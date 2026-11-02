-- Existing dinners become supper without rewriting their snapshots or revisions.
-- Multiple meals in a slot support separate lunches, sides and snacks.
alter table public.household_meal_plans
 add column meal_type text not null default 'supper'
 constraint household_meal_plans_meal_type_check
 check(meal_type in ('breakfast','lunch','supper','snacks'));

create index household_meal_plans_home_date_idx
 on public.household_meal_plans(household_id,meal_date,id);
alter table public.household_meal_plans
 drop constraint household_meal_plans_household_id_meal_date_key;

-- Stable creation IDs let a lost-response retry check its original meal.
-- IDs remain immutable; every insert/read still uses household membership RLS.
grant insert(id,meal_type),update(meal_type) on public.household_meal_plans to authenticated;
notify pgrst,'reload schema';
