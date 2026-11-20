alter table private.outlook_calendar_picker add column creation_lease uuid, add column creation_until timestamptz;
alter table private.outlook_calendar_connections add column import_events boolean not null default false;

create function private.outlook_calendar_creation(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid:=(payload->>'householdId')::uuid;
 uid uuid:=(payload->>'userId')::uuid;
 stage private.outlook_calendar_picker%rowtype;
 calendar jsonb:=payload->'calendar';
 value text;
begin
 if not private.personal_calendar_ready(hid) or not exists (
  select 1 from public.household_members where household_id=hid and user_id=uid
 ) then raise exception 'Calendar connection is unavailable'; end if;
 if exists(select 1 from private.outlook_calendar_connections where household_id=hid and user_id=uid)
  then raise exception 'This TEST account already has an Outlook calendar.'; end if;
 select * into stage from private.outlook_calendar_picker where household_id=hid and user_id=uid and expires_at>now() for update;
 if stage.secret_id is null then raise exception 'Connect Outlook again to choose a calendar.'; end if;
 if action='begin_create' then
  if stage.creation_until>now() then raise exception 'An Outlook calendar is already being set up. Try again in a moment.'; end if;
  update private.outlook_calendar_picker set creation_lease=gen_random_uuid(),creation_until=now()+interval '90 seconds'
   where household_id=hid and user_id=uid returning * into stage;
  select decrypted_secret into value from vault.decrypted_secrets where id=stage.secret_id;
  return jsonb_build_object('lease',stage.creation_lease,'refreshToken',value);
 end if;
 if stage.creation_lease is null or stage.creation_lease is distinct from (payload->>'lease')::uuid
  or stage.creation_until<=now() then raise exception 'Outlook calendar creation expired. Try again.'; end if;
 if action='refresh_creation' then
  update private.outlook_calendar_picker set secret_id=vault.create_secret(payload->>'refreshToken')
   where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 if action='finish_create' and jsonb_typeof(calendar)='object' and lower(calendar->>'name')='hh family'
  and length(calendar->>'id') between 1 and 1000 then
  update private.outlook_calendar_picker set creation_lease=null,creation_until=null,
   calendars=case when exists(select 1 from jsonb_array_elements(stage.calendars) item where item->>'id'=calendar->>'id')
    then stage.calendars else stage.calendars||jsonb_build_array(calendar) end
   where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 raise exception 'Invalid Outlook calendar setup';
end;$$;

create function public.outlook_calendar_creation(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.outlook_calendar_creation(action,payload);
$$;
revoke all on function private.outlook_calendar_creation(text,jsonb),public.outlook_calendar_creation(text,jsonb)
 from public,anon,authenticated;
grant execute on function private.outlook_calendar_creation(text,jsonb),public.outlook_calendar_creation(text,jsonb)
 to service_role;

create function private.outlook_calendar_with_mode(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid:=(payload->>'householdId')::uuid;
 uid uuid:=(payload->>'userId')::uuid;
 result jsonb;
 imports boolean;
begin
 if action='connect' then
  result:=private.outlook_calendar(action,payload);
  update private.outlook_calendar_connections set import_events=coalesce(payload->'importEvents'='true'::jsonb,false)
   where household_id=hid and user_id=uid;
  return result;
 end if;
 if action in ('snapshot','status','match','receive') then
  select import_events into imports from private.outlook_calendar_connections
   where household_id=hid and user_id=uid and active;
  if (action='match' or (action='receive' and payload->>'eventId' is null)) and not coalesce(imports,false)
   then return 'false'::jsonb; end if;
  result:=private.outlook_calendar(action,payload);
  if action in ('snapshot','status') and result is not null
   then return result||jsonb_build_object('importEvents',coalesce(imports,false)); end if;
  return result;
 end if;
 return private.outlook_calendar(action,payload);
end;$$;
revoke all on function private.outlook_calendar_with_mode(text,jsonb) from public,anon,authenticated;
grant execute on function private.outlook_calendar_with_mode(text,jsonb) to service_role;

create or replace function public.outlook_calendar(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.outlook_calendar_with_mode(action,payload);
$$;
notify pgrst,'reload schema';
