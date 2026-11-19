create table private.event_address_monthly_usage (
 billing_month date primary key,
 requests integer not null check (requests between 1 and 8500)
);

create table private.event_address_member_limit (
 user_id uuid primary key references auth.users(id) on delete cascade,
 minute timestamptz not null,
 requests smallint not null check (requests between 1 and 18)
);

alter table private.event_address_monthly_usage enable row level security;
alter table private.event_address_member_limit enable row level security;
revoke all on private.event_address_monthly_usage,private.event_address_member_limit from public,anon,authenticated;

-- Each accepted reservation permits exactly one autocomplete request. A
-- conditional upsert enforces the cap across concurrent Edge instances.
create function private.reserve_event_address_request(actor uuid, monthly_limit integer) returns text
language plpgsql security definer set search_path='' as $$
declare
 current_minute timestamptz := date_trunc('minute',statement_timestamp());
 billing_month date := date_trunc('month',statement_timestamp() at time zone 'America/Los_Angeles')::date;
begin
 if monthly_limit is null or monthly_limit not between 1 and 8500 then raise exception 'Invalid address request cap';end if;
 if not exists(select 1 from public.household_members where user_id=actor) then return 'forbidden';end if;

 insert into private.event_address_member_limit as member_limit(user_id,minute,requests)
 values(actor,current_minute,1)
 on conflict(user_id) do update
 set minute=excluded.minute,requests=case when member_limit.minute=excluded.minute then member_limit.requests+1 else 1 end
 where member_limit.minute<excluded.minute
    or (member_limit.minute=excluded.minute and member_limit.requests<18);
 if not found then return 'rate_limited';end if;

 insert into private.event_address_monthly_usage as usage(billing_month,requests)
 values(billing_month,1)
 on conflict on constraint event_address_monthly_usage_pkey
 do update set requests=usage.requests+1 where usage.requests<monthly_limit;
 if not found then return 'paused';end if;
 return 'allowed';
end;$$;

create function public.reserve_event_address_request(actor uuid,monthly_limit integer) returns text
language sql security invoker set search_path='' as $$
 select private.reserve_event_address_request(actor,monthly_limit);
$$;
revoke all on function private.reserve_event_address_request(uuid,integer),public.reserve_event_address_request(uuid,integer) from public,anon,authenticated;
grant execute on function private.reserve_event_address_request(uuid,integer),public.reserve_event_address_request(uuid,integer) to service_role;
notify pgrst,'reload schema';
