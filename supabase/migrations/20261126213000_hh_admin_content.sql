-- In-app posts and optional palettes are managed through the site admin role.
create table private.hh_app_notices (
 id uuid primary key,
 kind text not null check (kind in ('notice','update')),
 title text not null check (char_length(title) between 1 and 100 and title !~ '[[:cntrl:]]'),
 body text not null check (char_length(body) between 1 and 2000),
 published_by uuid references auth.users(id) on delete set null,
 published_at timestamptz not null default now(),
 archived_at timestamptz
);
create index hh_app_notices_published_at on private.hh_app_notices(published_at desc,id) where archived_at is null;
alter table private.hh_app_notices enable row level security;
revoke all on private.hh_app_notices from public,anon,authenticated;

create table private.hh_seasonal_palettes (
 palette text primary key check (palette in ('spring','summer','autumn','winter')),
 enabled boolean not null
);
alter table private.hh_seasonal_palettes enable row level security;
revoke all on private.hh_seasonal_palettes from public,anon,authenticated;

create function private.hh_content_snapshot(include_archived boolean) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'notices',coalesce((
   select jsonb_agg(
    jsonb_build_object('id',n.id,'kind',n.kind,'title',n.title,'body',n.body,'published_at',n.published_at)
    || case when include_archived then jsonb_build_object('archived_at',n.archived_at) else '{}'::jsonb end
    order by n.published_at desc,n.id
   )
   from private.hh_app_notices n where include_archived or n.archived_at is null
  ),'[]'::jsonb),
  'seasonal_palettes',coalesce((
   select jsonb_agg(p.palette order by array_position(array['spring','summer','autumn','winter'],p.palette))
   from private.hh_seasonal_palettes p where p.enabled
  ),'[]'::jsonb)
 );
$$;
revoke all on function private.hh_content_snapshot(boolean) from public,anon,authenticated;

create function private.hh_admin_content(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 notice_id uuid;
 notice_kind text;
 notice_title text;
 notice_body text;
 saved private.hh_app_notices%rowtype;
begin
 if private.hh_site_admin_issuer(uid) is null then raise exception 'Admin access required' using errcode='42501';end if;
 if (auth.jwt()->>'aal') is distinct from 'aal2' then
  raise exception 'Verify your second factor to continue' using errcode='42501';
 end if;
 if action='snapshot' then return private.hh_content_snapshot(true);end if;
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid content request';end if;

 if action in ('publish_notice','archive_notice') then
  if jsonb_typeof(payload->'id') is distinct from 'string' or payload->>'id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'Choose a valid notice';
  end if;
  notice_id:=(payload->>'id')::uuid;
 end if;
 if action='publish_notice' then
  notice_kind:=payload->>'kind';
  notice_title:=btrim(payload->>'title');
  notice_body:=btrim(payload->>'body',E' \t\r\n');
  if notice_kind is null or notice_kind not in ('notice','update') then raise exception 'Choose notice or update';end if;
  if jsonb_typeof(payload->'title') is distinct from 'string' or char_length(notice_title) not between 1 and 100
   or notice_title ~ '[[:cntrl:]]' then raise exception 'Enter a title between 1 and 100 characters';end if;
  if jsonb_typeof(payload->'body') is distinct from 'string' or char_length(notice_body) not between 1 and 2000 then
   raise exception 'Enter a message between 1 and 2,000 characters';
  end if;
  insert into private.hh_app_notices(id,kind,title,body,published_by)
  values(notice_id,notice_kind,notice_title,notice_body,uid)
  on conflict (id) do nothing;
  if not found then
   select * into saved from private.hh_app_notices where id=notice_id;
   if saved.kind is distinct from notice_kind or saved.title is distinct from notice_title or saved.body is distinct from notice_body then
    raise exception 'This notice was already published with different content';
   end if;
  end if;
 elsif action='archive_notice' then
  update private.hh_app_notices set archived_at=now() where id=notice_id and archived_at is null;
  if not found and not exists(select 1 from private.hh_app_notices where id=notice_id) then raise exception 'Notice no longer exists';end if;
 elsif action='set_palette' then
  if payload->>'palette' is null or payload->>'palette' not in ('spring','summer','autumn','winter')
   or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose a seasonal palette and on or off';end if;
  insert into private.hh_seasonal_palettes(palette,enabled) values(payload->>'palette',(payload->>'enabled')::boolean)
  on conflict (palette) do update set enabled=excluded.enabled
  where hh_seasonal_palettes.enabled is distinct from excluded.enabled;
 else
  raise exception 'Unsupported content request';
 end if;
 return private.hh_content_snapshot(true);
end;
$$;

create function public.hh_admin_content(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_admin_content(action,payload);$$;
revoke all on function private.hh_admin_content(text,jsonb),public.hh_admin_content(text,jsonb) from public,anon,authenticated;
grant execute on function private.hh_admin_content(text,jsonb),public.hh_admin_content(text,jsonb) to authenticated;

create function private.hh_member_content() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=auth.uid() and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 return private.hh_content_snapshot(false);
end;
$$;

create function public.hh_member_content() returns jsonb
language sql stable security invoker set search_path='' as $$select private.hh_member_content();$$;
revoke all on function private.hh_member_content(),public.hh_member_content() from public,anon,authenticated;
grant execute on function private.hh_member_content(),public.hh_member_content() to authenticated;
