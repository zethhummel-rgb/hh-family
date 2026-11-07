-- Preserve historical ingredient text; structured amounts are optional.
create or replace function private.meal_ingredients_valid(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; seen text[]:=array[]::text[];
begin
 if value is null or jsonb_typeof(value)<>'array' then return false;end if;
 if jsonb_array_length(value)>60 then return false;end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' or (item-array['id','title','category','quantity','unit'])<>'{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string'
   or jsonb_typeof(item->'title') is distinct from 'string'
   or jsonb_typeof(item->'category') is distinct from 'string' then return false;end if;
  if (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (item->>'id')=any(seen) or char_length(item->>'title') not between 1 and 160
   or private.grocery_title_key(item->>'title')=''
   or (item->>'category') not in ('Produce','Dairy & eggs','Deli','Meat & fish','Bakery','Pantry','Frozen','Household','Other') then return false;end if;
  if item ? 'quantity' and jsonb_typeof(item->'quantity') not in ('null','number') then return false;end if;
  if item->>'quantity' is not null then
   if (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>9999 or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,3) then return false;end if;
  end if;
  if item ? 'unit' and jsonb_typeof(item->'unit') not in ('null','string') then return false;end if;
  if item->>'unit' is not null and (item->>'quantity' is null or char_length(item->>'unit') not between 1 and 30 or btrim(item->>'unit')='' or item->>'unit'<>btrim(item->>'unit')) then return false;end if;
  seen:=array_append(seen,item->>'id');
 end loop;
 return true;
end;$$;
revoke all on function private.meal_ingredients_valid(jsonb) from public,anon;
grant execute on function private.meal_ingredients_valid(jsonb) to authenticated;


notify pgrst,'reload schema';

create or replace function public.add_meal_ingredients(hid uuid,selections jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare selection jsonb; ingredient jsonb; ingredient_id jsonb; plan public.household_meal_plans;
 plan_ids uuid[]:=array[]::uuid[]; selected_ids text[]; resolved jsonb:='[]'::jsonb;
 total integer:=0; found_plans integer:=0; matched integer; added integer:=0; skipped integer:=0;
begin
 if auth.uid() is null or not private.is_member(hid) then raise exception 'Household membership required';end if;
 if selections is null or jsonb_typeof(selections)<>'array' then raise exception 'Choose ingredients from your saved dinner plans';end if;
 if jsonb_array_length(selections) not between 1 and 100 then raise exception 'Choose between 1 and 100 ingredients';end if;
 for selection in select * from jsonb_array_elements(selections) loop
  if jsonb_typeof(selection)<>'object' or (selection-array['meal_id','version','ingredient_ids'])<>'{}'::jsonb
   or jsonb_typeof(selection->'meal_id') is distinct from 'string'
   or (selection->>'meal_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(selection->'version') is distinct from 'number'
   or (selection->>'version') !~ '^[1-9][0-9]{0,9}$'
   or jsonb_typeof(selection->'ingredient_ids') is distinct from 'array' then raise exception 'Check your selected dinner plans';end if;
  if (selection->>'version')::numeric>2147483647 or (selection->>'meal_id')::uuid=any(plan_ids)
   or jsonb_array_length(selection->'ingredient_ids') not between 1 and 60 then raise exception 'Check your selected dinner plans';end if;
  plan_ids:=array_append(plan_ids,(selection->>'meal_id')::uuid);selected_ids:=array[]::text[];
  for ingredient_id in select * from jsonb_array_elements(selection->'ingredient_ids') loop
   if jsonb_typeof(ingredient_id)<>'string' or (ingredient_id#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (ingredient_id#>>'{}')=any(selected_ids) then raise exception 'Check your selected ingredients';end if;
   selected_ids:=array_append(selected_ids,ingredient_id#>>'{}');
  end loop;
  total:=total+cardinality(selected_ids);
 end loop;
 if total>100 then raise exception 'Choose no more than 100 ingredients at a time';end if;
 if private.household_transition_active(hid) or not private.household_transition_write_open(hid) then raise exception 'Finish the household transfer before adding meal ingredients to the shopping list';end if;

 -- Share the staples lock, then resolve and lock every selected snapshot before
 -- any grocery insert. Stale, removed, or foreign selections fail as one batch.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(hid::text,816441));
 for plan in select * from public.household_meal_plans where household_id=hid and id=any(plan_ids) order by id for share loop
  found_plans:=found_plans+1;
  select value into selection from jsonb_array_elements(selections) where value->>'meal_id'=plan.id::text;
  if plan.version<>(selection->>'version')::integer then raise exception 'Meal plan changed. Refresh and choose ingredients again';end if;
  selected_ids:=array(select jsonb_array_elements_text(selection->'ingredient_ids'));matched:=0;
  for ingredient in select value from jsonb_array_elements(plan.ingredients) where value->>'id'=any(selected_ids) loop
   resolved:=resolved||jsonb_build_array(ingredient);matched:=matched+1;
  end loop;
  if matched<>cardinality(selected_ids) then raise exception 'Meal plan changed. Refresh and choose ingredients again';end if;
 end loop;
 if found_plans<>cardinality(plan_ids) then raise exception 'Meal plan changed. Refresh and choose ingredients again';end if;

 -- Sum compatible quantities across the selected plans. Unknown quantities and
 -- different units stay separate. The same exact resulting line remains idempotent.
 for ingredient in
  select jsonb_build_object('title',min(btrim(value->>'title')),'category',min(value->>'category'),
   'quantity',sum((value->>'quantity')::numeric),'unit',min(nullif(btrim(value->>'unit'),'')))
  from jsonb_array_elements(resolved)
  group by private.grocery_title_key(value->>'title'),lower(btrim(coalesce(value->>'unit',''))),(value->>'quantity' is null)
 loop
  if (ingredient->>'quantity')::numeric>9999 then raise exception 'A combined quantity is above 9999. Choose fewer meals';end if;
  if exists(select 1 from public.household_items where household_id=hid and kind='grocery' and not done and private.grocery_title_key(title)=private.grocery_title_key(ingredient->>'title') and grocery_quantity is not distinct from (ingredient->>'quantity')::numeric and lower(btrim(coalesce(grocery_unit,'')))=lower(btrim(coalesce(ingredient->>'unit','')))) then
   skipped:=skipped+1;
  else
   insert into public.household_items(household_id,kind,title,category,person,grocery_quantity,grocery_unit) values(hid,'grocery',ingredient->>'title',ingredient->>'category','Everyone',(ingredient->>'quantity')::numeric,ingredient->>'unit');
   added:=added+1;
  end if;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end;$$;
revoke all on function public.add_meal_ingredients(uuid,jsonb) from public,anon;
grant execute on function public.add_meal_ingredients(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
