-- One-time, consented imports. No refresh tokens and no connection to the outbound copy.
create table private.google_import_sessions (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households on delete cascade,
 user_id uuid not null references auth.users on delete cascade, state_hash text unique, verifier text,
 secret_id uuid, completion_hash text, expires_at timestamptz not null default now()+interval '10 minutes',
 calendars jsonb not null default '[]', preview_id uuid, preview_expires_at timestamptz,
 calendar_id text, preview jsonb, receipt jsonb, unique(household_id,user_id)
);
create table private.google_import_ledger (
 household_id uuid not null references public.households on delete cascade,
 source_key text not null check(source_key ~ '^[a-f0-9]{64}$'), event_id uuid not null,
 imported_at timestamptz not null default now(), primary key(household_id,source_key)
);
alter table private.google_import_sessions enable row level security;
alter table private.google_import_ledger enable row level security;
revoke all on private.google_import_sessions,private.google_import_ledger from public,anon,authenticated;
create index google_import_sessions_expiry on private.google_import_sessions(expires_at);
create index google_import_sessions_user on private.google_import_sessions(user_id);

create function private.google_import_secret_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.secret_id is not null and (tg_op='DELETE' or new.secret_id is distinct from old.secret_id) then delete from vault.secrets where id=old.secret_id;end if;
 return null;
end $$;
revoke all on function private.google_import_secret_cleanup() from public,anon,authenticated;
create trigger google_import_secret_cleanup after delete or update of secret_id on private.google_import_sessions for each row execute function private.google_import_secret_cleanup();
create function private.google_import_member_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from private.google_import_sessions where household_id=old.household_id and user_id=old.user_id;return null;end $$;
revoke all on function private.google_import_member_cleanup() from public,anon,authenticated;
create trigger google_import_member_cleanup after delete on public.household_members for each row execute function private.google_import_member_cleanup();
create function private.expire_google_imports() returns void language sql security definer set search_path='' as $$
 delete from private.google_import_sessions where expires_at<=now();
$$;
revoke all on function private.expire_google_imports() from public,anon,authenticated;
select cron.schedule('hh-expire-google-imports','*/10 * * * *','select private.expire_google_imports()');

