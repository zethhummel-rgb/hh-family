-- Shared plain-text notes stay with the household when an individual member leaves.
create table public.household_notes (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160 and title ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'),
 body text not null check(char_length(body) between 1 and 10000 and body ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'),
 pinned boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index household_notes_household_id_idx on public.household_notes(household_id,id);
alter table public.household_notes enable row level security;
create policy family_notes_read on public.household_notes for select to authenticated using(private.is_member(household_id));
create policy family_notes_add on public.household_notes for insert to authenticated with check(private.is_member(household_id));
create policy family_notes_update on public.household_notes for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy family_notes_delete on public.household_notes for delete to authenticated using(private.is_member(household_id));
revoke all on public.household_notes from public,anon,authenticated;
grant select,delete on public.household_notes to authenticated;
grant insert(household_id,title,body,pinned),update(title,body,pinned) on public.household_notes to authenticated;

-- Clients match the version they read when editing, pinning or deleting. The
-- trigger owns revisions/timestamps, so stale writes cannot forge a match.
create function private.maintain_family_note() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.version:=1;
  new.created_at:=clock_timestamp();
  new.updated_at:=new.created_at;
 else
  new.version:=old.version+1;
  new.created_at:=old.created_at;
  new.updated_at:=clock_timestamp();
 end if;
 return new;
end;$$;
revoke all on function private.maintain_family_note() from public,anon,authenticated;
create trigger household_note_revision before insert or update on public.household_notes
 for each row execute function private.maintain_family_note();
notify pgrst,'reload schema';
