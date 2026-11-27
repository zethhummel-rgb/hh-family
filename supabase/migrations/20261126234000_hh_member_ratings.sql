-- Ratings stay private to HH Admin. A dismissal stores only the completion marker.
create table private.hh_member_rating_prompt (
 id boolean primary key default true check (id),
 enabled boolean not null default false
);
insert into private.hh_member_rating_prompt default values;
alter table private.hh_member_rating_prompt enable row level security;
revoke all on private.hh_member_rating_prompt from public,anon,authenticated;

create table private.hh_member_ratings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 id uuid unique,
 stars smallint,
 comment text,
 allow_quote boolean not null default false,
 created_at timestamptz,
 check (
  (stars is null and id is null and comment is null and not allow_quote and created_at is null)
  or (stars is not null and stars between 1 and 5 and id is not null and created_at is not null
   and (comment is null or char_length(comment) between 1 and 1000)
   and (not allow_quote or comment is not null))
 )
);
create index hh_member_ratings_page on private.hh_member_ratings(created_at desc,id desc) where stars is not null;
alter table private.hh_member_ratings enable row level security;
revoke all on private.hh_member_ratings from public,anon,authenticated;

create function private.hh_rating_prompt_enabled() returns boolean
language sql stable set search_path='' as $$
 select coalesce((select p.enabled from private.hh_member_rating_prompt p where p.id),false);
$$;
revoke all on function private.hh_rating_prompt_enabled() from public,anon,authenticated;

create or replace function private.hh_member_content() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 return private.hh_content_snapshot(false) || jsonb_build_object('rating_eligible',
  private.hh_rating_prompt_enabled() and not exists(select 1 from private.hh_member_ratings where user_id=uid));
end;
$$;

create function private.hh_member_rating(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 prompt_enabled boolean;
 rating_stars numeric;
 rating_comment text;
 quote_allowed boolean;
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 if action is null or action not in ('submit','dismiss') then raise exception 'Unsupported rating action';end if;
 if exists(select 1 from private.hh_member_ratings where user_id=uid) then return jsonb_build_object('completed',true);end if;

 -- Serialize the availability switch against new responses while allowing members to rate concurrently.
 select p.enabled into prompt_enabled from private.hh_member_rating_prompt p where p.id for share;
 if prompt_enabled is distinct from true then
  if exists(select 1 from private.hh_member_ratings where user_id=uid) then return jsonb_build_object('completed',true);end if;
  raise exception 'The rating prompt is currently off' using errcode='42501';
 end if;
 if action='dismiss' then
  insert into private.hh_member_ratings(user_id) values(uid) on conflict (user_id) do nothing;
  return jsonb_build_object('completed',true);
 end if;

 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid rating';end if;
 if jsonb_typeof(payload->'stars')='number' then rating_stars:=(payload->>'stars')::numeric;end if;
 if rating_stars is null or rating_stars not in (1,2,3,4,5) then raise exception 'Choose a rating from one to five stars';end if;
 if payload ? 'comment' and jsonb_typeof(payload->'comment') not in ('null','string') then raise exception 'Enter a valid comment';end if;
 if char_length(payload->>'comment')>1000 then raise exception 'Keep your comment to 1,000 characters';end if;
 rating_comment:=nullif(btrim(payload->>'comment',E' \t\r\n'),'');
 if payload ? 'allow_quote' and jsonb_typeof(payload->'allow_quote') is distinct from 'boolean' then
  raise exception 'Choose whether HH may quote your comment';
 end if;
 quote_allowed:=coalesce((payload->>'allow_quote')::boolean,false);
 if quote_allowed and rating_comment is null then raise exception 'Enter a comment before allowing HH to quote it';end if;
 insert into private.hh_member_ratings(user_id,id,stars,comment,allow_quote,created_at)
 values(uid,gen_random_uuid(),rating_stars::smallint,rating_comment,quote_allowed,clock_timestamp())
 on conflict (user_id) do nothing;
 return jsonb_build_object('completed',true);
end;
$$;

create function public.hh_member_rating(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_member_rating(action,payload);$$;
revoke all on function private.hh_member_rating(text,jsonb),public.hh_member_rating(text,jsonb) from public,anon,authenticated;
grant execute on function private.hh_member_rating(text,jsonb),public.hh_member_rating(text,jsonb) to authenticated;

create function private.hh_admin_ratings(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 cursor_time timestamptz;
 cursor_id uuid;
 page_size constant int:=25;
begin
 if private.hh_site_admin_issuer(auth.uid()) is null then raise exception 'Admin access required' using errcode='42501';end if;
 if private.hh_admin_needs_second_factor() then raise exception 'Verify your second factor to continue' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid ratings request';end if;

 if action='set_enabled' then
  if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose whether the prompt is enabled';end if;
  insert into private.hh_member_rating_prompt(id,enabled) values(true,(payload->>'enabled')::boolean)
  on conflict (id) do update set enabled=excluded.enabled;
 elsif action='snapshot' then
  if (payload ? 'before_created_at' and jsonb_typeof(payload->'before_created_at') not in ('string','null'))
   or (payload ? 'before_id' and jsonb_typeof(payload->'before_id') not in ('string','null')) then
   raise exception 'Invalid ratings cursor';
  end if;
  begin
   cursor_time:=(payload->>'before_created_at')::timestamptz;
   cursor_id:=(payload->>'before_id')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   raise exception 'Invalid ratings cursor';
  end;
  if (cursor_time is null)<>(cursor_id is null) or (cursor_time is not null and not isfinite(cursor_time)) then
   raise exception 'Invalid ratings cursor';
  end if;
 else
  raise exception 'Unsupported ratings action';
 end if;

 return (
  with page as (
   select r.id,r.stars,r.comment,r.allow_quote,r.created_at from private.hh_member_ratings r
   where r.stars is not null and (cursor_time is null or (r.created_at,r.id)<(cursor_time,cursor_id))
   order by r.created_at desc,r.id desc limit (page_size+1)
  )
  select jsonb_build_object('enabled',private.hh_rating_prompt_enabled(),
   'ratings',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc)
    from (select * from page order by created_at desc,id desc limit page_size) rows),'[]'::jsonb),
   'has_more',(select count(*)>page_size from page))
 );
end;
$$;

create function public.hh_admin_ratings(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_admin_ratings(action,payload);$$;
revoke all on function private.hh_admin_ratings(text,jsonb),public.hh_admin_ratings(text,jsonb) from public,anon,authenticated;
grant execute on function private.hh_admin_ratings(text,jsonb),public.hh_admin_ratings(text,jsonb) to authenticated;
