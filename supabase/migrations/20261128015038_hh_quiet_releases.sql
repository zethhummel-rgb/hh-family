-- Quiet releases share deployment verification and Admin history with announced releases.
-- Pre-existing builds and callers retain the announced release behavior.
alter table private.hh_app_releases add column quiet boolean not null default false;

create or replace function private.hh_release_view(release private.hh_app_releases) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',release.id,'version',release.version,'commit_sha',release.commit_sha,
  'artifact_run_id',release.artifact_run_id,'artifact_sha256',release.artifact_sha256,'status',release.status,'quiet',release.quiet,
  'title',release.title,'body',release.body,'image_path',release.image_path,'image_alt',release.image_alt,
  'error',release.error,'created_at',release.created_at,'updated_at',release.updated_at);
$$;

create or replace function private.hh_release_worker(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 release private.hh_app_releases%rowtype;
 release_id uuid;
 actor_id uuid;
 attempt_id uuid;
 reviewed_at timestamptz;
 failure_message text;
 quiet_release boolean := action='queue_quiet';
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

 if action in ('queue','queue_quiet') then
  actor_id:=(payload->>'actor_id')::uuid;
  if private.hh_site_admin_issuer(actor_id) is null then raise exception 'Admin access required' using errcode='42501';end if;
  if release.status in ('queued','deploying') and release.quiet<>quiet_release then
   raise exception 'Retry using the release mode that was already approved';
  end if;
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
  if not quiet_release then
   perform private.hh_notice_fields(release_id,to_jsonb(release),true);
   if release.image_path is not null and not exists(
    select 1 from storage.objects o where o.bucket_id='hh-notice-images' and o.name=release.image_path and o.version=release.image_version
   ) then raise exception 'The release artwork changed. Save and review the updated draft before queueing.';end if;
  end if;
  update private.hh_app_releases set status='queued',quiet=quiet_release,queued_by=actor_id,claim_id=null,error=null,updated_at=clock_timestamp()
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
    -- A quiet build is complete as soon as both hosted addresses have been verified.
    update private.hh_app_releases set status=case when quiet then 'published' else 'verified' end,
     updated_at=clock_timestamp() where id=release_id returning * into release;
   elsif release.status not in ('verified','published') then raise exception 'This release is not deploying';end if;
  elsif action='failed' then
   if release.status='deploying' then
    failure_message:=left(nullif(btrim(regexp_replace(coalesce(payload->>'error',payload->>'reason',''),'[[:cntrl:]]',' ','g')),''),500);
    update private.hh_app_releases set status='failed',error=coalesce(failure_message,'The TEST deployment did not finish verification.'),
     updated_at=clock_timestamp() where id=release_id returning * into release;
   elsif release.status<>'failed' then raise exception 'This release is not deploying';end if;
  elsif release.status='verified' then
   if not release.quiet then
    perform private.hh_publish_notice(release.id,jsonb_build_object('kind','update','release_version',release.version,
     'title',release.title,'body',release.body,'image_path',release.image_path,'image_alt',release.image_alt));
   end if;
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
