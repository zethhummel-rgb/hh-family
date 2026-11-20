import fs from 'node:fs';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const db=new PGlite(),read=name=>fs.readFileSync(new URL('../database/'+name,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create schema vault;create table vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
create schema net;create table net.requests(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id;$$;
create schema cron;create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$select 1::bigint$$;`);
for(const name of ['schema.sql','calendar.sql','google_calendar.sql','calendar_integrity.sql','member-colours.sql','pilot.sql'])await db.exec(read(name));
await db.exec('alter table public.household_events add column reminder_minutes integer');
await db.exec(read('native-calendar-repeats.sql'));await db.exec(read('event-notification-toggle.sql'));
await db.exec(`create table private.push_devices(id uuid primary key,household_id uuid references public.households on delete cascade,user_id uuid);
create table private.push_deliveries(device_id uuid references private.push_devices on delete cascade,delivery_key text,state text,attempts integer default 1,lease_until timestamptz default now()+interval '2 minutes',created_at timestamptz default now(),primary key(device_id,delivery_key));`);
const pushSource=read('push-reminders.sql'),pushStart=pushSource.indexOf('create or replace function private.push_service('),pushEnd=pushSource.indexOf('end$$;',pushStart)+'end$$;'.length;
await db.exec(pushSource.slice(pushStart,pushEnd));

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',member='cccccccc-cccc-4ccc-8ccc-cccccccccccc',event='dddddddd-dddd-4ddd-8ddd-dddddddddddd',added='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
for(const id of [owner,other,member])await db.query('insert into auth.users values($1,$2,now())',[id,id+'@hh-copy.invalid']);
for(const [id,uid] of [[a,owner],[b,other]]){
 await db.query('insert into public.households(id,name,owner_id) values($1,$2,$3)',[id,'Synthetic home',uid]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",[id,uid]);
}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member','member')",[a,member]);
await db.query("insert into public.household_events(id,household_id,title,starts_at,ends_at) values($1,$2,'Original native snapshot','2026-11-03T15:00:00Z','2026-11-03T16:00:00Z')",[event,a]);
await db.query("insert into private.google_calendar_connections(household_id,user_id,secret_id,calendar_id,migration_complete) values($1,$2,gen_random_uuid(),'synthetic-google-calendar',true)",[a,owner]);
await db.exec(read('native-calendar-authority.sql'));
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const api=async(action,hid,extra={})=>scalar('select public.calendar_copy_service($1,$2)',[action,JSON.stringify({householdId:hid,...extra})]);
const asUser=async(uid,run)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');try{return await run()}finally{await db.exec('reset role')}};
assert.equal(await asUser(member,()=>scalar('select public.household_calendar_source($1)',[a])),'google');
await assert.rejects(asUser(other,()=>scalar('select public.household_calendar_source($1)',[a])),/membership/i);
assert.equal((await asUser(owner,()=>db.query("update public.household_events set title='Must remain frozen' where id=$1 returning id",[event]))).rows.length,0);
for(const role of ['anon','authenticated']){
 for(const table of ['calendar_copy_state','calendar_copy_queue','calendar_copy_links','calendar_transfer_backups','calendar_delivery_aliases']){
  assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')",[role,'private.'+table]),false);
  assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['private.'+table]),true);
 }
 assert.equal(await scalar("select has_function_privilege($1,'public.calendar_copy_service(text,jsonb)','EXECUTE')",[role]),false);
 assert.equal(await scalar("select has_function_privilege($1,'private.dispatch_calendar_copies()','EXECUTE')",[role]),false);
}
await db.query("update private.calendar_copy_state set next_attempt_at=now() where household_id=$1",[a]);
await db.exec('set role service_role');const claim=await api('claim',a);assert.ok(claim.lease);assert.equal(await api('claim',a),null);assert.equal(await api('legacy_lock',a),null);
await assert.rejects(api('finish',a,{lease:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),/lease/);
const raw=[{id:'google-legacy',summary:'All original provider fields',attendees:[{email:'synthetic@example.invalid'}],extendedProperties:{shared:{keep:'metadata'}}}];
const preserved=await api('archive',a,{lease:claim.lease,events:raw});assert.match(preserved.snapshotHash,/^[a-f0-9]{64}$/);
const native={id:event,title:'Verified HH plan',description:'Original notes',location:'Home',person:'Everyone',person_ids:[],starts_at:'2026-11-03T15:00:00Z',ends_at:'2026-11-03T16:00:00Z',all_day:false,start_date:null,end_date:null,reminder_minutes:1020,reminder_30_enabled:false,recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3'],exceptions:{'2026-11-10':null}};
const incoming={event:native,googleId:'google-legacy',shape:{start:native.starts_at}};
await assert.rejects(api('import',a,{lease:claim.lease,snapshotHash:'wrong',events:[incoming]}),/snapshot/);
await assert.rejects(api('import',a,{lease:claim.lease,snapshotHash:preserved.snapshotHash,events:[incoming,{...incoming,event:{...native,id:added,title:''},googleId:'invalid-event'}]}),/check|constraint|verification/i);
await db.exec('reset role');
assert.equal(await scalar('select title from public.household_events where id=$1',[event]),'Original native snapshot','A failed transfer rolls back every event');
assert.equal(await scalar('select native_ready from private.calendar_copy_state where household_id=$1',[a]),false,'Failure keeps the old source active');
assert.deepEqual(await scalar('select google_snapshot from private.calendar_transfer_backups where household_id=$1',[a]),raw,'Full original Google data remains available privately');
await db.exec('set role service_role');
const googleKey='legacy-instance:2026-11-03T10:00:00-05:00:1020';
const imported=await api('import',a,{lease:claim.lease,snapshotHash:preserved.snapshotHash,events:[incoming],deleted:[],deliveryAliases:[{eventId:event,occurrenceDate:'2026-11-03',nativeStart:'2026-11-03T15:00:00.000Z',minutes:1020,googleKey}]});assert.equal(imported.imported,1);
await api('finish',a,{lease:claim.lease});await db.exec('reset role');
assert.equal(await asUser(member,()=>scalar('select public.household_calendar_source($1)',[a])),'hh');
const saved=(await db.query('select * from public.household_events where id=$1',[event])).rows[0];
assert.equal(saved.title,native.title);assert.equal(saved.description,native.description);assert.equal(saved.reminder_minutes,1020);assert.equal(saved.reminder_30_enabled,false);assert.deepEqual(saved.recurrence,native.recurrence);assert.deepEqual(saved.exceptions,native.exceptions);
const device='99999999-9999-4999-8999-999999999999',nativeKey=event+'@2026-11-03:2026-11-03T15:00:00.000Z:1020';
await db.query('insert into private.push_devices values($1,$2,$3)',[device,a,owner]);
await db.query("insert into private.push_deliveries(device_id,delivery_key,state) values($1,$2,'sending')",[device,googleKey]);
await db.exec('set role service_role');
const reminder=()=>scalar('select public.calendar_reminder_claim($1)',[JSON.stringify({deviceId:device,userId:owner,key:nativeKey})]);
assert.equal(await reminder(),false,'An in-flight old worker suppresses duplicate native delivery');
await db.exec('reset role');await db.query("update private.push_deliveries set state='sent' where device_id=$1",[device]);
await db.exec('set role service_role');assert.equal(await reminder(),false,'A late successful Google delivery remains deduplicated');
await db.exec('reset role');await db.query("update private.push_deliveries set state='sending',lease_until=now()-interval '1 second' where device_id=$1",[device]);
await db.exec('set role service_role');assert.equal(await reminder(),true,'A failed old send can be retried under the native identity');assert.equal(await reminder(),false);
await db.exec('reset role');
await asUser(member,()=>db.query("update public.household_events set title='Member edit',version=version+1 where id=$1",[event]));
assert.equal(await scalar('select count(*)::int from private.calendar_copy_queue where household_id=$1',[a]),1);
await db.query("update private.calendar_copy_state set next_attempt_at=now() where household_id=$1",[a]);
await db.exec('set role service_role');const copy=await api('claim',a);const task=copy.work[0];
let link=await api('prepare',a,{lease:copy.lease,eventId:event,revision:task.revision,shape:incoming.shape,dates:['2026-11-10']});
assert.equal(link.google_id,'google-legacy');
await api('base_done',a,{lease:copy.lease,eventId:event,revision:task.revision});
await api('date_done',a,{lease:copy.lease,eventId:event,revision:task.revision,date:'2026-11-10'});
await db.exec('reset role');await asUser(member,()=>db.query("update public.household_events set title='Concurrent edit',version=version+1 where id=$1",[event]));
await db.exec('set role service_role');await api('event_done',a,{lease:copy.lease,eventId:event,revision:task.revision,version:task.event.version,dates:['2026-11-10']});
await api('finish',a,{lease:copy.lease});await db.exec('reset role');
assert.equal(await scalar('select count(*)::int from private.calendar_copy_queue where household_id=$1',[a]),1,'An old acknowledgment cannot consume a newer edit');
await db.query("update private.calendar_copy_state set next_attempt_at=now() where household_id=$1",[a]);
await db.exec('set role service_role');const next=await api('claim',a),nextTask=next.work[0];
link=await api('prepare',a,{lease:next.lease,eventId:event,revision:nextTask.revision,shape:{start:'changed-time'},dates:[]});
assert.notEqual(link.google_id,'google-legacy');assert.deepEqual(link.retired_ids,['google-legacy']);
await api('retired_done',a,{lease:next.lease,eventId:event,revision:nextTask.revision,googleId:'google-legacy'});
await api('base_done',a,{lease:next.lease,eventId:event,revision:nextTask.revision});
await api('event_done',a,{lease:next.lease,eventId:event,revision:nextTask.revision,version:nextTask.event.version,dates:[]});await api('finish',a,{lease:next.lease});await db.exec('reset role');
assert.equal(await scalar('select count(*)::int from private.calendar_copy_queue where household_id=$1',[a]),0);
await asUser(owner,()=>db.query('delete from public.household_events where id=$1',[event]));
assert.equal(await scalar('select count(*)::int from private.calendar_copy_queue where event_id=$1',[event]),1,'Deletions retain durable copy work');
await db.query("insert into private.google_calendar_connections(household_id,user_id,secret_id,calendar_id,migration_complete) values($1,$2,gen_random_uuid(),'new-google-copy',true)",[b,other]);
assert.equal(await asUser(other,()=>scalar('select public.household_calendar_source($1)',[b])),'hh','A new Google connection never takes over the HH calendar');
await asUser(other,()=>db.query("insert into public.household_events(id,household_id,title,starts_at,ends_at) values($1,$2,'Native while Google is connected','2026-11-04T15:00:00Z','2026-11-04T16:00:00Z')",[added,b]));
assert.equal(await scalar('select count(*)::int from private.calendar_copy_queue where household_id=$1',[b]),1);
await db.query('delete from public.households where id=$1',[a]);
for(const table of ['calendar_copy_state','calendar_copy_queue','calendar_copy_links','calendar_transfer_backups','calendar_delivery_aliases'])assert.equal(await scalar(`select count(*)::int from private.${table} where household_id=$1`,[a]),0);
// The fixture's legacy Vault reader is a table. Add the personal writer and a
// cascade so a deleted encrypted credential disappears from both fixture tables.
await db.exec(`create table vault.secrets(id uuid primary key);
 alter table vault.decrypted_secrets add foreign key(id) references vault.secrets(id) on delete cascade;
 create function vault.create_secret(value text) returns uuid language plpgsql as $$
 declare sid uuid:=gen_random_uuid();
 begin insert into vault.secrets values(sid);insert into vault.decrypted_secrets values(sid,null,value);return sid;end;$$;
 create function private.household_transition_active(uuid) returns boolean language sql as $$select false$$;`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261118212340_personal_google_calendar.sql',import.meta.url),'utf8'));
for(const uid of [member,owner])await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member','member')",[b,uid]);
const personal=async(action,userId,extra={})=>scalar('select public.personal_calendar_service($1,$2)',[action,JSON.stringify({householdId:b,userId,...extra})]);
assert.equal(await scalar("select has_function_privilege('authenticated','public.personal_calendar_service(text,jsonb)','EXECUTE')"),false);
assert.equal(await scalar("select has_table_privilege('authenticated','private.personal_calendar_connections','SELECT')"),false);

const edge=fs.readFileSync(new URL('../supabase/functions/google-calendar/personal.ts',import.meta.url),'utf8');
const edgeJs=ts.transpileModule(edge,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {handlePersonalCalendar,personalCalendarCallback}=await import('data:text/javascript;base64,'+Buffer.from(edgeJs).toString('base64'));
const admin={rpc:async(name,{action,payload})=>{
 assert.equal(name,'personal_calendar_service');
 try{return {data:await personal(action,payload.userId,payload)}}
 catch(error){return {error}}
}};
const cfg={clientId:'fixture',clientSecret:'fixture',callback:'https://test.invalid/callback',app:'https://test.invalid/hummel-home/'};
const request=(action,userId,extra={},fetcher)=>handlePersonalCalendar(admin,{action:'personal_'+action,householdId:b,...extra},userId,cfg,fetcher);
const approvedScope='https://www.googleapis.com/auth/calendar.app.created';
let calendarCreates=0;
const google=async(url,init)=>{
 if(url==='https://oauth2.googleapis.com/token'){
  const code=new URLSearchParams(init.body).get('code');
  assert.ok(new URLSearchParams(init.body).get('code_verifier'));
  return Response.json({access_token:code,refresh_token:'private-'+code,scope:approvedScope});
 }
 const account=init.headers.Authorization.slice('Bearer '.length);
 if(init.method==='POST'){
  assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars');
  assert.match(JSON.parse(init.body).summary,/HH Family/);
  calendarCreates++;
 }else assert.equal(url,'https://www.googleapis.com/calendar/v3/users/me/calendarList/'+account);
 return Response.json({id:account,accessRole:'owner'});
};
async function authorize(userId,account){
 const consent=new URL((await request('start',userId,{userId:other})).url);
 assert.equal(consent.searchParams.get('scope'),approvedScope);
 assert.equal(consent.searchParams.get('prompt'),'consent select_account');
 const state=consent.searchParams.get('state');
 const callback=new URL(cfg.callback);callback.search=new URLSearchParams({state,code:account});
 const returned=personalCalendarCallback(callback,cfg.app);
 const app=new URL(returned.headers.get('Location'));
 assert.equal(app.searchParams.get('code'),null);
 assert.equal(new URLSearchParams(app.hash.slice(1)).get('personal_calendar_code'),account);
 return {state,code:account};
}
assert.equal((await request('status',other)).usesExistingCopy,true);
await assert.rejects(request('start',other),/Reconnect your existing Google calendar/);
const first=await authorize(owner,'google-first'),second=await authorize(member,'google-second');
await assert.rejects(request('complete',member,first,()=>assert.fail('Another HH account cannot exchange this Google code')),/started this connection/);
await request('complete',owner,first,google);await request('complete',member,second,google);
await assert.rejects(request('complete',owner,first,()=>assert.fail('State is single use')),/started this connection/);
assert.equal(calendarCreates,2);
assert.equal(await scalar('select private.dispatch_personal_calendar_copies()'),0,'Missing scheduler configuration keeps external requests off');
await db.exec(`with inserted as (
 insert into vault.secrets select gen_random_uuid() from generate_series(1,2) returning id
) insert into vault.decrypted_secrets(id,name,decrypted_secret)
 select s.id,n.name,n.value from (select id,row_number() over() as row from inserted) s
 join (values(1,'home_together_api_url','https://test.invalid'),(2,'hummel_push_cron','fixture-secret')) n(row,name,value) using(row);`);
assert.equal(Number(await scalar('select private.dispatch_personal_calendar_copies()')),2);
assert.deepEqual((await db.query("select body->>'userId' as actor from net.requests where body->>'action'='personal_sync' order by actor")).rows.map(row=>row.actor),[owner,member]);
const initial=await personal('claim',owner);
assert.equal(initial.nativeReady,true);
assert.equal(initial.work[0].event.title,'Native while Google is connected');
assert.equal(await personal('claim',owner),null);
assert.deepEqual(await personal('credentials',owner,{lease:initial.lease}),{calendarId:'google-first',refreshToken:'private-google-first'});
await assert.rejects(personal('credentials',member,{lease:initial.lease}),/lease/);
await assert.rejects(request('disconnect',owner),/updating/);
await personal('finish',owner,{lease:initial.lease});
const nextRecipient=await personal('claim',member);
assert.equal(nextRecipient.work[0].eventId,added);
const stage=await personal('prepare',member,{lease:nextRecipient.lease,eventId:added,revision:nextRecipient.work[0].revision,shape:{},dates:[]});
assert.ok(stage.google_id);
await personal('base_done',member,{lease:nextRecipient.lease,eventId:added,revision:nextRecipient.work[0].revision});
await asUser(other,()=>db.query("update public.household_events set title='Changed for both copies',version=version+1 where id=$1",[added]));
await personal('event_done',member,{lease:nextRecipient.lease,eventId:added,revision:nextRecipient.work[0].revision,dates:[]});
await personal('finish',member,{lease:nextRecipient.lease});
assert.equal((await request('status',member)).pending,1,'A newer revision survives an in-flight acknowledgment');
assert.ok(!JSON.stringify(await request('status',owner)).includes('private-google'));
await request('complete',member,await authorize(member,'google-second'),google);
assert.equal(calendarCreates,2,'Reconnect reuses the original Google calendar');
assert.deepEqual(await personal('filter_import_calendars',other,{calendars:[{id:'google-first'},{id:'google-second'},{id:'other-calendar'}]}),[{id:'other-calendar'}]);
await request('disconnect',owner);
assert.equal((await request('status',owner)).connected,false);
assert.equal((await request('status',member)).connected,true);
assert.equal(await scalar('select count(*)::int from vault.decrypted_secrets where name is null'),1,'Disconnect and reconnect remove superseded credentials');
await asUser(other,()=>db.query('delete from public.household_events where id=$1',[added]));
const remove=await personal('claim',member);
assert.equal(remove.work[0].event,null,'Deletion is queued for the remaining connection');
await db.query('delete from public.household_members where household_id=$1 and user_id=$2',[b,member]);
assert.equal(await scalar('select count(*)::int from vault.decrypted_secrets where name is null'),0,'Removing a member removes their Google credential');
await assert.rejects(personal('check_lease',member,{lease:remove.lease}),/membership/);
assert.equal(await scalar('select count(*)::int from private.google_calendar_connections where household_id=$1',[b]),1);
console.log('Personal calendar checks passed: two accounts, OAuth state isolation and replay, private credentials, separate queues, retries, reconnect, disconnect, and membership cleanup.');
for(const path of ['20261119120746_event_venue_selection.sql','20261120130526_test_google_calendar_two_way.sql','20261120162000_test_google_repeating_events.sql']){
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
}
const pilot='55555555-5555-4555-8555-555555555555';
const pilotOwner='66666666-6666-4666-8666-666666666666',pilotMember='77777777-7777-4777-8777-777777777777';
for(const uid of [pilotOwner,pilotMember])await db.query('insert into auth.users values($1,$2,now())',[uid,uid+'@hh-copy.invalid']);
await db.query("insert into public.households(id,name,owner_id) values($1,'Synthetic two-way home',$2)",[pilot,pilotOwner]);
for(const [uid,role] of [[pilotOwner,'owner'],[pilotMember,'member']]){
 await db.query('insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,$3,$4)',[pilot,uid,'Fixture member',role]);
 await db.query('insert into private.personal_calendar_connections(household_id,user_id,calendar_id,secret_id) values($1,$2,$3,gen_random_uuid())',[pilot,uid,'two-way-fixture-'+role]);
}
const namedService=(name,action,uid,extra={})=>scalar('select public.'+name+'($1,$2)',[action,JSON.stringify({householdId:pilot,userId:uid,...extra})]);
const twoWay=(action,uid,extra)=>namedService('personal_calendar_two_way',action,uid,extra);
assert.equal(await scalar("select has_function_privilege('authenticated','public.personal_calendar_two_way(text,jsonb)','execute')"),false);
await assert.rejects(twoWay('status',other),/unavailable/);
assert.deepEqual(await twoWay('status',pilotOwner),{enabled:false,ready:false});
await twoWay('set',pilotOwner,{enabled:true});
assert.equal(Number(await scalar('select private.dispatch_test_calendar_two_way()')),1,'Only an opted-in connection is scheduled');
const localLease=(await namedService('personal_calendar_service','claim',pilotOwner)).lease;
const pull=(action,extra={})=>twoWay(action,pilotOwner,{lease:localLease,...extra});
await assert.rejects(twoWay('apply',pilotOwner,{lease:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}),/lease/);
const baseFields={title:'Added in Outlook',description:'Family notes',location:'Rink',starts_at:'2026-11-20T23:00:00.000Z',ends_at:'2026-11-21T00:00:00.000Z',all_day:false,start_date:null,end_date:null};
const remote=(event)=>({kind:'event',googleId:'outlook-new',event,shape:{starts_at:event.starts_at,ends_at:event.ends_at,all_day:false,start_date:null,end_date:null,recurrence:[]}});
const page=(changes,nextSync,nextPage=null)=>pull('apply',{changes,nextSync,nextPage});
assert.equal((await page([remote(baseFields)],null,'page-2')).changed,1);
assert.deepEqual(await pull('cursor'),{syncToken:null,pageToken:'page-2'});
const linked=(await db.query('select id,version from public.household_events where household_id=$1',[pilot])).rows[0];
assert.equal(await scalar('select count(*)::int from private.personal_calendar_queue where event_id=$1',[linked.id]),1,'Only the other connection has outbound work');
const tombstone={kind:'deleted',googleId:'outlook-new'};
assert.equal((await page([tombstone],'cursor-1')).changed,0,'Initial snapshot cannot delete household events');
assert.equal((await page([remote(baseFields)],'cursor-2')).changed,0,'Same Google event does not create a duplicate or increment version');
const moved={...baseFields,title:'Moved in Outlook',starts_at:'2026-11-21T00:00:00.000Z',ends_at:'2026-11-21T01:00:00.000Z'};
assert.equal((await page([remote(moved)],'cursor-3')).changed,1);
assert.equal(await scalar('select title from public.household_events where id=$1',[linked.id]),moved.title);
assert.equal(await scalar('select version from public.household_events where id=$1',[linked.id]),linked.version+1);
await asUser(pilotOwner,()=>db.query("update public.household_events set title='HH wins simultaneous edit',version=version+1 where id=$1",[linked.id]));
assert.equal((await page([tombstone],'cursor-4')).changed,0,'An unsent HH change wins over a competing deletion');
const job=(await db.query('select q.revision from private.personal_calendar_queue q join private.personal_calendar_connections c on c.id=q.connection_id where c.user_id=$1 and q.event_id=$2',[pilotOwner,linked.id])).rows[0];
const work={eventId:linked.id,revision:Number(job.revision),lease:localLease};
const hhShape=remote({...moved,starts_at:'2026-11-21T02:00:00.000Z',ends_at:'2026-11-21T03:00:00.000Z'}).shape;
await pull('keep_single_event_id',{...work,shape:hhShape});
const reused=await namedService('personal_calendar_service','prepare',pilotOwner,{...work,shape:hhShape,dates:[]});
assert.equal(reused.google_id,'outlook-new','An HH edit of a one-time event patches its existing provider ID');
await namedService('personal_calendar_service','base_done',pilotOwner,work);
await namedService('personal_calendar_service','event_done',pilotOwner,{...work,version:linked.version+2,dates:[]});
assert.equal((await page([tombstone],'cursor-5')).changed,1);
assert.equal(await scalar('select exists(select 1 from public.household_events where id=$1)',[linked.id]),false);
assert.equal((await page([tombstone],'cursor-6')).changed,0,'Replaying a deletion is harmless');
await pull('reset');
assert.deepEqual(await pull('cursor'),{syncToken:null,pageToken:null});
await namedService('personal_calendar_service','finish',pilotOwner,{lease:localLease});
await twoWay('set',pilotOwner,{enabled:false});
assert.deepEqual(await twoWay('status',pilotOwner),{enabled:false,ready:false});
console.log('TEST two-way calendar checks passed: opt-in, authorization, stable links, inbound add/edit/delete, replay, conflict handling, cursor reset, and other-member copies.');
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261120151600_test_google_existing_calendar.sql',import.meta.url),'utf8'));
const existing=(action,uid,extra)=>namedService('test_google_existing_calendar',action,uid,extra);
assert.equal(await scalar("select has_function_privilege('authenticated','public.test_google_existing_calendar(text,jsonb)','execute')"),false);
assert.equal((await existing('options',pilotOwner)).existingSource,false);
const newState='f'.repeat(64),newVerifier='v'.repeat(43);
await assert.rejects(existing('start',pilotOwner,{hash:newState,verifier:newVerifier}),/disconnect/i);
await namedService('personal_calendar_service','disconnect',pilotOwner);
await existing('start',pilotOwner,{hash:newState,verifier:newVerifier});
assert.equal(await existing('take',pilotMember,{hash:newState}),null);
assert.equal((await existing('take',pilotOwner,{hash:newState})).existingSource,true);
assert.equal(await existing('take',pilotOwner,{hash:newState}),null);
const selectedCalendar={id:'your-original-google-calendar',name:'Your original Google calendar'};
const stagedChoices=await existing('stage',pilotOwner,{hash:newState,refreshToken:'private-existing-credential',
 choices:[selectedCalendar,{id:'two-way-fixture-member',name:'Other member’s copy'}]});
assert.deepEqual(stagedChoices,[selectedCalendar]);
assert.deepEqual((await existing('options',pilotOwner)).choices,[selectedCalendar]);
assert.equal(JSON.stringify(await existing('options',pilotOwner)).includes('private-existing-credential'),false);
await assert.rejects(existing('connect',pilotOwner,{calendarId:'unlisted',acknowledgeShared:true}),/from the list/);
await assert.rejects(existing('connect',pilotOwner,{calendarId:selectedCalendar.id}),/Confirm sharing/);
await existing('connect',pilotOwner,{calendarId:selectedCalendar.id,acknowledgeShared:true});
assert.deepEqual(await existing('options',pilotOwner),{existingSource:true,calendarName:selectedCalendar.name,choices:null});
assert.deepEqual(await twoWay('status',pilotOwner),{enabled:true,ready:false});
const existingLease=(await namedService('personal_calendar_service','claim',pilotOwner)).lease;
assert.deepEqual(await namedService('personal_calendar_service','credentials',pilotOwner,{lease:existingLease}),
 {calendarId:selectedCalendar.id,refreshToken:'private-existing-credential'});
const firstImport=await twoWay('apply',pilotOwner,{lease:existingLease,changes:[remote(baseFields)],nextPage:null,nextSync:'existing-cursor'});
assert.equal(firstImport.changed,1);
const pullPage=(changes,nextSync,nextPage=null)=>twoWay('apply',pilotOwner,{lease:existingLease,changes,nextPage,nextSync});
const series={...remote({...baseFields,title:'Google weekly series'}),googleId:'google-weekly'};
series.shape.recurrence=['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=5'];
const skip={kind:'occurrence',googleId:series.googleId,date:'2026-11-27',event:null};
const move={...skip,date:'2026-12-04',event:{...baseFields,title:'Moved hockey',starts_at:'2026-12-05T23:00:00Z',ends_at:'2026-12-06T00:00:00Z'}};
assert.equal((await pullPage([skip],null,'repeat-page-2')).changed,0);
assert.equal((await pullPage([series,move],'repeat-cursor-1')).changed,3);
const weekly=(await db.query("select id,recurrence,exceptions from public.household_events where title='Google weekly series'")).rows[0];
assert.deepEqual(weekly.recurrence,series.shape.recurrence);
assert.equal(weekly.exceptions[skip.date],null);
assert.equal(weekly.exceptions[move.date].title,'Moved hockey');
assert.equal(weekly.exceptions[move.date].person,'Everyone');
assert.equal((await pullPage([move],'repeat-cursor-2')).changed,0,'A repeated Google exception does not generate another edit');
const longer={...series,shape:{...series.shape,recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=6']}};
assert.equal((await pullPage([longer],'repeat-cursor-3')).changed,1);
assert.deepEqual(await scalar('select recurrence from public.household_events where id=$1',[weekly.id]),longer.shape.recurrence);
assert.equal((await pullPage([{kind:'deleted',googleId:series.googleId}],'repeat-cursor-4')).changed,1);
assert.equal(await scalar('select exists(select 1 from public.household_events where id=$1)',[weekly.id]),false,'Only a master tombstone removes the entire series');
assert.equal((await namedService('personal_calendar_service','status',pilotOwner)).pending,0,'Imported Google events must not echo back as new copies');
await namedService('personal_calendar_service','finish',pilotOwner,{lease:existingLease});
await namedService('personal_calendar_service','disconnect',pilotOwner);
assert.equal(await scalar("select count(*)::int from vault.decrypted_secrets where decrypted_secret='private-existing-credential'"),0);
console.log('Existing Google calendar checks passed: staged selection, consent, source isolation, in-place import and refresh credential cleanup.');
await db.close();console.log('Calendar copy database checks passed: source gating, transactional preservation/rollback, private full backups, member/outsider/anonymous isolation, lease exclusion, checkpoints, concurrent edits, notification cutover deduplication, durable deletes, new connections stay native and complete household cleanup. No live data or Google requests.');
