-- Keep the admin role and Auth factors independent of the dashboard's sign-in policy.
-- Every environment starts with MFA required. A TEST override is applied separately.
create table private.hh_admin_auth_policy (
 id boolean primary key default true check (id),
 require_mfa boolean not null default true
);
insert into private.hh_admin_auth_policy default values;
alter table private.hh_admin_auth_policy enable row level security;
revoke all on private.hh_admin_auth_policy from public,anon,authenticated;

create function private.hh_admin_needs_second_factor() returns boolean
language sql stable set search_path='' as $$
 select coalesce((select p.require_mfa from private.hh_admin_auth_policy p where p.id),true)
  and (auth.jwt()->>'aal') is distinct from 'aal2';
$$;
revoke all on function private.hh_admin_needs_second_factor() from public,anon,authenticated;

-- Keep the original role checks and actions. Replace just the existing MFA condition.
do $policy$
declare
 gate regprocedure;
 definition text;
 old_condition constant text := $old$(auth.jwt()->>'aal') is distinct from 'aal2'$old$;
begin
 foreach gate in array array[
  'private.hh_admin_status()'::regprocedure,
  'private.hh_admin_dashboard(text,jsonb)'::regprocedure,
  'private.hh_admin_content(text,jsonb)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(gate);
  if position(old_condition in definition)=0 then
   raise exception 'Expected admin verification condition in %',gate;
  end if;
  execute replace(definition,old_condition,'private.hh_admin_needs_second_factor()');
 end loop;
end;
$policy$;
