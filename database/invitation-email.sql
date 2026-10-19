-- HH only: private, rate-limited email delivery for existing email-bound invitations.
create table private.invitation_mail_gate(id boolean primary key default true check(id));
insert into private.invitation_mail_gate values(true);
create table private.invitation_mail_deliveries(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('family','pilot')), invitation_id uuid not null,
 actor_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid references public.households(id) on delete cascade,
 recipient text not null, status text not null check(status in ('sending','sent','failed')),
 claim_id uuid, last_attempt_at timestamptz not null default now(), sent_at timestamptz,
 unique(kind,invitation_id)
);
create table private.invitation_mail_attempts(
 id uuid primary key, delivery_id uuid not null references private.invitation_mail_deliveries(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade, recipient text not null,
 started_at timestamptz not null default now(), status text not null check(status in ('sending','sent','failed'))
);
create index invitation_mail_attempt_actor on private.invitation_mail_attempts(actor_id,started_at);
create index invitation_mail_attempt_recipient on private.invitation_mail_attempts(recipient,started_at);
create index invitation_mail_attempt_time on private.invitation_mail_attempts(started_at);
create index invitation_mail_attempt_delivery on private.invitation_mail_attempts(delivery_id);
create index invitation_mail_delivery_actor on private.invitation_mail_deliveries(actor_id);
create index invitation_mail_delivery_household on private.invitation_mail_deliveries(household_id);
alter table private.invitation_mail_gate enable row level security;
alter table private.invitation_mail_deliveries enable row level security;
alter table private.invitation_mail_attempts enable row level security;
revoke all on private.invitation_mail_gate,private.invitation_mail_deliveries,private.invitation_mail_attempts from public,anon,authenticated;

-- Only the authenticated Edge Function can call this. Actor is taken from auth.getUser there.
create function private.invitation_mail_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=(payload->>'actorId')::uuid;
 invite_kind text:=payload->>'kind'; raw_token text:=payload->>'token';
 iid uuid; hid uuid; recipient_email text; home_name text; sender_name text; expiry timestamptz;
 delivery private.invitation_mail_deliveries%rowtype; claim uuid; result_status text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
  raise exception 'Sign in with a confirmed account to send invitations';
 end if;
 if action='finish' then
  claim:=(payload->>'claimId')::uuid; result_status:=payload->>'status';
  if result_status is null or result_status not in ('sent','failed') then raise exception 'Invalid delivery result';end if;
  update private.invitation_mail_deliveries set status=result_status,sent_at=case when result_status='sent' then now() else null end
   where actor_id=uid and claim_id=claim and status='sending';
  if not found then return jsonb_build_object('updated',false);end if;
  update private.invitation_mail_attempts set status=result_status where id=claim and actor_id=uid;
  return jsonb_build_object('updated',true);
 end if;
 if action is distinct from 'claim' or invite_kind is null or invite_kind not in ('family','pilot') or raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then
  raise exception 'Choose a valid invitation';
 end if;
 -- Serialize claims and rate-limit accounting across requests and household devices.
 perform 1 from private.invitation_mail_gate where id=true for update;
 if invite_kind='family' then
  select i.id,i.household_id,i.email,i.expires_at,h.name,m.display_name
   into iid,hid,recipient_email,expiry,home_name,sender_name
   from public.household_invites i
   join public.households h on h.id=i.household_id and h.owner_id=uid
   join public.household_members m on m.household_id=h.id and m.user_id=uid and m.role='owner'
   where i.token_hash=encode(sha256(convert_to(raw_token,'UTF8')),'hex') and i.used_at is null and i.expires_at>now();
 else
  select i.id,i.email,i.expires_at,coalesce(m.display_name,'The HH pilot host')
   into iid,recipient_email,expiry,sender_name
   from private.pilot_invites i
   join auth.users u on u.id=i.host_user_id
   join private.pilot_hosts p on p.email=lower(u.email)
   left join public.household_members m on m.user_id=u.id
   where i.host_user_id=uid and i.token_hash=encode(sha256(convert_to(raw_token,'UTF8')),'hex') and i.used_at is null and i.expires_at>now();
 end if;
 if iid is null then raise exception 'This invitation is unavailable, expired, or not yours to send';end if;
 select * into delivery from private.invitation_mail_deliveries where kind=invite_kind and invitation_id=iid;
 if delivery.status='sent' then return jsonb_build_object('status','sent');end if;
 if delivery.status='sending' and delivery.last_attempt_at>now()-interval '2 minutes' then return jsonb_build_object('status','sending');end if;
 if delivery.last_attempt_at>now()-interval '1 minute' then return jsonb_build_object('status','cooldown');end if;
 if (select count(*) from private.invitation_mail_attempts where actor_id=uid and started_at>now()-interval '1 hour')>=10
  or (select count(*) from private.invitation_mail_attempts where actor_id=uid and started_at>now()-interval '24 hours')>=20 then
  raise exception 'Invitation email limit reached. Share the link or try again later';
 end if;
 if (select count(*) from private.invitation_mail_attempts where recipient=recipient_email and started_at>now()-interval '1 hour')>=3
  or (select count(*) from private.invitation_mail_attempts where recipient=recipient_email and started_at>now()-interval '24 hours')>=5 then
  raise exception 'This address has received several invitations. Share the link or try again later';
 end if;
 if (select count(*) from private.invitation_mail_attempts where started_at>now()-interval '1 hour')>=30
  or (select count(*) from private.invitation_mail_attempts where started_at>now()-interval '24 hours')>=100 then
  raise exception 'Email sending is busy. Share the link or try again later';
 end if;
 claim:=gen_random_uuid();
 insert into private.invitation_mail_deliveries(kind,invitation_id,actor_id,household_id,recipient,status,claim_id,last_attempt_at)
  values(invite_kind,iid,uid,hid,recipient_email,'sending',claim,now())
  on conflict(kind,invitation_id) do update set status='sending',claim_id=excluded.claim_id,last_attempt_at=now()
  returning * into delivery;
 insert into private.invitation_mail_attempts(id,delivery_id,actor_id,recipient,status) values(claim,delivery.id,uid,recipient_email,'sending');
 return jsonb_build_object('status','claimed','claimId',claim,'deliveryId',delivery.id,'email',recipient_email,'expiresAt',expiry,'householdName',home_name,'senderName',sender_name);
end;$$;
revoke all on function private.invitation_mail_service(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.invitation_mail_service(text,jsonb) to service_role;
create function public.invitation_mail_service(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.invitation_mail_service(action,payload);$$;
revoke all on function public.invitation_mail_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.invitation_mail_service(text,jsonb) to service_role;
