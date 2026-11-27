-- Read only messages that household members submitted through the feedback form.
create index feedback_created_id on private.feedback_submissions (created_at desc,id desc);

create function private.hh_admin_feedback(kind text,before_created_at timestamptz,before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $feedback$
begin
 if private.hh_site_admin_issuer(auth.uid()) is null then
  raise exception 'Admin access required' using errcode='42501';
 end if;
 if private.hh_admin_needs_second_factor() then
  raise exception 'Verify your second factor to continue' using errcode='42501';
 end if;
 if kind is null or kind not in ('all','feedback','ideas') then
  raise exception 'Choose a valid feedback filter' using errcode='22023';
 end if;
 if (before_created_at is null) <> (before_id is null) then
  raise exception 'A feedback cursor requires both creation time and ID' using errcode='22023';
 end if;

 return (
  with fetched as (
   select f.id,f.area,f.message,f.created_at
   from private.feedback_submissions f
   where (before_created_at is null or (f.created_at,f.id)<(before_created_at,before_id))
    and (
     kind='all'
     or (kind='ideas' and f.area='New Feature Suggestion')
     or (kind='feedback' and f.area<>'New Feature Suggestion')
    )
   order by f.created_at desc,f.id desc
   limit 31
  )
  select jsonb_build_object(
   'submissions',coalesce((
    select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id desc)
    from (select id,area,message,created_at from fetched order by created_at desc,id desc limit 30) page
   ),'[]'::jsonb),
   'has_more',(select count(*)>30 from fetched)
  )
 );
end;
$feedback$;

create function public.hh_admin_feedback(
 kind text default 'all',
 before_created_at timestamptz default null,
 before_id uuid default null
) returns jsonb
language sql stable security invoker set search_path='' as $feedback$
 select private.hh_admin_feedback(kind,before_created_at,before_id)
$feedback$;

revoke all on function private.hh_admin_feedback(text,timestamptz,uuid),public.hh_admin_feedback(text,timestamptz,uuid)
 from public,anon,authenticated;
grant execute on function private.hh_admin_feedback(text,timestamptz,uuid),public.hh_admin_feedback(text,timestamptz,uuid)
 to authenticated;

-- TEST can keep a submission when its mail transport is disconnected.
alter table private.feedback_submissions
 drop constraint feedback_submissions_status_check,
 add constraint feedback_submissions_status_check check (status in ('sending','sent','uncertain','preview'));

create function private.hh_capture_feedback_preview(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $preview$
declare
 claim_status text:=private.feedback_mail_service('claim',payload)->>'status';
begin
 if claim_status='claimed' then
  update private.feedback_submissions
   set status='preview'
   where id=(payload->>'id')::uuid and actor_id=(payload->>'actorId')::uuid and status='sending';
  if not found then raise exception 'Feedback preview was not saved';end if;
  return jsonb_build_object('status','saved');
 end if;

 -- The original claim already verified the same actor, household, area and message.
 if claim_status='pending' and exists(
  select 1 from private.feedback_submissions
  where id=(payload->>'id')::uuid and actor_id=(payload->>'actorId')::uuid and status='preview'
 ) then
  return jsonb_build_object('status','saved');
 end if;
 if claim_status in ('sent','pending','limited') then
  return jsonb_build_object('status',claim_status);
 end if;
 raise exception 'Unexpected feedback preview status';
end;
$preview$;

create function public.hh_capture_feedback_preview(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $preview$
 select private.hh_capture_feedback_preview(payload)
$preview$;

revoke all on function private.hh_capture_feedback_preview(jsonb),public.hh_capture_feedback_preview(jsonb)
 from public,anon,authenticated;
grant execute on function private.hh_capture_feedback_preview(jsonb),public.hh_capture_feedback_preview(jsonb)
 to service_role;
