-- Synthetic users and households only. The entire transaction is rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('10000000-0000-4000-8000-000000000001','host@hh-qa.invalid',now(),'{}'),
 ('10000000-0000-4000-8000-000000000002','owner@hh-qa.invalid',now(),'{}'),
 ('10000000-0000-4000-8000-000000000003','member@hh-qa.invalid',now(),'{}'),
 ('10000000-0000-4000-8000-000000000004','outsider@hh-qa.invalid',now(),'{}'),
 ('10000000-0000-4000-8000-000000000005','unconfirmed@hh-qa.invalid',null,'{}');
insert into private.pilot_hosts(email) values('host@hh-qa.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.home_a',public.create_household('QA first home','Host')::text,true);
select set_config('test.pilot',(public.pilot_invitations('create','owner@hh-qa.invalid')->>'token'),true);
select set_config('test.unconfirmed',(public.pilot_invitations('create','unconfirmed@hh-qa.invalid')->>'token'),true);
select public.pilot_invitations('create','extra@hh-qa.invalid');
do $$begin
 if (public.pilot_status()->>'is_host')::boolean is not true then raise exception 'Host not recognized';end if;
 begin perform public.pilot_invitations('create','fourth@hh-qa.invalid');raise exception 'CAP_BYPASSED';exception when others then if sqlerrm='CAP_BYPASSED' then raise;end if;end;
 if public.pilot_invitations('list')::text like '%'||current_setting('test.pilot')||'%' then raise exception 'Token leaked in list';end if;
end$$;
select public.pilot_invitations('revoke',null,(select (v->>'id')::uuid from jsonb_array_elements(public.pilot_invitations('list')) v where v->>'email'='extra@hh-qa.invalid'));
do $$begin if jsonb_array_length(public.pilot_invitations('list'))<>2 then raise exception 'Revoke failed';end if;end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
do $$begin
 begin perform public.create_pilot_household(current_setting('test.unconfirmed'),'QA blocked','Unconfirmed');raise exception 'UNCONFIRMED_ACCEPTED';exception when others then if sqlerrm='UNCONFIRMED_ACCEPTED' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$begin
 if exists(select 1 from public.households) then raise exception 'Outsider sees homes';end if;
 begin perform public.create_household('QA uninvited','Outsider');raise exception 'UNINVITED_ACCEPTED';exception when others then if sqlerrm='UNINVITED_ACCEPTED' then raise;end if;end;
 begin perform public.create_pilot_household(current_setting('test.pilot'),'QA wrong email','Outsider');raise exception 'WRONG_EMAIL_ACCEPTED';exception when others then if sqlerrm='WRONG_EMAIL_ACCEPTED' then raise;end if;end;
 begin perform public.pilot_invitations('list');raise exception 'HOST_CONTROLS_EXPOSED';exception when others then if sqlerrm='HOST_CONTROLS_EXPOSED' then raise;end if;end;
 begin perform 1 from private.pilot_invites;raise exception 'PRIVATE_TABLE_EXPOSED';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('test.home_b',public.create_pilot_household(current_setting('test.pilot'),'QA second home','Owner')::text,true);
select set_config('test.family',public.create_household_invite('member@hh-qa.invalid'),true);
select set_config('test.person',public.add_household_person('QA child','#E78725')::text,true);
insert into public.household_items(household_id,kind,title) values(current_setting('test.home_b')::uuid,'grocery','QA groceries');
insert into public.household_events(household_id,title,starts_at,ends_at) values(current_setting('test.home_b')::uuid,'QA event',now(),now()+interval '1 hour');
do $$begin
 begin perform public.create_pilot_household(current_setting('test.pilot'),'QA repeat','Owner');raise exception 'REPLAY_ACCEPTED';exception when others then if sqlerrm='REPLAY_ACCEPTED' then raise;end if;end;
 begin update public.household_people set linked_user_id='10000000-0000-4000-8000-000000000001' where id=current_setting('test.person')::uuid;raise exception 'FOREIGN_PROFILE_LINKED';exception when foreign_key_violation then null;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$declare n integer;begin
 if exists(select 1 from public.household_items) or exists(select 1 from public.household_events) or exists(select 1 from public.household_people) then raise exception 'Host sees other family data';end if;
 begin insert into public.household_items(household_id,kind,title) values(current_setting('test.home_b')::uuid,'grocery','Denied');raise exception 'FOREIGN_WRITE_ACCEPTED';exception when insufficient_privilege then null;end;
 update public.households set name='Denied' where id=current_setting('test.home_b')::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Foreign home renamed';end if;
 update public.household_people set display_name='Denied' where id=current_setting('test.person')::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Foreign profile edited';end if;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.accept_household_invite(current_setting('test.family'),'Member');
do $$declare n integer;begin
 if(select count(*) from public.household_members)<>2 then raise exception 'Family reads failed';end if;
 if(select count(*) from public.household_items)<>1 or (select count(*) from public.household_events)<>1 or (select count(*) from public.household_people)<>1 then raise exception 'Member cannot read family data';end if;
 update public.household_people set display_name='Denied' where id=current_setting('test.person')::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Nonowner profile edit accepted';end if;
 begin perform public.add_household_person('Denied','#E78725');raise exception 'NONOWNER_ADD_ACCEPTED';exception when others then if sqlerrm='NONOWNER_ADD_ACCEPTED' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
update public.household_people set linked_user_id='10000000-0000-4000-8000-000000000003' where id=current_setting('test.person')::uuid;
update public.households set name='QA renamed home' where id=current_setting('test.home_b')::uuid;
do $$begin
 if not exists(select 1 from public.household_people where linked_user_id='10000000-0000-4000-8000-000000000003') then raise exception 'Account link failed';end if;
 if not exists(select 1 from public.households where name='QA renamed home') then raise exception 'Owner rename failed';end if;
 if has_table_privilege('anon','public.household_people','select') or has_function_privilege('anon','public.create_pilot_household(text,text,text)','execute') then raise exception 'Anonymous access exists';end if;
 if has_table_privilege('authenticated','private.google_calendar_connections','select') or has_function_privilege('authenticated','public.calendar_service(text,jsonb)','execute') or has_function_privilege('authenticated','public.push_service(text,jsonb)','execute') then raise exception 'Provider or push secrets exposed';end if;
end$$;
reset role;
do $$begin
 if(select count(*) from private.pilot_invites where host_user_id='10000000-0000-4000-8000-000000000001' and used_at is not null)<>1 then raise exception 'Invitation consumption failed';end if;
end$$;
rollback;
select 'PASS: independent HH backend, host-only pilot controls, invite limits/revocation/confirmed-email/replay guards, household item/event/profile isolation, owner/member permissions, cross-home account linking denial, and private provider/push storage. Synthetic records rolled back.' as result;
