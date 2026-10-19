-- Freeze native writes once Google migration starts, preserving a stable import snapshot.
create function private.native_calendar_writable(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_member(hid) and not exists(select 1 from private.google_calendar_connections where household_id=hid);
$$;
revoke all on function private.native_calendar_writable(uuid) from public,anon;
grant execute on function private.native_calendar_writable(uuid) to authenticated;
alter policy events_add on public.household_events with check(private.native_calendar_writable(household_id));
alter policy events_update on public.household_events using(private.native_calendar_writable(household_id)) with check(private.native_calendar_writable(household_id));
alter policy events_delete on public.household_events using(private.native_calendar_writable(household_id));
