-- HH fresh project only. No accounts, events, credentials, or production data are included.
begin;

-- schema.sql
-- Fresh HH pilot project only. Never run against an existing family or work database.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.households (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 80),
 owner_id uuid not null references auth.users(id), calendar_id text not null default '' check(char_length(calendar_id)<=300), created_at timestamptz not null default now()
);
create table public.household_members (
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 60),
 role text not null check(role in ('owner','member')), joined_at timestamptz not null default now()
);
create index household_members_household_idx on public.household_members(household_id);
create index households_owner_idx on public.households(owner_id);
create table public.household_items (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 kind text not null check(kind in ('grocery','task')), title text not null check(char_length(title) between 1 and 160),
 category text not null default 'Other' check(category in ('Produce','Dairy & eggs','Meat & fish','Bakery','Pantry','Frozen','Household','Other')),
 person text not null default 'Everyone' check(char_length(person) between 1 and 60), due date, done boolean not null default false,
 created_at timestamptz not null default now()
);
create index household_items_household_idx on public.household_items(household_id,created_at);
create table public.household_invites (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 email text not null check(char_length(email) between 3 and 254), token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '7 days', used_at timestamptz, created_at timestamptz not null default now()
);
create index household_invites_household_idx on public.household_invites(household_id);
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_items enable row level security;
alter table public.household_invites enable row level security;
-- Private membership lookup avoids recursive membership RLS. Only the signed-in caller can be checked.
create function private.is_member(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.household_members where household_id=hid and user_id=(select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public,anon;
grant execute on function private.is_member(uuid) to authenticated;
create policy household_read on public.households for select to authenticated using(private.is_member(id));
create policy household_owner_update on public.households for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy member_read on public.household_members for select to authenticated using(private.is_member(household_id));
create policy item_read on public.household_items for select to authenticated using(private.is_member(household_id));
create policy item_add on public.household_items for insert to authenticated with check(private.is_member(household_id));
create policy item_update on public.household_items for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy item_delete on public.household_items for delete to authenticated using(private.is_member(household_id));
create policy invite_owner_read on public.household_invites for select to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
create policy invite_owner_delete on public.household_invites for delete to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
revoke all on public.households,public.household_members,public.household_items,public.household_invites from anon,authenticated;
grant select on public.households,public.household_members to authenticated;
grant update(calendar_id) on public.households to authenticated;
grant select,delete on public.household_invites to authenticated;
grant select,insert,delete on public.household_items to authenticated;
grant update(title,category,person,due,done) on public.household_items to authenticated;
-- Atomic onboarding and email-bound invitation redemption need controlled elevated writes.
create function private.create_household(household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name'; end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 return hid;
end; $$;
create function private.create_household_invite(invite_email text) returns text language plpgsql security definer set search_path='' as $$
declare hid uuid; raw_token text; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first'; end if;
 select h.id into hid from public.households h join public.household_members m on m.household_id=h.id where m.user_id=uid and h.owner_id=uid;
 if hid is null then raise exception 'Only the household owner can invite members'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from public.household_invites where household_id=hid and used_at is null and expires_at>now())>=20 then raise exception 'Revoke an unused invitation before creating another'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.household_invites(household_id,email,token_hash) values(hid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return raw_token;
end; $$;
create function private.accept_household_invite(invite_token text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.household_invites%rowtype; uid uuid:=auth.uid(); current_email text;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 select lower(email) into current_email from auth.users where id=uid and email_confirmed_at is not null;
 if current_email is null then raise exception 'Confirm your email before joining'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if invite_token is null or char_length(invite_token)<>64 then raise exception 'Invitation is invalid or expired'; end if;
 if member_name is null or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name'; end if;
 select * into inv from public.household_invites where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and used_at is null and expires_at>now() for update;
 if not found or inv.email<>current_email then raise exception 'Invitation is invalid, expired, or belongs to a different email'; end if;
 insert into public.household_members(household_id,user_id,display_name,role) values(inv.household_id,uid,trim(member_name),'member');
 update public.household_invites set used_at=now() where id=inv.id;
 return inv.household_id;
end; $$;
revoke all on function private.create_household(text,text),private.create_household_invite(text),private.accept_household_invite(text,text) from public,anon;
grant execute on function private.create_household(text,text),private.create_household_invite(text),private.accept_household_invite(text,text) to authenticated;
-- Public API wrappers retain invoker privileges; elevated implementations stay in the private schema.
create function public.create_household(household_name text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.create_household(household_name,member_name);$$;
create function public.create_household_invite(invite_email text) returns text language sql security invoker set search_path='' as $$select private.create_household_invite(invite_email);$$;
create function public.accept_household_invite(invite_token text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.accept_household_invite(invite_token,member_name);$$;
revoke all on function public.create_household(text,text),public.create_household_invite(text),public.accept_household_invite(text,text) from public,anon;
grant execute on function public.create_household(text,text),public.create_household_invite(text),public.accept_household_invite(text,text) to authenticated;


-- calendar.sql
create table public.household_events (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160),
 description text not null default '' check(char_length(description)<=4000),
 location text not null default '' check(char_length(location)<=300),
 person text not null default 'Everyone' check(char_length(person) between 1 and 60),
 starts_at timestamptz not null, ends_at timestamptz not null,
 all_day boolean not null default false,
 start_date date, end_date date,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 check(ends_at>starts_at),
 check((not all_day and start_date is null and end_date is null) or (all_day and start_date is not null and end_date>start_date))
);
create index household_events_household_start on public.household_events(household_id,starts_at);
alter table public.household_events enable row level security;
create policy events_read on public.household_events for select to authenticated using(private.is_member(household_id));
create policy events_add on public.household_events for insert to authenticated with check(private.is_member(household_id));
create policy events_update on public.household_events for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy events_delete on public.household_events for delete to authenticated using(private.is_member(household_id));
revoke all on public.household_events from anon,authenticated;
grant select,insert,delete on public.household_events to authenticated;
grant update(title,description,location,person,starts_at,ends_at,all_day,start_date,end_date,version) on public.household_events to authenticated;


-- google_calendar.sql
-- Provider refresh tokens remain encrypted in Vault and are never exposed to browsers.
create table private.google_calendar_states (
 state_hash text primary key, verifier text not null, user_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade, expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.google_calendar_connections (
 household_id uuid primary key references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), secret_id uuid not null,
 calendar_id text not null, migration_complete boolean not null default false, connected_at timestamptz not null default now()
);
create index google_calendar_states_user on private.google_calendar_states(user_id);
create index google_calendar_states_household on private.google_calendar_states(household_id);
create index google_calendar_connections_user on private.google_calendar_connections(user_id);
alter table private.google_calendar_states enable row level security;
alter table private.google_calendar_connections enable row level security;
revoke all on private.google_calendar_states,private.google_calendar_connections from public,anon,authenticated;
create function private.calendar_service(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; sid uuid; old_sid uuid;
begin
 if action='state_create' then
  delete from private.google_calendar_states where expires_at<now() or user_id=(payload->>'userId')::uuid;
  insert into private.google_calendar_states(state_hash,verifier,user_id,household_id) values(payload->>'hash',payload->>'verifier',(payload->>'userId')::uuid,(payload->>'householdId')::uuid);
  return '{}'::jsonb;
 elsif action='state_take' then
  delete from private.google_calendar_states where state_hash=payload->>'hash' and expires_at>now() returning to_jsonb(google_calendar_states.*) into result;
  return result;
 elsif action='connection_get' then
  select jsonb_build_object('calendarId',c.calendar_id,'refreshToken',v.decrypted_secret,'userId',c.user_id,'migrationComplete',c.migration_complete) into result
  from private.google_calendar_connections c join vault.decrypted_secrets v on v.id=c.secret_id where c.household_id=(payload->>'householdId')::uuid;
  return result;
 elsif action='connection_set' then
  select secret_id into old_sid from private.google_calendar_connections where household_id=(payload->>'householdId')::uuid;
  select vault.create_secret(payload->>'refreshToken') into sid;
  insert into private.google_calendar_connections(household_id,user_id,secret_id,calendar_id) values((payload->>'householdId')::uuid,(payload->>'userId')::uuid,sid,payload->>'calendarId')
  on conflict(household_id) do update set user_id=excluded.user_id,secret_id=excluded.secret_id,calendar_id=excluded.calendar_id,connected_at=now(),migration_complete=false;
  if old_sid is not null then delete from vault.secrets where id=old_sid;end if;
  return '{}'::jsonb;
 elsif action='migration_done' then
  update private.google_calendar_connections set migration_complete=true where household_id=(payload->>'householdId')::uuid;
  return '{}'::jsonb;
 end if;
 raise exception 'Unsupported calendar service operation';
end;$$;
revoke all on function private.calendar_service(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.calendar_service(text,jsonb) to service_role;
create function public.calendar_service(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.calendar_service(action,payload);$$;
revoke all on function public.calendar_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_service(text,jsonb) to service_role;


-- calendar_integrity.sql
-- Freeze native writes once Google migration starts, preserving a stable import snapshot.
create function private.native_calendar_writable(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_member(hid) and not exists(select 1 from private.google_calendar_connections where household_id=hid);
$$;
revoke all on function private.native_calendar_writable(uuid) from public,anon;
grant execute on function private.native_calendar_writable(uuid) to authenticated;
alter policy events_add on public.household_events with check(private.native_calendar_writable(household_id));
alter policy events_update on public.household_events using(private.native_calendar_writable(household_id)) with check(private.native_calendar_writable(household_id));
alter policy events_delete on public.household_events using(private.native_calendar_writable(household_id));


-- member-colours.sql
alter table public.household_members add column if not exists calendar_color text check(calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$');
-- Existing membership reads remain household-scoped. Only a member's own colour is writable.
grant update(calendar_color) on public.household_members to authenticated;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='household_members' and policyname='member_own_colour') then
  create policy member_own_colour on public.household_members for update to authenticated
   using(user_id=(select auth.uid()) and private.is_member(household_id))
   with check(user_id=(select auth.uid()) and private.is_member(household_id));
 end if;
end$$;
alter table public.household_events add column if not exists person_ids text[] check(person_ids is null or (cardinality(person_ids)<=20 and array_position(person_ids,null) is null));
grant update(person_ids) on public.household_events to authenticated;


-- push-reminders.sql
-- Only the authenticated Edge handler can manage device subscriptions or read push keys.
alter table public.household_events add column if not exists reminder_minutes integer check (reminder_minutes between 0 and 10080);
grant update(reminder_minutes) on public.household_events to authenticated;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table if not exists private.push_settings (
 id boolean primary key default true check(id), key_secret_id uuid not null,
 lease_until timestamptz, last_run_at timestamptz, last_result jsonb
);
create table if not exists private.push_devices (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=4096), subscription jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_test_at timestamptz
);
create index if not exists push_devices_household_user on private.push_devices(household_id,user_id);
create index if not exists push_devices_user on private.push_devices(user_id);
create table if not exists private.push_deliveries (
 device_id uuid not null references private.push_devices(id) on delete cascade,
 delivery_key text not null check(length(delivery_key)<=1600), state text not null check(state in ('sending','sent','expired')),
 attempts integer not null default 1, lease_until timestamptz not null default now()+interval '2 minutes',
 created_at timestamptz not null default now(), primary key(device_id,delivery_key)
);
alter table private.push_settings enable row level security;
alter table private.push_devices enable row level security;
alter table private.push_deliveries enable row level security;
revoke all on private.push_settings,private.push_devices,private.push_deliveries from public,anon,authenticated;
-- A random scheduler credential is generated inside Postgres; never embedded in a job or source file.
do $$begin
 if not exists(select 1 from vault.secrets where name='hummel_push_cron') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'hummel_push_cron');
 end if;
end$$;
create or replace function private.push_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; device uuid; key_id uuid; hid uuid; uid uuid;
begin
 if action='config' then
  perform pg_advisory_xact_lock(638164725);
  if not exists(select 1 from private.push_settings) then
   if payload->'keys' is null then return null;end if;
   key_id:=vault.create_secret((payload->'keys')::text);
   insert into private.push_settings(id,key_secret_id) values(true,key_id);
  end if;
  select (v.decrypted_secret::jsonb)->'publicKey' into result from private.push_settings s join vault.decrypted_secrets v on v.id=s.key_secret_id;
  return result;
 elsif action='secrets' then
  select jsonb_build_object('keys',(select v.decrypted_secret::jsonb from private.push_settings s join vault.decrypted_secrets v on v.id=s.key_secret_id),
   'cronSecret',(select decrypted_secret from vault.decrypted_secrets where name='hummel_push_cron')) into result;
  return result;
 elsif action='lock' then
  update private.push_settings set lease_until=now()+interval '90 seconds' where id and (lease_until is null or lease_until<now()) returning 'true'::jsonb into result;
  return coalesce(result,'false'::jsonb);
 elsif action='unlock' then
  update private.push_settings set lease_until=null,last_run_at=now(),last_result=payload where id;
  delete from private.push_deliveries where created_at<now()-interval '30 days';
  return '{}'::jsonb;
 elsif action='households' then
  select coalesce(jsonb_agg(distinct d.household_id),'[]'::jsonb) into result from private.push_devices d join public.household_members m on m.household_id=d.household_id and m.user_id=d.user_id;
  return result;
 elsif action='devices' then
  select coalesce(jsonb_agg(to_jsonb(d.*)),'[]'::jsonb) into result from private.push_devices d join public.household_members m on m.household_id=d.household_id and m.user_id=d.user_id where d.household_id=(payload->>'householdId')::uuid;
  return result;
 elsif action in ('subscribe','status','unsubscribe','test') then
  hid:=(payload->>'householdId')::uuid;uid:=(payload->>'userId')::uuid;
  if not exists(select 1 from public.household_members where household_id=hid and user_id=uid) then raise exception 'Current household membership required';end if;
  if action='subscribe' then
   if (select count(*) from private.push_devices where user_id=uid)>=10 and not exists(select 1 from private.push_devices where endpoint=payload->>'endpoint') then raise exception 'Ten devices are already enabled';end if;
   -- Reassign a shared browser only when its existing encryption keys match.
   insert into private.push_devices(household_id,user_id,endpoint,subscription) values(hid,uid,payload->>'endpoint',payload->'subscription')
   on conflict(endpoint) do update set household_id=excluded.household_id,user_id=excluded.user_id,subscription=excluded.subscription,updated_at=now()
    where private.push_devices.subscription->'keys'=excluded.subscription->'keys'
   returning id into device;
   if device is null then raise exception 'Renew this device subscription';end if;
   return jsonb_build_object('enabled',true);
  elsif action='status' then
   return jsonb_build_object('enabled',exists(select 1 from private.push_devices where household_id=hid and user_id=uid and endpoint=payload->>'endpoint'));
  elsif action='unsubscribe' then
   delete from private.push_devices where household_id=hid and user_id=uid and endpoint=payload->>'endpoint';return '{}'::jsonb;
  else
   update private.push_devices set last_test_at=now() where household_id=hid and user_id=uid and endpoint=payload->>'endpoint' and (last_test_at is null or last_test_at<now()-interval '1 minute') returning to_jsonb(push_devices.*) into result;
   return result;
  end if;
 elsif action='retire' then
  delete from private.push_devices where id=(payload->>'deviceId')::uuid;return '{}'::jsonb;
 elsif action='claim' then
  -- Recheck membership at dispatch; a removed member cannot keep receiving reminders.
  if not exists(select 1 from private.push_devices d join public.household_members m on m.household_id=d.household_id and m.user_id=d.user_id where d.id=(payload->>'deviceId')::uuid and d.user_id=(payload->>'userId')::uuid) then return 'false'::jsonb;end if;
  insert into private.push_deliveries(device_id,delivery_key,state) values((payload->>'deviceId')::uuid,payload->>'key','sending')
  on conflict(device_id,delivery_key) do update set state='sending',attempts=private.push_deliveries.attempts+1,lease_until=now()+interval '2 minutes'
   where private.push_deliveries.state='sending' and private.push_deliveries.lease_until<now() and private.push_deliveries.attempts<3
  returning device_id into device;
  return to_jsonb(device is not null);
 elsif action='finish' then
  update private.push_deliveries set state=case when payload->>'state'='sent' then 'sent' else 'expired' end where device_id=(payload->>'deviceId')::uuid and delivery_key=payload->>'key';return '{}'::jsonb;
 end if;
 raise exception 'Unknown push operation';
end$$;
revoke all on function private.push_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.push_service(text,jsonb) to service_role;
create or replace function public.push_service(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.push_service(action,payload);$$;
revoke all on function public.push_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.push_service(text,jsonb) to service_role;
create or replace function private.dispatch_reminders() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='home_together_api_url')||'/functions/v1/event-reminders',
  headers:=jsonb_build_object('Content-Type','application/json','x-hummel-cron',(select decrypted_secret from vault.decrypted_secrets where name='hummel_push_cron')),
  body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=55000
 );
$$;
revoke all on function private.dispatch_reminders() from public,anon,authenticated;
-- One job; redeploying the migration updates it instead of adding a duplicate.
select cron.schedule('hummel-event-reminders','* * * * *','select private.dispatch_reminders();');


-- recurring-reminders.sql
-- Extend existing household tasks; existing tasks remain undated/silent unless configured.
alter table public.household_items
 add column if not exists reminder_time time without time zone,
 add column if not exists repeat_unit text not null default 'none' check(repeat_unit in ('none','day','week','month','year')),
 add column if not exists repeat_every integer not null default 1 check(repeat_every between 1 and 999),
 add column if not exists repeat_anchor date,
 add column if not exists reminder_version integer not null default 1,
 add column if not exists last_completed_at timestamptz,
 add column if not exists remind_at timestamptz generated always as ((due+reminder_time) at time zone 'America/Toronto') stored;
alter table public.household_items add constraint household_reminder_schedule check (
 (reminder_time is null or due is not null) and (repeat_unit='none' or due is not null)
 and (kind='task' or (reminder_time is null and repeat_unit='none'))
);
grant update(reminder_time,repeat_unit,repeat_every) on public.household_items to authenticated;
create index if not exists household_reminders_due on public.household_items(remind_at,household_id) where kind='task' and not done and reminder_time is not null;
create or replace function private.advance_reminder(anchor date,unit text,every integer,after_date date) returns date
language plpgsql immutable set search_path='' as $$
declare step integer; n integer; candidate date;
begin
 if anchor is null or after_date is null or every not between 1 and 999 then raise exception 'Invalid repeat schedule';end if;
 if unit in ('day','week') then
  step:=every*case when unit='week' then 7 else 1 end;
  n:=greatest(1,floor((after_date-anchor)::numeric/step)::integer+1);
  return anchor+n*step;
 elsif unit='month' then
  n:=greatest(1,floor(((extract(year from after_date)-extract(year from anchor))*12+extract(month from after_date)-extract(month from anchor))/every)::integer);
  candidate:=(anchor+make_interval(months=>n*every))::date;
  if candidate<=after_date then candidate:=(anchor+make_interval(months=>(n+1)*every))::date;end if;
  return candidate;
 elsif unit='year' then
  n:=greatest(1,floor((extract(year from after_date)-extract(year from anchor))/every)::integer);
  candidate:=(anchor+make_interval(years=>n*every))::date;
  if candidate<=after_date then candidate:=(anchor+make_interval(years=>(n+1)*every))::date;end if;
  return candidate;
 end if;
 raise exception 'Invalid repeat unit';
end$$;
revoke all on function private.advance_reminder(date,text,integer,date) from public,anon;
grant execute on function private.advance_reminder(date,text,integer,date) to authenticated,service_role;
create or replace function private.maintain_reminder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.reminder_version:=1;new.repeat_anchor:=new.due;new.last_completed_at:=null;
 elsif new.kind='task' then
  new.reminder_version:=old.reminder_version+1;new.last_completed_at:=old.last_completed_at;
  if new.done and not old.done then
   new.last_completed_at:=now();
   if new.repeat_unit<>'none' then
    -- Keep the original day anchor through shorter months and leap years.
    new.repeat_anchor:=coalesce(old.repeat_anchor,old.due);
    new.due:=private.advance_reminder(new.repeat_anchor,new.repeat_unit,new.repeat_every,greatest(old.due,(now() at time zone 'America/Toronto')::date));
    new.done:=false;
   end if;
  elsif new.due is distinct from old.due or new.repeat_unit<>old.repeat_unit or new.repeat_every<>old.repeat_every then
   new.repeat_anchor:=new.due;
  else new.repeat_anchor:=old.repeat_anchor;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.maintain_reminder() from public,anon,authenticated;
create trigger household_reminder_schedule before insert or update on public.household_items for each row execute function private.maintain_reminder();


-- reminder-completion-guard.sql
-- Keep completed repeats waiting until the next Eastern calendar date.
create or replace function private.maintain_reminder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.reminder_version:=1;new.repeat_anchor:=new.due;new.last_completed_at:=null;
 elsif new.kind='task' then
  -- The previous occurrence is done. A repeat cannot be completed again before
  -- its next date, even by an old client or a second family member.
  if new.done and not old.done and old.repeat_unit<>'none'
    and old.last_completed_at is not null
    and old.due>(now() at time zone 'America/Toronto')::date then
   return old;
  end if;
  new.reminder_version:=old.reminder_version+1;new.last_completed_at:=old.last_completed_at;
  if new.done and not old.done then
   new.last_completed_at:=now();
   if new.repeat_unit<>'none' then
    -- Keep the original day anchor through shorter months and leap years.
    new.repeat_anchor:=coalesce(old.repeat_anchor,old.due);
    new.due:=private.advance_reminder(new.repeat_anchor,new.repeat_unit,new.repeat_every,greatest(old.due,(now() at time zone 'America/Toronto')::date));
    new.done:=false;
   end if;
  elsif new.due is distinct from old.due or new.repeat_unit<>old.repeat_unit or new.repeat_every<>old.repeat_every then
   new.repeat_anchor:=new.due;
  else new.repeat_anchor:=old.repeat_anchor;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.maintain_reminder() from public,anon,authenticated;


-- pilot.sql
-- Fresh HH pilot only. Apply after schema.sql. Never apply to Hummel Home.
create table private.pilot_hosts (
 email text primary key check(email=lower(trim(email)))
);
create table private.pilot_invites (
 id uuid primary key default gen_random_uuid(),
 host_user_id uuid not null references auth.users(id),
 email text not null, token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '14 days',
 used_at timestamptz, household_id uuid references public.households(id),
 created_at timestamptz not null default now()
);
create index pilot_invites_host on private.pilot_invites(host_user_id);
create index pilot_invites_home on private.pilot_invites(household_id);
alter table private.pilot_hosts enable row level security;
alter table private.pilot_invites enable row level security;
revoke all on private.pilot_hosts,private.pilot_invites from public,anon,authenticated;
create function private.is_pilot_host() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=(select auth.uid()) and u.email_confirmed_at is not null);
$$;
revoke all on function private.is_pilot_host() from public,anon;
grant execute on function private.is_pilot_host() to authenticated;
create function public.pilot_status() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('is_host',private.is_pilot_host());
$$;
revoke all on function public.pilot_status() from public,anon;
grant execute on function public.pilot_status() to authenticated;
-- The host can make their own first home; other families must redeem an invitation.
create or replace function private.create_household(household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; uid uuid:=auth.uid();
begin
 if uid is null or not private.is_pilot_host() then raise exception 'New households are invitation-only. Open your invitation link.'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if household_name is null or member_name is null or char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name'; end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 return hid;
end;$$;
create function private.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); raw_token text;
begin
 if uid is null or not private.is_pilot_host() then raise exception 'Pilot host access required'; end if;
 -- Serialize slot allocation across devices.
 perform 1 from private.pilot_hosts h join auth.users u on lower(u.email)=h.email where u.id=uid for update of h;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'used_at',i.used_at) order by i.created_at desc) from private.pilot_invites i where i.host_user_id=uid),'[]'::jsonb);
 elsif action='revoke' then
  delete from private.pilot_invites where id=invitation_id and host_user_id=uid and used_at is null;
  return '{}'::jsonb;
 elsif action<>'create' then raise exception 'Unsupported pilot request'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from private.pilot_invites where host_user_id=uid and (used_at is not null or expires_at>now()))>=3 then raise exception 'This pilot has room for three invited households. Revoke an unused invitation to free a place.'; end if;
 if exists(select 1 from private.pilot_invites where email=lower(trim(invite_email)) and (used_at is not null or expires_at>now())) then raise exception 'This email already has a pilot invitation'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.pilot_invites(host_user_id,email,token_hash) values(uid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return jsonb_build_object('token',raw_token);
end;$$;
create function private.create_pilot_household(pilot_token text,household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current_email text; inv private.pilot_invites%rowtype; hid uuid;
begin
 if uid is null then raise exception 'Sign in first';end if;
 select lower(email) into current_email from auth.users where id=uid and email_confirmed_at is not null;
 if current_email is null then raise exception 'Confirm your email before creating your home';end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household';end if;
 if pilot_token is null or char_length(pilot_token)<>64 then raise exception 'Invitation is invalid or expired';end if;
 if household_name is null or member_name is null or char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name';end if;
 select * into inv from private.pilot_invites where token_hash=encode(sha256(convert_to(pilot_token,'UTF8')),'hex') and used_at is null and expires_at>now() for update;
 if not found or inv.email<>current_email then raise exception 'Invitation is invalid, expired, or belongs to another email';end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 update private.pilot_invites set used_at=now(),household_id=hid where id=inv.id;
 return hid;
end;$$;
revoke all on function private.pilot_invitations(text,text,uuid),private.create_pilot_household(text,text,text) from public,anon;
grant execute on function private.pilot_invitations(text,text,uuid),private.create_pilot_household(text,text,text) to authenticated;
create function public.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.pilot_invitations(action,invite_email,invitation_id);$$;
create function public.create_pilot_household(pilot_token text,household_name text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.create_pilot_household(pilot_token,household_name,member_name);$$;
revoke all on function public.pilot_invitations(text,text,uuid),public.create_pilot_household(text,text,text) from public,anon;
grant execute on function public.pilot_invitations(text,text,uuid),public.create_pilot_household(text,text,text) to authenticated;
-- Owner-controlled profiles for children or other family members without a login.
alter table public.household_members add constraint member_home_user_unique unique(household_id,user_id);
create table public.household_people (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 display_name text not null check(char_length(trim(display_name)) between 1 and 60),
 calendar_color text not null check(calendar_color~'^#[0-9A-Fa-f]{6}$'), linked_user_id uuid,
 created_at timestamptz not null default now(),
 foreign key(household_id,linked_user_id) references public.household_members(household_id,user_id)
);
create index household_people_home on public.household_people(household_id);
create index household_people_linked_user on public.household_people(household_id,linked_user_id);
alter table public.household_people enable row level security;
revoke all on public.household_people from public,anon,authenticated;
grant select on public.household_people to authenticated;
grant update(display_name,calendar_color,linked_user_id) on public.household_people to authenticated;
create policy people_read on public.household_people for select to authenticated using(private.is_member(household_id));
create policy people_owner_update on public.household_people for update to authenticated
 using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())))
 with check(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
create function private.add_household_person(person_name text,person_color text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; pid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first';end if;
 select id into hid from public.households where owner_id=uid for update;
 if hid is null then raise exception 'Only the household owner can add family profiles';end if;
 if (select count(*) from public.household_people where household_id=hid)>=20 then raise exception 'This home already has twenty family profiles';end if;
 if person_name is null or char_length(trim(person_name)) not between 1 and 60 or person_color is null or person_color!~'^#[0-9A-Fa-f]{6}$' then raise exception 'Enter a name and valid colour';end if;
 insert into public.household_people(household_id,display_name,calendar_color) values(hid,trim(person_name),person_color) returning id into pid;
 return pid;
end;$$;
revoke all on function private.add_household_person(text,text) from public,anon;
grant execute on function private.add_household_person(text,text) to authenticated;
create function public.add_household_person(person_name text,person_color text) returns uuid language sql security invoker set search_path='' as $$select private.add_household_person(person_name,person_color);$$;
revoke all on function public.add_household_person(text,text) from public,anon;
grant execute on function public.add_household_person(text,text) to authenticated;
grant update(name) on public.households to authenticated;

alter table public.households add constraint household_name_not_blank check(char_length(trim(name))>=1);
grant all on public.household_people to service_role;


-- invitation-email.sql
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


-- pilot-seven-spots.sql
-- HH only: increase the pilot to seven invited households; existing invitations keep their places.
create or replace function private.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); raw_token text;
begin
 if uid is null or not private.is_pilot_host() then raise exception 'Pilot host access required'; end if;
 -- Serialize slot allocation across devices.
 perform 1 from private.pilot_hosts h join auth.users u on lower(u.email)=h.email where u.id=uid for update of h;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'used_at',i.used_at) order by i.created_at desc) from private.pilot_invites i where i.host_user_id=uid),'[]'::jsonb);
 elsif action='revoke' then
  delete from private.pilot_invites where id=invitation_id and host_user_id=uid and used_at is null;
  return '{}'::jsonb;
 elsif action<>'create' then raise exception 'Unsupported pilot request'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from private.pilot_invites where host_user_id=uid and (used_at is not null or expires_at>now()))>=7 then raise exception 'This pilot has room for seven invited households. Revoke an unused invitation to free a place.'; end if;
 if exists(select 1 from private.pilot_invites where email=lower(trim(invite_email)) and (used_at is not null or expires_at>now())) then raise exception 'This email already has a pilot invitation'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.pilot_invites(host_user_id,email,token_hash) values(uid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return jsonb_build_object('token',raw_token);
end;$$;
revoke all on function private.pilot_invitations(text,text,uuid) from public,anon;
grant execute on function private.pilot_invitations(text,text,uuid) to authenticated;


-- native-calendar-repeats.sql
-- Native repeats retain the existing household RLS and optimistic version checks.
alter table public.household_events add column recurrence text[] not null default '{}';
alter table public.household_events add column exceptions jsonb not null default '{}';
grant update(recurrence,exceptions) on public.household_events to authenticated;

create function private.validate_native_event_repeats() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rule text; pair record; item public.household_events; k text; until_value text;
begin
 if cardinality(new.recurrence)>1 or array_position(new.recurrence,null) is not null then
  raise exception 'Choose one supported repeat pattern';
 end if;
 if cardinality(new.recurrence)=1 then
  rule:=new.recurrence[1];
  if rule !~ '^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY);INTERVAL=[1-9][0-9]{0,2}(;COUNT=[1-9][0-9]{0,3}|;UNTIL=[0-9]{8}(T[0-9]{6}Z)?)?$' then
   raise exception 'Choose a supported repeat pattern';
  end if;
  until_value:=substring(rule from 'UNTIL=([0-9]{8})');
  if until_value is not null then
   perform (substring(until_value,1,4)||'-'||substring(until_value,5,2)||'-'||substring(until_value,7,2))::date;
   if new.all_day <> (rule !~ 'T[0-9]{6}Z$') then raise exception 'Repeat ending does not match event type'; end if;
  end if;
 end if;
 if jsonb_typeof(new.exceptions)<>'object' or octet_length(new.exceptions::text)>500000 then raise exception 'Too many changed occurrences';end if;
 for pair in select * from jsonb_each(new.exceptions) loop
  if pair.key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid occurrence date';end if;
  perform pair.key::date;
  if pair.value='null'::jsonb then continue;end if;
  if jsonb_typeof(pair.value)<>'object' then raise exception 'Invalid occurrence details';end if;
  for k in select jsonb_object_keys(pair.value) loop
   if k not in ('title','description','location','person','person_ids','reminder_minutes','starts_at','ends_at','all_day','start_date','end_date') then raise exception 'Invalid occurrence field';end if;
  end loop;
  item:=jsonb_populate_record(null::public.household_events,pair.value);
  if item.title is null or char_length(item.title) not between 1 and 160 or item.description is null or char_length(item.description)>4000 or item.location is null or char_length(item.location)>300 or item.person is null or char_length(item.person) not between 1 and 60 or item.starts_at is null or item.ends_at is null or item.ends_at<=item.starts_at or item.all_day is null then raise exception 'Check occurrence details';end if;
  if (item.all_day and (item.start_date is null or item.end_date is null or item.end_date<=item.start_date)) or (not item.all_day and (item.start_date is not null or item.end_date is not null)) then raise exception 'Invalid occurrence dates';end if;
  if item.reminder_minutes is not null and item.reminder_minutes not between 0 and 10080 then raise exception 'Invalid reminder';end if;
  if cardinality(item.person_ids)>20 or array_position(item.person_ids,null) is not null then raise exception 'Invalid event people';end if;
 end loop;
 return new;
end $$;
revoke all on function private.validate_native_event_repeats() from public,anon,authenticated;
create trigger validate_native_event_repeats before insert or update on public.household_events for each row execute function private.validate_native_event_repeats();


-- event-notification-toggle.sql
-- Keep the default alert independent of the optional additional reminder.
alter table public.household_events add column reminder_30_enabled boolean not null default true;
grant update(reminder_30_enabled) on public.household_events to authenticated;

create or replace function private.validate_native_event_repeats() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rule text; pair record; item public.household_events; k text; until_value text;
begin
 if cardinality(new.recurrence)>1 or array_position(new.recurrence,null) is not null then
  raise exception 'Choose one supported repeat pattern';
 end if;
 if cardinality(new.recurrence)=1 then
  rule:=new.recurrence[1];
  if rule !~ '^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY);INTERVAL=[1-9][0-9]{0,2}(;COUNT=[1-9][0-9]{0,3}|;UNTIL=[0-9]{8}(T[0-9]{6}Z)?)?$' then
   raise exception 'Choose a supported repeat pattern';
  end if;
  until_value:=substring(rule from 'UNTIL=([0-9]{8})');
  if until_value is not null then
   perform (substring(until_value,1,4)||'-'||substring(until_value,5,2)||'-'||substring(until_value,7,2))::date;
   if new.all_day <> (rule !~ 'T[0-9]{6}Z$') then raise exception 'Repeat ending does not match event type'; end if;
  end if;
 end if;
 if jsonb_typeof(new.exceptions)<>'object' or octet_length(new.exceptions::text)>500000 then raise exception 'Too many changed occurrences';end if;
 for pair in select * from jsonb_each(new.exceptions) loop
  if pair.key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid occurrence date';end if;
  perform pair.key::date;
  if pair.value='null'::jsonb then continue;end if;
  if jsonb_typeof(pair.value)<>'object' then raise exception 'Invalid occurrence details';end if;
  for k in select jsonb_object_keys(pair.value) loop
   if k not in ('title','description','location','person','person_ids','reminder_minutes','reminder_30_enabled','starts_at','ends_at','all_day','start_date','end_date') then raise exception 'Invalid occurrence field';end if;
  end loop;
  if pair.value ? 'reminder_30_enabled' and jsonb_typeof(pair.value->'reminder_30_enabled')<>'boolean' then raise exception 'Invalid notification switch';end if;
  item:=jsonb_populate_record(null::public.household_events,pair.value);
  if item.title is null or char_length(item.title) not between 1 and 160 or item.description is null or char_length(item.description)>4000 or item.location is null or char_length(item.location)>300 or item.person is null or char_length(item.person) not between 1 and 60 or item.starts_at is null or item.ends_at is null or item.ends_at<=item.starts_at or item.all_day is null then raise exception 'Check occurrence details';end if;
  if (item.all_day and (item.start_date is null or item.end_date is null or item.end_date<=item.start_date)) or (not item.all_day and (item.start_date is not null or item.end_date is not null)) then raise exception 'Invalid occurrence dates';end if;
  if item.reminder_minutes is not null and item.reminder_minutes not between 0 and 10080 then raise exception 'Invalid reminder';end if;
  if cardinality(item.person_ids)>20 or array_position(item.person_ids,null) is not null then raise exception 'Invalid event people';end if;
 end loop;
 return new;
end $$;
revoke all on function private.validate_native_event_repeats() from public,anon,authenticated;


-- pilot-fourteen-spots.sql
-- HH only: add seven pilot places, preserving existing invitations and authorization.
do $migration$
declare definition text;
begin
 definition := pg_get_functiondef('private.pilot_invitations(text,text,uuid)'::regprocedure);
 if position('>=7 then' in definition)=0 or position('seven invited households' in definition)=0 then
  raise exception 'Expected the existing seven-place pilot limit';
 end if;
 definition := replace(definition, '>=7 then', '>=14 then');
 definition := replace(definition, 'seven invited households', 'fourteen invited households');
 execute definition;
end;
$migration$;


-- admin-households.sql
-- HH only. Called exclusively by the authenticated admin Edge Function.
create function private.admin_households(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; hid uuid; home public.households; member_ids uuid[]; sid uuid;
begin
 if not exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=uid and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null) then raise exception 'Admin access required';end if;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'memberCount',(select count(*) from public.household_members m where m.household_id=h.id),'protected',h.owner_id=uid or exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=uid)) order by h.created_at) from public.households h),'[]'::jsonb);
 end if;
 if action is distinct from 'delete' then raise exception 'Unsupported admin request';end if;
 hid:=(payload->>'householdId')::uuid;
 select * into home from public.households where id=hid for update;
 if not found then raise exception 'Household no longer exists';end if;
 if home.owner_id=uid or exists(select 1 from public.household_members where household_id=hid and user_id=uid) then raise exception 'Your admin household cannot be deleted';end if;
 if payload->>'confirmation' is distinct from home.name then raise exception 'Type the exact household name to confirm';end if;
 select array_agg(distinct user_id) into member_ids from (select user_id from public.household_members where household_id=hid union select home.owner_id) members;
 perform 1 from auth.users where id=any(member_ids) for update;
 if exists(select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email) where u.id=any(member_ids)) then raise exception 'A pilot admin household cannot be deleted';end if;
 if exists(select 1 from public.households where owner_id=any(member_ids) and id<>hid) then raise exception 'A member owns another household';end if;
 -- The calendar itself remains in Google; remove only HH's private connection and credential.
 for sid in select secret_id from private.google_calendar_connections where household_id=hid loop
  delete from vault.secrets where id=sid;
 end loop;
 delete from private.pilot_invites where household_id=hid;
 delete from public.households where id=hid;
  delete from auth.sessions where user_id=any(member_ids);
  delete from auth.users where id=any(member_ids);
 return jsonb_build_object('deleted',true);
