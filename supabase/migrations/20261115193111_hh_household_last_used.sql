-- Retain one timestamp per household. The existing admin endpoint is the only reader.
create table private.household_last_use (
 household_id uuid primary key references public.households(id) on delete cascade,
 last_used_at timestamptz not null
);
alter table private.household_last_use enable row level security;
revoke all on private.household_last_use from public,anon,authenticated;

-- Keep the latest available household change from before this release.
insert into private.household_last_use(household_id,last_used_at)
 select household_id,max(created_at) from public.household_activity group by household_id;

create function private.record_household_use(target_household uuid) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); visit_time timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.household_members where user_id=uid and household_id=target_household) then
  raise exception 'Household membership required' using errcode='42501';
 end if;
 insert into private.household_last_use as usage(household_id,last_used_at)
 values(target_household,visit_time)
 on conflict(household_id) do update set last_used_at=excluded.last_used_at
 where usage.last_used_at < excluded.last_used_at-interval '10 seconds';
end;$$;
revoke all on function private.record_household_use(uuid) from public,anon,authenticated;
grant execute on function private.record_household_use(uuid) to authenticated;

create function public.record_household_use(target_household uuid) returns void
language sql security invoker set search_path='' as $$select private.record_household_use(target_household);$$;
revoke all on function public.record_household_use(uuid) from public,anon,authenticated;
grant execute on function public.record_household_use(uuid) to authenticated;

create or replace function private.admin_households(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; hid uuid; home public.households; member_ids uuid[]; sid uuid;
begin
 if not exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=uid and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null) then raise exception 'Admin access required';end if;
 if action='list' then
  return coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',h.id,'name',h.name,'memberCount',members.member_count,'protected',h.owner_id=uid or coalesce(members.is_admin_member,false),
    'lastUsedAt',visits.last_used_at,'lastSignInAt',members.last_sign_in
   ) order by h.created_at)
   from public.households h
   left join private.household_last_use visits on visits.household_id=h.id
   cross join lateral (
    select count(*) as member_count, bool_or(m.user_id=uid) as is_admin_member, max(u.last_sign_in_at) as last_sign_in
    from public.household_members m left join auth.users u on u.id=m.user_id
    where m.household_id=h.id
   ) members
  ),'[]'::jsonb);
 end if;
 if action is distinct from 'delete' then raise exception 'Unsupported admin request';end if;
 hid:=(payload->>'householdId')::uuid;
 select * into home from public.households where id=hid for update;
 if not found then raise exception 'Household no longer exists';end if;
 if home.owner_id=uid or exists(select 1 from public.household_members where household_id=hid and user_id=uid) then raise exception 'Your admin household cannot be deleted';end if;
 if payload->>'confirmation' is distinct from home.name then raise exception 'Type the exact household name to confirm';end if;
 select array_agg(distinct user_id) into member_ids from (select user_id from public.household_members where household_id=hid union select home.owner_id) members;
 perform 1 from auth.users where id=any(member_ids) for update;
 if exists(select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email) where u.id=any(member_ids)) then raise exception 'A pilot admin household cannot be deleted';end if;
 if exists(select 1 from public.households where owner_id=any(member_ids) and id<>hid) then raise exception 'A member owns another household';end if;
 -- The calendar itself remains in Google; remove only HH's private connection and credential.
 for sid in select secret_id from private.google_calendar_connections where household_id=hid loop
  delete from vault.secrets where id=sid;
 end loop;
 delete from private.pilot_invites where household_id=hid;
 delete from public.households where id=hid;
  delete from auth.sessions where user_id=any(member_ids);
  delete from auth.users where id=any(member_ids);
 return jsonb_build_object('deleted',true);
end;$$;
