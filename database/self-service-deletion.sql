-- HH only: service-only RPC, actor identity supplied by the authenticated Edge Function.
create function private.self_service_deletion(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; actor_email text; hid uuid; home public.households; member_ids uuid[]; sid uuid;
begin
 select lower(email) into actor_email from auth.users where id=uid and email_confirmed_at is not null;
 if actor_email is null then raise exception 'Sign in with a confirmed account';end if;
 if exists(select 1 from private.pilot_hosts where email=actor_email) then raise exception 'Pilot administrator accounts are protected';end if;
 if action='account' then
  select household_id into hid from public.household_members where user_id=uid;
  if hid is not null then perform 1 from public.households where id=hid for update;end if;
  perform 1 from auth.users where id=uid for update;
  if exists(select 1 from public.households where owner_id=uid) then raise exception 'Household owners must use Delete home and all accounts';end if;
  if lower(trim(payload->>'confirmation')) is distinct from actor_email then raise exception 'Type your email address to confirm';end if;
  -- Keep child profiles and their event tags, reverting to household notification routing.
  update public.household_people set linked_user_id=null where linked_user_id=uid;
  delete from auth.sessions where user_id=uid;
  delete from auth.users where id=uid;
 elsif action='household' then
  hid:=(payload->>'householdId')::uuid;
  select * into home from public.households where id=hid for update;
  if not found or home.owner_id<>uid then raise exception 'Only the household owner can delete this home';end if;
  if payload->>'confirmation' is distinct from home.name then raise exception 'Type the exact household name to confirm';end if;
  select array_agg(distinct user_id) into member_ids from (select user_id from public.household_members where household_id=hid union select home.owner_id) members;
  perform 1 from auth.users where id=any(member_ids) for update;
  if exists(select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email) where u.id=any(member_ids)) then raise exception 'Pilot administrator households are protected';end if;
  if exists(select 1 from public.households where owner_id=any(member_ids) and id<>hid) then raise exception 'A member owns another household';end if;
  for sid in select secret_id from private.google_calendar_connections where household_id=hid loop
   delete from vault.secrets where id=sid;
  end loop;
  delete from private.pilot_invites where household_id=hid;
  delete from public.households where id=hid;
  delete from auth.sessions where user_id=any(member_ids);
  delete from auth.users where id=any(member_ids);
 else raise exception 'Unsupported deletion request';end if;
 return jsonb_build_object('deleted',true);
end;$$;
revoke all on function private.self_service_deletion(text,jsonb) from public,anon,authenticated;
grant execute on function private.self_service_deletion(text,jsonb) to service_role;
create function public.self_service_deletion(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.self_service_deletion(action,payload);$$;
revoke all on function public.self_service_deletion(text,jsonb) from public,anon,authenticated;
grant execute on function public.self_service_deletion(text,jsonb) to service_role;
