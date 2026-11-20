alter table private.personal_calendar_states
 add column source_existing boolean not null default false,
 add column selection_secret_id uuid,
 add column calendar_choices jsonb;
alter table private.personal_calendar_connections
 add column source_existing boolean not null default false,
 add column source_calendar_name text;

create function private.clear_google_calendar_selection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.selection_secret_id is not null and (tg_op='DELETE' or new.selection_secret_id is distinct from old.selection_secret_id)
  then delete from vault.secrets where id=old.selection_secret_id; end if;
 return null;
end;$$;
revoke all on function private.clear_google_calendar_selection() from public,anon,authenticated;
create trigger clear_google_calendar_selection after update of selection_secret_id or delete on private.personal_calendar_states
 for each row execute function private.clear_google_calendar_selection();

create function private.test_google_existing_calendar(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid:=(payload->>'householdId')::uuid;
 uid uuid:=(payload->>'userId')::uuid;
 stage private.personal_calendar_states%rowtype;
 connection private.personal_calendar_connections%rowtype;
 choices jsonb;
 picked jsonb;
 credential text;
 result jsonb;
begin
 if not private.personal_calendar_ready(hid) or not exists (
  select 1 from public.household_members where household_id=hid and user_id=uid
 ) then raise exception 'Google Calendar is unavailable for this household'; end if;
 select * into connection from private.personal_calendar_connections where household_id=hid and user_id=uid;
 if action in ('start','start_copy') then
  if connection.id is not null and action='start' and not connection.source_existing
   then raise exception 'Disconnect your current Google copy before linking a different calendar.'; end if;
  if connection.id is not null and action='start_copy' and connection.source_existing
   then raise exception 'Reconnect the existing Google calendar.'; end if;
  perform private.personal_calendar_service('state_create',payload);
  update private.personal_calendar_states set source_existing=(action='start'),calendar_choices=null,selection_secret_id=null
   where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 if action='take' then
  result:=private.personal_calendar_service('state_take',payload);
  if result is null then return null; end if;
  return result||jsonb_build_object('existingSource',coalesce((select source_existing
   from private.personal_calendar_states where household_id=hid and user_id=uid),false));
 end if;
 if action='options' then
  return jsonb_build_object('existingSource',coalesce(connection.source_existing,false),
   'calendarName',connection.source_calendar_name,'choices',(select calendar_choices from private.personal_calendar_states
    where household_id=hid and user_id=uid and source_existing and expires_at>now()));
 end if;
 if action='cancel' then
  delete from private.personal_calendar_states where household_id=hid and user_id=uid and source_existing;
  return '{}'::jsonb;
 end if;
 select * into stage from private.personal_calendar_states where household_id=hid and user_id=uid
  and source_existing and claimed and expires_at>now() for update;
 if stage.state_hash is null then raise exception 'Google connection expired'; end if;
 if action='stage' then
  if stage.state_hash is distinct from payload->>'hash' or jsonb_typeof(payload->'choices') is distinct from 'array'
   or jsonb_array_length(payload->'choices')>250 or coalesce(length(payload->>'refreshToken'),0) not between 1 and 4096
   then raise exception 'Google connection expired'; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into choices from jsonb_array_elements(payload->'choices') item
   where (connection.id is null or item->>'id'=connection.calendar_id)
    and not exists(select 1 from private.google_calendar_connections c where c.calendar_id=item->>'id')
    and not exists(select 1 from private.personal_calendar_connections c
     where c.calendar_id=item->>'id' and c.id is distinct from connection.id);
  update private.personal_calendar_states set calendar_choices=choices,expires_at=now()+interval '10 minutes',
   selection_secret_id=vault.create_secret(payload->>'refreshToken') where household_id=hid and user_id=uid;
  return choices;
 end if;
 if action<>'connect' or stage.selection_secret_id is null then raise exception 'Google connection expired'; end if;
 select item into picked from jsonb_array_elements(stage.calendar_choices) item where item->>'id'=payload->>'calendarId';
 if picked is null then raise exception 'Choose a writable Google calendar from the list.'; end if;
 if payload->'acknowledgeShared' is distinct from 'true'::jsonb then raise exception 'Confirm sharing this Google calendar with your household.'; end if;
 if connection.id is not null and not connection.source_existing then raise exception 'Disconnect your current Google copy before linking a different calendar.'; end if;
 select decrypted_secret into credential from vault.decrypted_secrets where id=stage.selection_secret_id;
 perform private.personal_calendar_service('connection_set',jsonb_build_object('householdId',hid,'userId',uid,
  'hash',stage.state_hash,'calendarId',picked->>'id','refreshToken',credential));
 update private.personal_calendar_connections set source_existing=true,source_calendar_name=picked->>'name',two_way_enabled=true
  where household_id=hid and user_id=uid;
 return '{}'::jsonb;
end;$$;

create function public.test_google_existing_calendar(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.test_google_existing_calendar(action,payload);
$$;
revoke all on function private.test_google_existing_calendar(text,jsonb),public.test_google_existing_calendar(text,jsonb)
 from public,anon,authenticated;
grant execute on function private.test_google_existing_calendar(text,jsonb),public.test_google_existing_calendar(text,jsonb)
 to service_role;

create function private.expire_test_google_calendar_choices() returns void
language sql security definer set search_path='' as $$
 delete from private.personal_calendar_states where source_existing and expires_at<=now();
$$;
revoke all on function private.expire_test_google_calendar_choices() from public,anon,authenticated;
select cron.schedule('hh-test-google-picker-cleanup','*/5 * * * *','select private.expire_test_google_calendar_choices();');
notify pgrst,'reload schema';
