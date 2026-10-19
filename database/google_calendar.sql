-- Provider refresh tokens remain encrypted in Vault and are never exposed to browsers.
create table private.google_calendar_states (
 state_hash text primary key, verifier text not null, user_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade, expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.google_calendar_connections (
 household_id uuid primary key references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), secret_id uuid not null,
 calendar_id text not null, migration_complete boolean not null default false, connected_at timestamptz not null default now()
);
create index google_calendar_states_user on private.google_calendar_states(user_id);
create index google_calendar_states_household on private.google_calendar_states(household_id);
create index google_calendar_connections_user on private.google_calendar_connections(user_id);
alter table private.google_calendar_states enable row level security;
alter table private.google_calendar_connections enable row level security;
revoke all on private.google_calendar_states,private.google_calendar_connections from public,anon,authenticated;
create function private.calendar_service(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; sid uuid; old_sid uuid;
begin
 if action='state_create' then
  delete from private.google_calendar_states where expires_at<now() or user_id=(payload->>'userId')::uuid;
  insert into private.google_calendar_states(state_hash,verifier,user_id,household_id) values(payload->>'hash',payload->>'verifier',(payload->>'userId')::uuid,(payload->>'householdId')::uuid);
  return '{}'::jsonb;
 elsif action='state_take' then
  delete from private.google_calendar_states where state_hash=payload->>'hash' and expires_at>now() returning to_jsonb(google_calendar_states.*) into result;
  return result;
 elsif action='connection_get' then
  select jsonb_build_object('calendarId',c.calendar_id,'refreshToken',v.decrypted_secret,'userId',c.user_id,'migrationComplete',c.migration_complete) into result
  from private.google_calendar_connections c join vault.decrypted_secrets v on v.id=c.secret_id where c.household_id=(payload->>'householdId')::uuid;
  return result;
 elsif action='connection_set' then
  select secret_id into old_sid from private.google_calendar_connections where household_id=(payload->>'householdId')::uuid;
  select vault.create_secret(payload->>'refreshToken') into sid;
  insert into private.google_calendar_connections(household_id,user_id,secret_id,calendar_id) values((payload->>'householdId')::uuid,(payload->>'userId')::uuid,sid,payload->>'calendarId')
  on conflict(household_id) do update set user_id=excluded.user_id,secret_id=excluded.secret_id,calendar_id=excluded.calendar_id,connected_at=now(),migration_complete=false;
  if old_sid is not null then delete from vault.secrets where id=old_sid;end if;
  return '{}'::jsonb;
 elsif action='migration_done' then
  update private.google_calendar_connections set migration_complete=true where household_id=(payload->>'householdId')::uuid;
  return '{}'::jsonb;
 end if;
 raise exception 'Unsupported calendar service operation';
end;$$;
revoke all on function private.calendar_service(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.calendar_service(text,jsonb) to service_role;
create function public.calendar_service(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.calendar_service(action,payload);$$;
revoke all on function public.calendar_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_service(text,jsonb) to service_role;
