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
