-- Reissue an unused household invitation atomically. Raw token stays with the
-- requesting owner; only its hash is stored. Repeated requests are idempotent.
create or replace function private.reissue_household_invite(
 source_invitation_id uuid, expected_email text, recipient_email text,
 replacement_id uuid, replacement_token text
) returns text language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); hid uuid; previous public.household_invites%rowtype; existing public.household_invites%rowtype; normalized text:=lower(trim(recipient_email)); hashed text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Sign in with a confirmed account first';end if;
 select h.id into hid from public.households h join public.household_members m on m.household_id=h.id and m.user_id=uid and m.role='owner' where h.owner_id=uid;
 if hid is null then raise exception 'Only the household owner can invite members';end if;
 if source_invitation_id is null or replacement_id is null or source_invitation_id=replacement_id or replacement_token is null or replacement_token !~ '^[a-f0-9]{64}$' then raise exception 'Choose a valid invitation';end if;
 if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address';end if;
 hashed:=encode(sha256(convert_to(replacement_token,'UTF8')),'hex');
 -- Serialize replacement attempts for this home and prevent concurrent retries
 -- from observing a half-completed operation.
 perform 1 from public.households where id=hid for update;
 select * into existing from public.household_invites where id=replacement_id;
 if found then
  if existing.household_id=hid and existing.email=normalized and existing.token_hash=hashed and existing.used_at is null and existing.expires_at>now() then return replacement_token;end if;
  raise exception 'This invitation changed. Refresh the list before trying again.';
 end if;
 select * into previous from public.household_invites where id=source_invitation_id and household_id=hid for update;
 if not found or previous.email is distinct from expected_email or previous.used_at is not null or previous.expires_at<=now() then raise exception 'This invitation changed, was used, or expired. Refresh the list before trying again.';end if;
 insert into public.household_invites(id,household_id,email,token_hash,expires_at)
 values(replacement_id,hid,normalized,hashed,now()+interval '7 days');
 delete from public.household_invites where id=previous.id;
 return replacement_token;
end;$$;
revoke all on function private.reissue_household_invite(uuid,text,text,uuid,text) from public,anon;
grant execute on function private.reissue_household_invite(uuid,text,text,uuid,text) to authenticated;
create or replace function public.reissue_household_invite(source_invitation_id uuid,expected_email text,recipient_email text,replacement_id uuid,replacement_token text)
 returns text language sql security invoker set search_path='' as $$select private.reissue_household_invite(source_invitation_id,expected_email,recipient_email,replacement_id,replacement_token);$$;
revoke all on function public.reissue_household_invite(uuid,text,text,uuid,text) from public,anon;
grant execute on function public.reissue_household_invite(uuid,text,text,uuid,text) to authenticated;

