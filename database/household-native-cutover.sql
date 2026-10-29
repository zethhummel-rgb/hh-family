-- Explicit final cutover controls; inert until a configured household is paused.
alter table private.household_transitions add column write_paused boolean not null default false;
alter table private.household_transitions add column completed_at timestamptz;
alter table private.household_transitions add column transfer_report jsonb;
create function private.household_transition_state(hid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('direction',t.direction,'active',coalesce(t.active,false),'writePaused',coalesce(t.write_paused,false),
 'completed',t.completed_at is not null,'readOnly',coalesce(t.write_paused or t.direction='source' and t.completed_at is not null,false))
 from (select 1) dummy left join private.household_transitions t on t.household_id=hid;
$$;
revoke all on function private.household_transition_state(uuid) from public,anon;
grant execute on function private.household_transition_state(uuid) to authenticated,service_role;
create function public.household_transition_state(hid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.is_member(hid) then raise exception 'Household membership required';end if;
 return private.household_transition_state(hid);
end;$$;
revoke all on function public.household_transition_state(uuid) from public,anon;
grant execute on function public.household_transition_state(uuid) to authenticated;
create function public.household_transition_state_service(hid uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.household_transition_state(hid);$$;
revoke all on function public.household_transition_state_service(uuid) from public,anon,authenticated;
grant execute on function public.household_transition_state_service(uuid) to service_role;
create function private.guard_transition_source_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare hid uuid;
begin
 if tg_op='DELETE' then hid:=old.household_id;else hid:=new.household_id;end if;
 if exists(select 1 from private.household_transitions where household_id=hid and direction='source' and (write_paused or completed_at is not null)) then
  raise exception 'Your household is moving to HH. Open HH Family to make changes after the transfer.';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function private.guard_transition_source_write() from public,anon,authenticated;
create trigger guard_transition_source_write before insert or update or delete on public.household_items for each row execute function private.guard_transition_source_write();
create trigger guard_transition_source_write before insert or update or delete on public.household_events for each row execute function private.guard_transition_source_write();
notify pgrst,'reload schema';

create function private.household_transition_write_open(hid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.household_transitions where household_id=hid and write_paused);
$$;
revoke all on function private.household_transition_write_open(uuid) from public,anon;
grant execute on function private.household_transition_write_open(uuid) to authenticated;
create policy transition_cutover_insert on public.household_items as restrictive for insert to authenticated with check(private.household_transition_write_open(household_id));
create policy transition_cutover_update on public.household_items as restrictive for update to authenticated using(private.household_transition_write_open(household_id)) with check(private.household_transition_write_open(household_id));
create policy transition_cutover_delete on public.household_items as restrictive for delete to authenticated using(private.household_transition_write_open(household_id));
create or replace function private.native_calendar_writable(hid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_member(hid) and not private.household_transition_active(hid) and private.household_transition_write_open(hid)
 and not exists(select 1 from private.calendar_copy_state s where s.household_id=hid and not s.native_ready);
$$;
revoke all on function private.native_calendar_writable(uuid) from public,anon;
grant execute on function private.native_calendar_writable(uuid) to authenticated;

-- Preserve completion history and anchors on an explicitly privileged import.
-- User writes continue through the ordinary completion guard below.
create or replace function private.maintain_reminder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('postgres','service_role') and current_setting('hh.transition_import',true)=new.household_id::text then return new;end if;
 if tg_op='INSERT' then
  new.reminder_version:=1;new.repeat_anchor:=new.due;new.last_completed_at:=null;
 elsif new.kind='task' then
  -- The previous occurrence is done. A repeat cannot be completed again before
  -- its next date, even by an old client or a second family member.
  if new.done and not old.done and old.repeat_unit<>'none'
    and old.last_completed_at is not null
    and old.due>(now() at time zone 'America/Toronto')::date then
   return old;
  end if;
  new.reminder_version:=old.reminder_version+1;new.last_completed_at:=old.last_completed_at;
  if new.done and not old.done then
   new.last_completed_at:=now();
   if new.repeat_unit<>'none' then
    -- Keep the original day anchor through shorter months and leap years.
    new.repeat_anchor:=coalesce(old.repeat_anchor,old.due);
    new.due:=private.advance_reminder(new.repeat_anchor,new.repeat_unit,new.repeat_every,greatest(old.due,(now() at time zone 'America/Toronto')::date));
    new.done:=false;
   end if;
  elsif new.due is distinct from old.due or new.repeat_unit<>old.repeat_unit or new.repeat_every<>old.repeat_every then
   new.repeat_anchor:=new.due;
  else new.repeat_anchor:=old.repeat_anchor;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.maintain_reminder() from public,anon,authenticated;

create function private.finish_household_transition(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hid uuid:=(payload->>'householdId')::uuid;t private.household_transitions%rowtype;
 backup private.household_transition_snapshots%rowtype;entry jsonb;event public.household_events%rowtype;saved public.household_events%rowtype;list_item public.household_items%rowtype;
 imported_events integer:=0;imported_items integer:=0;report jsonb;native_time text;occurrence text;
begin
 select * into t from private.household_transitions where household_id=hid for update;
 if not found or t.direction<>'target' or not t.active or not t.write_paused or t.completed_at is not null then raise exception 'Paused active transition required';end if;
 perform 1 from public.households h join public.household_members m on m.household_id=h.id and m.user_id=h.owner_id and m.role='owner' where h.id=hid and h.owner_id=t.owner_id for update of h;
 if not found then raise exception 'Household owner changed';end if;
 select * into backup from private.household_transition_snapshots where id=(payload->>'snapshotId')::uuid and household_id=hid;
 if not found or backup.snapshot_hash is distinct from payload->>'snapshotHash' then raise exception 'Preservation snapshot mismatch';end if;
 if jsonb_typeof(payload->'events') is distinct from 'array' or jsonb_typeof(backup.snapshot->'google') is distinct from 'array' or jsonb_typeof(backup.snapshot->'items') is distinct from 'array' then raise exception 'Complete snapshot required';end if;
 if exists(select 1 from public.household_events where household_id=hid) or exists(select 1 from public.household_items where household_id=hid) then raise exception 'Target is not empty; preserve its changes first';end if;
 if jsonb_typeof(backup.snapshot->'native') is distinct from 'array' or jsonb_array_length(backup.snapshot->'native')<>0 then raise exception 'Preserve unexpected native source rows before cutover';end if;
 if jsonb_array_length(payload->'events')>1000 or jsonb_array_length(backup.snapshot->'items')>1000 then raise exception 'Transfer too large';end if;
 if (select count(*) from jsonb_array_elements(backup.snapshot->'google') e where coalesce(e->>'status','confirmed')<>'cancelled' and not e ? 'recurringEventId')<>jsonb_array_length(payload->'events')
 or exists(select 1 from jsonb_array_elements(backup.snapshot->'google') e where coalesce(e->>'status','confirmed')<>'cancelled' and not e ? 'recurringEventId' and not exists(select 1 from jsonb_array_elements(payload->'events') n where n->>'googleId'=e->>'id'))
 or (select count(*)<>count(distinct e->>'googleId') from jsonb_array_elements(payload->'events') e) then raise exception 'Calendar identity verification failed';end if;
 perform set_config('hh.transition_import',hid::text,true);
 for entry in select * from jsonb_array_elements(backup.snapshot->'items') loop
  if entry->>'household_id' is distinct from t.peer_household_id::text then raise exception 'Source list belongs to another household';end if;
  list_item:=jsonb_populate_record(null::public.household_items,entry||jsonb_build_object('household_id',hid));
  insert into public.household_items(id,household_id,kind,title,category,person,due,done,created_at,reminder_time,repeat_unit,repeat_every,repeat_anchor,reminder_version,last_completed_at)
  values(list_item.id,hid,list_item.kind,list_item.title,list_item.category,list_item.person,list_item.due,list_item.done,list_item.created_at,list_item.reminder_time,list_item.repeat_unit,list_item.repeat_every,list_item.repeat_anchor,list_item.reminder_version,list_item.last_completed_at)
  returning * into list_item;
  if to_jsonb(list_item) is distinct from to_jsonb(jsonb_populate_record(null::public.household_items,entry||jsonb_build_object('household_id',hid))) then raise exception 'List field verification failed';end if;
  imported_items:=imported_items+1;
 end loop;
 perform set_config('hh.transition_import','',true);
 for entry in select * from jsonb_array_elements(payload->'events') loop
  if entry->'event' ? 'household_id' and entry->'event'->>'household_id'<>hid::text then raise exception 'Wrong target household';end if;
  event:=jsonb_populate_record(null::public.household_events,entry->'event');event.household_id:=hid;event.version:=1;event.created_at:=coalesce(event.created_at,backup.captured_at);event.reminder_30_enabled:=coalesce(event.reminder_30_enabled,true);event.recurrence:=coalesce(event.recurrence,'{}');event.exceptions:=coalesce(event.exceptions,'{}');
  insert into public.household_events(id,household_id,title,description,location,person,person_ids,starts_at,ends_at,all_day,start_date,end_date,reminder_minutes,reminder_30_enabled,recurrence,exceptions,version,created_at)
  values(event.id,hid,event.title,event.description,event.location,event.person,event.person_ids,event.starts_at,event.ends_at,event.all_day,event.start_date,event.end_date,event.reminder_minutes,coalesce(event.reminder_30_enabled,true),coalesce(event.recurrence,'{}'),coalesce(event.exceptions,'{}'),1,event.created_at) returning * into saved;
  if to_jsonb(saved) is distinct from to_jsonb(event) then raise exception 'Calendar field verification failed';end if;
  imported_events:=imported_events+1;
 end loop;
 if jsonb_array_length(coalesce(payload->'deliveryAliases','[]'))>4000 then raise exception 'Too many reminder aliases';end if;
 for entry in select * from jsonb_array_elements(coalesce(payload->'deliveryAliases','[]')) loop
  select * into event from public.household_events where id=(entry->>'eventId')::uuid and household_id=hid;
  if not found then raise exception 'Reminder alias belongs to another home';end if;
  occurrence:=entry->>'occurrenceDate';
  native_time:=case when coalesce((entry->>'allDay')::boolean,event.all_day) then coalesce(entry->>'startDate',event.start_date::text)
   when occurrence is null then to_jsonb(event)->>'starts_at' else entry->>'nativeStart' end;
  insert into private.calendar_delivery_aliases(household_id,native_key,google_key)
  values(hid,event.id::text||case when occurrence is not null then '@'||occurrence else '' end||':'||native_time||':'||(entry->>'minutes'),entry->>'googleKey') on conflict do nothing;
 end loop;
 report:=jsonb_build_object('events',imported_events,'items',imported_items,'eventHash',(select md5(jsonb_agg(to_jsonb(e) order by e.id)::text) from public.household_events e where e.household_id=hid),'itemHash',(select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from public.household_items i where i.household_id=hid),'snapshotId',backup.id,'snapshotHash',backup.snapshot_hash,'verifiedAt',now());
 update private.household_transitions set active=false,completed_at=now(),transfer_report=report where household_id=hid;
 -- Remain paused until the external source and committed rows are checked again.
 return report;
end;$$;
revoke all on function private.finish_household_transition(jsonb) from public,anon,authenticated;
grant execute on function private.finish_household_transition(jsonb) to service_role;
create function public.finish_household_transition(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.finish_household_transition(payload);$$;
revoke all on function public.finish_household_transition(jsonb) from public,anon,authenticated;
grant execute on function public.finish_household_transition(jsonb) to service_role;
notify pgrst,'reload schema';

create or replace function private.guard_transition_home_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.household_transitions where household_id=old.id and direction='target' and (active or write_paused)) then raise exception 'Finish the Hummel Home transition before deleting this household';end if;return old;
end;$$;
create function private.rollback_household_transition(hid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t private.household_transitions%rowtype;
begin
 select * into t from private.household_transitions where household_id=hid for update;
 if not found or t.direction<>'target' or t.active or not t.write_paused or t.completed_at is null then raise exception 'Unreleased completed import required';end if;
 if not exists(select 1 from public.households where id=hid and owner_id=t.owner_id) then raise exception 'Household owner changed';end if;
 if (select md5(jsonb_agg(to_jsonb(e) order by e.id)::text) from public.household_events e where e.household_id=hid) is distinct from t.transfer_report->>'eventHash'
 or (select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from public.household_items i where i.household_id=hid) is distinct from t.transfer_report->>'itemHash' then raise exception 'Imported data changed; retain all records for reconciliation';end if;
 -- Recovery retains every imported row and snapshot for reconciliation.
 update private.household_transitions set active=true,completed_at=null,transfer_report=transfer_report||jsonb_build_object('recoveryRetained',true) where household_id=hid;
end;$$;
revoke all on function private.rollback_household_transition(uuid) from public,anon,authenticated;
grant execute on function private.rollback_household_transition(uuid) to service_role;
create function public.rollback_household_transition(hid uuid) returns void language sql security invoker set search_path='' as $$select private.rollback_household_transition(hid);$$;
revoke all on function public.rollback_household_transition(uuid) from public,anon,authenticated;
grant execute on function public.rollback_household_transition(uuid) to service_role;
