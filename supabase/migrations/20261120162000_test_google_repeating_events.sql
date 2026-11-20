-- TEST calendar connections only. Keep household event identities stable.
create table private.google_calendar_pending_occurrences (
 connection_id uuid not null references private.personal_calendar_connections(id) on delete cascade,
 google_id text not null,
 occurrence_date date not null,
 change jsonb not null,
 primary key(connection_id,google_id,occurrence_date)
);
alter table private.google_calendar_pending_occurrences enable row level security;
revoke all on private.google_calendar_pending_occurrences from public,anon,authenticated;
alter table private.personal_calendar_connections add column repeat_baseline_pending boolean not null default false;
update private.personal_calendar_connections set repeat_baseline_pending=true where two_way_enabled;

create or replace function private.personal_calendar_two_way(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid := (payload->>'householdId')::uuid;
 uid uuid := (payload->>'userId')::uuid;
 conn private.personal_calendar_connections%rowtype;
 link private.personal_calendar_links%rowtype;
 current_event public.household_events%rowtype;
 change jsonb;
 fields public.household_events%rowtype;
 gid text;
 eid uuid;
 saved_version integer;
 next_page text;
 next_sync text;
 changed integer := 0;
 rules text[];
 occurrence_day text;
 occurrence jsonb;
 overrides jsonb;
begin
 if not private.personal_calendar_ready(hid) or not exists(
  select 1 from public.household_members where household_id=hid and user_id=uid
 ) then raise exception 'Calendar connection is unavailable'; end if;

 if action='status' then
  select * into conn from private.personal_calendar_connections where household_id=hid and user_id=uid;
  return jsonb_build_object('enabled',coalesce(conn.two_way_enabled,false),
   'ready',conn.google_sync_token is not null);
 end if;
 select * into conn from private.personal_calendar_connections
  where household_id=hid and user_id=uid for no key update;
 if not found then raise exception 'Connect Google Calendar first'; end if;

 if action='set' then
  if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose whether to sync both ways'; end if;
  if conn.two_way_enabled=(payload->>'enabled')::boolean then return '{}'::jsonb; end if;
  if conn.lease_until>now() then raise exception 'Calendar sync is running. Try again in a moment.'; end if;
  update private.personal_calendar_connections
   set two_way_enabled=(payload->>'enabled')::boolean,google_sync_token=null,google_page_token=null,next_attempt_at=now()
   where id=conn.id;
  delete from private.google_calendar_pending_occurrences where connection_id=conn.id;
  return '{}'::jsonb;
 end if;
 if conn.lease_id is null or conn.lease_id is distinct from (payload->>'lease')::uuid
    or conn.lease_until is null or conn.lease_until<=now() then
  raise exception 'Calendar sync lease expired';
 end if;
 if action='cursor' then
  if not conn.two_way_enabled then return null; end if;
  if conn.repeat_baseline_pending and payload->'includeRepeating'='true'::jsonb then
   -- Existing connections already advanced past recurring events when the
   -- old worker ignored them. Read a fresh baseline under the new lease.
   update private.personal_calendar_connections
    set google_sync_token=null,google_page_token=null,repeat_baseline_pending=false where id=conn.id;
   return jsonb_build_object('syncToken',null,'pageToken',null);
  end if;
  return jsonb_build_object('syncToken',conn.google_sync_token,'pageToken',conn.google_page_token);
 end if;
 if not conn.two_way_enabled then raise exception 'Turn on two-way sync first'; end if;
 if action='reset' then
  update private.personal_calendar_connections set google_sync_token=null,google_page_token=null where id=conn.id;
  delete from private.google_calendar_pending_occurrences where connection_id=conn.id;
  return '{}'::jsonb;
 end if;
 if action in ('keep_single_event_id','keep_series_event_id') then
  eid:=(payload->>'eventId')::uuid;
  -- Two-way sync retains the existing Google ID when the event's time type
  -- allows a patch. The copy worker still reconciles modified occurrences.
  update private.personal_calendar_links l set shape=payload->'shape'
   where connection_id=conn.id and event_id=eid and l.synced_version is not null
    and l.shape->'all_day'=payload->'shape'->'all_day'
    and cardinality(l.retired_ids)=0
    and ((action='keep_single_event_id' and l.shape->'recurrence'='[]'::jsonb
           and payload->'shape'->'recurrence'='[]'::jsonb and cardinality(l.exception_dates)=0)
      or (action='keep_series_event_id' and (l.shape->'recurrence'<>'[]'::jsonb or payload->'shape'->'recurrence'<>'[]'::jsonb)))
    and exists(select 1 from private.personal_calendar_queue q
     where q.connection_id=conn.id and q.event_id=eid and q.revision=(payload->>'revision')::bigint);
  return '{}'::jsonb;
 end if;
 if action<>'apply' then raise exception 'Unknown calendar sync operation'; end if;
 next_page:=payload->>'nextPage'; next_sync:=payload->>'nextSync';
 if (next_page is null)=(next_sync is null) or coalesce(length(next_page),length(next_sync)) not between 1 and 4096
  or jsonb_typeof(payload->'changes') is distinct from 'array' or jsonb_array_length(payload->'changes')>100 then
  raise exception 'Invalid Google calendar page';
 end if;

 -- Retain a cancelled or moved date when Google paginates it before its master.
 for change in select entry from (
  select value as entry,0 as priority, ordinality as position
   from jsonb_array_elements(payload->'changes') with ordinality where value->>'kind'<>'occurrence'
  union all
  select item.change,1,0 from private.google_calendar_pending_occurrences item
   where item.connection_id=conn.id and exists(
    select 1 from jsonb_array_elements(payload->'changes') entry
     where entry->>'kind'='event' and entry->>'googleId'=item.google_id)
  union all
  select value,2,ordinality from jsonb_array_elements(payload->'changes') with ordinality where value->>'kind'='occurrence'
 ) incoming order by priority,position
 loop
  gid:=change->>'googleId';
  if gid is null or length(gid) not between 1 and 1200 then raise exception 'Invalid event ID'; end if;
  select * into link from private.personal_calendar_links where connection_id=conn.id and google_id=gid;
  if change->>'kind'='occurrence' then
   occurrence_day:=change->>'date';
   occurrence:=change->'event';
   if occurrence_day is null or occurrence_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(jsonb_typeof(occurrence),'') not in ('object','null') then raise exception 'Invalid occurrence'; end if;
   if link.event_id is null then
    if next_page is not null then
     insert into private.google_calendar_pending_occurrences(connection_id,google_id,occurrence_date,change)
      values(conn.id,gid,occurrence_day::date,change)
      on conflict(connection_id,google_id,occurrence_date) do update set change=excluded.change;
    end if;
    continue;
   end if;
   delete from private.google_calendar_pending_occurrences
    where connection_id=conn.id and google_id=gid and occurrence_date=occurrence_day::date;
   if conn.google_sync_token is null and gid ~ '^home[0-9a-f]{32}$' then continue; end if;
   select * into current_event from public.household_events where id=link.event_id and household_id=hid for update;
   if not found or cardinality(current_event.recurrence)=0 or
    link.synced_version is distinct from current_event.version or exists(
     select 1 from private.personal_calendar_queue where connection_id=conn.id and event_id=link.event_id
   ) then continue; end if;
   if occurrence<>'null'::jsonb then
    occurrence:=jsonb_build_object('person',current_event.person)
      ||coalesce(nullif(current_event.exceptions->occurrence_day,'null'::jsonb),'{}'::jsonb)||occurrence;
    if coalesce(current_event.exceptions->occurrence_day->>'location',current_event.location) is distinct from occurrence->>'location' then
     occurrence:=occurrence-'location_place_id';
    end if;
   end if;
   if current_event.exceptions->occurrence_day is not distinct from occurrence then continue; end if;
   eid:=current_event.id;
   overrides:=jsonb_set(current_event.exceptions,array[occurrence_day],occurrence);
   update public.household_events set exceptions=overrides,version=current_event.version+1
    where id=eid and household_id=hid returning version into saved_version;
   update private.personal_calendar_links set synced_version=saved_version,
    exception_dates=array(select jsonb_object_keys(overrides)) where connection_id=conn.id and event_id=eid;
   delete from private.personal_calendar_queue where connection_id=conn.id and event_id=eid;
   changed:=changed+1;
   continue;
  end if;
  if change->>'kind'='event' then
   select array(select jsonb_array_elements_text(coalesce(change->'shape'->'recurrence','[]'))) into rules;
  end if;
  if link.event_id is not null then
   -- Full snapshots establish a baseline without replacing previously linked
   -- HH events. Only changes received after that baseline update them.
   if conn.google_sync_token is null then continue; end if;
   select * into current_event from public.household_events
    where id=link.event_id and household_id=hid for update;
   if not found or link.synced_version is distinct from current_event.version
     or exists(select 1 from private.personal_calendar_queue where connection_id=conn.id and event_id=link.event_id)
   then continue; end if;
   eid:=current_event.id;
   if change->>'kind'='deleted' then
    delete from public.household_events where id=eid and household_id=hid;
    delete from private.personal_calendar_links where connection_id=conn.id and event_id=eid;
   else
    fields:=jsonb_populate_record(null::public.household_events,change->'event');
    if row(current_event.title,current_event.description,current_event.location,current_event.starts_at,current_event.ends_at,current_event.all_day,current_event.start_date,current_event.end_date,current_event.recurrence)
     is not distinct from row(fields.title,fields.description,fields.location,fields.starts_at,fields.ends_at,fields.all_day,fields.start_date,fields.end_date,rules)
    then continue; end if;
    update public.household_events set title=fields.title,description=fields.description,location=fields.location,
     location_place_id=case when current_event.location=fields.location then current_event.location_place_id else null end,
     starts_at=fields.starts_at,ends_at=fields.ends_at,all_day=fields.all_day,start_date=fields.start_date,end_date=fields.end_date,
     recurrence=rules,exceptions=case when cardinality(rules)=0 then '{}'::jsonb else current_event.exceptions end,
     version=current_event.version+1 where id=eid and household_id=hid returning version into saved_version;
    update private.personal_calendar_links set synced_version=saved_version,shape=change->'shape',
     exception_dates=case when cardinality(rules)=0 then '{}'::text[] else exception_dates end
     where connection_id=conn.id and event_id=eid;
   end if;
  else
   -- Recovering an already exported event must use its mapping. A cancelled or
   -- retired HH copy is never imported as a new household event.
   if change->>'kind'<>'event' or gid ~ '^home[0-9a-f]{32}$'
    or coalesce((change->>'hhCopy')::boolean,false)
    or exists(select 1 from private.personal_calendar_links where connection_id=conn.id and gid=any(retired_ids))
   then continue; end if;
   fields:=jsonb_populate_record(null::public.household_events,change->'event');
   insert into public.household_events(household_id,title,description,location,starts_at,ends_at,all_day,start_date,end_date,reminder_30_enabled,recurrence)
    values(hid,fields.title,fields.description,fields.location,fields.starts_at,fields.ends_at,fields.all_day,fields.start_date,fields.end_date,false,rules)
    returning id,version into eid,saved_version;
   insert into private.personal_calendar_links(connection_id,event_id,google_id,shape,base_done,synced_version)
    values(conn.id,eid,gid,change->'shape',true,saved_version);
  end if;
  -- Preserve queued copies to other members while avoiding an echo to the
  -- calendar that already contains this change.
  delete from private.personal_calendar_queue where connection_id=conn.id and event_id=eid;
  changed:=changed+1;
 end loop;
 update private.personal_calendar_connections set google_page_token=next_page,
  google_sync_token=coalesce(next_sync,google_sync_token) where id=conn.id;
 if next_sync is not null then
  delete from private.google_calendar_pending_occurrences where connection_id=conn.id;
 end if;
 return jsonb_build_object('changed',changed);
end;$$;