end;$$;
revoke all on function private.admin_households(text,jsonb) from public,anon,authenticated;
grant execute on function private.admin_households(text,jsonb) to service_role;
create function public.admin_households(action text,payload jsonb) returns jsonb language sql set search_path='' as $$select private.admin_households(action,payload);$$;
revoke all on function public.admin_households(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_households(text,jsonb) to service_role;


-- self-service-deletion.sql
-- HH only: service-only RPC, actor identity supplied by the authenticated Edge Function.
create function private.self_service_deletion(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; actor_email text; hid uuid; home public.households; member_ids uuid[]; sid uuid;
begin
 select lower(email) into actor_email from auth.users where id=uid and email_confirmed_at is not null;
 if actor_email is null then raise exception 'Sign in with a confirmed account';end if;
 if exists(select 1 from private.pilot_hosts where email=actor_email) then raise exception 'Pilot administrator accounts are protected';end if;
 if action='account' then
  select household_id into hid from public.household_members where user_id=uid;
  if hid is not null then perform 1 from public.households where id=hid for update;end if;
  perform 1 from auth.users where id=uid for update;
  if exists(select 1 from public.households where owner_id=uid) then raise exception 'Household owners must use Delete home and all accounts';end if;
  if lower(trim(payload->>'confirmation')) is distinct from actor_email then raise exception 'Type your email address to confirm';end if;
  -- Keep child profiles and their event tags, reverting to household notification routing.
  update public.household_people set linked_user_id=null where linked_user_id=uid;
  delete from auth.sessions where user_id=uid;
  delete from auth.users where id=uid;
 elsif action='household' then
  hid:=(payload->>'householdId')::uuid;
  select * into home from public.households where id=hid for update;
  if not found or home.owner_id<>uid then raise exception 'Only the household owner can delete this home';end if;
  if payload->>'confirmation' is distinct from home.name then raise exception 'Type the exact household name to confirm';end if;
  select array_agg(distinct user_id) into member_ids from (select user_id from public.household_members where household_id=hid union select home.owner_id) members;
  perform 1 from auth.users where id=any(member_ids) for update;
  if exists(select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email) where u.id=any(member_ids)) then raise exception 'Pilot administrator households are protected';end if;
  if exists(select 1 from public.households where owner_id=any(member_ids) and id<>hid) then raise exception 'A member owns another household';end if;
  for sid in select secret_id from private.google_calendar_connections where household_id=hid loop
   delete from vault.secrets where id=sid;
  end loop;
  delete from private.pilot_invites where household_id=hid;
  delete from public.households where id=hid;
  delete from auth.sessions where user_id=any(member_ids);
  delete from auth.users where id=any(member_ids);
 else raise exception 'Unsupported deletion request';end if;
 return jsonb_build_object('deleted',true);
end;$$;
revoke all on function private.self_service_deletion(text,jsonb) from public,anon,authenticated;
grant execute on function private.self_service_deletion(text,jsonb) to service_role;
create function public.self_service_deletion(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.self_service_deletion(action,payload);$$;
revoke all on function public.self_service_deletion(text,jsonb) from public,anon,authenticated;
grant execute on function public.self_service_deletion(text,jsonb) to service_role;


-- household-reminder-jobs.sql
-- HH only: a separate authenticated Edge invocation and lease for each household.
create table private.push_household_runs(
 household_id uuid primary key references public.households(id) on delete cascade,
 lease_until timestamptz, last_run_at timestamptz, last_result jsonb
);
alter table private.push_household_runs enable row level security;
revoke all on private.push_household_runs from public,anon,authenticated;

-- Preserve the existing subscription, delivery-deduplication and key management operations.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.push_service(text,jsonb)'::regprocedure);
 if position('if action=''config'' then' in definition)=0 then raise exception 'Expected push service configuration branch';end if;
 definition:=replace(definition,'if action=''config'' then',$branches$if action='lock_household' then
  hid:=(payload->>'householdId')::uuid;
  if not exists(select 1 from public.households where id=hid) then return 'false'::jsonb;end if;
  insert into private.push_household_runs(household_id,lease_until) values(hid,now()+interval '90 seconds')
  on conflict(household_id) do update set lease_until=excluded.lease_until
   where private.push_household_runs.lease_until is null or private.push_household_runs.lease_until<now()
  returning 'true'::jsonb into result;
  return coalesce(result,'false'::jsonb);
 elsif action='unlock_household' then
  hid:=(payload->>'householdId')::uuid;
  update private.push_household_runs set lease_until=null,last_run_at=now(),last_result=payload-'householdId' where household_id=hid;
  update private.push_settings set last_run_at=now(),last_result=payload where id;
  return '{}'::jsonb;
 elsif action='config' then$branches$);
 execute definition;
end;
$migration$;

create or replace function private.dispatch_reminders() returns bigint
language plpgsql security definer set search_path='' as $$
declare hid uuid; dispatched bigint:=0; api_url text; cron_secret text;
begin
 select decrypted_secret into api_url from vault.decrypted_secrets where name='home_together_api_url';
 select decrypted_secret into cron_secret from vault.decrypted_secrets where name='hummel_push_cron';
 if api_url is null or cron_secret is null then raise exception 'Reminder scheduler is not configured';end if;
 -- pg_net queues independent requests; one slow or failed household does not hold the others.
 for hid in select distinct d.household_id from private.push_devices d
  join public.household_members m on m.household_id=d.household_id and m.user_id=d.user_id loop
  perform net.http_post(url:=api_url||'/functions/v1/event-reminders',
   headers:=jsonb_build_object('Content-Type','application/json','x-hummel-cron',cron_secret),
   body:=jsonb_build_object('action','dispatch','householdId',hid),timeout_milliseconds:=30000);
  dispatched:=dispatched+1;
 end loop;
 -- Retain bounded delivery history even when no devices are enabled.
 delete from private.push_deliveries where created_at<now()-interval '30 days';
 return dispatched;
end;$$;
revoke all on function private.dispatch_reminders() from public,anon,authenticated;


-- native-calendar-authority.sql
-- HH Family only. Native events are authoritative; Google is a queued copy.
create table private.calendar_copy_state(
 household_id uuid primary key references private.google_calendar_connections(household_id) on delete cascade,
 native_ready boolean not null default true,
 legacy_baseline jsonb not null default '{}',
 lease_id uuid,lease_until timestamptz,next_attempt_at timestamptz not null default now(),
 last_attempt_at timestamptz,last_synced_at timestamptz,transfer_report jsonb,last_error text
  check(last_error in ('reconnect','retry','needs_attention'))
);
create table private.calendar_copy_queue(
 household_id uuid not null references private.google_calendar_connections(household_id) on delete cascade,
 event_id uuid not null,revision bigint not null default 1,changed_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(),attempts integer not null default 0,
 last_error text check(last_error in ('retry','needs_attention')),
 primary key(household_id,event_id)
);
create index calendar_copy_queue_due on private.calendar_copy_queue(household_id,next_attempt_at,changed_at);
create table private.calendar_copy_links(
 household_id uuid not null references private.google_calendar_connections(household_id) on delete cascade,
 event_id uuid not null,google_id text not null check(char_length(google_id) between 1 and 1200),
 shape jsonb,exception_dates text[] not null default '{}',retired_ids text[] not null default '{}',
 work_revision bigint,base_done boolean not null default false,pending_dates text[] not null default '{}',
 synced_version integer,
 primary key(household_id,event_id),unique(household_id,google_id)
);
create table private.calendar_transfer_backups(
 household_id uuid primary key references private.google_calendar_connections(household_id) on delete cascade,
 native_snapshot jsonb not null,google_snapshot jsonb,snapshot_hash text,captured_at timestamptz
);
create table private.calendar_delivery_aliases(
 household_id uuid not null references public.households(id) on delete cascade,
 native_key text not null check(char_length(native_key)<=1600),google_key text not null check(char_length(google_key)<=1600),
 created_at timestamptz not null default now(),primary key(household_id,native_key,google_key)
);
alter table private.calendar_copy_state enable row level security;
alter table private.calendar_copy_queue enable row level security;
alter table private.calendar_copy_links enable row level security;
alter table private.calendar_transfer_backups enable row level security;
alter table private.calendar_delivery_aliases enable row level security;
revoke all on private.calendar_copy_state,private.calendar_copy_queue,private.calendar_copy_links from public,anon,authenticated;
revoke all on private.calendar_transfer_backups from public,anon,authenticated;
revoke all on private.calendar_delivery_aliases from public,anon,authenticated;

-- Existing Google homes get one preservation pass before any outbound writes.
insert into private.calendar_copy_state(household_id,native_ready,legacy_baseline,next_attempt_at)
 select c.household_id,false,coalesce((select jsonb_object_agg(e.id::text,e.version)
  from public.household_events e where e.household_id=c.household_id),'{}')
  ,now()+interval '2 minutes'
 from private.google_calendar_connections c;
insert into private.calendar_transfer_backups(household_id,native_snapshot)
 select c.household_id,coalesce((select jsonb_agg(to_jsonb(e)) from public.household_events e where e.household_id=c.household_id),'[]')
 from private.google_calendar_connections c;

create or replace function private.native_calendar_writable(hid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_member(hid)
  and not exists(select 1 from private.calendar_copy_state s where s.household_id=hid and not s.native_ready);
$$;
revoke all on function private.native_calendar_writable(uuid) from public,anon;
grant execute on function private.native_calendar_writable(uuid) to authenticated;

-- The app asks Postgres which source is active; core HH loading does not
-- depend on the Google Edge Function or provider being reachable.
create function private.household_calendar_source(hid uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_member(hid) then raise exception 'Household membership required';end if;
 if exists(select 1 from private.calendar_copy_state where household_id=hid and not native_ready) then return 'google';end if;
 return 'hh';
end;$$;
revoke all on function private.household_calendar_source(uuid) from public,anon;
grant execute on function private.household_calendar_source(uuid) to authenticated;
create function public.household_calendar_source(hid uuid) returns text
language sql security invoker set search_path='' as $$select private.household_calendar_source(hid);$$;
revoke all on function public.household_calendar_source(uuid) from public,anon;
grant execute on function public.household_calendar_source(uuid) to authenticated;

create function private.queue_calendar_copy() returns trigger
language plpgsql security definer set search_path='' as $$
declare hid uuid;eid uuid;
begin
 if tg_op='DELETE' then hid:=old.household_id;eid:=old.id;else hid:=new.household_id;eid:=new.id;end if;
 -- A cascading household deletion must not recreate work for a deleted home.
 if exists(select 1 from private.google_calendar_connections c join public.households h on h.id=c.household_id where c.household_id=hid) then
  insert into private.calendar_copy_queue(household_id,event_id) values(hid,eid)
  on conflict(household_id,event_id) do update set revision=calendar_copy_queue.revision+1,
   changed_at=now(),next_attempt_at=now(),attempts=0,last_error=null;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function private.queue_calendar_copy() from public,anon,authenticated;
create trigger queue_calendar_copy after insert or update or delete on public.household_events
 for each row execute function private.queue_calendar_copy();

create function private.queue_connected_calendar() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.calendar_copy_state(household_id) values(new.household_id)
 on conflict(household_id) do update set last_error=null,next_attempt_at=now();
 if new.migration_complete then
  insert into private.calendar_copy_queue(household_id,event_id)
   select new.household_id,id from public.household_events where household_id=new.household_id
  on conflict(household_id,event_id) do update set revision=calendar_copy_queue.revision+1,next_attempt_at=now(),attempts=0,last_error=null;
 end if;
 return new;
end;$$;
revoke all on function private.queue_connected_calendar() from public,anon,authenticated;
create trigger queue_connected_calendar after insert or update on private.google_calendar_connections
 for each row execute function private.queue_connected_calendar();

create function private.calendar_copy_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid:=(payload->>'householdId')::uuid;eid uuid;expected bigint;token uuid;
 state private.calendar_copy_state%rowtype;link private.calendar_copy_links%rowtype;
 queued private.calendar_copy_queue%rowtype;item jsonb;row_event public.household_events%rowtype;
 baseline integer;gid text;dates text[];work jsonb;pending integer;problem text;result jsonb;
 imported integer:=0;kept integer:=0;deleted integer:=0;imported_ids uuid[]:='{}';backup private.calendar_transfer_backups%rowtype;
 native_key text;native_time text;occurrence text;
begin
 if action='status' then
  select * into state from private.calendar_copy_state where household_id=hid;
  if not found then return jsonb_build_object('nativeReady',true,'googleConnected',false,'copyStatus','off','pending',0);end if;
  select count(*)::integer into pending from private.calendar_copy_queue where household_id=hid;
  return jsonb_build_object('nativeReady',state.native_ready,'googleConnected',true,'pending',pending,
   'lastSyncedAt',state.last_synced_at,'copyStatus',case
    when state.last_error='reconnect' then 'reconnect'
    when state.last_error='needs_attention' or exists(select 1 from private.calendar_copy_queue where household_id=hid and last_error='needs_attention') then 'needs_attention'
    when not state.native_ready then 'importing'
    when state.last_error='retry' then 'retry'
    when pending>0 then 'pending' else 'up_to_date' end);
 elsif action in ('claim','legacy_lock') then
  update private.calendar_copy_state s set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',last_attempt_at=now()
   where s.household_id=hid and (action='legacy_lock' or s.next_attempt_at<=now()) and (s.lease_until is null or s.lease_until<now())
    and (action<>'legacy_lock' or not s.native_ready)
    and exists(select 1 from private.google_calendar_connections c join public.households h on h.id=c.household_id
     join public.household_members m on m.household_id=h.id and m.user_id=h.owner_id and m.role='owner'
     where c.household_id=hid and c.migration_complete and c.user_id=h.owner_id)
   returning * into state;
  if not found then return null;end if;
  if action='legacy_lock' then return jsonb_build_object('lease',state.lease_id);end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventId',q.event_id,'revision',q.revision,'event',to_jsonb(e))), '[]') into work
   from (select * from private.calendar_copy_queue where household_id=hid and next_attempt_at<=now() order by changed_at,event_id limit 5) q
   left join public.household_events e on e.id=q.event_id and e.household_id=q.household_id;
  return jsonb_build_object('lease',state.lease_id,'nativeReady',state.native_ready,'baseline',state.legacy_baseline,'work',work);
 end if;
 token:=(payload->>'lease')::uuid;
 select * into state from private.calendar_copy_state where household_id=hid and lease_id=token and lease_until>now() for update;
 if not found then raise exception 'Calendar copy lease is unavailable';end if;
 if not exists(select 1 from private.google_calendar_connections c join public.households h on h.id=c.household_id
  join public.household_members m on m.household_id=h.id and m.user_id=h.owner_id and m.role='owner'
  where c.household_id=hid and c.user_id=h.owner_id) then raise exception 'Calendar copy owner is unavailable';end if;
 if action='finish' then
  problem:=payload->>'error';
  if problem is not null and problem not in ('reconnect','retry','needs_attention') then raise exception 'Invalid copy result';end if;
  update private.calendar_copy_state set lease_id=null,lease_until=null,last_error=problem,
   next_attempt_at=now()+case problem when 'reconnect' then interval '15 minutes' when 'needs_attention' then interval '6 hours' else interval '30 seconds' end,
   last_synced_at=case when problem is null and native_ready and not exists(select 1 from private.calendar_copy_queue where household_id=hid) then now() else last_synced_at end
   where household_id=hid;
  return '{}'::jsonb;
 elsif action='archive' then
  if state.native_ready then return jsonb_build_object('alreadyImported',true);end if;
  if jsonb_typeof(payload->'events') is distinct from 'array' or jsonb_array_length(payload->'events')>1000 or octet_length((payload->'events')::text)>8000000 then raise exception 'Calendar preservation snapshot is too large';end if;
  update private.calendar_transfer_backups set google_snapshot=payload->'events',
   snapshot_hash=encode(sha256(convert_to((payload->'events')::text,'UTF8')),'hex'),captured_at=now()
   where household_id=hid returning * into backup;
  if not found then raise exception 'Calendar preservation backup is unavailable';end if;
  return jsonb_build_object('snapshotHash',backup.snapshot_hash);
 elsif action='import' then
  if state.native_ready then return jsonb_build_object('alreadyImported',true);end if;
  select * into backup from private.calendar_transfer_backups where household_id=hid and snapshot_hash=payload->>'snapshotHash';
  if not found or backup.google_snapshot is null then raise exception 'A verified Google preservation snapshot is required';end if;
  if jsonb_typeof(payload->'events') is distinct from 'array' or jsonb_array_length(payload->'events')>1000 then raise exception 'Invalid import batch';end if;
  if exists(select 1 from jsonb_array_elements(backup.google_snapshot) original
    where coalesce(original->>'status','confirmed')<>'cancelled' and original->>'recurringEventId' is null
    and not exists(select 1 from jsonb_array_elements(payload->'events') incoming where incoming->>'googleId'=original->>'id'))
   or exists(select 1 from jsonb_array_elements(payload->'events') incoming
    where not exists(select 1 from jsonb_array_elements(backup.google_snapshot) original where original->>'id'=incoming->>'googleId'
     and coalesce(original->>'status','confirmed')<>'cancelled' and original->>'recurringEventId' is null))
   or (select count(*)<>count(distinct incoming->>'googleId') from jsonb_array_elements(payload->'events') incoming)
   then raise exception 'Calendar transfer verification mismatch';end if;
  for item in select * from jsonb_array_elements(payload->'events') loop
   eid:=(item->'event'->>'id')::uuid;gid:=item->>'googleId';
   if gid is null or char_length(gid) not between 1 and 1200 then raise exception 'Invalid imported calendar event';end if;
   select * into row_event from public.household_events where id=eid for update;
   if found and row_event.household_id<>hid then raise exception 'Imported event belongs to another household';end if;
   baseline:=(state.legacy_baseline->>eid::text)::integer;
   -- Preserve HH edits/deletions made while the old Google calendar was read.
   if baseline is not null and (row_event.id is null or row_event.version<>baseline) then kept:=kept+1;continue;end if;
   if baseline is null and row_event.id is not null then kept:=kept+1;continue;end if;
   row_event:=jsonb_populate_record(null::public.household_events,item->'event');
   insert into public.household_events(id,household_id,title,description,location,person,person_ids,starts_at,ends_at,all_day,start_date,end_date,reminder_minutes,reminder_30_enabled,recurrence,exceptions,version)
    values(eid,hid,row_event.title,row_event.description,row_event.location,row_event.person,row_event.person_ids,row_event.starts_at,row_event.ends_at,row_event.all_day,row_event.start_date,row_event.end_date,row_event.reminder_minutes,coalesce(row_event.reminder_30_enabled,true),coalesce(row_event.recurrence,'{}'),coalesce(row_event.exceptions,'{}'),coalesce(baseline,0)+1)
   on conflict(id) do update set title=excluded.title,description=excluded.description,location=excluded.location,person=excluded.person,person_ids=excluded.person_ids,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,all_day=excluded.all_day,start_date=excluded.start_date,end_date=excluded.end_date,
    reminder_minutes=excluded.reminder_minutes,reminder_30_enabled=excluded.reminder_30_enabled,recurrence=excluded.recurrence,exceptions=excluded.exceptions,version=excluded.version
    where household_events.household_id=hid and household_events.version=baseline
    returning * into row_event;
   if not found then kept:=kept+1;continue;end if;
   insert into private.calendar_copy_links(household_id,event_id,google_id,shape,exception_dates,synced_version)
    values(hid,eid,gid,item->'shape',array(select jsonb_object_keys(coalesce(item->'event'->'exceptions','{}'))),coalesce(baseline,0)+1)
   on conflict(household_id,event_id) do nothing;
   imported:=imported+1;
   imported_ids:=array_append(imported_ids,eid);
  end loop;
  if jsonb_array_length(coalesce(payload->'deliveryAliases','[]'))>4000 then raise exception 'Too many transfer reminder identities';end if;
  for item in select * from jsonb_array_elements(coalesce(payload->'deliveryAliases','[]')) loop
   eid:=(item->>'eventId')::uuid;if not eid=any(imported_ids) then continue;end if;
   select * into row_event from public.household_events where id=eid and household_id=hid;
   occurrence:=item->>'occurrenceDate';
   native_time:=case when coalesce((item->>'allDay')::boolean,row_event.all_day) then coalesce(item->>'startDate',row_event.start_date::text)
    when occurrence is null then to_jsonb(row_event)->>'starts_at' else item->>'nativeStart' end;
   native_key:=eid::text||case when occurrence is not null then '@'||occurrence else '' end||':'||native_time||':'||(item->>'minutes');
   insert into private.calendar_delivery_aliases(household_id,native_key,google_key) values(hid,native_key,item->>'googleKey') on conflict do nothing;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(payload->'deleted','[]')) loop
   eid:=trim(both '"' from item::text)::uuid;baseline:=(state.legacy_baseline->>eid::text)::integer;
   if baseline is not null then
    delete from public.household_events where id=eid and household_id=hid and version=baseline;
    if found then deleted:=deleted+1;end if;
   end if;
  end loop;
  result:=jsonb_build_object('imported',imported,'preservedNewerChanges',kept,'preservedDeletions',deleted,'snapshotHash',backup.snapshot_hash,'verifiedAt',now());
  update private.calendar_copy_state set native_ready=true,legacy_baseline='{}',last_error=null,next_attempt_at=now(),transfer_report=result where household_id=hid;
  return result;
 end if;
 eid:=(payload->>'eventId')::uuid;expected:=(payload->>'revision')::bigint;
 select * into queued from private.calendar_copy_queue where household_id=hid and event_id=eid;
 if not found then return null;end if;
 if action='event_failed' then
  problem:=payload->>'error';if problem is null or problem not in ('retry','needs_attention') then raise exception 'Invalid copy failure';end if;
  update private.calendar_copy_queue set attempts=attempts+1,last_error=problem,
   next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
   where household_id=hid and event_id=eid and revision=expected;
  return '{}'::jsonb;
 elsif action='prepare' then
  if queued.revision<>expected then return null;end if;
  dates:=array(select jsonb_array_elements_text(coalesce(payload->'dates','[]')));
  if cardinality(dates)>40000 or exists(select 1 from unnest(dates) d where d !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid copy occurrence dates';end if;
  select * into link from private.calendar_copy_links where household_id=hid and event_id=eid for update;
  if not found then
   insert into private.calendar_copy_links(household_id,event_id,google_id) values(hid,eid,'home'||replace(eid::text,'-','')) returning * into link;
  end if;
  if coalesce((payload->>'rotate')::boolean,false) or jsonb_typeof(payload->'shape')='object' and link.shape is not null and link.shape is distinct from payload->'shape' then
   link.retired_ids:=array(select distinct unnest(link.retired_ids||array[link.google_id]));
   link.google_id:='home'||replace(gen_random_uuid()::text,'-','');link.synced_version:=null;
   link.exception_dates:='{}';link.work_revision:=null;
  end if;
  if link.work_revision is distinct from expected then
   link.exception_dates:=array(select distinct unnest(link.exception_dates||dates));
   link.pending_dates:=link.exception_dates;link.base_done:=false;link.work_revision:=expected;
  end if;
  update private.calendar_copy_links set google_id=link.google_id,retired_ids=link.retired_ids,shape=payload->'shape',exception_dates=link.exception_dates,
   pending_dates=link.pending_dates,base_done=link.base_done,work_revision=link.work_revision,synced_version=link.synced_version
   where household_id=hid and event_id=eid returning * into link;
  return to_jsonb(link);
 elsif action='retired_done' then
  update private.calendar_copy_links set retired_ids=array_remove(retired_ids,payload->>'googleId') where household_id=hid and event_id=eid;
 elsif action='base_done' then
  update private.calendar_copy_links set base_done=true where household_id=hid and event_id=eid and work_revision=expected;
 elsif action='date_done' then
  update private.calendar_copy_links set pending_dates=array_remove(pending_dates,payload->>'date') where household_id=hid and event_id=eid and work_revision=expected;
 elsif action='event_done' then
  if coalesce((payload->>'deleted')::boolean,false) then
   delete from private.calendar_copy_links where household_id=hid and event_id=eid;
  else
   if exists(select 1 from private.calendar_copy_links where household_id=hid and event_id=eid and (not base_done or cardinality(pending_dates)>0 or cardinality(retired_ids)>0)) then raise exception 'Calendar copy is incomplete';end if;
   update private.calendar_copy_links set synced_version=(payload->>'version')::integer,exception_dates=array(select jsonb_array_elements_text(coalesce(payload->'dates','[]'))),work_revision=null
    where household_id=hid and event_id=eid;
  end if;
  delete from private.calendar_copy_queue where household_id=hid and event_id=eid and revision=expected;
 else raise exception 'Unknown calendar copy operation';end if;
 return '{}'::jsonb;
end;$$;
revoke all on function private.calendar_copy_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.calendar_copy_service(text,jsonb) to service_role;
create function public.calendar_copy_service(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.calendar_copy_service(action,payload);$$;
revoke all on function public.calendar_copy_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_copy_service(text,jsonb) to service_role;

-- Preserve reminder deduplication across the provider-to-native ID change,
-- including an old worker that finishes sending after the transfer commits.
create function private.calendar_reminder_claim(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.calendar_delivery_aliases a
  join private.push_devices device on device.household_id=a.household_id and device.id=(payload->>'deviceId')::uuid
  join private.push_deliveries delivered on delivered.device_id=device.id and delivered.delivery_key=a.google_key
  where a.native_key=payload->>'key' and (delivered.state in ('sent','expired') or delivered.state='sending' and delivered.lease_until>now())) then
  return 'false'::jsonb;
 end if;
 return private.push_service('claim',payload);
end;$$;
revoke all on function private.calendar_reminder_claim(jsonb) from public,anon,authenticated;
grant execute on function private.calendar_reminder_claim(jsonb) to service_role;
create function public.calendar_reminder_claim(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.calendar_reminder_claim(payload);$$;
revoke all on function public.calendar_reminder_claim(jsonb) from public,anon,authenticated;
grant execute on function public.calendar_reminder_claim(jsonb) to service_role;

create function private.dispatch_calendar_copies() returns bigint
language plpgsql security definer set search_path='' as $$
declare hid uuid;api_url text;credential text;dispatched bigint:=0;
begin
 delete from private.calendar_delivery_aliases where created_at<now()-interval '30 days';
 select decrypted_secret into api_url from vault.decrypted_secrets where name='home_together_api_url';
 select decrypted_secret into credential from vault.decrypted_secrets where name='hummel_push_cron';
 if api_url is null or credential is null then raise exception 'Calendar copy scheduler is not configured';end if;
 for hid in select s.household_id from private.calendar_copy_state s
  join private.google_calendar_connections c on c.household_id=s.household_id
  join public.households h on h.id=s.household_id and h.owner_id=c.user_id
  join public.household_members m on m.household_id=h.id and m.user_id=h.owner_id and m.role='owner'
  where c.migration_complete and s.next_attempt_at<=now() and (s.lease_until is null or s.lease_until<now())
   and (not s.native_ready or exists(select 1 from private.calendar_copy_queue q where q.household_id=s.household_id and q.next_attempt_at<=now())) loop
  perform net.http_post(url:=api_url||'/functions/v1/google-calendar',headers:=jsonb_build_object('Content-Type','application/json','x-hummel-cron',credential),
   body:=jsonb_build_object('action','sync','householdId',hid),timeout_milliseconds:=30000);
  dispatched:=dispatched+1;
 end loop;
 return dispatched;
end;$$;
revoke all on function private.dispatch_calendar_copies() from public,anon,authenticated;
select cron.schedule('hh-google-calendar-copy','* * * * *','select private.dispatch_calendar_copies();');
notify pgrst,'reload schema';


commit;
