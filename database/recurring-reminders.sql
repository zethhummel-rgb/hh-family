-- Extend existing household tasks; existing tasks remain undated/silent unless configured.
alter table public.household_items
 add column if not exists reminder_time time without time zone,
 add column if not exists repeat_unit text not null default 'none' check(repeat_unit in ('none','day','week','month','year')),
 add column if not exists repeat_every integer not null default 1 check(repeat_every between 1 and 999),
 add column if not exists repeat_anchor date,
 add column if not exists reminder_version integer not null default 1,
 add column if not exists last_completed_at timestamptz,
 add column if not exists remind_at timestamptz generated always as ((due+reminder_time) at time zone 'America/Toronto') stored;
alter table public.household_items add constraint household_reminder_schedule check (
 (reminder_time is null or due is not null) and (repeat_unit='none' or due is not null)
 and (kind='task' or (reminder_time is null and repeat_unit='none'))
);
grant update(reminder_time,repeat_unit,repeat_every) on public.household_items to authenticated;
create index if not exists household_reminders_due on public.household_items(remind_at,household_id) where kind='task' and not done and reminder_time is not null;
create or replace function private.advance_reminder(anchor date,unit text,every integer,after_date date) returns date
language plpgsql immutable set search_path='' as $$
declare step integer; n integer; candidate date;
begin
 if anchor is null or after_date is null or every not between 1 and 999 then raise exception 'Invalid repeat schedule';end if;
 if unit in ('day','week') then
  step:=every*case when unit='week' then 7 else 1 end;
  n:=greatest(1,floor((after_date-anchor)::numeric/step)::integer+1);
  return anchor+n*step;
 elsif unit='month' then
  n:=greatest(1,floor(((extract(year from after_date)-extract(year from anchor))*12+extract(month from after_date)-extract(month from anchor))/every)::integer);
  candidate:=(anchor+make_interval(months=>n*every))::date;
  if candidate<=after_date then candidate:=(anchor+make_interval(months=>(n+1)*every))::date;end if;
  return candidate;
 elsif unit='year' then
  n:=greatest(1,floor((extract(year from after_date)-extract(year from anchor))/every)::integer);
  candidate:=(anchor+make_interval(years=>n*every))::date;
  if candidate<=after_date then candidate:=(anchor+make_interval(years=>(n+1)*every))::date;end if;
  return candidate;
 end if;
 raise exception 'Invalid repeat unit';
end$$;
revoke all on function private.advance_reminder(date,text,integer,date) from public,anon;
grant execute on function private.advance_reminder(date,text,integer,date) to authenticated,service_role;
create or replace function private.maintain_reminder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.reminder_version:=1;new.repeat_anchor:=new.due;new.last_completed_at:=null;
 elsif new.kind='task' then
  new.reminder_version:=old.reminder_version+1;new.last_completed_at:=old.last_completed_at;
  if new.done and not old.done then
   new.last_completed_at:=now();
   if new.repeat_unit<>'none' then
    -- Keep the original day anchor through shorter months and leap years.
    new.repeat_anchor:=coalesce(old.repeat_anchor,old.due);
    new.due:=private.advance_reminder(new.repeat_anchor,new.repeat_unit,new.repeat_every,greatest(old.due,(now() at time zone 'America/Toronto')::date));
    new.done:=false;
   end if;
  elsif new.due is distinct from old.due or new.repeat_unit<>old.repeat_unit or new.repeat_every<>old.repeat_every then
   new.repeat_anchor:=new.due;
  else new.repeat_anchor:=old.repeat_anchor;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.maintain_reminder() from public,anon,authenticated;
create trigger household_reminder_schedule before insert or update on public.household_items for each row execute function private.maintain_reminder();
