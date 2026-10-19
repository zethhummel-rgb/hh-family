-- Keep completed repeats waiting until the next Eastern calendar date.
create or replace function private.maintain_reminder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.reminder_version:=1;new.repeat_anchor:=new.due;new.last_completed_at:=null;
 elsif new.kind='task' then
  -- The previous occurrence is done. A repeat cannot be completed again before
  -- its next date, even by an old client or a second family member.
  if new.done and not old.done and old.repeat_unit<>'none'
    and old.last_completed_at is not null
    and old.due>(now() at time zone 'America/Toronto')::date then
   return old;
  end if;
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
