-- Native repeats retain the existing household RLS and optimistic version checks.
alter table public.household_events add column recurrence text[] not null default '{}';
alter table public.household_events add column exceptions jsonb not null default '{}';
grant update(recurrence,exceptions) on public.household_events to authenticated;

create function private.validate_native_event_repeats() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rule text; pair record; item public.household_events; k text; until_value text;
begin
 if cardinality(new.recurrence)>1 or array_position(new.recurrence,null) is not null then
  raise exception 'Choose one supported repeat pattern';
 end if;
 if cardinality(new.recurrence)=1 then
  rule:=new.recurrence[1];
  if rule !~ '^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY);INTERVAL=[1-9][0-9]{0,2}(;COUNT=[1-9][0-9]{0,3}|;UNTIL=[0-9]{8}(T[0-9]{6}Z)?)?$' then
   raise exception 'Choose a supported repeat pattern';
  end if;
  until_value:=substring(rule from 'UNTIL=([0-9]{8})');
  if until_value is not null then
   perform (substring(until_value,1,4)||'-'||substring(until_value,5,2)||'-'||substring(until_value,7,2))::date;
   if new.all_day <> (rule !~ 'T[0-9]{6}Z$') then raise exception 'Repeat ending does not match event type'; end if;
  end if;
 end if;
 if jsonb_typeof(new.exceptions)<>'object' or octet_length(new.exceptions::text)>500000 then raise exception 'Too many changed occurrences';end if;
 for pair in select * from jsonb_each(new.exceptions) loop
  if pair.key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid occurrence date';end if;
  perform pair.key::date;
  if pair.value='null'::jsonb then continue;end if;
  if jsonb_typeof(pair.value)<>'object' then raise exception 'Invalid occurrence details';end if;
  for k in select jsonb_object_keys(pair.value) loop
   if k not in ('title','description','location','person','person_ids','reminder_minutes','starts_at','ends_at','all_day','start_date','end_date') then raise exception 'Invalid occurrence field';end if;
  end loop;
  item:=jsonb_populate_record(null::public.household_events,pair.value);
  if item.title is null or char_length(item.title) not between 1 and 160 or item.description is null or char_length(item.description)>4000 or item.location is null or char_length(item.location)>300 or item.person is null or char_length(item.person) not between 1 and 60 or item.starts_at is null or item.ends_at is null or item.ends_at<=item.starts_at or item.all_day is null then raise exception 'Check occurrence details';end if;
  if (item.all_day and (item.start_date is null or item.end_date is null or item.end_date<=item.start_date)) or (not item.all_day and (item.start_date is not null or item.end_date is not null)) then raise exception 'Invalid occurrence dates';end if;
  if item.reminder_minutes is not null and item.reminder_minutes not between 0 and 10080 then raise exception 'Invalid reminder';end if;
  if cardinality(item.person_ids)>20 or array_position(item.person_ids,null) is not null then raise exception 'Invalid event people';end if;
 end loop;
 return new;
end $$;
revoke all on function private.validate_native_event_repeats() from public,anon,authenticated;
create trigger validate_native_event_repeats before insert or update on public.household_events for each row execute function private.validate_native_event_repeats();
