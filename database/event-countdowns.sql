-- Opt-in Home display metadata stays on its HH calendar event/series. Existing
-- events remain off. Existing membership/source RLS and version checks apply.
alter table public.household_events add column countdown_enabled boolean not null default false;
grant update(countdown_enabled) on public.household_events to authenticated;
notify pgrst,'reload schema';
