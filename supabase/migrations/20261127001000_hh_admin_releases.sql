-- A release binds one announcement draft to one immutable CI artifact.
create table private.hh_app_releases (
 id uuid primary key,
 version text not null check (version ~ '^V(0|[1-9][0-9]{0,5})\.[0-9]$'),
 commit_sha text not null unique check (commit_sha ~ '^[a-f0-9]{40}$'),
 artifact_run_id text not null check (artifact_run_id ~ '^[1-9][0-9]{0,19}$'),
 artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'ready' check (status in ('ready','queued','deploying','failed','verified','published')),
 title text not null default '',
 body text not null default '',
 image_path text,
 image_alt text,
 image_version text,
 error text,
 claim_id uuid,
 queued_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status in ('ready','queued'))=(claim_id is null)),
 check ((status='failed')=(error is not null)),
 check ((image_path is null)=(image_version is null))
);
create unique index hh_app_releases_active on private.hh_app_releases((true)) where status in ('deploying','verified');
alter table private.hh_app_releases enable row level security;
revoke all on private.hh_app_releases from public,anon,authenticated,service_role;

create function private.hh_release_view(release private.hh_app_releases) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',release.id,'version',release.version,'commit_sha',release.commit_sha,
  'artifact_run_id',release.artifact_run_id,'artifact_sha256',release.artifact_sha256,'status',release.status,
  'title',release.title,'body',release.body,'image_path',release.image_path,'image_alt',release.image_alt,
  'error',release.error,'created_at',release.created_at,'updated_at',release.updated_at);
$$;
revoke all on function private.hh_release_view(private.hh_app_releases) from public,anon,authenticated,service_role;

-- A draft may be incomplete. Queueing and publishing use the same full notice rules.
create function private.hh_notice_fields(notice_id uuid,payload jsonb,require_complete boolean) returns jsonb
language plpgsql set search_path='' as $$
declare
 notice_title text:=coalesce(btrim(payload->>'title'),'');
 notice_body text:=coalesce(btrim(payload->>'body',E' \t\r\n'),'');
 notice_image_path text:=payload->>'image_path';
 notice_image_alt text:=btrim(payload->>'image_alt');
begin
 if jsonb_typeof(payload->'title') not in ('string','null') or char_length(notice_title)>100
  or notice_title ~ '[[:cntrl:]]'
  or (require_complete and notice_image_path is null and (jsonb_typeof(payload->'title') is distinct from 'string' or notice_title='')) then
  raise exception 'Enter a title between 1 and 100 characters';
 end if;
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
  or (require_complete and notice_image_path is null and (jsonb_typeof(payload->'body') is distinct from 'string' or notice_body='')) then
  raise exception 'Enter a message between 1 and 2,000 characters';
 end if;
 return jsonb_build_object('title',notice_title,'body',notice_body,'image_path',notice_image_path,'image_alt',notice_image_alt);
end;
$$;
revoke all on function private.hh_notice_fields(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

create or replace function private.hh_publish_notice(notice_id uuid,payload jsonb) returns void
language plpgsql set search_path='' as $$
declare
 notice_kind text:=payload->>'kind';
 notice_release_version text:=nullif(upper(btrim(payload->>'release_version',E' \t\r\n')),'');
 fields jsonb;
 saved private.hh_app_notices%rowtype;
begin
 if notice_kind is null or notice_kind not in ('notice','update') then raise exception 'Choose notice or update';end if;
 if jsonb_typeof(payload->'release_version') not in ('string','null')
  or (notice_release_version is not null and notice_release_version !~ '^V(0|[1-9][0-9]{0,5})\.[0-9]$') then
  raise exception 'Enter a release version like V2.1';
 end if;
 if notice_kind='notice' and notice_release_version is not null then raise exception 'Release versions are for app updates';end if;
 fields:=private.hh_notice_fields(notice_id,payload,true);

 perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||notice_id::text,0));
 select * into saved from private.hh_app_notices where id=notice_id;
 if found then
  if (saved.kind,saved.title,saved.body,saved.image_path,saved.image_alt,saved.release_version)
   is distinct from (notice_kind,fields->>'title',fields->>'body',fields->>'image_path',fields->>'image_alt',notice_release_version) then
   raise exception 'This notice was already published with different content';
  end if;
  return;
 end if;
 if notice_kind='update' and notice_release_version is null then raise exception 'Enter a release version like V2.1';end if;
 if fields->>'image_path' is not null and not exists(
  select 1 from storage.objects o where o.bucket_id='hh-notice-images' and o.name=fields->>'image_path'
 ) then raise exception 'Upload the image before publishing this notice';end if;
 insert into private.hh_app_notices(id,kind,title,body,published_by,image_path,image_alt,release_version)
 values(notice_id,notice_kind,fields->>'title',fields->>'body',auth.uid(),fields->>'image_path',fields->>'image_alt',notice_release_version);
end;
$$;

