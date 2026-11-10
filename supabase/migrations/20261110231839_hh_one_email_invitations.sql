-- Invitation bearer proof is checked here; only the registration Edge Function may call it.
-- Lookup never consumes a code. Existing acceptance RPCs consume it under a row lock.
create table private.invitation_registration_attempts (
 token_hash text primary key,
 window_started timestamptz not null default now(),
 attempts integer not null default 0
);
alter table private.invitation_registration_attempts enable row level security;
revoke all on private.invitation_registration_attempts from public,anon,authenticated;

create function private.invitation_registration(invite_kind text,raw_token text,register_attempt boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare recipient text; home_name text; digest text; account_id uuid; confirmed boolean; attempt_count integer;
begin
 if invite_kind is null or invite_kind not in ('family','pilot') or raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then
  raise exception 'This invitation is invalid, expired or already used. Ask for a new invitation.';
 end if;
 digest:=encode(sha256(convert_to(raw_token,'UTF8')),'hex');
 if invite_kind='family' then
  select i.email,h.name into recipient,home_name from public.household_invites i
   join public.households h on h.id=i.household_id
   where i.token_hash=digest and i.used_at is null and i.expires_at>now();
 else
  select i.email into recipient from private.pilot_invites i
   join auth.users u on u.id=i.host_user_id
   join private.pilot_hosts p on p.email=lower(u.email)
   where i.token_hash=digest and i.used_at is null and i.expires_at>now();
 end if;
 if recipient is null then raise exception 'This invitation is invalid, expired or already used. Ask for a new invitation.';end if;
 if register_attempt then
  delete from private.invitation_registration_attempts where window_started<now()-interval '7 days';
  insert into private.invitation_registration_attempts(token_hash,attempts) values(digest,1)
   on conflict(token_hash) do update set
    attempts=case when invitation_registration_attempts.window_started<now()-interval '1 hour' then 1 else invitation_registration_attempts.attempts+1 end,
    window_started=case when invitation_registration_attempts.window_started<now()-interval '1 hour' then now() else invitation_registration_attempts.window_started end
   returning attempts into attempt_count;
  if attempt_count>10 then raise exception 'Too many attempts. Wait an hour before trying this invitation again.';end if;
 end if;
 select u.id,u.email_confirmed_at is not null into account_id,confirmed from auth.users u where lower(u.email)=lower(recipient);
 return jsonb_build_object('email',lower(recipient),'householdName',home_name,'userId',account_id,'confirmed',coalesce(confirmed,false));
end;$$;
revoke all on function private.invitation_registration(text,text,boolean) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.invitation_registration(text,text,boolean) to service_role;
create function public.invitation_registration(invite_kind text,raw_token text,register_attempt boolean default false)
returns jsonb language sql security invoker set search_path='' as $$select private.invitation_registration(invite_kind,raw_token,register_attempt);$$;
revoke all on function public.invitation_registration(text,text,boolean) from public,anon,authenticated;
grant execute on function public.invitation_registration(text,text,boolean) to service_role;
