alter table public.household_events
 add column location_place_id text
 check (char_length(location_place_id) between 1 and 300 and location_place_id !~ '[^A-Za-z0-9_-]');

-- Match the existing column grants and household-scoped row policies.
grant update (location_place_id) on public.household_events to authenticated;
notify pgrst, 'reload schema';
