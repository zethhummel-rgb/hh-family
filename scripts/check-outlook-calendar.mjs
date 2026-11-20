import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createGraph,eventFields,outlookFields} from '../supabase/functions/outlook-calendar/graph.ts';
import {syncEvents} from '../supabase/functions/outlook-calendar/sync.ts';
import {nativeInstant} from '../supabase/functions/google-calendar/native.ts';

const db=new PGlite();
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text);
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(value text) returns uuid language sql as $$
  insert into vault.secrets(secret) values(value) returning id;
 $$;
 create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create schema net;create table net.requests(url text,headers jsonb,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint
  language plpgsql as $$begin insert into net.requests values(url,headers,body);return 1;end;$$;
`);
await db.exec(read('database/schema.sql'));
await db.exec(read('database/calendar.sql'));
await db.exec(`
 alter table public.household_members add unique(household_id,user_id);
 grant usage on schema private to service_role;
 create function private.personal_calendar_ready(uuid) returns boolean language sql as $$select true$$;
 alter table public.household_events add column location_place_id text,add column reminder_minutes integer,
  add column person_ids uuid[];
`);
await db.exec(read('database/native-calendar-repeats.sql'));
await db.exec(read('database/event-notification-toggle.sql'));
for(const file of ['20261120142442_test_outlook_calendar.sql','20261120150942_test_outlook_share_hh_events.sql',
 '20261120151200_test_outlook_create_family_calendar.sql','20261120162100_test_outlook_repeating_events.sql'])await db.exec(read('supabase/migrations/'+file));

const householdId='10000000-0000-4000-8000-000000000001';
const userId='10000000-0000-4000-8000-000000000002';
const other='10000000-0000-4000-8000-000000000003';
const scalar=async(query,values=[])=>Object.values((await db.query(query,values)).rows[0])[0];
const call=(action,data={})=>scalar('select public.outlook_calendar($1,$2)',[action,JSON.stringify({householdId,userId,...data})]);
const creation=(action,data={})=>scalar('select public.outlook_calendar_creation($1,$2)',[action,JSON.stringify({householdId,userId,...data})]);
for(const user of [userId,other])await db.query('insert into auth.users values($1)',[user]);
await db.query("insert into public.households(id,name,owner_id) values($1,'TEST household',$2)",[householdId,other]);
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Fixture member','member')",[householdId,userId]);
for(const role of ['anon','authenticated']){
 assert.equal(await scalar("select has_function_privilege($1,'public.outlook_calendar(text,jsonb)','execute')",[role]),false);
 for(const table of ['oauth','picker','connections','links']){
  assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT')",[role,'private.outlook_calendar_'+table]),false);
  assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['private.outlook_calendar_'+table]),true);
 }
}
await db.exec('set role service_role');
const stateHash='a'.repeat(64),verifier='b'.repeat(43);
await call('authorize',{stateHash,verifier});
await assert.rejects(call('claim',{stateHash,userId:other}),/unavailable/);
assert.equal(await call('claim',{stateHash:'c'.repeat(64)}),null);
assert.equal(await call('claim',{stateHash}),verifier);
assert.equal(await call('claim',{stateHash}),null);
assert.equal((await call('status')).active,false);
const calendarId='calendar=existing';
await call('choose',{microsoftId:'fixture-user',calendars:[{id:calendarId,name:'Existing family'}],refreshToken:'trial-token'});
assert.deepEqual((await call('status')).calendars,[{id:calendarId,name:'Existing family'}]);
assert.equal(JSON.stringify(await call('status')).includes('trial-token'),false);
await assert.rejects(creation('begin_create',{userId:other}),/unavailable/);
const creating=await creation('begin_create');
assert.equal(creating.refreshToken,'trial-token');
await assert.rejects(creation('begin_create'),/already being set up/);
let calendarCreates=0;
const catalog=createGraph('fixture-access',Date.now()+20000,async(url,init)=>{
 assert.equal(new URL(url).pathname,'/v1.0/me/calendars');
 const family={id:'family-calendar',name:'HH Family',canEdit:true};
 if(init.method==='GET')return Response.json({value:calendarCreates?[family]:[]});
 assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{name:'HH Family'});
 calendarCreates++;
 return Response.json(family,{status:201});
});
const family=await catalog.familyCalendar();
assert.deepEqual(await catalog.familyCalendar(),family);
assert.equal(calendarCreates,1);
await creation('finish_create',{lease:creating.lease,calendar:family});
assert.deepEqual((await call('status')).calendars.map(c=>c.name),['Existing family','HH Family']);
await assert.rejects(call('connect',{calendarId:'calendar=unlisted'}),/Choose a calendar from the list/);
await call('connect',{calendarId});
assert.equal((await call('status')).active,true);
assert.equal((await call('status')).importEvents,false);
assert.equal(await call('receive',{outlookId:'forced-import'}),false);
await db.exec('reset role');
assert.equal(await scalar("select count(*)::int from vault.secrets where secret='trial-token'"),1);

const makeEvent=(id,subject,extra={})=>({
 id,subject,changeKey:'v1','@odata.etag':'W/"v1"',sensitivity:'normal',type:'singleInstance',
 isOrganizer:true,isCancelled:false,isAllDay:false,attendees:[],location:{displayName:'Cornwall'},
 body:{contentType:'text',content:'Family notes'},
 start:{dateTime:'2038-03-15T14:00:00.0000000',timeZone:'UTC'},end:{dateTime:'2038-03-15T15:00:00.0000000',timeZone:'UTC'},
 ...extra
});
const home=eventFields(makeEvent('fixture','Created in HH'));
assert.ok(home);
assert.equal(eventFields(makeEvent('fixture','Ignored',{sensitivity:'private'})),null);
assert.equal(eventFields(makeEvent('fixture','Ignored',{hasAttachments:true})),null);
const dst=eventFields(makeEvent('fixture','All day',{isAllDay:true,
 start:{dateTime:'2026-03-07T05:00:00',timeZone:'UTC'},end:{dateTime:'2026-03-09T04:00:00',timeZone:'UTC'}}));
assert.deepEqual([dst.start_date,dst.end_date],['2026-03-07','2026-03-09']);
assert.equal(outlookFields(dst).end.dateTime,'2026-03-09T00:00:00');
const homeId='10000000-0000-4000-8000-000000000004';
await db.query("insert into public.household_events(id,household_id,title,description,location,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",
 [homeId,householdId,home.title,home.description,home.location,home.starts_at,home.ends_at]);

const remote=new Map([
 ['existing',makeEvent('existing','Created in Outlook')],
 ['private',makeEvent('private','Personal notes',{sensitivity:'private'})],
 ['meeting',makeEvent('meeting','Company meeting',{attendees:[{}]})],
 ['repeat',makeEvent('repeat','Repeat',{type:'seriesMaster'})]
]);
const writes=[];
const occurrences=new Map();
const utc=stamp=>stamp?.timeZone==='Eastern Standard Time'?
 {dateTime:nativeInstant(stamp.dateTime.slice(0,10),stamp.dateTime.slice(11)).slice(0,-1),timeZone:'UTC'}:stamp;
const responseFields=body=>({...body,...(body.start?{start:utc(body.start),end:utc(body.end)}:{})});
const version=(item,fields)=>({...item,...responseFields(fields),changeKey:'v'+(writes.length+1),'@odata.etag':'W/"v'+(writes.length+1)+'"'});
const occurrence=(master,date,extra={})=>makeEvent(master+'-'+date,'HH weekly series',{
 type:'occurrence',occurrenceId:'OID.'+master+'.'+date,
 start:{dateTime:date+'T14:00:00',timeZone:'UTC'},end:{dateTime:date+'T15:00:00',timeZone:'UTC'},...extra
});
let networkBreak=false,breakBeforeAck=false,htmlDetail=false,conflictOnDelete=false,eventsCreated=0;
const base='/v1.0/me/calendars/'+encodeURIComponent(calendarId);
const request=async(url,options)=>{
 const address=new URL(url),method=options.method,path=address.pathname,body=options.body?JSON.parse(options.body):null;
 assert.equal(address.origin,'https://graph.microsoft.com');
 assert.equal(options.headers.Authorization,'Bearer fixture-access');
 const response=(payload,status=200)=>Response.json(payload,{status});
 if(path===base)return response({id:calendarId,canEdit:true});
 if(path===base+'/events'&&method==='GET')return response({value:[...remote.values()],
  ...(networkBreak?{'@odata.nextLink':'https://untrusted.invalid'+base+'/events?cursor=x'}:{})});
 if(path===base+'/events'&&method==='POST'){
  writes.push(method);
  const id='from-home-'+(++eventsCreated);
  const result={...makeEvent(id,body.subject),...responseFields(body),...(body.recurrence?{type:'seriesMaster',exceptionOccurrences:[],cancelledOccurrences:[]}:{} )};
  remote.set(id,result);
  if(breakBeforeAck){breakBeforeAck=false;throw Error('Response lost after commit')}
  return response(result,201);
 }
 if(path.endsWith('/instances')){
  const master=path.split('/').at(-2),date=address.searchParams.get('startDateTime').slice(0,10);
  const item=occurrence(master,date);
  occurrences.set(item.id,{master,item});
  return response({value:[item]});
 }
 const id=path.split('/').at(-1),instance=occurrences.get(id);
 const item=remote.get(id)??instance?.item;
 if(method==='GET')return item?response(htmlDetail&&id==='from-home-1'?{...item,body:{contentType:'html',content:'<html>Family notes</html>'}}:item):response({},404);
 assert.equal(path,base+'/events/'+id);
 assert.equal(options.headers['If-Match'],item['@odata.etag']);
 if(method==='DELETE'&&conflictOnDelete){conflictOnDelete=false;return response({},412)}
 writes.push(method);
 if(instance){
  const master=remote.get(instance.master);
  const exceptions=master.exceptionOccurrences.filter(e=>e.id!==id);
  if(method==='DELETE'){
   remote.set(master.id,{...master,exceptionOccurrences:exceptions,cancelledOccurrences:[...master.cancelledOccurrences,item.occurrenceId]});
   occurrences.delete(id);
   return new Response(null,{status:204});
  }
  const updated=version(item,{...body,type:'exception'});
  occurrences.set(id,{master:master.id,item:updated});
  remote.set(master.id,{...master,exceptionOccurrences:[...exceptions,updated]});
  return response(updated);
 }
 if(method==='DELETE'){remote.delete(id);return new Response(null,{status:204})}
 if(item.type==='seriesMaster'){
  const updated=version(item,body);
  remote.set(id,updated);
  return response(updated);
 }
 assert.deepEqual(body,{subject:'HH edit'},'Editing only the name must preserve Outlook formatting and location metadata');
 const updated={...item,...body,changeKey:'v3','@odata.etag':'W/"v3"'};
 remote.set(id,updated);
 return response(updated);
};
let tick=0;
async function sync(expectedProblem=null){
 await db.exec('set role service_role');
 try{
  const lease=await call('lease');
  assert.ok(lease.lease);
  assert.equal(await call('lease'),null);
  const worker=(action,data)=>call(action,{...data,lease:lease.lease});
  await assert.rejects(call('snapshot'),/expired/);
  try{
   let problem=await syncEvents(createGraph('fixture-access',Date.now()+20000,request),worker,lease.calendarId,lease.initial);
   assert.equal(problem,expectedProblem);
   tick++;
   await worker('finish',{problem});
  }catch(error){await worker('finish',{problem:'retry'});throw error}
 }finally{await db.exec('reset role')}
}
breakBeforeAck=true;
await assert.rejects(sync(),/Response lost/);
await sync();
assert.equal(eventsCreated,1,'A lost response must not duplicate an Outlook event');
assert.equal(await scalar('select count(*)::int from public.household_events'),1,'Share mode must leave Outlook-only events in Outlook');
remote.set('from-home-1',{...remote.get('from-home-1'),subject:'Edited a shared HH copy in Outlook',
 changeKey:'shared-v2','@odata.etag':'W/"shared-v2"'});
await sync();
assert.equal(await scalar('select title from public.household_events where id=$1',[homeId]),'Edited a shared HH copy in Outlook');

await call('disconnect');
await call('choose',{microsoftId:'fixture-user',calendars:[{id:calendarId,name:'Existing family'}],refreshToken:'trial-token'});
await call('connect',{calendarId,importEvents:true});
assert.equal((await call('status')).importEvents,true);
await sync();
assert.equal(await scalar('select count(*)::int from public.household_events'),2);
const outlookId=await scalar("select id from public.household_events where title='Created in Outlook'");
remote.set('existing',makeEvent('existing','Outlook edit',{changeKey:'v2','@odata.etag':'W/"v2"'}));
await db.query("update public.household_events set title='HH edit',version=version+1 where id=$1",[homeId]);
await sync();
assert.equal(remote.get('from-home-1').subject,'HH edit');
assert.equal(await scalar('select title from public.household_events where id=$1',[outlookId]),'Outlook edit');

remote.delete('existing');
networkBreak=true;
await assert.rejects(sync(),/invalid calendar page/);
assert.equal(await scalar('select count(*)::int from public.household_events'),2,'A failed list must not delete HH events');
networkBreak=false;
await db.query('delete from public.household_events where id=$1',[homeId]);
const copyBeforeDelete=remote.get('from-home-1');
remote.set(copyBeforeDelete.id,{...copyBeforeDelete,attendees:[{}],changeKey:'has-guest','@odata.etag':'W/"has-guest"'});
await sync('review');
assert.equal(remote.has(copyBeforeDelete.id),true,'Keep Outlook copies that now have a guest');
remote.set(copyBeforeDelete.id,{...copyBeforeDelete,subject:'Edited before deletion',changeKey:'edited-outside-hh','@odata.etag':'W/"edited-outside-hh"'});
htmlDetail=true;
conflictOnDelete=true;
await assert.rejects(sync(),/Outlook changed during sync/);
assert.equal(remote.has(copyBeforeDelete.id),true,'An Outlook edit during deletion is retried using a fresh version');
await sync();
assert.equal(remote.has('from-home-1'),false,'An HH deletion removes the ordinary Outlook copy even after an Outlook edit');
assert.equal(await scalar('select count(*)::int from public.household_events'),0);
assert.deepEqual(writes,['POST','PATCH','DELETE']);
assert.deepEqual([...remote.keys()],['private','meeting','repeat']);
assert.equal(tick,6);

const seriesId='10000000-0000-4000-8000-000000000005';
const weekly=['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=6'];
await db.query("insert into public.household_events(id,household_id,title,description,location,starts_at,ends_at,recurrence,exceptions) values($1,$2,'HH weekly series','Family notes','Cornwall','2038-03-15T14:00:00Z','2038-03-15T15:00:00Z',$3,$4)",
 [seriesId,householdId,weekly,JSON.stringify({'2038-03-22':null,'2038-03-29':{...home,person:'Everyone',title:'Moved in HH',starts_at:'2038-03-30T14:00:00Z',ends_at:'2038-03-30T15:00:00Z'}})]);
await sync();
const exported=remote.get('from-home-2');
assert.equal(exported.recurrence.pattern.type,'weekly');
assert.equal(exported.recurrence.range.numberOfOccurrences,6);
assert.deepEqual(exported.cancelledOccurrences,['OID.from-home-2.2038-03-22']);
assert.equal(exported.exceptionOccurrences[0].subject,'Moved in HH');
const priorWrites=writes.length;
await sync();
assert.equal(writes.length,priorWrites,'A repeated sync leaves unchanged Outlook series and exceptions alone');
const externalMove=occurrence(exported.id,'2038-04-05',{type:'exception',subject:'Moved in Outlook',
 start:{dateTime:'2038-04-06T14:00:00',timeZone:'UTC'},end:{dateTime:'2038-04-06T15:00:00',timeZone:'UTC'}});
remote.set(exported.id,{...exported,exceptionOccurrences:[...exported.exceptionOccurrences,externalMove],
 cancelledOccurrences:[...exported.cancelledOccurrences,'OID.from-home-2.2038-04-12']});
await sync();
const hhExceptions=await scalar('select exceptions from public.household_events where id=$1',[seriesId]);
assert.equal(hhExceptions['2038-04-05'].title,'Moved in Outlook','A changed occurrence imports even if the series change key did not change');
assert.equal(hhExceptions['2038-04-12'],null);
assert.equal(hhExceptions['2038-03-29'].title,'Moved in HH');
const providerOnly=makeEvent('outlook-series','Created a series in Outlook',{type:'seriesMaster',recurrence:exported.recurrence,
 exceptionOccurrences:[],cancelledOccurrences:['OID.outlook-series.2038-03-22']});
remote.set(providerOnly.id,providerOnly);
await sync();
const importedSeries=(await db.query("select id,recurrence,exceptions from public.household_events where title='Created a series in Outlook'")).rows[0];
assert.deepEqual(importedSeries.recurrence,weekly);
assert.deepEqual(importedSeries.exceptions,{'2038-03-22':null});
await db.query("update public.household_events set title='Edited Outlook series in HH',version=version+1 where id=$1",[importedSeries.id]);
await sync();
assert.equal(remote.get(providerOnly.id).subject,'Edited Outlook series in HH');
remote.delete(providerOnly.id);
await sync();
assert.equal(await scalar('select exists(select 1 from public.household_events where id=$1)',[importedSeries.id]),false);
assert.equal(await scalar('select count(*)::int from public.household_events'),1,'Deleting one series leaves the other intact');

await call('disconnect');
assert.equal((await call('status')).active,false);
assert.equal(await call('lease'),null);
assert.equal(await scalar("select count(*)::int from vault.secrets where secret='trial-token'"),0);
assert.equal(await scalar('select count(*)::int from private.outlook_calendar_links where retired'),3);
await db.close();
console.log('Outlook trial checks passed: default HH sharing, opt-in import, one-use authorization, safe HH Family calendar creation, two-way edits and deletions, lost-response recovery and credential cleanup.');
