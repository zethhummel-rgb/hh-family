-- Save the series and its individual occurrence changes on the existing event link.
alter table private.outlook_calendar_links add column series_state jsonb;

create or replace function private.outlook_calendar(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid := (payload->>'householdId')::uuid;
 uid uuid := (payload->>'userId')::uuid;
 eid uuid := (payload->>'eventId')::uuid;
 expected_version integer := (payload->>'version')::integer;
 conn private.outlook_calendar_connections%rowtype;
 staged private.outlook_calendar_picker%rowtype;
 link private.outlook_calendar_links%rowtype;
 current_event public.household_events%rowtype;
 fields public.household_events%rowtype;
 picked jsonb;
 stored_secret uuid;
 value text;
 issue text;
 result jsonb;
begin
 if not private.personal_calendar_ready(hid) or not exists (
  select 1 from public.household_members where household_id=hid and user_id=uid
 ) then raise exception 'Calendar connection is unavailable'; end if;

 if action='authorize' then
  if payload->>'stateHash' !~ '^[a-f0-9]{64}$' or payload->>'verifier' !~ '^[A-Za-z0-9_-]{43}$'
   then raise exception 'Invalid Microsoft authorization'; end if;
  insert into private.outlook_calendar_oauth(household_id,user_id,state_hash,verifier)
   values(hid,uid,payload->>'stateHash',payload->>'verifier')
   on conflict (household_id,user_id) do update set state_hash=excluded.state_hash,
    verifier=excluded.verifier,expires_at=excluded.expires_at;
  delete from private.outlook_calendar_picker where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 if action='claim' then
  delete from private.outlook_calendar_oauth
   where household_id=hid and user_id=uid and expires_at>now() and state_hash=payload->>'stateHash'
   returning verifier into value;
  return to_jsonb(value);
 end if;
 if action='choose' then
  if jsonb_typeof(payload->'calendars') is distinct from 'array' or jsonb_array_length(payload->'calendars')>100
   then raise exception 'Invalid Microsoft calendar list'; end if;
  insert into private.outlook_calendar_picker(household_id,user_id,microsoft_id,secret_id,calendars)
   values(hid,uid,payload->>'microsoftId',vault.create_secret(payload->>'refreshToken'),payload->'calendars')
   on conflict (household_id,user_id) do update set microsoft_id=excluded.microsoft_id,
    secret_id=excluded.secret_id,calendars=excluded.calendars,expires_at=excluded.expires_at;
  return '{}'::jsonb;
 end if;
 if action='cancel_picker' then
  delete from private.outlook_calendar_picker where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;

 select * into conn from private.outlook_calendar_connections where household_id=hid and user_id=uid for no key update;
 if action='status' then
  select calendars into picked from private.outlook_calendar_picker
   where household_id=hid and user_id=uid and expires_at>now();
  return jsonb_build_object('calendarName',conn.calendar_name,'active',coalesce(conn.active,false),
   'syncedAt',conn.synced_at,'problem',conn.problem,'calendars',picked);
 end if;
 if action in ('connect','disconnect') and conn.lease_until>now()
  then raise exception 'Calendar sync is running. Try again in a moment.'; end if;
 if action='connect' then
  select * into staged from private.outlook_calendar_picker
   where household_id=hid and user_id=uid and expires_at>now() for update;
  select item into picked from jsonb_array_elements(staged.calendars) item where item->>'id'=payload->>'calendarId';
  if picked is null then raise exception 'Choose a calendar from the list.'; end if;
  if conn.id is not null and (conn.microsoft_id<>staged.microsoft_id or conn.calendar_id<>picked->>'id')
   then raise exception 'Reconnect the same Outlook calendar for this trial.'; end if;
  if exists(select 1 from private.outlook_calendar_connections
   where microsoft_id=staged.microsoft_id and calendar_id=picked->>'id' and id is distinct from conn.id)
   then raise exception 'This Outlook calendar is already linked to a TEST account.'; end if;
  select vault.create_secret(decrypted_secret) into stored_secret from vault.decrypted_secrets where id=staged.secret_id;
  insert into private.outlook_calendar_connections(household_id,user_id,microsoft_id,calendar_id,calendar_name,secret_id)
   values(hid,uid,staged.microsoft_id,picked->>'id',picked->>'name',stored_secret)
   on conflict (household_id,user_id) do update set calendar_name=excluded.calendar_name,secret_id=excluded.secret_id,
    active=true,problem=null,next_attempt_at=now(),lease=null,lease_until=null;
  delete from private.outlook_calendar_picker where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 if action='disconnect' then
  -- Preserve event mappings so reconnecting the same calendar cannot duplicate events.
  if conn.active then
   update private.outlook_calendar_connections set active=false,secret_id=null,
    lease=null,lease_until=null,problem=null where id=conn.id;
  end if;
  delete from private.outlook_calendar_picker where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 end if;
 if conn.id is null or not conn.active then return null; end if;

 if action='lease' then
  if conn.lease_until>now() or conn.problem='reconnect' or
   (coalesce(payload->>'automatic','false')='true' and conn.next_attempt_at>now()) then return null; end if;
  update private.outlook_calendar_connections set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds'
   where id=conn.id returning * into conn;
  select decrypted_secret into value from vault.decrypted_secrets where id=conn.secret_id;
  return jsonb_build_object('lease',conn.lease,'calendarId',conn.calendar_id,'refreshToken',value,
   'since',conn.sync_since,'initial',conn.synced_at is null);
 end if;
 if conn.lease is null or conn.lease is distinct from (payload->>'lease')::uuid or conn.lease_until<=now()
  then raise exception 'Calendar sync expired'; end if;
 if action='token' then
  update private.outlook_calendar_connections set secret_id=vault.create_secret(payload->>'refreshToken') where id=conn.id;
  return '{}'::jsonb;
 end if;
 if action='finish' then
  issue:=payload->>'problem';
  update private.outlook_calendar_connections set lease=null,lease_until=null,problem=issue,
   synced_at=case when issue is null then now() else synced_at end,
   next_attempt_at=now()+case when issue is null then interval '1 minute' else interval '5 minutes' end
   where id=conn.id;
  return '{}'::jsonb;
 end if;
 if action='snapshot' then
  select jsonb_agg(to_jsonb(e)) into result from (
   select id,version,title,description,location,starts_at,ends_at,all_day,start_date,end_date,recurrence,exceptions
    from public.household_events e where e.household_id=hid and (
     (e.ends_at>=conn.sync_since or cardinality(e.recurrence)>0)
     or exists (select 1 from private.outlook_calendar_links l where l.connection_id=conn.id and l.event_id=e.id and not l.retired))
    order by e.id limit 501
  ) e;
  return jsonb_build_object('events',coalesce(result,'[]'::jsonb),'syncSince',conn.sync_since,'links',
   (select coalesce(jsonb_agg(to_jsonb(l)-'connection_id'),'[]'::jsonb)
    from private.outlook_calendar_links l where l.connection_id=conn.id));
 end if;

 select * into current_event from public.household_events where id=eid and household_id=hid for update;
 select * into link from private.outlook_calendar_links where connection_id=conn.id and event_id=eid;
 if action in ('reserve','current') then
  if current_event.version is distinct from expected_version or coalesce(link.retired,false) then return null; end if;
  if action='current' then return 'true'::jsonb; end if;
  if current_event.id is null then return null; end if;
  insert into private.outlook_calendar_links(connection_id,event_id) values(conn.id,eid) on conflict do nothing;
  select transaction_id into stored_secret from private.outlook_calendar_links where connection_id=conn.id and event_id=eid;
  return to_jsonb(stored_secret);
 end if;
 if action='remember' then
  -- Record the version actually sent. If HH changed during the call, the
  -- latest version remains eligible for the next sync.
  update private.outlook_calendar_links set outlook_id=payload->>'outlookId',change_key=payload->>'changeKey',
   synced_version=expected_version,series_state=coalesce(payload->'seriesState',series_state) where connection_id=conn.id and event_id=eid
   and not retired and (outlook_id is null or outlook_id=payload->>'outlookId');
  return '{}'::jsonb;
 end if;
 if action='retire' then
  if current_event.id is null then
   update private.outlook_calendar_links set retired=true where connection_id=conn.id and event_id=eid;
  end if;
  return '{}'::jsonb;
 end if;
 if action not in ('receive','match','remove') then raise exception 'Invalid Outlook sync action'; end if;
 if action='match' then
  if current_event.version is distinct from expected_version or current_event.id is null or link.event_id is not null
   then return 'false'::jsonb; end if;
  insert into private.outlook_calendar_links(connection_id,event_id,outlook_id,synced_version,change_key,series_state)
   values(conn.id,eid,payload->>'outlookId',expected_version,payload->>'changeKey',payload->'seriesState');
  return 'true'::jsonb;
 end if;
 if eid is not null then
  if current_event.version is distinct from expected_version or current_event.id is null or link.retired
   or link.synced_version is distinct from expected_version or link.outlook_id is distinct from payload->>'outlookId'
   then return 'false'::jsonb; end if;
  if action='remove' then
   delete from public.household_events where id=eid and household_id=hid;
   update private.outlook_calendar_links set retired=true where connection_id=conn.id and event_id=eid;
   return 'true'::jsonb;
  end if;
 elsif action='remove' then return 'false'::jsonb;
 elsif exists(select 1 from private.outlook_calendar_links where connection_id=conn.id and outlook_id=payload->>'outlookId')
  then return 'false'::jsonb;
 end if;

 fields:=jsonb_populate_record(null::public.household_events,payload->'event');
 select coalesce(jsonb_object_agg(item.key,case when item.value='null'::jsonb then item.value
  else jsonb_build_object('person',coalesce(current_event.person,'Everyone'))||item.value end),'{}'::jsonb)
 into fields.exceptions from jsonb_each(coalesce(fields.exceptions,'{}')) as item;
 if eid is null then
  insert into public.household_events(household_id,title,description,location,starts_at,ends_at,all_day,start_date,end_date,reminder_30_enabled,recurrence,exceptions)
   values(hid,fields.title,fields.description,fields.location,fields.starts_at,fields.ends_at,
    fields.all_day,fields.start_date,fields.end_date,false,coalesce(fields.recurrence,'{}'),coalesce(fields.exceptions,'{}'))
   returning id,version into eid,expected_version;
  insert into private.outlook_calendar_links(connection_id,event_id,outlook_id,synced_version,change_key,series_state)
   values(conn.id,eid,payload->>'outlookId',expected_version,payload->>'changeKey',payload->'seriesState');
 else
  update public.household_events set title=fields.title,description=fields.description,location=fields.location,
   location_place_id=case when current_event.location=fields.location then current_event.location_place_id end,
   starts_at=fields.starts_at,ends_at=fields.ends_at,all_day=fields.all_day,start_date=fields.start_date,end_date=fields.end_date,
   recurrence=coalesce(fields.recurrence,'{}'),exceptions=coalesce(fields.exceptions,'{}'),
   version=version+1 where id=eid and household_id=hid returning version into expected_version;
  update private.outlook_calendar_links set synced_version=expected_version,change_key=payload->>'changeKey',series_state=payload->'seriesState'
   where connection_id=conn.id and event_id=eid;
 end if;
 return 'true'::jsonb;
end;$$;

