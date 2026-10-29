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

