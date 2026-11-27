-- Provision the sole live HH dashboard operator from the confirmed account.
-- The existing pilot host remains the issuer for household invitations.
do $admin$
declare
 operator_id uuid;
 issuer_id uuid;
begin
 select id into strict operator_id from auth.users
 where lower(email)='zethhummel@gmail.com' and email_confirmed_at is not null;
 select u.id into strict issuer_id from auth.users u
 join private.pilot_hosts h on h.email=lower(u.email)
 where h.email='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null;
 if exists(select 1 from private.hh_site_admins where user_id<>operator_id) then
  raise exception 'Unexpected admin account on live HH';
 end if;
 insert into private.hh_site_admins(user_id,verified_email,pilot_host_user_id)
 values(operator_id,'zethhummel@gmail.com',issuer_id)
 on conflict(user_id) do update set verified_email=excluded.verified_email,
  pilot_host_user_id=excluded.pilot_host_user_id;
end;
$admin$;

-- Reuse the existing household management behavior and replace its old access checks.
do $gates$
declare
 management text := replace(pg_get_functiondef('private.admin_households(text,jsonb)'::regprocedure),chr(13),'');
 usage text := replace(pg_get_functiondef('private.admin_household_usage()'::regprocedure),chr(13),'');
 old_actor constant text := $old$(payload->>'actorId')::uuid$old$;
 old_manage_gate constant text := $old$not exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=uid and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null)$old$;
 old_usage_gate constant text := $old$not exists(
  select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email)
  where u.id=auth.uid() and lower(u.email)='hummelhomeapp@gmail.com' and u.email_confirmed_at is not null
 )$old$;
 old_hidden_delete constant text := $old$h.owner_id=uid or exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=uid)$old$;
 protected_home constant text := $new$h.owner_id=uid or exists(
    select 1 from public.household_members m where m.household_id=h.id and m.user_id=uid
   ) or exists(
    select 1 from auth.users u join private.pilot_hosts p on p.email=lower(u.email)
    where u.id=h.owner_id or exists(
     select 1 from public.household_members m where m.household_id=h.id and m.user_id=u.id
    )
   )$new$;
 manage_gate constant text := 'private.hh_site_admin_issuer(uid) is null or private.hh_admin_needs_second_factor()';
 usage_gate constant text := 'private.hh_site_admin_issuer(auth.uid()) is null or private.hh_admin_needs_second_factor()';
begin
 if strpos(management,old_actor)=0 or strpos(management,old_manage_gate)=0
  or strpos(management,old_hidden_delete)=0 or strpos(usage,old_usage_gate)=0 then
  raise exception 'Existing HH household administration checks did not match';
 end if;
 management:=replace(replace(management,old_actor,'auth.uid()'),old_manage_gate,manage_gate);
 management:=replace(management,$old$raise exception 'Admin access required';$old$,
  $new$raise exception 'Admin access required' using errcode='42501';$new$);
 execute replace(management,old_hidden_delete,protected_home);
 execute replace(usage,old_usage_gate,usage_gate);
end;
$gates$;

revoke execute on function private.admin_households(text,jsonb),public.admin_households(text,jsonb) from service_role;
grant execute on function private.admin_households(text,jsonb),public.admin_households(text,jsonb) to authenticated;
