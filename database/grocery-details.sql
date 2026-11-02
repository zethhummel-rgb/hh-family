-- Additive grocery details; null defaults preserve existing rows and old transfer snapshots.
alter table public.household_items
 add column grocery_quantity numeric,
 add column grocery_unit text,
 add column grocery_store text,
 add constraint grocery_quantity_valid check(grocery_quantity is null or (grocery_quantity>0 and grocery_quantity<=9999 and grocery_quantity=round(grocery_quantity,3))),
 add constraint grocery_unit_valid check(grocery_unit is null or (grocery_quantity is not null and char_length(btrim(grocery_unit)) between 1 and 30)),
 add constraint grocery_store_valid check(grocery_store is null or char_length(btrim(grocery_store)) between 1 and 80),
 add constraint grocery_details_kind check(kind='grocery' or (grocery_quantity is null and grocery_unit is null and grocery_store is null));
grant update(grocery_quantity,grocery_unit,grocery_store) on public.household_items to authenticated;
alter table public.household_items drop constraint household_items_category_check;
alter table public.household_items add constraint household_items_category_check check(category in ('Produce','Dairy & eggs','Deli','Meat & fish','Bakery','Pantry','Frozen','Household','Other'));
alter table public.household_grocery_staples drop constraint household_grocery_staples_category_check;
alter table public.household_grocery_staples add constraint household_grocery_staples_category_check check(category in ('Produce','Dairy & eggs','Deli','Meat & fish','Bakery','Pantry','Frozen','Household','Other'));

-- Use the existing item revision: old clients also advance it on grocery edits.
-- The task reminder trigger still owns task revisions and recurrence.
create function private.maintain_grocery_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('postgres','service_role') and current_setting('hh.transition_import',true)=new.household_id::text then return new;end if;
 if new.kind='grocery' then new.reminder_version:=old.reminder_version+1;end if;
 return new;
end;$$;
revoke all on function private.maintain_grocery_revision() from public,anon,authenticated;
create trigger household_grocery_revision before update on public.household_items for each row execute function private.maintain_grocery_revision();

create or replace function private.meal_ingredients_valid(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; seen text[]:=array[]::text[];
begin
 if value is null or jsonb_typeof(value)<>'array' then return false;end if;
 if jsonb_array_length(value)>60 then return false;end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' or (item-array['id','title','category'])<>'{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string'
   or jsonb_typeof(item->'title') is distinct from 'string'
   or jsonb_typeof(item->'category') is distinct from 'string' then return false;end if;
  if (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (item->>'id')=any(seen) or char_length(item->>'title') not between 1 and 160
   or private.grocery_title_key(item->>'title')=''
   or (item->>'category') not in ('Produce','Dairy & eggs','Deli','Meat & fish','Bakery','Pantry','Frozen','Household','Other') then return false;end if;
  seen:=array_append(seen,item->>'id');
 end loop;
 return true;
end;$$;
revoke all on function private.meal_ingredients_valid(jsonb) from public,anon;
grant execute on function private.meal_ingredients_valid(jsonb) to authenticated;


notify pgrst,'reload schema';
