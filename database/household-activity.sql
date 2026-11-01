-- A personal unread inbox, not a permanent household audit trail. No backfill.
create table public.household_activity (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 recipient_id uuid not null references public.household_members(user_id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 actor_name text not null check(char_length(actor_name) between 1 and 60),
 entity_kind text not null check(entity_kind in ('grocery','task','event','note','meal_plan','meal_recipe','staple','profile')),
 entity_id uuid not null,
 action text not null check(action in ('added','updated','completed','reopened','removed')),
 title text not null check(char_length(title) between 1 and 160),
 entity_date date,
 created_at timestamptz not null default clock_timestamp(),
 check(recipient_id<>actor_id)
);
create index household_activity_inbox_idx on public.household_activity(household_id,recipient_id,id);
create index household_activity_recipient_idx on public.household_activity(recipient_id);
create index household_activity_actor_idx on public.household_activity(actor_id);
create index household_activity_retention_idx on public.household_activity(household_id,created_at);
alter table public.household_activity enable row level security;
create policy activity_read on public.household_activity for select to authenticated
 using(recipient_id=(select auth.uid()) and private.is_member(household_id) and created_at>now()-interval '30 days');
create policy activity_seen on public.household_activity for delete to authenticated
 using(recipient_id=(select auth.uid()) and private.is_member(household_id));
revoke all on public.household_activity from public,anon,authenticated;
grant select,delete on public.household_activity to authenticated;

-- Only the database can supply the actor, household, recipient and summary.
-- Definer rights are needed solely to deliver to OTHER members' inboxes.
create function private.capture_household_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 before_row jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 item jsonb:=case when tg_op='DELETE' then before_row else after_row end;
 hid uuid:=(item->>'household_id')::uuid;
 actor uuid:=coalesce(auth.uid(),nullif(current_setting('hh.activity_actor',true),'')::uuid);
 who text; kind text; verb text; item_date date;
begin
 -- Maintenance/copy/reminder workers are not family members making changes.
 -- Also skip cascades when the household no longer exists.
 if actor is null or not exists(select 1 from public.households where id=hid) then return null;end if;
 select display_name into who from public.household_members where household_id=hid and user_id=actor;
 if who is null then return null;end if;
 if tg_op='UPDATE' and
  (after_row-array['version','reminder_version','created_at','updated_at','remind_at','title_key']) is not distinct from
  (before_row-array['version','reminder_version','created_at','updated_at','remind_at','title_key']) then return null;end if;
 kind:=case tg_table_name
  when 'household_items' then item->>'kind'
  when 'household_events' then 'event'
  when 'household_notes' then 'note'
  when 'household_meal_plans' then 'meal_plan'
  when 'household_meal_recipes' then 'meal_recipe'
  when 'household_grocery_staples' then 'staple'
  when 'household_people' then 'profile' end;
 if kind is null then return null;end if;
 verb:=case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'updated' end;
 if tg_table_name='household_items' and tg_op='UPDATE' then
  if (after_row->>'done')::boolean and not (before_row->>'done')::boolean
   or after_row->>'last_completed_at' is not null and after_row->>'last_completed_at' is distinct from before_row->>'last_completed_at' then verb:='completed';
  elsif not (after_row->>'done')::boolean and (before_row->>'done')::boolean then verb:='reopened';end if;
 end if;
 item_date:=case kind when 'meal_plan' then (item->>'meal_date')::date
  when 'task' then (item->>'due')::date
  when 'event' then coalesce((item->>'start_date')::date,((item->>'starts_at')::timestamptz at time zone 'America/Toronto')::date) end;
 -- Seen rows are deleted by their recipient. Old unread rows expire after 30
 -- days; cleanup stays bounded to the household currently being changed.
 delete from public.household_activity where household_id=hid and created_at<=clock_timestamp()-interval '30 days';
 insert into public.household_activity(household_id,recipient_id,actor_id,actor_name,entity_kind,entity_id,action,title,entity_date)
 select hid,m.user_id,actor,who,kind,(item->>'id')::uuid,verb,
  left(coalesce(item->>'title',item->>'display_name'),160),item_date
 from public.household_members m where m.household_id=hid and m.user_id<>actor;
 return null;
end;$$;
revoke all on function private.capture_household_activity() from public,anon,authenticated,service_role;
do $$declare target text;begin
 foreach target in array array['household_items','household_events','household_notes','household_meal_plans','household_meal_recipes','household_grocery_staples','household_people'] loop
  execute format('create trigger capture_household_activity after insert or update or delete on public.%I for each row execute function private.capture_household_activity()',target);
 end loop;
end;$$;

-- Imports run through a service-only, validated operation. Carry its actor
-- only for that call, so imported events have the same attribution as manual
-- additions. The existing private service still validates user/session/home.
create or replace function public.google_import_service(action text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous text:=current_setting('hh.activity_actor',true);result jsonb;
begin
 perform set_config('hh.activity_actor',case when action='commit' then payload->>'userId' else '' end,true);
 result:=private.google_import_service(action,payload);
 perform set_config('hh.activity_actor',coalesce(previous,''),true);
 return result;
end;$$;
revoke all on function public.google_import_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.google_import_service(text,jsonb) to service_role;
notify pgrst,'reload schema';
