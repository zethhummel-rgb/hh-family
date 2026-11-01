-- Saved grocery templates belong to one household; they are not shopping-list items.
create function private.grocery_title_key(value text) returns text
language sql immutable strict parallel safe security invoker set search_path='' as $$
 -- Match JavaScript's whitespace set explicitly, including pasted nonbreaking
 -- spaces, rather than relying on the database locale's POSIX space class.
 select lower(btrim(regexp_replace(value,U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')));
$$;
revoke all on function private.grocery_title_key(text) from public,anon;
grant execute on function private.grocery_title_key(text) to authenticated;

create table public.household_grocery_staples (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160),
 category text not null default 'Other' check(category in ('Produce','Dairy & eggs','Meat & fish','Bakery','Pantry','Frozen','Household','Other')),
 title_key text generated always as (private.grocery_title_key(title)) stored check(title_key<>''),
 created_at timestamptz not null default now(),
 unique(household_id,title_key)
);
alter table public.household_grocery_staples enable row level security;
create policy grocery_staples_read on public.household_grocery_staples for select to authenticated using(private.is_member(household_id));
create policy grocery_staples_add on public.household_grocery_staples for insert to authenticated with check(private.is_member(household_id));
create policy grocery_staples_update on public.household_grocery_staples for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy grocery_staples_delete on public.household_grocery_staples for delete to authenticated using(private.is_member(household_id));
revoke all on public.household_grocery_staples from public,anon,authenticated;
grant select,delete on public.household_grocery_staples to authenticated;
grant insert(household_id,title,category),update(title,category) on public.household_grocery_staples to authenticated;

-- Existing open groceries count too, even if they were added manually or assigned
-- to a different category. Picked-up rows remain as shopping history.
create index household_items_open_grocery_title_idx on public.household_items(household_id,private.grocery_title_key(title)) where kind='grocery' and not done;

create function public.add_grocery_staples(hid uuid,staple_ids uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 selected public.household_grocery_staples[]:=array[]::public.household_grocery_staples[];
 staple public.household_grocery_staples; expected integer; added integer:=0; skipped integer:=0;
begin
 if auth.uid() is null or not private.is_member(hid) then raise exception 'Household membership required';end if;
 if staple_ids is null or cardinality(staple_ids) not between 1 and 100 or array_ndims(staple_ids)<>1 or array_position(staple_ids,null) is not null then raise exception 'Choose between 1 and 100 staples';end if;
 if private.household_transition_active(hid) or not private.household_transition_write_open(hid) then raise exception 'Finish the household transfer before adding staples to the shopping list';end if;

 -- All staple-add requests for this household wait here, so simultaneous taps
 -- recheck the committed open list instead of inserting the same staples twice.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(hid::text,816441));
 select count(distinct value) into expected from unnest(staple_ids) value;
 for staple in select * from public.household_grocery_staples where household_id=hid and id=any(staple_ids) order by id for share loop
  selected:=array_append(selected,staple);
 end loop;
 if cardinality(selected)<>expected then raise exception 'Some staples changed. Refresh and choose them again';end if;

 foreach staple in array selected loop
  if exists(select 1 from public.household_items where household_id=hid and kind='grocery' and not done and private.grocery_title_key(title)=staple.title_key) then
   skipped:=skipped+1;
  else
   insert into public.household_items(household_id,kind,title,category,person) values(hid,'grocery',staple.title,staple.category,'Everyone');
   added:=added+1;
  end if;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end;$$;
revoke all on function public.add_grocery_staples(uuid,uuid[]) from public,anon;
grant execute on function public.add_grocery_staples(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
