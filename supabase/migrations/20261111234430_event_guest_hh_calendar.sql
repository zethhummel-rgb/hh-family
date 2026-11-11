create function private.event_guest_hh_calendar(action text, capability text, shared_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  invite private.event_guest_invitations%rowtype;
  source public.household_events%rowtype;
  saved public.household_events%rowtype;
  destination uuid;
  copy_id uuid;
  source_instance text;
begin
  if actor is null or action is null or action not in ('status','add') then return null; end if;
  select * into invite from private.event_guest_invitations
    where token_hash=capability and revoked_at is null and reply in ('yes','maybe') for share;
  if not found then return null; end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and lower(u.email)=invite.email) then
    return jsonb_build_object('state','wrong-account');
  end if;
  select household_id into destination from public.household_members where user_id=actor for share;
  if not found then return jsonb_build_object('state','no-household'); end if;
  select * into source from public.household_events where id=invite.event_id for share;
  if not found then return null; end if;
  source_instance := source.id::text||case when invite.occurrence='' then '' else '@'||invite.occurrence end;
  if source.household_id=destination then
    return jsonb_build_object('state','view','eventId',source_instance);
  end if;
  -- An event occurrence can appear once in each destination household, even
  -- when several members accept separate invitations or retry concurrently.
  copy_id := substr(encode(sha256(convert_to(jsonb_build_array('hh-guest-copy',source.id,invite.occurrence,destination)::text,'UTF8')),'hex'),1,32)::uuid;
  select * into saved from public.household_events where id=copy_id and household_id=destination;
  if found then
    return jsonb_build_object('state','view','eventId',saved.id,
      'date',coalesce(saved.start_date,(saved.starts_at at time zone 'America/Toronto')::date));
  end if;
  if not private.native_calendar_writable(destination) then return jsonb_build_object('state','unavailable'); end if;
  if action='status' then return jsonb_build_object('state','add'); end if;
  if source.version is distinct from (shared_event->>'version')::integer
    or (shared_event->>'id') is distinct from source_instance
    or (shared_event->>'endsAt')::timestamptz <= now()
  then return null; end if;

  insert into public.household_events
    (id,household_id,title,location,description,person,starts_at,ends_at,all_day,start_date,end_date,reminder_30_enabled)
  values (copy_id,destination,shared_event->>'title',coalesce(shared_event->>'location',''),'','Unassigned',
    (shared_event->>'startsAt')::timestamptz,(shared_event->>'endsAt')::timestamptz,
    (shared_event->>'allDay')::boolean,(shared_event->>'startDate')::date,(shared_event->>'endDate')::date,false)
  on conflict(id) do nothing;
  select * into saved from public.household_events where id=copy_id and household_id=destination;
  if not found then return null; end if;
  return jsonb_build_object('state','view','eventId',saved.id,
    'date',coalesce(saved.start_date,(saved.starts_at at time zone 'America/Toronto')::date));
end;
$$;
revoke all on function private.event_guest_hh_calendar(text,text,jsonb) from public,anon,authenticated;
grant execute on function private.event_guest_hh_calendar(text,text,jsonb) to authenticated;
create function public.event_guest_hh_calendar(action text,capability text,shared_event jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.event_guest_hh_calendar(action,capability,shared_event);
$$;
revoke all on function public.event_guest_hh_calendar(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.event_guest_hh_calendar(text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
