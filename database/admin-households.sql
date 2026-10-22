-- HH only. Called exclusively by the authenticated admin Edge Function.
create function private.admin_households(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; hid uuid; home public.households; member_ids uuid[]; sid uuid;
begin
 if not exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=uid and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null) then raise exception 'Admin access required';end if;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'memberCount',(select count(*) from public.household_members m where m.household_id=h.id),'protected',h.owner_id=uid or exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=uid)) order by h.created_at) from public.households h),'[]'::jsonb);
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
revoke all on function private.admin_households(text,jsonb) from public,anon,authenticated;
grant execute on function private.admin_households(text,jsonb) to service_role;
create function public.admin_households(action text,payload jsonb) returns jsonb language sql set search_path='' as $$select private.admin_households(action,payload);$$;
revoke all on function public.admin_households(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_households(text,jsonb) to service_role;
