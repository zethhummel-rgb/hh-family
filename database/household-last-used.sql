-- Retain one timestamp per household. Only the verified pilot admin can read it.
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

-- This endpoint only reads timestamps and cannot modify the household list.
create function private.admin_household_usage()
returns table(household_id uuid,last_used_at timestamptz,last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(
  select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email)
  where u.id=auth.uid() and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null
 ) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
  select h.id,usage.last_used_at,max(u.last_sign_in_at)
  from public.households h
  left join private.household_last_use usage on usage.household_id=h.id
  left join public.household_members m on m.household_id=h.id
  left join auth.users u on u.id=m.user_id
  group by h.id,usage.last_used_at;
end;$$;
revoke all on function private.admin_household_usage() from public,anon,authenticated;
grant execute on function private.admin_household_usage() to authenticated;

create function public.admin_household_usage()
returns table(household_id uuid,last_used_at timestamptz,last_sign_in_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from private.admin_household_usage();$$;
revoke all on function public.admin_household_usage() from public,anon,authenticated;
grant execute on function public.admin_household_usage() to authenticated;
