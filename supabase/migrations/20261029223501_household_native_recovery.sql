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
