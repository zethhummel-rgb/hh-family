-- Personal replicas follow the native HH calendar. The existing household
-- connection and the legacy Google-to-HH transfer keep their own storage.
create table private.personal_calendar_connections (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null,
 user_id uuid not null,
 calendar_id text not null check (char_length(calendar_id) between 1 and 1024),
 secret_id uuid not null,
 lease_id uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 last_synced_at timestamptz,
 last_error text check (last_error in ('reconnect','retry','needs_attention')),
 unique (household_id,user_id),
 unique (calendar_id),
 foreign key (household_id,user_id) references public.household_members(household_id,user_id) on delete cascade
);

create table private.personal_calendar_states (
 household_id uuid not null,
 user_id uuid not null,
 state_hash text not null unique,
 verifier text not null,
 expires_at timestamptz not null default now()+interval '10 minutes',
 claimed boolean not null default false,
 primary key (household_id,user_id),
 foreign key (household_id,user_id) references public.household_members(household_id,user_id) on delete cascade
);

create table private.personal_calendar_queue (
 connection_id uuid not null references private.personal_calendar_connections(id) on delete cascade,
 event_id uuid not null,
 revision bigint not null default 1,
 changed_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,
 last_error text check (last_error in ('retry','needs_attention')),
 primary key (connection_id,event_id)
);
create index personal_calendar_queue_due on private.personal_calendar_queue(connection_id,next_attempt_at,changed_at);

create table private.personal_calendar_links (
 connection_id uuid not null references private.personal_calendar_connections(id) on delete cascade,
 event_id uuid not null,
 google_id text not null,
 shape jsonb,
 exception_dates text[] not null default '{}',
 retired_ids text[] not null default '{}',
 work_revision bigint,
 base_done boolean not null default false,
 pending_dates text[] not null default '{}',
 synced_version integer,
 primary key (connection_id,event_id)
);

alter table private.personal_calendar_connections enable row level security;
alter table private.personal_calendar_states enable row level security;
alter table private.personal_calendar_queue enable row level security;
alter table private.personal_calendar_links enable row level security;
revoke all on private.personal_calendar_connections,private.personal_calendar_states,private.personal_calendar_queue,private.personal_calendar_links from public,anon,authenticated;

create function private.delete_personal_calendar_token() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from vault.secrets where id=old.secret_id;
 return old;
end;$$;
revoke all on function private.delete_personal_calendar_token() from public,anon,authenticated;
create trigger delete_personal_calendar_token after delete on private.personal_calendar_connections
 for each row execute function private.delete_personal_calendar_token();

create function private.queue_personal_calendar_copies() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_home uuid := coalesce(new.household_id,old.household_id);
begin
 -- Serialize the initial snapshot with events being created, edited or deleted.
 perform pg_advisory_xact_lock(hashtextextended(target_home::text,27931));
 insert into private.personal_calendar_queue(connection_id,event_id)
 select id,coalesce(new.id,old.id) from private.personal_calendar_connections where household_id=target_home
 on conflict(connection_id,event_id) do update set revision=personal_calendar_queue.revision+1,
   changed_at=now(),next_attempt_at=now(),attempts=0,last_error=null;
 return null;
end;$$;
revoke all on function private.queue_personal_calendar_copies() from public,anon,authenticated;
create trigger queue_personal_calendar_copies after insert or update or delete on public.household_events
 for each row execute function private.queue_personal_calendar_copies();

create function private.personal_calendar_ready(target_home uuid) returns boolean
language sql stable set search_path='' as $$
 select not private.household_transition_active(target_home)
 and not exists(select 1 from private.calendar_copy_state where household_id=target_home and not native_ready);
$$;
revoke all on function private.personal_calendar_ready(uuid) from public,anon,authenticated;

create function private.personal_calendar_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 hid uuid := (payload->>'householdId')::uuid;
 uid uuid := (payload->>'userId')::uuid;
 hash text := payload->>'hash';
 state private.personal_calendar_states%rowtype;
 connection private.personal_calendar_connections%rowtype;
 link private.personal_calendar_links%rowtype;
 queued private.personal_calendar_queue%rowtype;
 eid uuid; expected bigint; credential uuid; dates text[]; work jsonb; problem text; pending integer;
 existing_owner_copy boolean;
