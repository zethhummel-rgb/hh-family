-- Feedback is private to the sender and HH's email delivery service, never the family feed.
create table private.feedback_mail_gate(id boolean primary key default true check(id));
insert into private.feedback_mail_gate values(true);
create table private.feedback_submissions(
 id uuid primary key,
 actor_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 area text not null check(area in ('Home dashboard','Calendar','Groceries','To Do & Reminders','Meal planner','Family notes','Week overview','Household & invitations','Notifications','Appearance & settings','Sign-in & accounts','Other / General feedback','New Feature Suggestion')),
 message text not null check(length(btrim(message)) between 1 and 5000),
 status text not null default 'sending' check(status in ('sending','sent','uncertain')),
 created_at timestamptz not null default now(),sent_at timestamptz
);
create index feedback_actor_time on private.feedback_submissions(actor_id,created_at);
create index feedback_time on private.feedback_submissions(created_at);
create index feedback_household on private.feedback_submissions(household_id);
alter table private.feedback_mail_gate enable row level security;
alter table private.feedback_submissions enable row level security;
revoke all on private.feedback_mail_gate,private.feedback_submissions from public,anon,authenticated;

-- Service-only: actorId is verified with auth.getUser in the Edge Function.
create function private.feedback_mail_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=(payload->>'actorId')::uuid;
 rid uuid:=(payload->>'id')::uuid;
 hid uuid:=(payload->>'householdId')::uuid;
 row private.feedback_submissions%rowtype;
 sender_email text;sender_name text;home_name text;
begin
 if uid is null or rid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Confirmed account required';end if;
 if action='finish' then
  if payload->>'status' not in ('sent','uncertain') then raise exception 'Invalid status';end if;
  update private.feedback_submissions set status=payload->>'status',sent_at=case when payload->>'status'='sent' then now() else null end where id=rid and actor_id=uid and status='sending';
  return jsonb_build_object('updated',found);
 end if;
 if action<>'claim' or action is null then raise exception 'Invalid action';end if;
 select u.email,m.display_name,h.name into sender_email,sender_name,home_name from public.household_members m join auth.users u on u.id=m.user_id join public.households h on h.id=m.household_id where m.user_id=uid and m.household_id=hid;
 if not found then raise exception 'Household membership required';end if;
 perform 1 from private.feedback_mail_gate where id=true for update;
 select * into row from private.feedback_submissions where id=rid;
 if found then
  if row.actor_id<>uid or row.household_id<>hid or row.area is distinct from payload->>'area' or row.message is distinct from btrim(payload->>'message') then raise exception 'Submission mismatch';end if;
  return jsonb_build_object('status',case when row.status='sent' then 'sent' else 'pending' end);
 end if;
 if exists(select 1 from private.feedback_submissions where actor_id=uid and created_at>now()-interval '30 seconds')
 or (select count(*) from private.feedback_submissions where actor_id=uid and created_at>now()-interval '1 hour')>=5
 or (select count(*) from private.feedback_submissions where created_at>now()-interval '1 hour')>=100 then return jsonb_build_object('status','limited');end if;
 insert into private.feedback_submissions(id,actor_id,household_id,area,message) values(rid,uid,hid,payload->>'area',btrim(payload->>'message'));
 return jsonb_build_object('status','claimed','id',rid,'area',payload->>'area','message',btrim(payload->>'message'),'email',sender_email,'name',sender_name,'householdName',home_name);
end $$;
revoke all on function private.feedback_mail_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.feedback_mail_service(text,jsonb) to service_role;
create function public.feedback_mail_service(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.feedback_mail_service(action,payload)$$;
revoke all on function public.feedback_mail_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.feedback_mail_service(text,jsonb) to service_role;
