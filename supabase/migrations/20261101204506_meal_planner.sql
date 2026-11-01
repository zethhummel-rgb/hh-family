-- Dinner plans are independent snapshots, so saved-meal edits never rewrite plans.
create function private.meal_ingredients_valid(value jsonb) returns boolean
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
   or (item->>'category') not in ('Produce','Dairy & eggs','Meat & fish','Bakery','Pantry','Frozen','Household','Other') then return false;end if;
  seen:=array_append(seen,item->>'id');
 end loop;
 return true;
end;$$;
revoke all on function private.meal_ingredients_valid(jsonb) from public,anon;
grant execute on function private.meal_ingredients_valid(jsonb) to authenticated;

create function private.meal_source_url_valid(value text) returns boolean
language sql immutable strict security invoker set search_path='' as $$
 select char_length(value)<=2048 and (value='' or (
  value ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  and value !~ U&'[\0001-\0020\007F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
  and strpos(value,chr(92))=0));
$$;
revoke all on function private.meal_source_url_valid(text) from public,anon;
grant execute on function private.meal_source_url_valid(text) to authenticated;

create table public.household_meal_recipes (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160 and private.grocery_title_key(title)<>''),
 instructions text not null default '' check(char_length(instructions)<=10000),
 source_url text not null default '' check(private.meal_source_url_valid(source_url)),
 ingredients jsonb not null default '[]'::jsonb check(private.meal_ingredients_valid(ingredients)),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index household_meal_recipes_home_id_idx on public.household_meal_recipes(household_id,id);
create table public.household_meal_plans (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 meal_date date not null check(meal_date between date '0001-01-01' and date '9999-12-31'),
 title text not null check(char_length(title) between 1 and 160 and private.grocery_title_key(title)<>''),
 instructions text not null default '' check(char_length(instructions)<=10000),
 source_url text not null default '' check(private.meal_source_url_valid(source_url)),
 ingredients jsonb not null default '[]'::jsonb check(private.meal_ingredients_valid(ingredients)),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 unique(household_id,meal_date)
);
create index household_meal_plans_home_id_idx on public.household_meal_plans(household_id,id);

alter table public.household_meal_recipes enable row level security;
alter table public.household_meal_plans enable row level security;
create policy meal_recipes_read on public.household_meal_recipes for select to authenticated using(private.is_member(household_id));
create policy meal_recipes_add on public.household_meal_recipes for insert to authenticated with check(private.is_member(household_id));
create policy meal_recipes_update on public.household_meal_recipes for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy meal_recipes_delete on public.household_meal_recipes for delete to authenticated using(private.is_member(household_id));
create policy meal_plans_read on public.household_meal_plans for select to authenticated using(private.is_member(household_id));
create policy meal_plans_add on public.household_meal_plans for insert to authenticated with check(private.is_member(household_id));
create policy meal_plans_update on public.household_meal_plans for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy meal_plans_delete on public.household_meal_plans for delete to authenticated using(private.is_member(household_id));
revoke all on public.household_meal_recipes,public.household_meal_plans from public,anon,authenticated;
grant select,delete on public.household_meal_recipes,public.household_meal_plans to authenticated;
grant insert(household_id,title,instructions,source_url,ingredients),update(title,instructions,source_url,ingredients) on public.household_meal_recipes to authenticated;
grant insert(household_id,meal_date,title,instructions,source_url,ingredients),update(meal_date,title,instructions,source_url,ingredients) on public.household_meal_plans to authenticated;

create function private.maintain_meal_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.version:=1;new.created_at:=clock_timestamp();new.updated_at:=new.created_at;
 else
  new.version:=old.version+1;new.created_at:=old.created_at;new.updated_at:=clock_timestamp();
 end if;
 return new;
end;$$;
revoke all on function private.maintain_meal_revision() from public,anon,authenticated;
create trigger meal_recipe_revision before insert or update on public.household_meal_recipes for each row execute function private.maintain_meal_revision();
create trigger meal_plan_revision before insert or update on public.household_meal_plans for each row execute function private.maintain_meal_revision();

create function public.add_meal_ingredients(hid uuid,selections jsonb) returns jsonb
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

 for ingredient in select * from jsonb_array_elements(resolved) loop
  if exists(select 1 from public.household_items where household_id=hid and kind='grocery' and not done and private.grocery_title_key(title)=private.grocery_title_key(ingredient->>'title')) then
   skipped:=skipped+1;
  else
   insert into public.household_items(household_id,kind,title,category,person) values(hid,'grocery',ingredient->>'title',ingredient->>'category','Everyone');
   added:=added+1;
  end if;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end;$$;
revoke all on function public.add_meal_ingredients(uuid,jsonb) from public,anon;
grant execute on function public.add_meal_ingredients(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
