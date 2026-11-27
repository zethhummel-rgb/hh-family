-- A dismissal pauses the rating prompt for 24 hours. An actual rating stays final.
alter table private.hh_member_ratings
 add column snoozed_until timestamptz,
 add constraint hh_member_ratings_snooze_check check (
  snoozed_until is null or (stars is null and isfinite(snoozed_until))
 );

-- The earlier completion markers carry no dismissal time. Keep each invisible for one
-- final 24-hour window from migration, then allow the member to rate again.
update private.hh_member_ratings set snoozed_until=now()+interval '24 hours' where stars is null;

create or replace function private.hh_member_content() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 return private.hh_content_snapshot(false) || jsonb_build_object('rating_eligible',
  private.hh_rating_prompt_enabled() and not exists(
   select 1 from private.hh_member_ratings where user_id=uid and (stars is not null or snoozed_until>now())
  ));
end;
$$;

create or replace function private.hh_member_rating(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 prompt_enabled boolean;
 rating_stars numeric;
 rating_comment text;
 quote_allowed boolean;
 snooze_end timestamptz;
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=uid and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 if action is null or action not in ('submit','dismiss') then raise exception 'Unsupported rating action';end if;
 if exists(select 1 from private.hh_member_ratings where user_id=uid and stars is not null) then
  return jsonb_build_object('completed',true);
 end if;

 -- Serialize the availability switch against new responses while allowing members to rate concurrently.
 select p.enabled into prompt_enabled from private.hh_member_rating_prompt p where p.id for share;
 if prompt_enabled is distinct from true then
  if exists(select 1 from private.hh_member_ratings where user_id=uid and stars is not null) then
   return jsonb_build_object('completed',true);
  end if;
  raise exception 'The rating prompt is currently off' using errcode='42501';
 end if;
 if action='dismiss' then
  insert into private.hh_member_ratings as response(user_id,snoozed_until) values(uid,now()+interval '24 hours')
  on conflict (user_id) do update set snoozed_until=excluded.snoozed_until
  where response.stars is null and (response.snoozed_until is null or response.snoozed_until<=now())
  returning response.snoozed_until into snooze_end;
  if not found then select r.snoozed_until into snooze_end from private.hh_member_ratings r where r.user_id=uid;end if;
  return case when snooze_end is null then jsonb_build_object('completed',true)
   else jsonb_build_object('completed',true,'snoozed_until',snooze_end) end;
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
 insert into private.hh_member_ratings as response(user_id,id,stars,comment,allow_quote,created_at)
 values(uid,gen_random_uuid(),rating_stars::smallint,rating_comment,quote_allowed,clock_timestamp())
 on conflict (user_id) do update set id=excluded.id,stars=excluded.stars,comment=excluded.comment,
  allow_quote=excluded.allow_quote,created_at=excluded.created_at,snoozed_until=null
 where response.stars is null;
 return jsonb_build_object('completed',true);
end;
$$;
