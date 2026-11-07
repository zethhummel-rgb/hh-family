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

-- A member may correct their own name. Keep legacy name-based assignments in
-- the same transaction; the existing own-member UPDATE policy still applies.
grant update(display_name) on public.household_members to authenticated;
create or replace function private.preserve_member_assignments() returns trigger
language plpgsql security invoker set search_path='' as $$
declare old_label text:=lower(btrim(old.display_name)); new_label text:=lower(btrim(new.display_name));
 old_labels text[]:=array[lower(btrim(old.display_name))]; first_label text:=split_part(lower(btrim(old.display_name)),' ',1);
begin
 new.display_name:=btrim(new.display_name);
 if new.display_name=old.display_name then return new;end if;
 if auth.uid() is distinct from old.user_id then raise exception 'Only your own display name can be changed';end if;
 if new_label in ('everyone','unassigned','family members') or char_length(new.display_name) not between 1 and 60 then raise exception 'Choose a personal name between 1 and 60 characters';end if;
 if exists(select 1 from public.household_members where household_id=old.household_id and user_id<>old.user_id and lower(btrim(display_name))=new_label)
 or exists(select 1 from public.household_people where household_id=old.household_id and linked_user_id is distinct from old.user_id and lower(btrim(display_name))=new_label) then raise exception 'Another family member already uses this name. Add an initial or surname';end if;
 if not private.native_calendar_writable(old.household_id) or private.household_transition_active(old.household_id) then raise exception 'Finish your household calendar transfer before changing your name';end if;
 if exists(select 1 from public.household_members where household_id=old.household_id and user_id<>old.user_id and lower(btrim(display_name))=old_label)
 or exists(select 1 from public.household_people where household_id=old.household_id and linked_user_id is distinct from old.user_id and lower(btrim(display_name))=old_label) then raise exception 'Two profiles share your current name. Ask your household owner to give the other profile a distinct name first';end if;
 if first_label<>old_label and not exists(select 1 from public.household_members where household_id=old.household_id and user_id<>old.user_id and split_part(lower(btrim(display_name)),' ',1)=first_label)
 and not exists(select 1 from public.household_people where household_id=old.household_id and linked_user_id is distinct from old.user_id and split_part(lower(btrim(display_name)),' ',1)=first_label) then old_labels:=array_append(old_labels,first_label);end if;
 update public.household_items set person=new.display_name where household_id=old.household_id and kind='task' and lower(btrim(person))=any(old_labels);
 update public.household_events e set
  person=case when lower(btrim(e.person))=any(old_labels) then new.display_name else e.person end,
  person_ids=case when e.person_ids is null and lower(btrim(e.person))=any(old_labels) then array[old.user_id::text] else e.person_ids end,
  exceptions=coalesce((select jsonb_object_agg(x.key,case when jsonb_typeof(x.value)='object' and lower(btrim(x.value->>'person'))=any(old_labels) then x.value||jsonb_build_object('person',new.display_name,'person_ids',coalesce(nullif(x.value->'person_ids','null'::jsonb),jsonb_build_array(old.user_id::text))) else x.value end) from jsonb_each(e.exceptions) x),'{}'::jsonb),
  version=e.version+1
 where e.household_id=old.household_id and (lower(btrim(e.person))=any(old_labels) or exists(select 1 from jsonb_each(e.exceptions) x where lower(btrim(x.value->>'person'))=any(old_labels)));
 return new;
end;$$;
revoke all on function private.preserve_member_assignments() from public,anon;
drop trigger if exists preserve_member_assignments on public.household_members;
create trigger preserve_member_assignments before update of display_name on public.household_members for each row execute function private.preserve_member_assignments();
