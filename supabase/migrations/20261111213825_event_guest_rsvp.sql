create table private.event_guest_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.household_events(id) on delete cascade,
  occurrence text not null check (occurrence = '' or occurrence ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  sender_name text not null,
  message text not null check (char_length(message) <= 500),
  delivery text not null default 'sending' check (delivery in ('sending','sent','unknown','preview')),
  reply text check (reply in ('yes','maybe','no')),
  replied_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index event_guest_invitations_event on private.event_guest_invitations(event_id);
create unique index event_guest_invitations_active on private.event_guest_invitations(event_id,occurrence,email)
  where revoked_at is null;
alter table private.event_guest_invitations enable row level security;
revoke all on private.event_guest_invitations from public,anon,authenticated;
grant usage on schema private to service_role;
create table private.event_guest_delivery_attempts (
  household_id uuid not null,
  address_hash bytea not null,
  created_at timestamptz not null default now()
);
alter table private.event_guest_delivery_attempts enable row level security;
revoke all on private.event_guest_delivery_attempts from public,anon,authenticated;

create function private.event_guest_service(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  event_row public.household_events%rowtype;
  invitation private.event_guest_invitations%rowtype;
  sender text;
  occurrence_key text := coalesce(payload->>'occurrence','');
  address text := lower(trim(payload->>'email'));
  recipient_hash bytea := sha256(convert_to(address,'UTF8'));
  response text := payload->>'reply';
begin
  if action in ('preview','respond','finish') then
    select * into invitation from private.event_guest_invitations
      where token_hash=payload->>'hash' and revoked_at is null;
    if not found then return null; end if;
    if action='finish' then
      update private.event_guest_invitations set delivery=payload->>'delivery'
        where id=invitation.id and delivery='sending';
      return null;
    end if;
    select * into event_row from public.household_events where id=invitation.event_id for share;
    if not found then return null; end if;
    if action='respond' then
      if response is null or response not in ('yes','maybe','no') then raise exception 'Choose a reply.'; end if;
      if event_row.version is distinct from (payload->>'version')::integer then raise exception 'The event changed. Open the invitation again.'; end if;
      update private.event_guest_invitations set reply=response,replied_at=now()
        where id=invitation.id and revoked_at is null
        returning * into invitation;
      if not found then return null; end if;
    end if;
    return jsonb_build_object('event',to_jsonb(event_row)-'description','occurrence',invitation.occurrence,
      'sender',invitation.sender_name,'message',invitation.message,'reply',invitation.reply);
  end if;

  select * into event_row from public.household_events where id=(payload->>'eventId')::uuid;
  if not found then return null; end if;
  select m.display_name into sender from public.household_members m
    join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null
    where m.household_id=event_row.household_id and m.user_id=(payload->>'actorId')::uuid;
  if not found then return null; end if;
  if action='event' then
    return jsonb_build_object('event',to_jsonb(event_row)-'description');
  end if;
  if action='list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'reply',i.reply,'delivery',i.delivery)
      order by i.created_at) from private.event_guest_invitations i
      where i.event_id=event_row.id and i.occurrence=occurrence_key and i.revoked_at is null),'[]'::jsonb);
  end if;
  if action='revoke' then
    update private.event_guest_invitations set revoked_at=now()
      where event_id=event_row.id and occurrence=occurrence_key and id=(payload->>'id')::uuid and revoked_at is null;
    return jsonb_build_object('revoked',found);
  end if;
  if action<>'claim' then return null; end if;

  -- Serialize invitation claims so simultaneous sends cannot bypass the quotas.
  perform pg_advisory_xact_lock(hashtextextended('hh-event-guest-invitations',0));
  select * into event_row from public.household_events where id=event_row.id for share;
  if not found or event_row.version is distinct from (payload->>'version')::integer then
    raise exception 'The event changed. Reopen it before inviting guests.';
  end if;
  if not exists(select 1 from public.household_members where household_id=event_row.household_id and user_id=(payload->>'actorId')::uuid) then return null; end if;
  if exists(select 1 from private.event_guest_invitations where event_id=event_row.id and occurrence=occurrence_key and email=address and revoked_at is null) then
    raise exception 'That address already has an invitation for this event.';
  end if;
  delete from private.event_guest_delivery_attempts where created_at<=now()-interval '1 day';
  if (select count(*) from private.event_guest_delivery_attempts d where d.address_hash=recipient_hash)>=5 or
    (select count(*) from private.event_guest_delivery_attempts d where d.household_id=event_row.household_id)>=40 or
    (select count(*) from private.event_guest_delivery_attempts)>=300 then
    raise exception 'Invitation limit reached. Try again tomorrow.';
  end if;
  insert into private.event_guest_invitations(event_id,occurrence,email,token_hash,sender_name,message)
    values(event_row.id,occurrence_key,address,payload->>'hash',sender,coalesce(payload->>'message',''))
    returning * into invitation;
  insert into private.event_guest_delivery_attempts(household_id,address_hash) values(event_row.household_id,recipient_hash);
  return jsonb_build_object('id',invitation.id,'sender',sender);
end;
$$;
revoke all on function private.event_guest_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.event_guest_service(text,jsonb) to service_role;
create function public.event_guest_service(action text,payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.event_guest_service(action,payload);
$$;
revoke all on function public.event_guest_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.event_guest_service(text,jsonb) to service_role;
notify pgrst,'reload schema';
