-- HH only: increase the pilot to seven invited households; existing invitations keep their places.
create or replace function private.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); raw_token text;
begin
 if uid is null or not private.is_pilot_host() then raise exception 'Pilot host access required'; end if;
 -- Serialize slot allocation across devices.
 perform 1 from private.pilot_hosts h join auth.users u on lower(u.email)=h.email where u.id=uid for update of h;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'used_at',i.used_at) order by i.created_at desc) from private.pilot_invites i where i.host_user_id=uid),'[]'::jsonb);
 elsif action='revoke' then
  delete from private.pilot_invites where id=invitation_id and host_user_id=uid and used_at is null;
  return '{}'::jsonb;
 elsif action<>'create' then raise exception 'Unsupported pilot request'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from private.pilot_invites where host_user_id=uid and (used_at is not null or expires_at>now()))>=7 then raise exception 'This pilot has room for seven invited households. Revoke an unused invitation to free a place.'; end if;
 if exists(select 1 from private.pilot_invites where email=lower(trim(invite_email)) and (used_at is not null or expires_at>now())) then raise exception 'This email already has a pilot invitation'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.pilot_invites(host_user_id,email,token_hash) values(uid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return jsonb_build_object('token',raw_token);
end;$$;
revoke all on function private.pilot_invitations(text,text,uuid) from public,anon;
grant execute on function private.pilot_invitations(text,text,uuid) to authenticated;
