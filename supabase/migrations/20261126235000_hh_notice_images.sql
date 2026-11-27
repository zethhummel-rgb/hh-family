-- Optional notice artwork stays in a private Storage bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hh-notice-images','hh-notice-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table private.hh_app_notices
 add column image_path text,
 add column image_alt text,
 drop constraint hh_app_notices_body_check,
 add constraint hh_app_notices_body_check check (char_length(body)<=2000 and (char_length(body)>0 or image_path is not null)),
 add constraint hh_app_notices_image_check check (
  (image_path is null and image_alt is null) or (image_path is not null and image_alt is not null
   and image_path in (id::text||'/artwork.jpg',id::text||'/artwork.png',id::text||'/artwork.webp')
   and char_length(btrim(image_alt)) between 1 and 300 and image_alt !~ '[[:cntrl:]]')
 );
create index hh_app_notices_visible_image on private.hh_app_notices(image_path)
 where image_path is not null and archived_at is null;

create function private.hh_notice_image_admin() returns boolean
language sql stable set search_path='' as $$
 select private.hh_site_admin_issuer(auth.uid()) is not null and not private.hh_admin_needs_second_factor();
$$;
revoke all on function private.hh_notice_image_admin() from public,anon,authenticated;

create function private.hh_notice_image_read(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select (private.hh_notice_image_admin() and storage.allow_any_operation(array[
  'object.get_authenticated_info','object.get_authenticated','object.head_authenticated_info',
  'object.list','object.list_v2','object.upload','object.upload_update','object.delete','object.delete_many'
 ])) or (
  storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
  and exists(select 1 from public.household_members m join auth.users u on u.id=m.user_id
   where m.user_id=auth.uid() and u.email_confirmed_at is not null)
  and exists(select 1 from private.hh_app_notices n where n.image_path=object_name and n.archived_at is null)
 );
$$;

create function private.hh_notice_image_draft(object_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare image_notice uuid;
begin
 if not private.hh_notice_image_admin()
  or not storage.allow_any_operation(array['object.upload','object.upload_update','object.delete','object.delete_many'])
  or object_name is null
  or object_name !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/artwork\.(jpg|png|webp)$' then return false;end if;
 image_notice:=split_part(object_name,'/',1)::uuid;
 -- Mutating the draft and publishing its notice must not pass the checks concurrently.
 perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||image_notice::text,0));
 return not exists(select 1 from private.hh_app_notices where id=image_notice);
end;
$$;
revoke all on function private.hh_notice_image_read(text),private.hh_notice_image_draft(text) from public,anon,authenticated;
grant execute on function private.hh_notice_image_read(text),private.hh_notice_image_draft(text) to authenticated;

create policy hh_notice_images_read on storage.objects for select to authenticated
 using (bucket_id='hh-notice-images' and private.hh_notice_image_read(name));
create policy hh_notice_images_upload on storage.objects for insert to authenticated
 with check (bucket_id='hh-notice-images' and private.hh_notice_image_draft(name));
create policy hh_notice_images_update on storage.objects for update to authenticated
 using (bucket_id='hh-notice-images' and private.hh_notice_image_draft(name))
 with check (bucket_id='hh-notice-images' and private.hh_notice_image_draft(name));
create policy hh_notice_images_delete on storage.objects for delete to authenticated
 using (bucket_id='hh-notice-images' and private.hh_notice_image_draft(name));

-- These guards also constrain broader Storage policies that may exist in an environment.
create policy hh_notice_images_anon_guard on storage.objects as restrictive for all to anon
 using (bucket_id is distinct from 'hh-notice-images') with check (bucket_id is distinct from 'hh-notice-images');
create policy hh_notice_images_read_guard on storage.objects as restrictive for select to authenticated
 using (bucket_id is distinct from 'hh-notice-images' or private.hh_notice_image_read(name));
create policy hh_notice_images_upload_guard on storage.objects as restrictive for insert to authenticated
 with check (bucket_id is distinct from 'hh-notice-images' or private.hh_notice_image_draft(name));
create policy hh_notice_images_update_guard on storage.objects as restrictive for update to authenticated
 using (bucket_id is distinct from 'hh-notice-images' or private.hh_notice_image_draft(name))
 with check (bucket_id is distinct from 'hh-notice-images' or private.hh_notice_image_draft(name));
create policy hh_notice_images_delete_guard on storage.objects as restrictive for delete to authenticated
 using (bucket_id is distinct from 'hh-notice-images' or private.hh_notice_image_draft(name));

create function private.hh_publish_notice(notice_id uuid,payload jsonb) returns void
language plpgsql set search_path='' as $$
declare
 notice_kind text:=payload->>'kind';
 notice_title text:=btrim(payload->>'title');
 notice_body text:=coalesce(btrim(payload->>'body',E' \t\r\n'),'');
 notice_image_path text:=payload->>'image_path';
 notice_image_alt text:=btrim(payload->>'image_alt');
 saved private.hh_app_notices%rowtype;
begin
 if notice_kind is null or notice_kind not in ('notice','update') then raise exception 'Choose notice or update';end if;
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
  if (saved.kind,saved.title,saved.body,saved.image_path,saved.image_alt)
   is distinct from (notice_kind,notice_title,notice_body,notice_image_path,notice_image_alt) then
   raise exception 'This notice was already published with different content';
  end if;
  return;
 end if;
 if notice_image_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='hh-notice-images' and o.name=notice_image_path) then
  raise exception 'Upload the image before publishing this notice';
 end if;
 insert into private.hh_app_notices(id,kind,title,body,published_by,image_path,image_alt)
 values(notice_id,notice_kind,notice_title,notice_body,auth.uid(),notice_image_path,notice_image_alt);
end;
$$;
revoke all on function private.hh_publish_notice(uuid,jsonb) from public,anon,authenticated;

create or replace function private.hh_admin_content(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare notice_id uuid;
begin
 if private.hh_site_admin_issuer(auth.uid()) is null then raise exception 'Admin access required' using errcode='42501';end if;
 if private.hh_admin_needs_second_factor() then raise exception 'Verify your second factor to continue' using errcode='42501';end if;
 if action='snapshot' then return private.hh_content_snapshot(true);end if;
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid content request';end if;

 if action in ('publish_notice','archive_notice') then
  if jsonb_typeof(payload->'id') is distinct from 'string' or payload->>'id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'Choose a valid notice';
  end if;
  notice_id:=(payload->>'id')::uuid;
 end if;
 if action='publish_notice' then
  perform private.hh_publish_notice(notice_id,payload);
 elsif action='archive_notice' then
  update private.hh_app_notices set archived_at=now() where id=notice_id and archived_at is null;
  if not found and not exists(select 1 from private.hh_app_notices where id=notice_id) then raise exception 'Notice no longer exists';end if;
 elsif action='set_palette' then
  perform private.hh_set_seasonal_palette(payload);
 else
  raise exception 'Unsupported content request';
 end if;
 return private.hh_content_snapshot(true);
end;
$$;

-- Add artwork fields to the existing snapshot without changing the palette or rating contracts.
do $notice_images$
declare
 definition text:=pg_get_functiondef('private.hh_content_snapshot(boolean)'::regprocedure);
 projection constant text:=$old$'body',n.body,'published_at',n.published_at$old$;
begin
 if position(projection in definition)=0 then raise exception 'Expected the existing notice projection';end if;
 execute replace(definition,projection,projection||$new$,'image_path',n.image_path,'image_alt',n.image_alt$new$);
end;
$notice_images$;