-- Release artwork is locked after it is queued, even before there is a published notice.
create or replace function private.hh_notice_image_draft(object_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare image_notice uuid;
begin
 if not private.hh_notice_image_admin()
  or not storage.allow_any_operation(array['object.upload','object.upload_update','object.delete','object.delete_many'])
  or object_name is null
  or object_name !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/artwork\.(jpg|png|webp)$' then return false;end if;
 image_notice:=split_part(object_name,'/',1)::uuid;
 perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||image_notice::text,0));
 return not exists(select 1 from private.hh_app_notices where id=image_notice)
  and not exists(select 1 from private.hh_app_releases where id=image_notice and status not in ('ready','failed'));
end;
$$;

-- Existing notice publishing cannot bypass the release gate for a registered ID.
do $release_notice$
declare
 definition text:=pg_get_functiondef('private.hh_admin_content(text,jsonb)'::regprocedure);
 call_publish constant text:='perform private.hh_publish_notice(notice_id,payload);';
 gated_publish constant text:=$gate$perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||notice_id::text,0));
  if exists(select 1 from private.hh_app_releases where id=notice_id) then
   raise exception 'Publish this update through Releases';
  end if;
  perform private.hh_publish_notice(notice_id,payload);$gate$;
begin
 if position(call_publish in definition)=0 then raise exception 'Expected the existing notice publish call';end if;
 execute replace(definition,call_publish,gated_publish);
end;
$release_notice$;

create function private.hh_admin_releases(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare release_id uuid;
        release private.hh_app_releases%rowtype;
        fields jsonb;
        artwork_version text;
begin
 if private.hh_site_admin_issuer(auth.uid()) is null then raise exception 'Admin access required' using errcode='42501';end if;
 if private.hh_admin_needs_second_factor() then raise exception 'Verify your second factor to continue' using errcode='42501';end if;
 if action='save_draft' then
  if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'release_id') is distinct from 'string' then
   raise exception 'Choose a release';
  end if;
  release_id:=(payload->>'release_id')::uuid;
  select * into release from private.hh_app_releases where id=release_id for update;
  if not found then raise exception 'Release no longer exists';end if;
  if release.status not in ('ready','failed') then raise exception 'This release draft is locked';end if;
  fields:=private.hh_notice_fields(release_id,payload,false);
  if fields->>'image_path' is not null then
   perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||release_id::text,0));
   select nullif(o.version,'') into artwork_version from storage.objects o
   where o.bucket_id='hh-notice-images' and o.name=fields->>'image_path';
   if artwork_version is null then raise exception 'Upload the image before saving this draft';end if;
  end if;
  update private.hh_app_releases set title=fields->>'title',body=fields->>'body',image_path=fields->>'image_path',
   image_alt=fields->>'image_alt',image_version=artwork_version,updated_at=clock_timestamp() where id=release_id
   and (title,body,image_path,image_alt,image_version) is distinct from
    (fields->>'title',fields->>'body',fields->>'image_path',fields->>'image_alt',artwork_version);
 elsif action is distinct from 'snapshot' then
  raise exception 'Unsupported release action';
 end if;
 return jsonb_build_object('can_release',true,'releases',coalesce((
  select jsonb_agg(private.hh_release_view(r) order by r.created_at desc,r.id) from private.hh_app_releases r
 ),'[]'::jsonb));
end;
$$;

