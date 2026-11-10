create function private.remove_family_person(target_household uuid, target_kind text, target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  member_email text;
begin
  -- Serialize with other changes that lock the household.
  perform 1 from public.households
    where id = target_household and owner_id = actor for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor and role = 'owner'
  ) then
    raise exception 'Only the household owner can remove family members or profiles';
  end if;

  if target_kind = 'profile' then
    delete from public.household_people where household_id = target_household and id = target_id;
    if not found then raise exception 'This profile is no longer in your household'; end if;
    return;
  end if;

  if target_kind is distinct from 'member' or target_id is null or target_id = actor then
    raise exception 'Choose a family member to remove';
  end if;

  select lower(u.email) into member_email
  from public.household_members m join auth.users u on u.id = m.user_id
  where m.household_id = target_household and m.user_id = target_id and m.role = 'member'
  for update of m;
  if not found then raise exception 'This member is no longer in your household'; end if;

  update public.household_people set linked_user_id = null
    where household_id = target_household and linked_user_id = target_id;
  delete from private.push_devices where household_id = target_household and user_id = target_id;
  delete from public.household_invites
    where household_id = target_household and lower(email) = member_email and used_at is null;
  delete from public.household_members
    where household_id = target_household and user_id = target_id and role = 'member';
end;
$$;

revoke all on function private.remove_family_person(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.remove_family_person(uuid,text,uuid) to authenticated;

create function public.remove_family_person(target_household uuid, target_kind text, target_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.remove_family_person(target_household, target_kind, target_id);
$$;
revoke all on function public.remove_family_person(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.remove_family_person(uuid,text,uuid) to authenticated;
