create table public.household_events (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160),
 description text not null default '' check(char_length(description)<=4000),
 location text not null default '' check(char_length(location)<=300),
 person text not null default 'Everyone' check(char_length(person) between 1 and 60),
 starts_at timestamptz not null, ends_at timestamptz not null,
 all_day boolean not null default false,
 start_date date, end_date date,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 check(ends_at>starts_at),
 check((not all_day and start_date is null and end_date is null) or (all_day and start_date is not null and end_date>start_date))
);
create index household_events_household_start on public.household_events(household_id,starts_at);
alter table public.household_events enable row level security;
create policy events_read on public.household_events for select to authenticated using(private.is_member(household_id));
create policy events_add on public.household_events for insert to authenticated with check(private.is_member(household_id));
create policy events_update on public.household_events for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy events_delete on public.household_events for delete to authenticated using(private.is_member(household_id));
revoke all on public.household_events from anon,authenticated;
grant select,insert,delete on public.household_events to authenticated;
grant update(title,description,location,person,starts_at,ends_at,all_day,start_date,end_date,version) on public.household_events to authenticated;