create function public.hh_admin_releases(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_admin_releases(action,payload);$$;
revoke all on function private.hh_admin_releases(text,jsonb),public.hh_admin_releases(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.hh_admin_releases(text,jsonb),public.hh_admin_releases(text,jsonb) to authenticated;

create function private.hh_release_worker(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 release private.hh_app_releases%rowtype;
 release_id uuid;
 actor_id uuid;
 attempt_id uuid;
 reviewed_at timestamptz;
 failure_message text;
begin
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid release request';end if;
 if payload->>'id' is not null and payload->>'release_id' is not null
  and (payload->>'id')::uuid<>(payload->>'release_id')::uuid then raise exception 'Release IDs do not match';end if;
 release_id:=coalesce(payload->>'release_id',payload->>'id')::uuid;
 if release_id is null then raise exception 'Choose a release';end if;

 -- Serialize worker transitions across candidates to keep only one deployment in progress.
 perform pg_advisory_xact_lock(hashtextextended('hh-app-release-worker',0));
 select * into release from private.hh_app_releases where id=release_id for update;
 if action='register' then
  if jsonb_typeof(payload->'version') is distinct from 'string' or payload->>'version' !~ '^V(0|[1-9][0-9]{0,5})\.[0-9]$'
   or jsonb_typeof(payload->'commit_sha') is distinct from 'string' or payload->>'commit_sha' !~ '^[a-f0-9]{40}$'
   or coalesce(jsonb_typeof(payload->'artifact_run_id'),'') not in ('string','number') or payload->>'artifact_run_id' !~ '^[1-9][0-9]{0,19}$'
   or jsonb_typeof(payload->'artifact_sha256') is distinct from 'string' or payload->>'artifact_sha256' !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid tested release metadata';
  end if;
  if found then
   if (release.version,release.commit_sha,release.artifact_run_id,release.artifact_sha256)
    is distinct from (payload->>'version',payload->>'commit_sha',payload->>'artifact_run_id',payload->>'artifact_sha256') then
    raise exception 'This release already has a different tested artifact';
   end if;
  else
   perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||release_id::text,0));
   if exists(select 1 from private.hh_app_notices where id=release_id) then raise exception 'This release ID is already a notice';end if;
   if exists(select 1 from private.hh_app_releases where commit_sha=payload->>'commit_sha') then
    raise exception 'This commit already belongs to a tested release';
   end if;
   insert into private.hh_app_releases(id,version,commit_sha,artifact_run_id,artifact_sha256)
   values(release_id,payload->>'version',payload->>'commit_sha',payload->>'artifact_run_id',payload->>'artifact_sha256') returning * into release;
  end if;
  return jsonb_build_object('release',private.hh_release_view(release));
 end if;
 if not found then raise exception 'Release no longer exists';end if;

 if action='queue' then
  actor_id:=(payload->>'actor_id')::uuid;
  if private.hh_site_admin_issuer(actor_id) is null then raise exception 'Admin access required' using errcode='42501';end if;
  if release.status='queued' then return jsonb_build_object('release',private.hh_release_view(release));end if;
  if release.status not in ('ready','failed') and not (release.status='deploying' and release.updated_at<now()-interval '60 minutes') then
   raise exception 'This release cannot be queued now';
  end if;
  begin
   if jsonb_typeof(payload->'expected_updated_at')='string' then
    reviewed_at:=(payload->>'expected_updated_at')::timestamptz;
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then
   reviewed_at:=null;
  end;
  if reviewed_at is distinct from release.updated_at then
   raise exception 'The release draft changed. Review the latest version before queueing.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hh-notice-images:'||release_id::text,0));
  perform private.hh_notice_fields(release_id,to_jsonb(release),true);
  if release.image_path is not null and not exists(
   select 1 from storage.objects o where o.bucket_id='hh-notice-images' and o.name=release.image_path and o.version=release.image_version
  ) then raise exception 'The release artwork changed. Save and review the updated draft before queueing.';end if;
  update private.hh_app_releases set status='queued',queued_by=actor_id,claim_id=null,error=null,updated_at=clock_timestamp()
  where id=release_id returning * into release;
 elsif action='claim' then
  if release.status<>'queued' or exists(select 1 from private.hh_app_releases where status in ('deploying','verified')) then
   return jsonb_build_object('claimed',false,'release',private.hh_release_view(release));
  end if;
  update private.hh_app_releases set status='deploying',claim_id=gen_random_uuid(),updated_at=clock_timestamp()
  where id=release_id returning * into release;
  return jsonb_build_object('claimed',true,'release',private.hh_release_view(release),'claim_id',release.claim_id);
 elsif action in ('verified','failed','publish','retry_publish') then
  if action<>'retry_publish' then
   attempt_id:=(payload->>'claim_id')::uuid;
   if attempt_id is null or release.claim_id is distinct from attempt_id then raise exception 'This deployment attempt is no longer active';end if;
  end if;
  if action='verified' then
   if payload->>'commit_sha' is distinct from release.commit_sha or payload->>'version' is distinct from release.version
    or payload->>'artifact_sha256' is distinct from release.artifact_sha256 then
    raise exception 'The hosted build does not match this tested release';
   end if;
   if release.status='deploying' then
    update private.hh_app_releases set status='verified',updated_at=clock_timestamp() where id=release_id returning * into release;
   elsif release.status not in ('verified','published') then raise exception 'This release is not deploying';end if;
  elsif action='failed' then
   if release.status='deploying' then
    failure_message:=left(nullif(btrim(regexp_replace(coalesce(payload->>'error',payload->>'reason',''),'[[:cntrl:]]',' ','g')),''),500);
    update private.hh_app_releases set status='failed',error=coalesce(failure_message,'The TEST deployment did not finish verification.'),
     updated_at=clock_timestamp() where id=release_id returning * into release;
   elsif release.status<>'failed' then raise exception 'This release is not deploying';end if;
  elsif release.status='verified' then
   perform private.hh_publish_notice(release.id,jsonb_build_object('kind','update','release_version',release.version,
    'title',release.title,'body',release.body,'image_path',release.image_path,'image_alt',release.image_alt));
   update private.hh_app_releases set status='published',updated_at=clock_timestamp() where id=release_id returning * into release;
  elsif release.status<>'published' then
   raise exception 'Verify this deployment before publishing its update';
  end if;
 else
  raise exception 'Unsupported release worker action';
 end if;
 return jsonb_build_object('release',private.hh_release_view(release));
end;
$$;

create function public.hh_release_worker(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hh_release_worker(action,payload);$$;
revoke all on function private.hh_release_worker(text,jsonb),public.hh_release_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.hh_release_worker(text,jsonb),public.hh_release_worker(text,jsonb) to service_role;
