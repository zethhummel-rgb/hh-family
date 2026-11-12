-- Short-lived delivery records contain only hashes and prevent duplicate emails.
create table private.pilot_request_delivery (
 id uuid primary key,
 email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'sending' check (status in ('sending','sent','uncertain')),
 created_at timestamptz not null default now()
);
create index pilot_request_delivery_email_time on private.pilot_request_delivery(email_hash,created_at);
create index pilot_request_delivery_time on private.pilot_request_delivery(created_at);
alter table private.pilot_request_delivery enable row level security;
revoke all on private.pilot_request_delivery from public,anon,authenticated;

create function private.pilot_request_mail_service(action text,payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare
 request_id uuid := (payload->>'id')::uuid;
 sender_hash text := payload->>'emailHash';
 request_hash text := payload->>'contentHash';
 existing private.pilot_request_delivery%rowtype;
begin
 if request_id is null then raise exception 'Request ID required'; end if;
 if action='finish' then
  if (payload->>'status') is null or (payload->>'status') not in ('sent','uncertain') then
   raise exception 'Invalid delivery status';
  end if;
  update private.pilot_request_delivery set status=payload->>'status' where id=request_id and status='sending';
  return 'finished';
 end if;
 if action is distinct from 'claim' then raise exception 'Invalid action'; end if;

 -- Keep the two quota checks and the claim atomic across concurrent requests.
 lock table private.pilot_request_delivery in share row exclusive mode;
 delete from private.pilot_request_delivery where created_at<now()-interval '7 days';
 select * into existing from private.pilot_request_delivery where id=request_id;
 if found then
  if existing.email_hash is distinct from sender_hash or existing.content_hash is distinct from request_hash then
   return 'mismatch';
  end if;
  if existing.status='sending' and existing.created_at<now()-interval '2 minutes' then return 'uncertain'; end if;
  return existing.status;
 end if;
 if (select count(*) from private.pilot_request_delivery where email_hash=sender_hash and created_at>now()-interval '1 hour')>=3
  or (select count(*) from private.pilot_request_delivery where created_at>now()-interval '1 hour')>=30 then
  return 'limited';
 end if;
 insert into private.pilot_request_delivery(id,email_hash,content_hash) values(request_id,sender_hash,request_hash);
 return 'claimed';
end $$;
revoke all on function private.pilot_request_mail_service(text,jsonb) from public,anon,authenticated;
grant execute on function private.pilot_request_mail_service(text,jsonb) to service_role;

create function public.pilot_request_mail_service(action text,payload jsonb) returns text
language sql security invoker set search_path='' as $$select private.pilot_request_mail_service(action,payload)$$;
revoke all on function public.pilot_request_mail_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.pilot_request_mail_service(text,jsonb) to service_role;
