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