create function private.google_import_service(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid; uid uuid; sess private.google_import_sessions; sid uuid; result jsonb; entry jsonb; event public.household_events;
 keys text[]; people text[]; label text; enabled boolean; count_added integer:=0; count_skipped integer:=0; key text; exception_row record; changes jsonb; saved_id uuid;
begin
 perform private.expire_google_imports();
 if action='state_take' then
  update private.google_import_sessions set state_hash=null
   where state_hash=payload->>'hash' and expires_at>now()
   returning * into sess;
  if sess.id is null then return null;end if;
  if not exists(select 1 from public.household_members where household_id=sess.household_id and user_id=sess.user_id) then
   delete from private.google_import_sessions where id=sess.id;return null;
  end if;
  return jsonb_build_object('id',sess.id,'householdId',sess.household_id,'userId',sess.user_id,'verifier',sess.verifier);
 end if;
 hid:=(payload->>'householdId')::uuid;uid:=(payload->>'userId')::uuid;
 if hid is null or uid is null then raise exception 'Sign in to your household first';end if;
 perform 1 from public.household_members where household_id=hid and user_id=uid for share;
 if not found then raise exception 'Current household membership is required';end if;
 if action='cancel' then delete from private.google_import_sessions where household_id=hid and user_id=uid and (not(payload ? 'sessionId') or id=(payload->>'sessionId')::uuid);return '{}'::jsonb;end if;
 if exists(select 1 from private.calendar_copy_state where household_id=hid and not native_ready)
    or private.household_transition_active(hid) or not private.household_transition_write_open(hid) then
  raise exception 'Finish your household calendar transfer before importing';
 end if;
 if action='start' then
  if payload->>'hash' !~ '^[a-f0-9]{64}$' or length(payload->>'verifier') not between 40 and 100 then raise exception 'Invalid import request';end if;
  delete from private.google_import_sessions where household_id=hid and user_id=uid;
  insert into private.google_import_sessions(household_id,user_id,state_hash,verifier) values(hid,uid,payload->>'hash',payload->>'verifier');return '{}'::jsonb;
 end if;
 select * into sess from private.google_import_sessions where household_id=hid and user_id=uid and expires_at>now() for update;
 if action='get' then
  if sess.id is null or sess.secret_id is null or sess.completion_hash is not null then return null;end if;
  select jsonb_build_object('accessToken',decrypted_secret,'expiresAt',sess.expires_at,'calendars',sess.calendars) into result from vault.decrypted_secrets where id=sess.secret_id;
  return result;
 end if;
 if sess.id is null then raise exception 'This import expired. Connect Google again';end if;
 if action='authorized' then
  if sess.id<>(payload->>'sessionId')::uuid or sess.state_hash is not null or sess.secret_id is not null or sess.verifier is null then raise exception 'Import authorization expired';end if;
  if payload->>'completionHash' is null or payload->>'completionHash' !~ '^[a-f0-9]{64}$' or length(payload->>'accessToken') not between 20 and 8192 or jsonb_typeof(payload->'calendars')<>'array' or jsonb_array_length(payload->'calendars')>100 then raise exception 'Invalid Google import authorization';end if;
  sid:=vault.create_secret(payload->>'accessToken');
  update private.google_import_sessions set secret_id=sid,verifier=null,completion_hash=payload->>'completionHash',calendars=(select coalesce(jsonb_agg(c),'[]') from jsonb_array_elements(payload->'calendars') c where not exists(select 1 from private.google_calendar_connections where household_id=hid and calendar_id=c->>'id')),expires_at=now()+make_interval(secs=>least(1800,greatest(1,(payload->>'expiresIn')::integer))) where id=sess.id;
  return '{}'::jsonb;
 end if;
 if action='complete' then
  if sess.secret_id is null or sess.completion_hash is null or sess.completion_hash is distinct from payload->>'hash' then raise exception 'Import authorization expired';end if;
  update private.google_import_sessions set completion_hash=null where id=sess.id;return '{}'::jsonb;
 end if;
 if sess.completion_hash is not null then raise exception 'Finish confirming Google import in the account that started it';end if;
 if action='preview' then
  if sess.secret_id is null then raise exception 'Connect Google again';end if;
  if not exists(select 1 from jsonb_array_elements(sess.calendars) c where c->>'id'=payload->>'calendarId') or exists(select 1 from private.google_calendar_connections where household_id=hid and calendar_id=payload->>'calendarId') then raise exception 'Choose an available calendar other than the HH Google copy';end if;
  if jsonb_typeof(payload->'entries')<>'array' or jsonb_array_length(payload->'entries')>2000 or octet_length((payload->'entries')::text)>12000000 then raise exception 'This calendar is too large to import';end if;
  if exists(select 1 from jsonb_array_elements(payload->'entries') e where e->>'sourceKey' is null or e->>'sourceKey' !~ '^[a-f0-9]{64}$') then raise exception 'Invalid import source';end if;
  if (select count(*) from jsonb_array_elements(payload->'entries'))<>(select count(distinct e->>'sourceKey') from jsonb_array_elements(payload->'entries') e) then raise exception 'Duplicate source entries';end if;
  update private.google_import_sessions set preview_id=gen_random_uuid(),preview_expires_at=least(expires_at,now()+interval '15 minutes'),calendar_id=payload->>'calendarId',preview=payload->'entries',receipt=null where id=sess.id returning * into sess;
  select coalesce(jsonb_agg(jsonb_build_object('sourceKey',e->>'sourceKey','title',e->'event'->>'title','description',e->'event'->>'description','location',e->'event'->>'location','starts_at',e->'event'->>'starts_at','ends_at',e->'event'->>'ends_at','all_day',e->'event'->'all_day','start_date',e->'event'->'start_date','end_date',e->'event'->'end_date','recurring',jsonb_array_length(e->'event'->'recurrence')>0,'duplicate',exists(select 1 from private.google_import_ledger l where l.household_id=hid and l.source_key=e->>'sourceKey'))),'[]') into result from jsonb_array_elements(sess.preview) e;
  return jsonb_build_object('previewId',sess.preview_id,'entries',result);
 end if;
 if action='commit' then
  if sess.preview_id is distinct from (payload->>'previewId')::uuid then raise exception 'Preview changed. Review the calendar again';end if;
  if sess.receipt is not null then return sess.receipt;end if;
  if sess.preview_expires_at<=now() or sess.secret_id is null then raise exception 'Preview expired. Review the calendar again';end if;
  if payload->'acknowledgeShared' is distinct from 'true'::jsonb or jsonb_typeof(payload->'reminder30')<>'boolean' then raise exception 'Confirm household sharing and reminder choices';end if;
  if jsonb_typeof(payload->'sourceKeys')<>'array' or jsonb_array_length(payload->'sourceKeys') not between 1 and 2000 or jsonb_typeof(payload->'personIds')<>'array' or jsonb_array_length(payload->'personIds')>20 then raise exception 'Choose events and people to import';end if;
  select array_agg(distinct v) into keys from jsonb_array_elements_text(payload->'sourceKeys') v;
  if exists(select 1 from unnest(keys) k where k is null or not exists(select 1 from jsonb_array_elements(sess.preview) e where e->>'sourceKey'=k)) then raise exception 'An event is not in this preview';end if;
  select coalesce(array_agg(distinct v),'{}') into people from jsonb_array_elements_text(payload->'personIds') v;
  if exists(select 1 from unnest(people) p where p is null or not exists(select 1 from public.household_members m where m.household_id=hid and m.user_id::text=p) and not exists(select 1 from public.household_people hp where hp.household_id=hid and hp.id::text=p)) then raise exception 'Choose people from this household';end if;
  if payload ? 'unassigned' and jsonb_typeof(payload->'unassigned')<>'boolean' then raise exception 'Choose valid people options';end if;
  if coalesce((payload->>'unassigned')::boolean,false) and cardinality(people)>0 then raise exception 'An unassigned event cannot also tag people';end if;
  enabled:=(payload->>'reminder30')::boolean and not coalesce((payload->>'unassigned')::boolean,false);
  label:=case when coalesce((payload->>'unassigned')::boolean,false) then 'Unassigned' when cardinality(people)=0 then 'Everyone' else 'Family' end;
  -- Serialize all imports for this home. The ledger survives deleting an event.
  perform pg_advisory_xact_lock(hashtextextended('google-import:'||hid::text,0));
  if (select count(*) from public.household_events where household_id=hid)+(select count(*) from jsonb_array_elements(sess.preview) e where e->>'sourceKey'=any(keys) and not exists(select 1 from private.google_import_ledger where household_id=hid and source_key=e->>'sourceKey'))>9999 then raise exception 'Your HH calendar is too large for this import. Choose fewer events';end if;
  for entry in select value from jsonb_array_elements(sess.preview) where value->>'sourceKey'=any(keys) loop
   key:=entry->>'sourceKey';
   if exists(select 1 from private.google_import_ledger where household_id=hid and source_key=key) then count_skipped:=count_skipped+1;continue;end if;
   event:=jsonb_populate_record(null::public.household_events,entry->'event');saved_id:=gen_random_uuid();changes:='{}'::jsonb;
   for exception_row in select * from jsonb_each(coalesce(event.exceptions,'{}')) loop
    changes:=changes||jsonb_build_object(exception_row.key,case when exception_row.value='null'::jsonb then 'null'::jsonb else exception_row.value||jsonb_build_object('person',label,'person_ids',people,'reminder_30_enabled',enabled,'reminder_minutes',null) end);
   end loop;
   insert into public.household_events(id,household_id,title,description,location,person,person_ids,starts_at,ends_at,all_day,start_date,end_date,recurrence,exceptions,reminder_30_enabled,reminder_minutes)
   values(saved_id,hid,event.title,event.description,event.location,label,people,event.starts_at,event.ends_at,event.all_day,event.start_date,event.end_date,coalesce(event.recurrence,'{}'),changes,enabled,null);
   insert into private.google_import_ledger(household_id,source_key,event_id) values(hid,key,saved_id);count_added:=count_added+1;
  end loop;
  result:=jsonb_build_object('imported',count_added,'skipped',count_skipped);
  update private.google_import_sessions set secret_id=null,preview=null,calendars='[]',receipt=result where id=sess.id;
  return result;
 end if;
 raise exception 'Unknown Google import operation';
end $$;
revoke all on function private.google_import_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.google_import_service(text,jsonb) to service_role;
create function public.google_import_service(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.google_import_service(action,payload);$$;
revoke all on function public.google_import_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.google_import_service(text,jsonb) to service_role;
