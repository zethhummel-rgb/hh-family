-- Record the choice with the signed-in user's OAuth setup. Older clients
-- and reconnects keep their existing sync preference.
alter table private.personal_calendar_states add column enable_two_way_copy boolean not null default false;

create function private.google_calendar_setup_with_sync(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid:=(payload->>'householdId')::uuid;
 uid uuid:=(payload->>'userId')::uuid;
 enable_sync boolean;
 result jsonb;
begin
 if action in ('start','start_copy','start_two_way_copy') then
  result:=private.personal_google_calendar_setup(
   case when action='start_two_way_copy' then 'start_copy' else action end,payload);
  update private.personal_calendar_states set enable_two_way_copy=action='start_two_way_copy'
   and not exists(select 1 from private.personal_calendar_connections where household_id=hid and user_id=uid)
   where household_id=hid and user_id=uid;
  return result;
 end if;
 if action='connect_copy' then
  select enable_two_way_copy into enable_sync from private.personal_calendar_states
   where household_id=hid and user_id=uid and state_hash=payload->>'hash' and claimed and not source_existing;
  if not found then raise exception 'Google connection expired'; end if;
  -- This validates the live OAuth state, household membership and calendar
  -- ownership mapping before consuming the state and storing the credential.
  result:=private.personal_calendar_service('connection_set',payload);
  if enable_sync then
   update private.personal_calendar_connections set two_way_enabled=true
    where household_id=hid and user_id=uid and not source_existing;
  end if;
  return result;
 end if;
 return private.personal_google_calendar_setup(action,payload);
end;$$;

revoke all on function private.google_calendar_setup_with_sync(text,jsonb) from public,anon,authenticated;
grant execute on function private.google_calendar_setup_with_sync(text,jsonb) to service_role;

create or replace function public.personal_google_calendar_setup(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.google_calendar_setup_with_sync(action,payload);
$$;
