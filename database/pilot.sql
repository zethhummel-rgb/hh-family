-- Fresh HH pilot only. Apply after schema.sql. Never apply to Hummel Home.
create table private.pilot_hosts (
 email text primary key check(email=lower(trim(email)))
);
create table private.pilot_invites (
 id uuid primary key default gen_random_uuid(),
 host_user_id uuid not null references auth.users(id),
 email text not null, token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '14 days',
 used_at timestamptz, household_id uuid references public.households(id),
 created_at timestamptz not null default now()
);
create index pilot_invites_host on private.pilot_invites(host_user_id);
create index pilot_invites_home on private.pilot_invites(household_id);
alter table private.pilot_hosts enable row level security;
alter table private.pilot_invites enable row level security;
revoke all on private.pilot_hosts,private.pilot_invites from public,anon,authenticated;
create function private.is_pilot_host() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join private.pilot_hosts h on h.email=lower(u.email) where u.id=(select auth.uid()) and u.email_confirmed_at is not null);
$$;
revoke all on function private.is_pilot_host() from public,anon;
grant execute on function private.is_pilot_host() to authenticated;
create function public.pilot_status() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('is_host',private.is_pilot_host());
$$;
revoke all on function public.pilot_status() from public,anon;
grant execute on function public.pilot_status() to authenticated;
-- The host can make their own first home; other families must redeem an invitation.
create or replace function private.create_household(household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; uid uuid:=auth.uid();
begin
 if uid is null or not private.is_pilot_host() then raise exception 'New households are invitation-only. Open your invitation link.'; end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household'; end if;
 if household_name is null or member_name is null or char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name'; end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 return hid;
end;$$;
create function private.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); raw_token text;
begin
 if uid is null or not private.is_pilot_host() then raise exception 'Pilot host access required'; end if;
 -- Serialize slot allocation across devices.
 perform 1 from private.pilot_hosts h join auth.users u on lower(u.email)=h.email where u.id=uid for update of h;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'used_at',i.used_at) order by i.created_at desc) from private.pilot_invites i where i.host_user_id=uid),'[]'::jsonb);
 elsif action='revoke' then
  delete from private.pilot_invites where id=invitation_id and host_user_id=uid and used_at is null;
  return '{}'::jsonb;
 elsif action<>'create' then raise exception 'Unsupported pilot request'; end if;
 if invite_email is null or char_length(trim(invite_email))>254 or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if (select count(*) from private.pilot_invites where host_user_id=uid and (used_at is not null or expires_at>now()))>=3 then raise exception 'This pilot has room for three invited households. Revoke an unused invitation to free a place.'; end if;
 if exists(select 1 from private.pilot_invites where email=lower(trim(invite_email)) and (used_at is not null or expires_at>now())) then raise exception 'This email already has a pilot invitation'; end if;
 raw_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.pilot_invites(host_user_id,email,token_hash) values(uid,lower(trim(invite_email)),encode(sha256(convert_to(raw_token,'UTF8')),'hex'));
 return jsonb_build_object('token',raw_token);
end;$$;
create function private.create_pilot_household(pilot_token text,household_name text,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current_email text; inv private.pilot_invites%rowtype; hid uuid;
begin
 if uid is null then raise exception 'Sign in first';end if;
 select lower(email) into current_email from auth.users where id=uid and email_confirmed_at is not null;
 if current_email is null then raise exception 'Confirm your email before creating your home';end if;
 if exists(select 1 from public.household_members where user_id=uid) then raise exception 'You already belong to a household';end if;
 if pilot_token is null or char_length(pilot_token)<>64 then raise exception 'Invitation is invalid or expired';end if;
 if household_name is null or member_name is null or char_length(trim(household_name)) not between 1 and 80 or char_length(trim(member_name)) not between 1 and 60 then raise exception 'Enter your name and household name';end if;
 select * into inv from private.pilot_invites where token_hash=encode(sha256(convert_to(pilot_token,'UTF8')),'hex') and used_at is null and expires_at>now() for update;
 if not found or inv.email<>current_email then raise exception 'Invitation is invalid, expired, or belongs to another email';end if;
 insert into public.households(name,owner_id) values(trim(household_name),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,display_name,role) values(hid,uid,trim(member_name),'owner');
 update private.pilot_invites set used_at=now(),household_id=hid where id=inv.id;
 return hid;
end;$$;
revoke all on function private.pilot_invitations(text,text,uuid),private.create_pilot_household(text,text,text) from public,anon;
grant execute on function private.pilot_invitations(text,text,uuid),private.create_pilot_household(text,text,text) to authenticated;
create function public.pilot_invitations(action text,invite_email text default null,invitation_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.pilot_invitations(action,invite_email,invitation_id);$$;
create function public.create_pilot_household(pilot_token text,household_name text,member_name text) returns uuid language sql security invoker set search_path='' as $$select private.create_pilot_household(pilot_token,household_name,member_name);$$;
revoke all on function public.pilot_invitations(text,text,uuid),public.create_pilot_household(text,text,text) from public,anon;
grant execute on function public.pilot_invitations(text,text,uuid),public.create_pilot_household(text,text,text) to authenticated;
-- Owner-controlled profiles for children or other family members without a login.
alter table public.household_members add constraint member_home_user_unique unique(household_id,user_id);
create table public.household_people (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 display_name text not null check(char_length(trim(display_name)) between 1 and 60),
 calendar_color text not null check(calendar_color~'^#[0-9A-Fa-f]{6}$'), linked_user_id uuid,
 created_at timestamptz not null default now(),
 foreign key(household_id,linked_user_id) references public.household_members(household_id,user_id)
);
create index household_people_home on public.household_people(household_id);
create index household_people_linked_user on public.household_people(household_id,linked_user_id);
alter table public.household_people enable row level security;
revoke all on public.household_people from public,anon,authenticated;
grant select on public.household_people to authenticated;
grant update(display_name,calendar_color,linked_user_id) on public.household_people to authenticated;
create policy people_read on public.household_people for select to authenticated using(private.is_member(household_id));
create policy people_owner_update on public.household_people for update to authenticated
 using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())))
 with check(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
create function private.add_household_person(person_name text,person_color text) returns uuid language plpgsql security definer set search_path='' as $$
declare hid uuid; pid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in first';end if;
 select id into hid from public.households where owner_id=uid for update;
 if hid is null then raise exception 'Only the household owner can add family profiles';end if;
 if (select count(*) from public.household_people where household_id=hid)>=20 then raise exception 'This home already has twenty family profiles';end if;
 if person_name is null or char_length(trim(person_name)) not between 1 and 60 or person_color is null or person_color!~'^#[0-9A-Fa-f]{6}$' then raise exception 'Enter a name and valid colour';end if;
 insert into public.household_people(household_id,display_name,calendar_color) values(hid,trim(person_name),person_color) returning id into pid;
 return pid;
end;$$;
revoke all on function private.add_household_person(text,text) from public,anon;
grant execute on function private.add_household_person(text,text) to authenticated;
create function public.add_household_person(person_name text,person_color text) returns uuid language sql security invoker set search_path='' as $$select private.add_household_person(person_name,person_color);$$;
revoke all on function public.add_household_person(text,text) from public,anon;
grant execute on function public.add_household_person(text,text) to authenticated;
grant update(name) on public.households to authenticated;

alter table public.households add constraint household_name_not_blank check(char_length(trim(name))>=1);
grant all on public.household_people to service_role;
