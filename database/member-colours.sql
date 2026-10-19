alter table public.household_members add column if not exists calendar_color text check(calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$');
-- Existing membership reads remain household-scoped. Only a member's own colour is writable.
grant update(calendar_color) on public.household_members to authenticated;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='household_members' and policyname='member_own_colour') then
  create policy member_own_colour on public.household_members for update to authenticated
   using(user_id=(select auth.uid()) and private.is_member(household_id))
   with check(user_id=(select auth.uid()) and private.is_member(household_id));
 end if;
end$$;
alter table public.household_events add column if not exists person_ids text[] check(person_ids is null or (cardinality(person_ids)<=20 and array_position(person_ids,null) is null));
grant update(person_ids) on public.household_events to authenticated;
