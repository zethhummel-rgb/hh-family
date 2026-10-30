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

