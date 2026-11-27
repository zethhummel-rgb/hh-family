-- Site administrators are provisioned explicitly. Household membership grants no access.
create table private.hh_site_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 verified_email text not null unique check (verified_email=lower(trim(verified_email)) and length(verified_email)>0),
 pilot_host_user_id uuid not null references auth.users(id) on delete cascade
);
alter table private.hh_site_admins enable row level security;
revoke all on private.hh_site_admins from public,anon,authenticated;

create function private.hh_site_admin_issuer(admin_user_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select a.pilot_host_user_id
 from private.hh_site_admins a
 join auth.users operator on operator.id=a.user_id
  and lower(operator.email)=a.verified_email and operator.email_confirmed_at is not null
 join auth.users issuer on issuer.id=a.pilot_host_user_id and issuer.email_confirmed_at is not null
 join private.pilot_hosts host on host.email=lower(issuer.email)
 where a.user_id=admin_user_id;
$$;
revoke all on function private.hh_site_admin_issuer(uuid) from public,anon,authenticated;

create function private.hh_admin_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('is_admin',eligible,'requires_mfa',eligible and (auth.jwt()->>'aal') is distinct from 'aal2')
 from (select private.hh_site_admin_issuer(auth.uid()) is not null as eligible) permitted;
$$;

create function public.hh_admin_status() returns jsonb
language sql stable security invoker set search_path='' as $$select private.hh_admin_status();$$;
revoke all on function private.hh_admin_status(),public.hh_admin_status() from public,anon,authenticated;
grant execute on function private.hh_admin_status(),public.hh_admin_status() to authenticated;

-- Keep the request inbox independent of the existing seven-day mail deduplication window.
create table private.hh_pilot_join_requests (
 id uuid primary key,
 name text not null check (char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
 email text not null check (email=lower(trim(email)) and char_length(email) between 3 and 254),
 heard_from text not null check (char_length(heard_from) between 1 and 160 and heard_from !~ '[[:cntrl:]]'),
 pilot_interest text not null check (pilot_interest in ('yes','maybe','no')),
 message text not null default '' check (char_length(message)<=1500),
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),
 status text not null check (status in ('sending','sent','uncertain','preview'))
);
alter table private.hh_pilot_join_requests enable row level security;
revoke all on private.hh_pilot_join_requests from public,anon,authenticated;

create function private.hh_admin_dashboard(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $dashboard$
declare
 issuer_id uuid:=private.hh_site_admin_issuer(auth.uid());
 invite_email text:=lower(btrim(payload->>'email'));
 raw_token text;
begin
 if issuer_id is null then raise exception 'Admin access required' using errcode='42501';end if;
 if (auth.jwt()->>'aal') is distinct from 'aal2' then
  raise exception 'Verify your second factor to continue' using errcode='42501';
 end if;

 if action='snapshot' then
  return jsonb_build_object(
   'requests',coalesce((
    select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'email',r.email,
     'heard_from',r.heard_from,'pilot_interest',r.pilot_interest,'message',r.message,'received_at',r.received_at,
     'status',case when r.status='sending' and r.received_at<now()-interval '2 minutes' then 'uncertain' else r.status end)
     order by r.received_at desc,r.id)
    from private.hh_pilot_join_requests r
   ),'[]'::jsonb),
   'invitations',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'created_at',i.created_at,
     'expires_at',i.expires_at,'used_at',i.used_at,'delivery_status',m.status) order by i.created_at desc,i.id)
    from private.pilot_invites i
    left join private.invitation_mail_deliveries m on m.kind='pilot' and m.invitation_id=i.id
    where i.host_user_id=issuer_id
   ),'[]'::jsonb),
   'capacity',jsonb_build_object('used',(
    select count(*) from private.pilot_invites where host_user_id=issuer_id and (used_at is not null or expires_at>now())
   ),'total',14)
  );
 end if;

 if action is distinct from 'create_invite' then raise exception 'Unsupported admin request';end if;
 if invite_email is null or char_length(invite_email)>254
  or invite_email !~ $email$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$$email$ then
  raise exception 'Enter a valid email address';
 end if;

 -- Take the same issuer-row lock as the Test Home pilot invitation controls.
 perform 1 from private.pilot_hosts host join auth.users issuer on lower(issuer.email)=host.email
 where issuer.id=issuer_id and issuer.email_confirmed_at is not null for update of host;
 if not found then raise exception 'Pilot host unavailable';end if;
 if exists(select 1 from private.pilot_invites where email=invite_email and (used_at is not null or expires_at>now())) then
  raise exception 'This email already has a pilot invitation';
 end if;
 if (select count(*) from private.pilot_invites where host_user_id=issuer_id and (used_at is not null or expires_at>now()))>=14 then
  raise exception 'This pilot has room for fourteen invited households. Revoke an unused invitation to free a place.';
 end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.pilot_invites(host_user_id,email,token_hash)
 values(issuer_id,invite_email,encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return jsonb_build_object('token',raw_token);
end;$dashboard$;

create function public.hh_admin_dashboard(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_admin_dashboard(action,payload);$$;
revoke all on function private.hh_admin_dashboard(text,jsonb),public.hh_admin_dashboard(text,jsonb) from public,anon,authenticated;
grant execute on function private.hh_admin_dashboard(text,jsonb),public.hh_admin_dashboard(text,jsonb) to authenticated;

alter table private.pilot_request_delivery drop constraint pilot_request_delivery_status_check;
alter table private.pilot_request_delivery add constraint pilot_request_delivery_status_check
 check (status in ('sending','sent','uncertain','preview'));

create or replace function private.pilot_request_mail_service(action text,payload jsonb) returns text
language plpgsql security definer set search_path='' as $request$
declare
 request_id uuid:=(payload->>'id')::uuid;
 sender_hash text:=payload->>'emailHash';
 request_hash text:=payload->>'contentHash';
 answers jsonb:=payload->'answers';
 request_email text:=lower(btrim(answers->>'email'));
 request_status text;
 existing private.pilot_request_delivery%rowtype;
 saved_request private.hh_pilot_join_requests%rowtype;
begin
 if request_id is null then raise exception 'Request ID required';end if;
 if action='finish' then
  request_status:=payload->>'status';
  if request_status is null or request_status not in ('sent','uncertain') then raise exception 'Invalid delivery status';end if;
  update private.pilot_request_delivery set status=request_status where id=request_id and status='sending';
  if found then
   update private.hh_pilot_join_requests set status=request_status where id=request_id and status='sending';
  end if;
  return 'finished';
 end if;
 if action is distinct from 'claim' then raise exception 'Invalid action';end if;

 -- Preserve the existing rate limits and insert the new inbox entry in the same transaction.
 lock table private.pilot_request_delivery in share row exclusive mode;
 delete from private.pilot_request_delivery where created_at<now()-interval '7 days';
 select * into existing from private.pilot_request_delivery where id=request_id;
 if found then
  if existing.email_hash is distinct from sender_hash or existing.content_hash is distinct from request_hash then return 'mismatch';end if;
  if existing.status='sending' and existing.created_at<now()-interval '2 minutes' then return 'uncertain';end if;
  return existing.status;
 end if;
 select * into saved_request from private.hh_pilot_join_requests where id=request_id;
 if found then
  if saved_request.content_hash is distinct from request_hash
   or encode(sha256(convert_to(saved_request.email,'UTF8')),'hex') is distinct from sender_hash then return 'mismatch';end if;
  if saved_request.status='sending' then return 'uncertain';end if;
  return saved_request.status;
 end if;
 if (select count(*) from private.pilot_request_delivery where email_hash=sender_hash and created_at>now()-interval '1 hour')>=3
  or (select count(*) from private.pilot_request_delivery where created_at>now()-interval '1 hour')>=30 then
  return 'limited';
 end if;

 request_status:=case when payload->'preview'='true'::jsonb then 'preview' else 'sending' end;
 if answers is not null then
  if jsonb_typeof(answers) is distinct from 'object'
   or jsonb_typeof(answers->'name') is distinct from 'string'
   or jsonb_typeof(answers->'email') is distinct from 'string'
   or jsonb_typeof(answers->'heardFrom') is distinct from 'string'
   or jsonb_typeof(answers->'pilotInterest') is distinct from 'string'
   or (answers ? 'message' and jsonb_typeof(answers->'message') is distinct from 'string')
   or request_email !~ $email$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$$email$
   or encode(sha256(convert_to(request_email,'UTF8')),'hex') is distinct from sender_hash then
   raise exception 'Invalid invitation request';
  end if;
  insert into private.hh_pilot_join_requests(id,name,email,heard_from,pilot_interest,message,content_hash,status)
  values(request_id,btrim(answers->>'name'),request_email,btrim(answers->>'heardFrom'),answers->>'pilotInterest',
   coalesce(answers->>'message',''),request_hash,request_status);
 elsif request_status='preview' then
  raise exception 'Invitation request answers required';
 end if;
 insert into private.pilot_request_delivery(id,email_hash,content_hash,status) values(request_id,sender_hash,request_hash,request_status);
 return case when request_status='preview' then 'preview' else 'claimed' end;
end;$request$;

-- The invitation Edge Function supplies siteAdmin only after verifying the caller's signed AAL2 session.
-- The service-only RPC verifies the current grant and shares the existing issuer's delivery quota.
create or replace function private.invitation_mail_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=(payload->>'actorId')::uuid;
 site_admin boolean:=coalesce(payload->'siteAdmin'='true'::jsonb,false);
 invite_kind text:=payload->>'kind'; raw_token text:=payload->>'token';
 iid uuid; hid uuid; recipient_email text; home_name text; sender_name text; expiry timestamptz;
 delivery private.invitation_mail_deliveries%rowtype; claim uuid; result_status text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
  raise exception 'Sign in with a confirmed account to send invitations';
 end if;
 if site_admin then
  uid:=private.hh_site_admin_issuer(uid);
  if uid is null or (action is distinct from 'finish' and invite_kind is distinct from 'pilot') then
   raise exception 'This invitation is unavailable, expired, or not yours to send';
  end if;
 end if;
 if action='finish' then
  claim:=(payload->>'claimId')::uuid; result_status:=payload->>'status';
  if result_status is null or result_status not in ('sent','failed') then raise exception 'Invalid delivery result';end if;
  update private.invitation_mail_deliveries set status=result_status,sent_at=case when result_status='sent' then now() else null end
   where actor_id=uid and claim_id=claim and status='sending' and (not site_admin or kind='pilot');
  if not found then return jsonb_build_object('updated',false);end if;
  update private.invitation_mail_attempts set status=result_status where id=claim and actor_id=uid;
  return jsonb_build_object('updated',true);
 end if;
 if action is distinct from 'claim' or invite_kind is null or invite_kind not in ('family','pilot') or raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then
  raise exception 'Choose a valid invitation';
 end if;
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
