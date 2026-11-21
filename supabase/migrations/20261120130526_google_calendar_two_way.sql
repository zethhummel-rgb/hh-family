alter table private.personal_calendar_connections
 add column two_way_enabled boolean not null default false,
 add column google_sync_token text,
 add column google_page_token text;

create unique index personal_calendar_link_google_id on private.personal_calendar_links(connection_id,google_id);

create function private.personal_calendar_two_way(action text,payload jsonb) returns jsonb
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
  return '{}'::jsonb;
 end if;
 if conn.lease_id is null or conn.lease_id is distinct from (payload->>'lease')::uuid
    or conn.lease_until is null or conn.lease_until<=now() then
  raise exception 'Calendar sync lease expired';
 end if;
 if action='cursor' then
  if not conn.two_way_enabled then return null; end if;
  return jsonb_build_object('syncToken',conn.google_sync_token,'pageToken',conn.google_page_token);
 end if;
 if not conn.two_way_enabled then raise exception 'Turn on two-way sync first'; end if;
 if action='reset' then
  update private.personal_calendar_connections set google_sync_token=null,google_page_token=null where id=conn.id;
  return '{}'::jsonb;
 end if;
 if action='keep_single_event_id' then
  eid:=(payload->>'eventId')::uuid;
  -- The existing worker rebuilds recurring series if their dates or rules
  -- change. For simple events it can safely patch the existing Google ID.
  update private.personal_calendar_links l set shape=payload->'shape'
   where connection_id=conn.id and event_id=eid and l.synced_version is not null
    and l.shape->'recurrence'='[]'::jsonb and payload->'shape'->'recurrence'='[]'::jsonb
    and l.shape->'all_day'=payload->'shape'->'all_day'
    and cardinality(l.exception_dates)=0 and cardinality(l.retired_ids)=0
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

 for change in select value from jsonb_array_elements(payload->'changes') loop
  gid:=change->>'googleId';
  if gid is null or length(gid) not between 1 and 1200 then raise exception 'Invalid event ID'; end if;
  select * into link from private.personal_calendar_links where connection_id=conn.id and google_id=gid;
  if found then
   -- Full snapshots establish a baseline without replacing previously linked
   -- HH events. Only changes received after that baseline update them.
   if conn.google_sync_token is null then continue; end if;
   select * into current_event from public.household_events
    where id=link.event_id and household_id=hid for update;
   if not found or cardinality(current_event.recurrence)>0
     or link.synced_version is distinct from current_event.version
     or exists(select 1 from private.personal_calendar_queue where connection_id=conn.id and event_id=link.event_id)
   then continue; end if;
   eid:=current_event.id;
   if change->>'kind'='deleted' then
    delete from public.household_events where id=eid and household_id=hid;
    delete from private.personal_calendar_links where connection_id=conn.id and event_id=eid;
   else
    fields:=jsonb_populate_record(null::public.household_events,change->'event');
    if row(current_event.title,current_event.description,current_event.location,current_event.starts_at,current_event.ends_at,current_event.all_day,current_event.start_date,current_event.end_date)
     is not distinct from row(fields.title,fields.description,fields.location,fields.starts_at,fields.ends_at,fields.all_day,fields.start_date,fields.end_date)
    then continue; end if;
    update public.household_events set title=fields.title,description=fields.description,location=fields.location,
     location_place_id=case when current_event.location=fields.location then current_event.location_place_id else null end,
     starts_at=fields.starts_at,ends_at=fields.ends_at,all_day=fields.all_day,start_date=fields.start_date,end_date=fields.end_date,
     version=current_event.version+1 where id=eid and household_id=hid returning version into saved_version;
    update private.personal_calendar_links set synced_version=saved_version,shape=change->'shape'
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
   insert into public.household_events(household_id,title,description,location,starts_at,ends_at,all_day,start_date,end_date,reminder_30_enabled)
    values(hid,fields.title,fields.description,fields.location,fields.starts_at,fields.ends_at,fields.all_day,fields.start_date,fields.end_date,false)
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
 return jsonb_build_object('changed',changed);
end;$$;

create function public.personal_calendar_two_way(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.personal_calendar_two_way(action,payload);
$$;
revoke all on function private.personal_calendar_two_way(text,jsonb),public.personal_calendar_two_way(text,jsonb) from public,anon,authenticated;
grant execute on function private.personal_calendar_two_way(text,jsonb),public.personal_calendar_two_way(text,jsonb) to service_role;

-- Schedule only active two-way connections on the live HH project.
create function private.dispatch_personal_calendar_two_way() returns bigint
language plpgsql security definer set search_path='' as $$
declare item record; credential text; dispatched bigint:=0;
begin
 if not exists(select 1 from vault.decrypted_secrets
  where name='home_together_api_url' and decrypted_secret='https://njpdqiwrwgoothkstoql.supabase.co') then return 0; end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='hummel_push_cron';
 if credential is null then return 0; end if;
 for item in select household_id,user_id from private.personal_calendar_connections c
  where c.two_way_enabled and c.next_attempt_at<=now() and (c.lease_until is null or c.lease_until<now())
   and private.personal_calendar_ready(c.household_id)
  order by c.next_attempt_at,c.id limit 10
 loop
  perform net.http_post(url:='https://njpdqiwrwgoothkstoql.supabase.co/functions/v1/google-calendar',
   headers:=jsonb_build_object('Content-Type','application/json','x-hummel-cron',credential),
   body:=jsonb_build_object('action','personal_sync','householdId',item.household_id,'userId',item.user_id),
   timeout_milliseconds:=30000);
  dispatched:=dispatched+1;
 end loop;
 return dispatched;
end;$$;
revoke all on function private.dispatch_personal_calendar_two_way() from public,anon,authenticated;
select cron.schedule('hh-google-two-way','* * * * *','select private.dispatch_personal_calendar_two_way();');
notify pgrst,'reload schema';
