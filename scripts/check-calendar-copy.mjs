import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const uri=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const base='supabase/functions/google-calendar/';
const recurrence=uri(read(base+'recurrence.ts')),native=uri(read(base+'native.ts').replace("'./recurrence.ts'",JSON.stringify(recurrence)));
let source=read(base+'copy.ts');
for(const [path,url] of [['./native.ts',native],['./recurrence.ts',recurrence],['./tags.ts',uri(read(base+'tags.ts'))],['./reminders.ts',uri(read(base+'reminders.ts'))],['../event-reminders/logic.ts',uri(read('supabase/functions/event-reminders/logic.ts'))]])source=source.replace(JSON.stringify(path).replaceAll('"',"'"),JSON.stringify(url));
const {runCalendarCopy,prepareGoogleTransfer,transferReminderAliases,copyShape,googleCopy}=await import(uri(source));
const {occurrenceForDate}=await import(native);
const hid='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',person='33333333-3333-4333-8333-333333333333';
const master={id,title:'Family plan',description:'Keep the notes',location:'Home',person:'Family member',person_ids:[person],reminder_minutes:1020,reminder_30_enabled:false,starts_at:'2026-10-25T14:00:00.000Z',ends_at:'2026-10-25T15:00:00.000Z',all_day:false,start_date:null,end_date:null,version:3,recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3'],exceptions:{'2026-11-01':null,'2026-11-08':{title:'Moved plan',description:'Keep changed notes',location:'Park',person:'Everyone',person_ids:[],reminder_minutes:15,reminder_30_enabled:true,starts_at:'2026-11-09T20:00:00.000Z',ends_at:'2026-11-09T21:00:00.000Z',all_day:false,start_date:null,end_date:null}}};
const oldGoogle={id:'home'+id.replaceAll('-',''),...googleCopy(master),etag:'master-v1',attendees:[{email:'synthetic@example.invalid'}],extendedProperties:{private:{keep:'private'},shared:{...googleCopy(master).extendedProperties.shared,keep:'other shared metadata'}}};
const cancelled={id:'cancelled-instance',recurringEventId:oldGoogle.id,status:'cancelled',etag:'cancelled-v1',originalStartTime:{dateTime:'2026-11-01T10:00:00-05:00'}};
const changed={id:'changed-instance',recurringEventId:oldGoogle.id,...googleCopy({...master,...master.exceptions['2026-11-08'],recurrence:[]}),etag:'changed-v1',originalStartTime:{dateTime:'2026-11-08T10:00:00-05:00'}};delete changed.recurrence;
const original=[oldGoogle,cancelled,changed];
let transfer=await prepareGoogleTransfer(hid,original,{[id]:1});
assert.equal(transfer.events[0].event.id,id);assert.deepEqual(transfer.events[0].event.recurrence,master.recurrence);assert.deepEqual(transfer.events[0].event.person_ids,[person]);
assert.equal(transfer.events[0].event.reminder_30_enabled,false);assert.equal(transfer.events[0].event.reminder_minutes,1020);assert.equal(transfer.events[0].event.exceptions['2026-11-01'],null);
assert.equal(transfer.events[0].event.exceptions['2026-11-08'].title,'Moved plan');assert.equal(transfer.events[0].event.exceptions['2026-11-08'].starts_at,'2026-11-09T20:00:00.000Z');
const allDay={id:'all-day',summary:'All day',description:'Notes',start:{date:'2026-11-01'},end:{date:'2026-11-02'},recurrence:['RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1']};
let converted=await prepareGoogleTransfer(hid,[allDay],{});assert.equal(converted.events[0].event.starts_at,'2026-11-01T04:00:00.000Z');assert.equal(converted.events[0].event.ends_at,'2026-11-02T05:00:00.000Z');assert.deepEqual(converted.events[0].event.recurrence,['RRULE:FREQ=YEARLY;INTERVAL=1']);
assert.equal(converted.events[0].event.id,(await prepareGoogleTransfer(hid,[allDay],{})).events[0].event.id);
assert.notEqual(converted.events[0].event.id,(await prepareGoogleTransfer('44444444-4444-4444-8444-444444444444',[allDay],{})).events[0].event.id,'Imported IDs are household-specific');
await assert.rejects(prepareGoogleTransfer(hid,[{...oldGoogle,recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']}],{}));
await assert.rejects(prepareGoogleTransfer(hid,[{...oldGoogle,start:{dateTime:master.starts_at,timeZone:'Asia/Tokyo'}}],{}));
const expanded={...oldGoogle,id:'google-original-instance',recurringEventId:oldGoogle.id,start:{dateTime:'2026-11-01T10:00:00-05:00'},end:{dateTime:'2026-11-01T11:00:00-05:00'},originalStartTime:{dateTime:'2026-11-01T10:00:00-05:00'}};
const aliases=transferReminderAliases(transfer.events,[expanded]);assert.equal(aliases.length,1);assert.equal(aliases[0].minutes,1020);assert.match(aliases[0].googleKey,/:2026-11-01T10:00:00-05:00:1020$/);assert.equal(aliases[0].nativeStart,'2026-11-01T15:00:00.000Z');

function fixture({legacy=false,items=original,event=master,googleFailure=false,unsupported=false,changing=false,failAfterInsert=false,ackFailure=false,conflict=false}={}){
 const calls=[],provider=[],records=new Map(),queue=event?[{eventId:id,revision:1,event:structuredClone(event)}]:[],links=new Map();
 let ready=!legacy,archived=null,imported=null,lease=null,finished=null,rotations=0,failedAfterInsert=false,failAck=ackFailure,reads=0,posts=0,phaseFailure=false;
 if(!legacy)records.set('home'+id.replaceAll('-',''),{...oldGoogle,extendedProperties:structuredClone(oldGoogle.extendedProperties)});
 const api=async(name,{action,payload})=>{
  calls.push({name,action,payload});
  if(name==='calendar_service')return {data:{calendarId:'server-selected-family',refreshToken:'server-only-credential'},error:null};
  const job=queue.find(q=>q.eventId===payload.eventId),link=links.get(payload.eventId);
  if(action==='claim'){if(lease)return {data:null};lease='synthetic-lease';return {data:{lease,nativeReady:ready,baseline:{[id]:1},work:structuredClone(queue)}}}
  if(action==='archive'){archived=structuredClone(payload.events);return {data:{snapshotHash:'synthetic-hash'}}}
  if(action==='import'){assert.deepEqual(archived,items);assert.equal(payload.snapshotHash,'synthetic-hash');imported=payload;ready=true;return {data:{imported:payload.events.length}}}
  if(action==='finish'){finished=payload;lease=null;return {data:{}}}
  if(action==='prepare'){
   if(!job||job.revision!==payload.revision)return {data:null};
   let current=link;
   if(!current){current={google_id:'home'+id.replaceAll('-',''),retired_ids:[],exception_dates:[],pending_dates:[],base_done:false,work_revision:null,synced_version:null};links.set(payload.eventId,current)}
   if(payload.rotate||current.shape&&JSON.stringify(current.shape)!==JSON.stringify(payload.shape)){
    current.retired_ids.push(current.google_id);current.google_id='homecopy'+(++rotations);current.work_revision=null;current.exception_dates=[];current.synced_version=null;
   }
   if(current.work_revision!==payload.revision){current.exception_dates=[...new Set([...current.exception_dates,...payload.dates])];current.pending_dates=[...current.exception_dates];current.base_done=false;current.work_revision=payload.revision}
   current.shape=payload.shape;return {data:structuredClone(current)};
  }
  if(action==='retired_done'){link.retired_ids=link.retired_ids.filter(g=>g!==payload.googleId);return {data:{}}}
  if(action==='base_done'){link.base_done=true;return {data:{}}}
  if(action==='date_done'){link.pending_dates=link.pending_dates.filter(d=>d!==payload.date);return {data:{}}}
  if(action==='event_failed'){job.error=payload.error;return {data:{}}}
  if(action==='event_done'){
   if(failAck){failAck=false;return {error:{message:'Synthetic acknowledgement interruption'}}}
   if(payload.deleted)links.delete(payload.eventId);else {assert.equal(link.base_done,true);assert.equal(link.pending_dates.length,0);link.synced_version=payload.version;link.exception_dates=payload.dates;link.work_revision=null}
   queue.splice(queue.indexOf(job),1);return {data:{}};
  }
  throw Error('Unexpected copy operation '+action);
 };
 const fetcher=async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token'){
   assert.equal(new URLSearchParams(init.body).get('refresh_token'),'server-only-credential');
   return googleFailure?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'google-access'});
  }
  assert.ok(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/server-selected-family/events'));assert.equal(init.headers.Authorization,'Bearer google-access');
  const u=new URL(url),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;provider.push({url,method,body});
  if(method!=='GET')assert.equal(u.searchParams.get('sendUpdates'),'none','Calendar copying must not email guests');
  const gid=decodeURIComponent(u.pathname.split('/').at(-1));
  if(legacy){
   assert.equal(method,'GET','No provider mutation is allowed during preservation');
   if(u.searchParams.get('singleEvents')==='true')return Response.json({items:[expanded]});
   reads++;const values=unsupported?[{...oldGoogle,recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']}]:items;
   return Response.json({items:changing&&reads>1?values.map(e=>({...e,etag:'changed-after-snapshot'})):values});
  }
  if(gid==='instances'){
   const parent=decodeURIComponent(u.pathname.split('/').at(-2)),originalStart=u.searchParams.get('originalStart');
   const instanceId=parent+'_'+originalStart,stored=records.get(instanceId);
   return Response.json({items:[stored||{id:instanceId,status:'confirmed',originalStartTime:{dateTime:originalStart},extendedProperties:{shared:{keep:'instance metadata'}}}]});
  }
  if(method==='GET'){const value=records.get(gid);return value?Response.json(value):Response.json({error:'missing'},{status:404})}
  if(method==='DELETE'){records.delete(gid);for(const key of records.keys())if(key.startsWith(gid+'_'))records.delete(key);return new Response(null,{status:204})}
  if(method==='POST'){
   posts++;if(conflict&&!phaseFailure){phaseFailure=true;return Response.json({error:'reserved ID'},{status:409})}
   if(records.has(body.id))return Response.json({error:'duplicate'},{status:409});records.set(body.id,{...body,etag:'created'});
   if(failAfterInsert&&!failedAfterInsert){failedAfterInsert=true;throw Error('Synthetic timeout after accepted insert')}
   return Response.json(records.get(body.id));
  }
  if(method==='PATCH'){records.set(gid,{...(records.get(gid)||{}),...body,etag:'updated'});return Response.json(records.get(gid))}
  throw Error('Unexpected provider operation');
 };
 return {calls,provider,records,queue,links,run:()=>runCalendarCopy({rpc:api},hid,{clientId:'synthetic-client',clientSecret:'synthetic-secret'},fetcher),get ready(){return ready},get archived(){return archived},get imported(){return imported},get finished(){return finished},get posts(){return posts}};
}
let f=fixture({legacy:true}),result=await f.run();assert.equal(result.transferred,true);assert.equal(f.ready,true);assert.equal(f.imported.events.length,1);assert.deepEqual(f.archived,original);assert.ok(f.imported.deliveryAliases.length>0);assert.ok(f.provider.every(c=>c.method==='GET'));
for(const options of [{googleFailure:true},{unsupported:true},{changing:true}]){
 f=fixture({legacy:true,...options});result=await f.run();assert.equal(f.ready,false);assert.equal(f.imported,null);assert.ok(f.finished.error);assert.ok(f.provider.every(c=>c.method==='GET'));
 if(!options.googleFailure)assert.ok(f.archived,'Preservation is captured before unsupported data is rejected');
}
f=fixture();result=await f.run();assert.equal(result.completed,1);assert.equal(f.queue.length,0);assert.equal(f.records.get(oldGoogle.id).summary,master.title);assert.equal(f.records.get(oldGoogle.id).extendedProperties.private.keep,'private');assert.equal(f.records.get(oldGoogle.id).extendedProperties.shared.keep,'other shared metadata');
assert.equal(f.provider.filter(c=>c.method==='DELETE').length,1);const changedCopy=[...f.records.values()].find(e=>e.summary==='Moved plan');assert.ok(changedCopy);assert.equal(changedCopy.extendedProperties.shared.hummel_reminder_30,'on');
f=fixture({googleFailure:true});result=await f.run();assert.equal(f.queue.length,1);assert.equal(result.error,'reconnect');assert.equal(f.provider.length,0);
f=fixture({ackFailure:true});await f.run();assert.equal(f.queue.length,1);await f.run();assert.equal(f.queue.length,0,'A failed database acknowledgement is retried');assert.equal(f.posts,0,'Retrying an existing provider copy does not duplicate it');
f=fixture({event:{...master,recurrence:[],exceptions:{}}});f.records.clear();
await f.run();assert.equal(f.posts,1);assert.equal(f.queue.length,0);
f=fixture({event:{...master,recurrence:[],exceptions:{}},failAfterInsert:true});f.records.clear();
await f.run();assert.equal(f.queue.length,1);await f.run();assert.equal(f.queue.length,0);assert.equal(f.posts,1,'A timeout after accepted insert reuses the saved provider ID');
f=fixture({event:null});f.queue.push({eventId:id,revision:1,event:null});await f.run();assert.equal(f.queue.length,0);assert.equal(f.records.has(oldGoogle.id),false,'A native deletion deletes only its managed provider copy');
// Exception checkpoints make progress across a bounded provider budget.
const large={...master,recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=40'],exceptions:{}};
for(let i=0;i<25;i++){const day=new Date(Date.parse(master.starts_at)+i*7*86400000).toISOString().slice(0,10);const occurrence=occurrenceForDate(large,day);large.exceptions[day]={...occurrence,title:'Changed '+i};}
f=fixture({event:large});let rounds=0;
do{const before=f.provider.length;await f.run();assert.ok(f.provider.length-before<=23);rounds++;}while(f.queue.length&&rounds<5);
assert.equal(f.queue.length,0);assert.ok(rounds>1,'Large series must resume rather than restart their exceptions');
// Removed exceptions are explicitly restored in Google.
f=fixture();await f.run();f.queue.push({eventId:id,revision:2,event:{...master,version:4,exceptions:{}}});await f.run();assert.equal(f.queue.length,0);assert.ok([...f.records.values()].filter(e=>e.originalStartTime).every(e=>e.summary===master.title));
// A changed time/repeat shape replaces only its managed copy.
f=fixture();await f.run();f.records.set('unrelated-google-event',{summary:'Keep separate'});
f.queue.push({eventId:id,revision:2,event:{...master,version:4,starts_at:'2026-10-25T15:00:00.000Z',ends_at:'2026-10-25T16:00:00.000Z'}});
await f.run();assert.equal(f.queue.length,0);assert.equal(f.records.has(oldGoogle.id),false);assert.equal(f.records.get('unrelated-google-event').summary,'Keep separate');assert.equal(f.posts,1);
console.log('Google copy checks passed: exact preservation before import, DST/all-day/repeat/exception/tag/reminder conversion, source remains unchanged on failures, etag recheck, notification aliases, outbound-only writes, metadata preservation, durable retries, idempotent inserts and deletes. No real Google or database requests.');
