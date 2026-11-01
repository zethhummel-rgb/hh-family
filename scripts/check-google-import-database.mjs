import fs from 'node:fs';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=name=>fs.readFileSync(new URL('../database/'+name,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(value text) returns uuid language sql as $$insert into vault.secrets(secret) values(value) returning id$$;
create schema cron;create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$select 1::bigint$$;`);
for(const name of ['schema.sql','calendar.sql','google_calendar.sql','calendar_integrity.sql','member-colours.sql','pilot.sql'])await db.exec(read(name));
await db.exec('alter table public.household_events add column reminder_minutes integer');
for(const name of ['native-calendar-repeats.sql','event-notification-toggle.sql'])await db.exec(read(name));
await db.exec(`create table private.calendar_copy_state(household_id uuid primary key,native_ready boolean default true);
create table private.test_transitions(household_id uuid primary key,active boolean,write_open boolean);
create function private.household_transition_active(hid uuid) returns boolean language sql as $$select coalesce((select active from private.test_transitions where household_id=hid),false)$$;
create function private.household_transition_write_open(hid uuid) returns boolean language sql as $$select coalesce((select write_open from private.test_transitions where household_id=hid),true)$$;`);
await db.exec(read('google-calendar-import.sql'));
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',member='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
for(const id of [owner,other,member])await db.query('insert into auth.users values($1,$2,now())',[id,id+'@import.invalid']);
for(const [id,uid] of [[a,owner],[b,other]]){
 await db.query('insert into public.households(id,name,owner_id) values($1,$2,$3)',[id,'Synthetic home',uid]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",[id,uid]);
}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member','member')",[a,member]);
const api=(action,extra={},uid=owner,hid=a)=>scalar('select public.google_import_service($1,$2)',[action,JSON.stringify({householdId:hid,userId:uid,...extra})]);
for(const role of ['anon','authenticated']){
 for(const table of ['google_import_sessions','google_import_ledger']){
  assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')",[role,'private.'+table]),false);
  assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['private.'+table]),true);
 }
 assert.equal(await scalar("select has_function_privilege($1,'public.google_import_service(text,jsonb)','EXECUTE')",[role]),false);
}
await db.exec('set role service_role');
await assert.rejects(api('start',{hash:'a'.repeat(64),verifier:'v'.repeat(43)},other),/membership/);
const login=async(uid=owner,hid=a,hash='a'.repeat(64))=>{
 await api('start',{hash,verifier:'v'.repeat(43)},uid,hid);
 const state=await api('state_take',{hash},uid,hid);assert.ok(state.id);assert.equal(await api('state_take',{hash},uid,hid),null,'OAuth state is consumed once');
 await api('authorized',{sessionId:state.id,accessToken:'synthetic-access-token-only',completionHash:'c'.repeat(64),expiresIn:1800,calendars:[{id:'google-calendar',name:'Chosen calendar'},{id:'own-copy',name:'HH copy'}]},uid,hid);
 assert.equal(await api('get',{},uid,hid),null,'OAuth callback is not exposed until initiating HH user confirms possession of browser completion token');
 await assert.rejects(api('complete',{hash:'d'.repeat(64)},uid,hid),/authorization expired/);
 await api('complete',{hash:'c'.repeat(64)},uid,hid);
 return state;
};
await login();assert.equal((await api('get')).calendars.length,2);
const event={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',title:'Imported plan',description:'Original notes',location:'Home',person:'External name',person_ids:[other],starts_at:'2026-11-03T15:00:00Z',ends_at:'2026-11-03T16:00:00Z',all_day:false,start_date:null,end_date:null,recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3'],exceptions:{'2026-11-10':null,'2026-11-17':{title:'Changed plan',description:'',location:'',person:'External name',person_ids:[other],starts_at:'2026-11-17T16:00:00Z',ends_at:'2026-11-17T17:00:00Z',all_day:false,start_date:null,end_date:null,reminder_minutes:30,reminder_30_enabled:false}}};
const entry={sourceKey:'1'.repeat(64),event};
const preview=await api('preview',{calendarId:'google-calendar',entries:[entry]});
const commit={previewId:preview.previewId,sourceKeys:[entry.sourceKey],personIds:[member],reminder30:true,acknowledgeShared:true};
await assert.rejects(api('commit',commit,member),/expired/,'Another member cannot use an import session');
await assert.rejects(api('commit',{...commit,personIds:[other]}),/household/);
await assert.rejects(api('commit',{...commit,acknowledgeShared:false}),/Confirm/);
await assert.rejects(api('commit',{...commit,sourceKeys:['2'.repeat(64)]}),/preview/);
assert.deepEqual(await api('commit',commit),{imported:1,skipped:0});
assert.deepEqual(await api('commit',commit),{imported:1,skipped:0},'Network retries return existing receipt');
await db.exec('reset role');
let saved=(await db.query('select * from public.household_events where household_id=$1',[a])).rows[0];
assert.notEqual(saved.id,event.id);assert.deepEqual(saved.person_ids,[member]);assert.equal(saved.reminder_30_enabled,true);assert.equal(saved.reminder_minutes,null);
assert.deepEqual(saved.exceptions['2026-11-17'].person_ids,[member]);assert.equal(saved.exceptions['2026-11-17'].reminder_30_enabled,true);assert.equal(saved.exceptions['2026-11-17'].reminder_minutes,null);
assert.equal(await scalar('select count(*)::int from vault.secrets'),0,'Successful import deletes access token');
await db.query('delete from public.household_events where id=$1',[saved.id]);
await db.exec('set role service_role');await login();
const repeated=await api('preview',{calendarId:'google-calendar',entries:[entry]});assert.equal(repeated.entries[0].duplicate,true);
assert.deepEqual(await api('commit',{...commit,previewId:repeated.previewId}),{imported:0,skipped:1},'Deleted events are not silently reimported');
await login(other,b);let another=await api('preview',{calendarId:'google-calendar',entries:[entry]},other,b);
assert.deepEqual(await api('commit',{...commit,previewId:another.previewId,personIds:[other]},other,b),{imported:1,skipped:0},'Another home can import the same shared Google calendar');
// Skipping tags is distinct from Everyone, including changed recurring dates.
await login(other,b);const untaggedEntry={sourceKey:'8'.repeat(64),event};
const untagged=await api('preview',{calendarId:'google-calendar',entries:[untaggedEntry]},other,b);
const noPeople={...commit,previewId:untagged.previewId,sourceKeys:[untaggedEntry.sourceKey],personIds:[],unassigned:true,reminder30:true};
await assert.rejects(api('commit',{...noPeople,personIds:[other]},other,b),/cannot also tag/);
await assert.rejects(api('commit',{...noPeople,unassigned:'true'},other,b),/valid people/);
assert.deepEqual(await api('commit',noPeople,other,b),{imported:1,skipped:0});
await db.exec('reset role');
const unassignedRow=(await db.query("select * from public.household_events where household_id=$1 and person='Unassigned'",[b])).rows[0];
assert.deepEqual(unassignedRow.person_ids,[]);assert.equal(unassignedRow.reminder_30_enabled,false);
assert.equal(unassignedRow.exceptions['2026-11-17'].person,'Unassigned');assert.deepEqual(unassignedRow.exceptions['2026-11-17'].person_ids,[]);assert.equal(unassignedRow.exceptions['2026-11-17'].reminder_30_enabled,false);
await db.exec('set role service_role');
// A bad later row rolls back every insert and the ledger.
await login();const invalid={sourceKey:'3'.repeat(64),event:{...event,title:''}},valid={sourceKey:'2'.repeat(64),event};
const failed=await api('preview',{calendarId:'google-calendar',entries:[valid,invalid]});
await assert.rejects(api('commit',{...commit,previewId:failed.previewId,sourceKeys:[valid.sourceKey,invalid.sourceKey]}),/constraint/);
await db.exec('reset role');assert.equal(await scalar('select count(*)::int from public.household_events where household_id=$1',[a]),0);assert.equal(await scalar('select count(*)::int from private.google_import_ledger where household_id=$1',[a]),1);
await db.query("insert into private.google_calendar_connections(household_id,user_id,secret_id,calendar_id) values($1,$2,gen_random_uuid(),'own-copy')",[a,owner]);
await db.exec('set role service_role');await login();assert.equal((await api('get')).calendars.length,1,'HH outbound copy is hidden');
await assert.rejects(api('preview',{calendarId:'own-copy',entries:[entry]}),/available calendar/);
await api('cancel');await db.exec('reset role');assert.equal(await scalar('select count(*)::int from vault.secrets'),0);
await db.exec('set role service_role');const old=await login();await login(owner,a,'b'.repeat(64));await api('cancel',{sessionId:old.id});assert.ok(await api('get'),'Stale callback cannot cancel a newer import');
await db.exec('reset role');await db.query("update private.google_import_sessions set expires_at=now()-interval '1 second' where household_id=$1",[a]);await db.exec('select private.expire_google_imports()');assert.equal(await scalar('select count(*)::int from vault.secrets'),0,'Expired access token is removed');
await db.exec('set role service_role');await login(member);await db.exec('reset role');await db.query('delete from public.household_members where user_id=$1',[member]);assert.equal(await scalar('select count(*)::int from vault.secrets'),0,'Leaving household cleans import tokens');
await db.query("insert into private.calendar_copy_state values($1,false)",[a]);await db.exec('set role service_role');await assert.rejects(api('start',{hash:'a'.repeat(64),verifier:'v'.repeat(43)}),/transfer/);await db.exec('reset role');
await db.query('delete from private.calendar_copy_state where household_id=$1',[a]);await db.query('insert into private.test_transitions values($1,true,false)',[a]);await db.exec('set role service_role');await assert.rejects(api('start',{hash:'a'.repeat(64),verifier:'v'.repeat(43)}),/transfer/);await db.exec('reset role');
await db.query('delete from private.test_transitions where household_id=$1',[a]);await db.exec('set role service_role');await login();await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);assert.equal(await scalar('select count(*)::int from vault.secrets'),0);assert.equal(await scalar('select count(*)::int from private.google_import_ledger where household_id=$1',[a]),0);
await db.close();console.log('Google import database checks passed: one-time state, session/membership isolation, shared consent, tag validation, atomic rollback, cross-home identity, deleted-event dedup, source gating, own-copy exclusion and token cleanup.');
