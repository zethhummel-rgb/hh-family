-- Outlook is a mirror of HH. Only mapped HH events can receive an Outlook edit.
create or replace function public.outlook_calendar(action text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select case
  when action='match' or (action='receive' and payload->>'eventId' is null) then 'false'::jsonb
  else private.outlook_calendar(action,payload)
 end;
$$;
