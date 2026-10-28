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