begin
 if not exists(select 1 from public.household_members where household_id=hid and user_id=uid) then
  raise exception 'Household membership required';
 end if;

 if action='state_take' then
  update private.personal_calendar_states set claimed=true
   where state_hash=hash and household_id=hid and user_id=uid and not claimed and expires_at>now() returning * into state;
  if not found or not private.personal_calendar_ready(state.household_id) then return null;end if;
  select * into connection from private.personal_calendar_connections where household_id=state.household_id and user_id=state.user_id;
  return jsonb_build_object('householdId',state.household_id,'userId',state.user_id,'verifier',state.verifier,
   'calendarId',connection.calendar_id,'householdName',(select name from public.households where id=state.household_id));
 elsif action='state_release' then
  delete from private.personal_calendar_states where state_hash=hash and household_id=hid and user_id=uid and claimed;
  return null;
 end if;

 if action='status' then
  select * into connection from private.personal_calendar_connections where household_id=hid and user_id=uid;
  select count(*) into pending from private.personal_calendar_queue where connection_id=connection.id;
  select exists(select 1 from private.google_calendar_connections where household_id=hid and user_id=uid) into existing_owner_copy;
  return jsonb_build_object('available',private.personal_calendar_ready(hid),'usesExistingCopy',existing_owner_copy,
   'connected',connection.id is not null,'pending',pending,'lastSyncedAt',connection.last_synced_at,
   'status',case when connection.id is null then 'off'
    when connection.last_error is not null then connection.last_error
    when exists(select 1 from private.personal_calendar_queue where connection_id=connection.id and last_error='needs_attention') then 'needs_attention'
    when pending>0 then 'pending' else 'up_to_date' end);
 elsif action='filter_import_calendars' then
  return (select coalesce(jsonb_agg(calendar),'[]') from jsonb_array_elements(payload->'calendars') calendar
   where not exists(select 1 from private.personal_calendar_connections
    where household_id=hid and calendar_id=calendar->>'id'));
 elsif action='disconnect' then
  delete from private.personal_calendar_states where household_id=hid and user_id=uid;
  select * into connection from private.personal_calendar_connections where household_id=hid and user_id=uid for update;
  if connection.lease_until>now() then raise exception 'Your Google copy is updating. Try disconnecting in a moment.';end if;
  delete from private.personal_calendar_connections where id=connection.id;
  return '{}'::jsonb;
 end if;

 if not private.personal_calendar_ready(hid) then raise exception 'Your household calendar transfer must finish first';end if;
 if action in ('state_create','connection_set')
  and exists(select 1 from private.google_calendar_connections where household_id=hid and user_id=uid) then
  raise exception 'Reconnect your existing Google calendar';
 end if;
 if action='state_create' then
  insert into private.personal_calendar_states(household_id,user_id,state_hash,verifier)
   values(hid,uid,hash,payload->>'verifier')
   on conflict(household_id,user_id) do update set state_hash=excluded.state_hash,verifier=excluded.verifier,
    expires_at=excluded.expires_at,claimed=false
   where not personal_calendar_states.claimed or personal_calendar_states.expires_at<=now();
  if not found then raise exception 'A Google connection is already being set up';end if;
  return '{}'::jsonb;
 elsif action='connection_set' then
  perform pg_advisory_xact_lock(hashtextextended(hid::text,27931));
  perform 1 from private.personal_calendar_states
   where household_id=hid and user_id=uid and state_hash=hash and claimed and expires_at>now() for update;
  if not found then raise exception 'Google connection expired';end if;
  select * into connection from private.personal_calendar_connections where household_id=hid and user_id=uid for update;
  if connection.id is not null and connection.calendar_id is distinct from payload->>'calendarId' then
   raise exception 'Reconnect with the Google account that owns this copy';
  end if;
  if coalesce(char_length(payload->>'refreshToken'),0) not between 1 and 4096 then raise exception 'Invalid Google credential';end if;
  select vault.create_secret(payload->>'refreshToken') into credential;
  if connection.id is null then
   insert into private.personal_calendar_connections(household_id,user_id,calendar_id,secret_id)
    values(hid,uid,payload->>'calendarId',credential) returning * into connection;
   insert into private.personal_calendar_queue(connection_id,event_id)
    select connection.id,id from public.household_events where household_id=hid;
  else
   update private.personal_calendar_connections set secret_id=credential,last_error=null,next_attempt_at=now() where id=connection.id;
   delete from vault.secrets where id=connection.secret_id;
  end if;
  delete from private.personal_calendar_states where household_id=hid and user_id=uid;
  return '{}'::jsonb;
 elsif action='claim' then
  update private.personal_calendar_connections set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds'
   where household_id=hid and user_id=uid and next_attempt_at<=now() and (lease_until is null or lease_until<now())
   returning * into connection;
  if not found then return null;end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventId',q.event_id,'revision',q.revision,'event',to_jsonb(e))), '[]') into work
   from (select * from private.personal_calendar_queue where connection_id=connection.id and next_attempt_at<=now()
    order by changed_at,event_id limit 5) q
   left join public.household_events e on e.id=q.event_id and e.household_id=hid;
  return jsonb_build_object('lease',connection.lease_id,'nativeReady',true,'work',work);
 end if;

 select * into connection from private.personal_calendar_connections
  where household_id=hid and user_id=uid and lease_id=(payload->>'lease')::uuid and lease_until>now() for update;
 if not found then raise exception 'Personal calendar copy lease is unavailable';end if;
 if action='credentials' then
  return (select jsonb_build_object('calendarId',connection.calendar_id,'refreshToken',decrypted_secret)
   from vault.decrypted_secrets where id=connection.secret_id);
 elsif action='check_lease' then
  return '{}'::jsonb;
 elsif action='finish' then
  problem:=payload->>'error';
  update private.personal_calendar_connections set lease_id=null,lease_until=null,last_error=problem,
   next_attempt_at=now()+case problem when 'reconnect' then interval '15 minutes' when 'needs_attention' then interval '6 hours' else interval '30 seconds' end,
   last_synced_at=case when problem is null and not exists(select 1 from private.personal_calendar_queue where connection_id=connection.id)
    then now() else last_synced_at end
   where id=connection.id;
  return '{}'::jsonb;
 end if;

 eid:=(payload->>'eventId')::uuid;expected:=(payload->>'revision')::bigint;
 select * into queued from private.personal_calendar_queue where connection_id=connection.id and event_id=eid;
 if not found then return null;end if;
 if action='event_failed' then
  problem:=payload->>'error';if problem is null or problem not in ('retry','needs_attention') then raise exception 'Invalid copy failure';end if;
  update private.personal_calendar_queue set attempts=attempts+1,last_error=problem,
   next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
   where connection_id=connection.id and event_id=eid and revision=expected;
  return '{}'::jsonb;
 elsif action='prepare' then
  if queued.revision<>expected then return null;end if;
  dates:=array(select jsonb_array_elements_text(coalesce(payload->'dates','[]')));
  if cardinality(dates)>40000 or exists(select 1 from unnest(dates) d where d !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid copy occurrence dates';end if;
  select * into link from private.personal_calendar_links where connection_id=connection.id and event_id=eid for update;
  if not found then
   insert into private.personal_calendar_links(connection_id,event_id,google_id) values(connection.id,eid,'home'||replace(eid::text,'-','')) returning * into link;
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
  update private.personal_calendar_links set google_id=link.google_id,retired_ids=link.retired_ids,shape=payload->'shape',exception_dates=link.exception_dates,
   pending_dates=link.pending_dates,base_done=link.base_done,work_revision=link.work_revision,synced_version=link.synced_version
   where connection_id=connection.id and event_id=eid returning * into link;
  return to_jsonb(link);
 elsif action='retired_done' then
  update private.personal_calendar_links set retired_ids=array_remove(retired_ids,payload->>'googleId') where connection_id=connection.id and event_id=eid;
 elsif action='base_done' then
  update private.personal_calendar_links set base_done=true where connection_id=connection.id and event_id=eid and work_revision=expected;
 elsif action='date_done' then
  update private.personal_calendar_links set pending_dates=array_remove(pending_dates,payload->>'date') where connection_id=connection.id and event_id=eid and work_revision=expected;
 elsif action='event_done' then
  if coalesce((payload->>'deleted')::boolean,false) then
   delete from private.personal_calendar_links where connection_id=connection.id and event_id=eid;
  else
   if exists(select 1 from private.personal_calendar_links where connection_id=connection.id and event_id=eid and (not base_done or cardinality(pending_dates)>0 or cardinality(retired_ids)>0)) then raise exception 'Calendar copy is incomplete';end if;
   update private.personal_calendar_links set synced_version=(payload->>'version')::integer,exception_dates=array(select jsonb_array_elements_text(coalesce(payload->'dates','[]'))),work_revision=null
    where connection_id=connection.id and event_id=eid;
  end if;
  delete from private.personal_calendar_queue where connection_id=connection.id and event_id=eid and revision=expected;
 else raise exception 'Unknown personal calendar copy operation';end if;
 return '{}'::jsonb;
end;$$;

create function public.personal_calendar_service(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.personal_calendar_service(action,payload);
$$;
revoke all on function private.personal_calendar_service(text,jsonb),public.personal_calendar_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.personal_calendar_service(text,jsonb),public.personal_calendar_service(text,jsonb) to service_role;

create function private.dispatch_personal_calendar_copies() returns bigint
language plpgsql security definer set search_path='' as $$
declare copy record; api_url text; credential text; dispatched bigint:=0;
begin
 delete from private.personal_calendar_states where expires_at<=now();
 select decrypted_secret into api_url from vault.decrypted_secrets where name='home_together_api_url';
 select decrypted_secret into credential from vault.decrypted_secrets where name='hummel_push_cron';
 if api_url is null or credential is null then return 0;end if;
 for copy in
  select c.id,c.household_id,c.user_id from private.personal_calendar_connections c
  where c.next_attempt_at<=now() and (c.lease_until is null or c.lease_until<now())
   and private.personal_calendar_ready(c.household_id)
   and exists(select 1 from private.personal_calendar_queue q where q.connection_id=c.id and q.next_attempt_at<=now())
  order by c.next_attempt_at,c.id limit 30
 loop
  perform net.http_post(url:=api_url||'/functions/v1/google-calendar',
   headers:=jsonb_build_object('Content-Type','application/json','x-hummel-cron',credential),
   body:=jsonb_build_object('action','personal_sync','householdId',copy.household_id,'userId',copy.user_id),timeout_milliseconds:=30000);
  dispatched:=dispatched+1;
 end loop;
 return dispatched;
end;$$;
revoke all on function private.dispatch_personal_calendar_copies() from public,anon,authenticated;
select cron.schedule('hh-personal-google-calendar-copy','* * * * *','select private.dispatch_personal_calendar_copies();');
notify pgrst,'reload schema';
