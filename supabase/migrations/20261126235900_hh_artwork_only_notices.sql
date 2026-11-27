-- Artwork can carry a post by itself. Text-only posts keep their existing requirements.
alter table private.hh_app_notices
 drop constraint hh_app_notices_title_check,
 add constraint hh_app_notices_title_check check (
  char_length(title)<=100 and title !~ '[[:cntrl:]]' and (char_length(title)>0 or image_path is not null)
 );

do $artwork_only$
declare
 definition text:=pg_get_functiondef('private.hh_publish_notice(uuid,jsonb)'::regprocedure);
 old_title constant text:=$old$notice_title text:=btrim(payload->>'title');$old$;
 new_title constant text:=$new$notice_title text:=coalesce(btrim(payload->>'title'),'');$new$;
 old_check constant text:=$old$ if jsonb_typeof(payload->'title') is distinct from 'string' or char_length(notice_title) not between 1 and 100
  or notice_title ~ '[[:cntrl:]]' then raise exception 'Enter a title between 1 and 100 characters';end if;$old$;
 new_check constant text:=$new$ if jsonb_typeof(payload->'title') not in ('string','null') or char_length(notice_title)>100
  or notice_title ~ '[[:cntrl:]]'
  or (notice_image_path is null and (jsonb_typeof(payload->'title') is distinct from 'string' or notice_title='')) then
  raise exception 'Enter a title between 1 and 100 characters';
 end if;$new$;
begin
 if position(old_title in definition)=0 or position(old_check in definition)=0 then
  raise exception 'Expected the existing notice title validation';
 end if;
 execute replace(replace(definition,old_title,new_title),old_check,new_check);
end;
$artwork_only$;
