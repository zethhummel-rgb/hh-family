-- Keep versionless historical updates and ordinary notices readable.
alter table private.hh_app_notices add column release_version text,
 add constraint hh_app_notices_release_version_check check (
  release_version is null or (kind='update' and release_version ~ '^V(0|[1-9][0-9]{0,5})\.[0-9]$')
 );

create or replace function private.hh_publish_notice(notice_id uuid,payload jsonb) returns void
language plpgsql set search_path='' as $$
declare
 notice_kind text:=payload->>'kind';
 notice_title text:=btrim(payload->>'title');
 notice_body text:=coalesce(btrim(payload->>'body',E' \t\r\n'),'');
 notice_image_path text:=payload->>'image_path';
 notice_image_alt text:=btrim(payload->>'image_alt');
 notice_release_version text:=nullif(upper(btrim(payload->>'release_version',E' \t\r\n')),'');
 saved private.hh_app_notices%rowtype;
begin
 if notice_kind is null or notice_kind not in ('notice','update') then raise exception 'Choose notice or update';end if;
 if jsonb_typeof(payload->'release_version') not in ('string','null')
  or (notice_release_version is not null and notice_release_version !~ '^V(0|[1-9][0-9]{0,5})\.[0-9]$') then
  raise exception 'Enter a release version like V2.1';
 end if;
 if notice_kind='notice' and notice_release_version is not null then raise exception 'Release versions are for app updates';end if;
 if jsonb_typeof(payload->'title') is distinct from 'string' or char_length(notice_title) not between 1 and 100
  or notice_title ~ '[[:cntrl:]]' then raise exception 'Enter a title between 1 and 100 characters';end if;
 if jsonb_typeof(payload->'image_path') not in ('string','null')
  or (notice_image_path is not null and notice_image_path not in
   (notice_id::text||'/artwork.jpg',notice_id::text||'/artwork.png',notice_id::text||'/artwork.webp')) then
  raise exception 'Choose a valid image for this notice';
 end if;
 if notice_image_path is null then
  if notice_image_alt is not null then raise exception 'Image description requires an image';end if;
 elsif jsonb_typeof(payload->'image_alt') is distinct from 'string' or char_length(notice_image_alt) not between 1 and 300
  or notice_image_alt ~ '[[:cntrl:]]' then
  raise exception 'Describe the image in 1 to 300 characters';
 end if;
 if char_length(notice_body)>2000 or jsonb_typeof(payload->'body') not in ('string','null')
  or (notice_image_path is null and (jsonb_typeof(payload->'body') is distinct from 'string' or notice_body='')) then
  raise exception 'Enter a message between 1 and 2,000 characters';
 end if;

 perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||notice_id::text,0));
 select * into saved from private.hh_app_notices where id=notice_id;
 if found then
  if (saved.kind,saved.title,saved.body,saved.image_path,saved.image_alt,saved.release_version)
   is distinct from (notice_kind,notice_title,notice_body,notice_image_path,notice_image_alt,notice_release_version) then
   raise exception 'This notice was already published with different content';
  end if;
  return;
 end if;
 if notice_kind='update' and notice_release_version is null then raise exception 'Enter a release version like V2.1';end if;
 if notice_image_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='hh-notice-images' and o.name=notice_image_path) then
  raise exception 'Upload the image before publishing this notice';
 end if;
 insert into private.hh_app_notices(id,kind,title,body,published_by,image_path,image_alt,release_version)
 values(notice_id,notice_kind,notice_title,notice_body,auth.uid(),notice_image_path,notice_image_alt,notice_release_version);
end;
$$;

do $notice_version$
declare
 definition text:=pg_get_functiondef('private.hh_content_snapshot(boolean)'::regprocedure);
 projection constant text:=$old$'image_path',n.image_path,'image_alt',n.image_alt$old$;
begin
 if position(projection in definition)=0 then raise exception 'Expected the existing notice artwork projection';end if;
 execute replace(definition,projection,projection||$new$,'release_version',n.release_version$new$);
end;
$notice_version$;

create function private.hh_member_notice_history(before_published_at timestamptz,before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page_size constant int:=20;
begin
 if not exists(
  select 1 from public.household_members m join auth.users u on u.id=m.user_id
  where m.user_id=auth.uid() and u.email_confirmed_at is not null
 ) then raise exception 'Confirmed household membership required' using errcode='42501';end if;
 if (before_published_at is null)<>(before_id is null)
  or (before_published_at is not null and not isfinite(before_published_at)) then raise exception 'Invalid notice history cursor';end if;

 return (
  with page as (
   select n.id,n.kind,n.title,n.body,n.published_at,n.image_path,n.image_alt,n.release_version
   from private.hh_app_notices n
   where n.archived_at is null and (before_published_at is null or n.published_at<before_published_at
    or (n.published_at=before_published_at and n.id>before_id))
   order by n.published_at desc,n.id limit (page_size+1)
  )
  select jsonb_build_object('notices',coalesce((
   select jsonb_agg(to_jsonb(rows) order by rows.published_at desc,rows.id)
   from (select * from page order by published_at desc,id limit page_size) rows
  ),'[]'::jsonb),'has_more',(select count(*)>page_size from page))
 );
end;
$$;

create function public.hh_member_notice_history(before_published_at timestamptz default null,before_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.hh_member_notice_history(before_published_at,before_id);$$;
revoke all on function private.hh_member_notice_history(timestamptz,uuid),public.hh_member_notice_history(timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.hh_member_notice_history(timestamptz,uuid),public.hh_member_notice_history(timestamptz,uuid) to authenticated;
