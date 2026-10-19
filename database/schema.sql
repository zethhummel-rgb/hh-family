-- Fresh HH pilot project only. Never run against an existing family or work database.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.households (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 80),
 owner_id uuid not null references auth.users(id), calendar_id text not null default '' check(char_length(calendar_id)<=300), created_at timestamptz not null default now()
);
create table public.household_members (
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 60),
 role text not null check(role in ('owner','member')), joined_at timestamptz not null default now()
);
create index household_members_household_idx on public.household_members(household_id);
create index households_owner_idx on public.households(owner_id);
create table public.household_items (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 kind text not null check(kind in ('grocery','task')), title text not null check(char_length(title) between 1 and 160),
 category text not null default 'Other' check(category in ('Produce','Dairy & eggs','Meat & fish','Bakery','Pantry','Frozen','Household','Other')),
 person text not null default 'Everyone' check(char_length(person) between 1 and 60), due date, done boolean not null default false,
 created_at timestamptz not null default now()
);
create index household_items_household_idx on public.household_items(household_id,created_at);
create table public.household_invites (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 email text not null check(char_length(email) between 3 and 254), token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '7 days', used_at timestamptz, created_at timestamptz not null default now()
);
create index household_invites_household_idx on public.household_invites(household_id);
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_items enable row level security;
alter table public.household_invites enable row level security;
-- Private membership lookup avoids recursive membership RLS. Only the signed-in caller can be checked.
create function private.is_member(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.household_members where household_id=hid and user_id=(select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public,anon;
grant execute on function private.is_member(uuid) to authenticated;
create policy household_read on public.households for select to authenticated using(private.is_member(id));
create policy household_owner_update on public.households for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy member_read on public.household_members for select to authenticated using(private.is_member(household_id));
create policy item_read on public.household_items for select to authenticated using(private.is_member(household_id));
create policy item_add on public.household_items for insert to authenticated with check(private.is_member(household_id));
create policy item_update on public.household_items for update to authenticated using(private.is_member(household_id)) with check(private.is_member(household_id));
create policy item_delete on public.household_items for delete to authenticated using(private.is_member(household_id));
create policy invite_owner_read on public.household_invites for select to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
create policy invite_owner_delete on public.household_invites for delete to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
revoke all on public.households,public.household_members,public.household_items,public.household_invites from anon,authenticated;
grant select on public.households,public.household_members to authenticated;
grant update(calendar_id) on public.households to authenticated;
grant select,delete on public.household_invites to authenticated;
grant select,insert,delete on public.household_items to authenticated;
grant update(title,category,person,due,done) on public.household_items to authenticated;
-- Atomic onboarding and email-bound invitation redemption need controlled elevated writes.
create function private.create_household(household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name'; end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 return hid;
end; $$;
create function private.create_household_invite(invite_email text) returns text language plpgsql security definer set search_path='' as $$
declare hid uuid; raw_token text; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first'; end if;
 select h.id into hid from public.households h join public.household_members m on m.household_id=h.id where m.user_id=uid and h.owner_id=uid;
 if hid is null then raise exception 'Only the household owner can invite members'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from public.household_invites where household_id=hid and used_at is null and expires_at>now())>=20 then raise exception 'Revoke an unused invitation before creating another'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.household_invites(household_id,email,token_hash) values(hid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return raw_token;
end; $$;
create function private.accept_household_invite(invite_token text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.household_invites%rowtype; uid uuid:=auth.uid(); current_email text;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 select lower(email) into current_email from auth.users where id=uid and email_confirmed_at is not null;
 if current_email is null then raise exception 'Confirm your email before joining'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if invite_token is null or char_length(invite_token)<>64 then raise exception 'Invitation is invalid or expired'; end if;
 if member_name is null or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name'; end if;
 select * into inv from public.household_invites where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and used_at is null and expires_at>now() for update;
 if not found or inv.email<>current_email then raise exception 'Invitation is invalid, expired, or belongs to a different email'; end if;
 insert into public.household_members(household_id,user_id,display_name,role) values(inv.household_id,uid,trim(member_name),'member');
 update public.household_invites set used_at=now() where id=inv.id;
 return inv.household_id;
end; $$;
revoke all on function private.create_household(text,text),private.create_household_invite(text),private.accept_household_invite(text,text) from public,anon;
grant execute on function private.create_household(text,text),private.create_household_invite(text),private.accept_household_invite(text,text) to authenticated;
-- Public API wrappers retain invoker privileges; elevated implementations stay in the private schema.
create function public.create_household(household_name text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.create_household(household_name,member_name);$$;
create function public.create_household_invite(invite_email text) returns text language sql security invoker set search_path='' as $$select private.create_household_invite(invite_email);$$;
create function public.accept_household_invite(invite_token text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.accept_household_invite(invite_token,member_name);$$;
revoke all on function public.create_household(text,text),public.create_household_invite(text),public.accept_household_invite(text,text) from public,anon;
grant execute on function public.create_household(text,text),public.create_household_invite(text),public.accept_household_invite(text,text) to authenticated;
