-- A notice acknowledgement belongs to an account and never removes the post from history.
create table private.hh_member_notice_acknowledgements (
 user_id uuid not null references auth.users(id) on delete cascade,
 notice_id uuid not null references private.hh_app_notices(id) on delete cascade,
 primary key (user_id,notice_id)
);

alter table private.hh_member_notice_acknowledgements enable row level security;
revoke all on private.hh_member_notice_acknowledgements from public,anon,authenticated;
create index hh_member_notice_acknowledgements_notice_id
 on private.hh_member_notice_acknowledgements(notice_id);

create function private.hh_member_acknowledge_notices(p_notice_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 if p_notice_ids is null or cardinality(p_notice_ids)>50 then
  raise exception 'Choose up to 50 notices to acknowledge' using errcode='22023';
 end if;
 insert into private.hh_member_notice_acknowledgements(user_id,notice_id)
 select uid,n.id from private.hh_app_notices n where n.id=any(p_notice_ids)
 on conflict (user_id,notice_id) do nothing;
end;
$$;

create function public.hh_member_acknowledge_notices(p_notice_ids uuid[]) returns void
language sql security invoker set search_path='' as $$
 select private.hh_member_acknowledge_notices(p_notice_ids);
$$;
revoke all on function private.hh_member_acknowledge_notices(uuid[]),public.hh_member_acknowledge_notices(uuid[])
 from public,anon,authenticated;
grant execute on function private.hh_member_acknowledge_notices(uuid[]),public.hh_member_acknowledge_notices(uuid[])
 to authenticated;

create or replace function private.hh_member_content() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 return private.hh_content_snapshot(false) || jsonb_build_object(
  'rating_eligible',private.hh_rating_prompt_enabled() and not exists(
   select 1 from private.hh_member_ratings where user_id=uid and (stars is not null or snoozed_until>now())
  ),
  'acknowledged_notice_ids',coalesce((
   select jsonb_agg(a.notice_id order by a.notice_id)
   from private.hh_member_notice_acknowledgements a
   join private.hh_app_notices n on n.id=a.notice_id
   where a.user_id=uid and n.archived_at is null
  ),'[]'::jsonb)
 );
end;
$$;
