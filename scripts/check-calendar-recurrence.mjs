import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const transitionSource=fs.readFileSync(new URL('../supabase/functions/google-calendar/transition.ts',import.meta.url),'utf8');
const transitionModule=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(transitionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const recurrenceSource=fs.readFileSync(new URL('../supabase/functions/google-calendar/recurrence.ts',import.meta.url),'utf8');
const recurrence=await import('data:text/javascript;base64,'+Buffer.from(compile(recurrenceSource)).toString('base64'));
const {buildRecurrence,readRecurrence,validateRecurrence}=recurrence;
const options={frequency:'WEEKLY',interval:2,ending:'never',until:'',count:10};
assert.deepEqual(buildRecurrence(options,'2026-10-18',false),['RRULE:FREQ=WEEKLY;INTERVAL=2']);
assert.deepEqual(buildRecurrence({...options,frequency:'DAILY',interval:5,ending:'after',count:6},'2026-10-18',false),['RRULE:FREQ=DAILY;INTERVAL=5;COUNT=6']);
assert.deepEqual(buildRecurrence({...options,frequency:'YEARLY',interval:1},'2027-02-06',true),['RRULE:FREQ=YEARLY;INTERVAL=1']);
assert.deepEqual(buildRecurrence({...options,frequency:'MONTHLY',interval:1,ending:'on',until:'2027-01-31'},'2026-10-31',true),['RRULE:FREQ=MONTHLY;INTERVAL=1;UNTIL=20270131']);
// A date cutoff includes the whole last Eastern day, including either DST transition.
for(const [date,until]of[['2026-11-01','20261102T045959Z'],['2027-03-14','20270315T035959Z']]){
 const r=buildRecurrence({...options,ending:'on',until:date},'2026-10-18',false);assert.match(r[0],new RegExp('UNTIL='+until+'$'));assert.equal(readRecurrence(r,false).until,date);assert.deepEqual(validateRecurrence(r,'2026-10-18',false),r);
}
for(const update of[{interval:0},{interval:1.5},{interval:1000},{ending:'after',count:0},{ending:'after',count:1.5},{ending:'on',until:'2026-02-30'},{ending:'on',until:'2026-10-17'},{frequency:'HOURLY'}])assert.throws(()=>buildRecurrence({...options,...update},'2026-10-18',false));
assert.equal(readRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'],false),null);
assert.equal(readRecurrence(['RRULE:FREQ=WEEKLY;COUNT=5;UNTIL=20271102T045959Z'],false),null);
assert.throws(()=>validateRecurrence(['RDATE:20261018'],'2026-10-18',true));
assert.deepEqual(validateRecurrence([],'2026-10-18',false),[]);
const searchSource=fs.readFileSync(new URL('../supabase/functions/google-calendar/search.ts',import.meta.url),'utf8');
const {searchParameters}=await import('data:text/javascript;base64,'+Buffer.from(compile(searchSource)).toString('base64'));
const tagsSource=fs.readFileSync(new URL('../supabase/functions/google-calendar/tags.ts',import.meta.url),'utf8');
const {encodePersonIds,decodePersonIds}=await import('data:text/javascript;base64,'+Buffer.from(compile(tagsSource)).toString('base64'));
const {reminderMinutes,readReminder}=await import('data:text/javascript;base64,'+Buffer.from(compile(fs.readFileSync(new URL('../supabase/functions/google-calendar/reminders.ts',import.meta.url),'utf8'))).toString('base64'));
const raw=fs.readFileSync(new URL('../supabase/functions/google-calendar/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const code=compile(raw);
const hid='11111111-1111-4111-8111-111111111111',origin='https://hh-pilot.example.test';
const master={id:'series1',summary:'Birthday',description:'Keep these notes',location:'Home',start:{date:'2027-02-06'},end:{date:'2027-02-07'},recurrence:['RRULE:FREQ=YEARLY'],etag:'"v1"',extendedProperties:{private:{keep:'private'},shared:{hummel_person:'Chelsea',keep:'shared'}}};
const instance={...master,id:'series1_20280206',start:{date:'2028-02-06'},end:{date:'2028-02-07'},recurringEventId:'series1',recurrence:undefined,etag:'"i1"'};
function fixture({member=true,validToken=true,nativeReady=false,role='member',legacyBusy=false,transition=false}={}){
 let handler;const calls=[],events=new Map([[master.id,structuredClone(master)],[instance.id,structuredClone(instance)]]);
 const admin={auth:{getUser:async token=>({error:!validToken||token!=='session',data:{user:validToken&&token==='session'?{id:'family-member'}:null}})},from:()=>{const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q},maybeSingle:async()=>({data:member&&filters.household_id===hid&&filters.user_id==='family-member'?{role}:null,error:null})};return q},rpc:async(name,{action})=>({data:name==='household_transition_service'?(transition?{householdId:hid,peerHouseholdId:'22222222-2222-4222-8222-222222222222',peerProject:'ybizqfghnplcxlmlhvyn',token:'c'.repeat(64),personMap:{'child:holt':'33333333-3333-4333-8333-333333333333'}}:null):name==='calendar_copy_service'?(action==='status'?{nativeReady,googleConnected:true,copyStatus:nativeReady?'up_to_date':'importing'}:action==='legacy_lock'?(legacyBusy?null:{lease:'synthetic-lease'}):{}):name==='push_service'?{cronSecret:'scheduler-only'}:{calendarId:'family@example.com',refreshToken:'server-only',migrationComplete:true},error:null})};
 const fakeFetch=async(url,init={})=>{
  if(url==='https://ybizqfghnplcxlmlhvyn.supabase.co/functions/v1/google-calendar'){const body=JSON.parse(init.body);assert.equal(init.headers['x-hh-transition'],'c'.repeat(64));assert.equal(body.householdId,'22222222-2222-4222-8222-222222222222');calls.push({transition:true,body});return Response.json({events:[{...instance,person_ids:['child:holt']}]})}
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'google-access'});
  calls.push({url,method:init.method||'GET',headers:init.headers,body:init.body?JSON.parse(init.body):undefined});
  assert.equal(init.headers.Authorization,'Bearer google-access');const u=new URL(url);assert.ok(u.pathname.startsWith('/calendar/v3/calendars/family%40example.com/events'));
  const id=decodeURIComponent(u.pathname.split('/').at(-1)),method=init.method||'GET';
  if(id==='events'&&method==='GET'){assert.equal(u.searchParams.get('singleEvents'),'true');return Response.json({items:[instance],...(u.searchParams.has('q')&&!u.searchParams.has('pageToken')?{nextPageToken:'next-results'}:{})})}
  if(id==='events'&&method==='POST'){const data=JSON.parse(init.body);events.set(data.id,{...data,etag:'"new"'});return Response.json(events.get(data.id))}
  const current=events.get(id);if(!current)return Response.json({error:'missing'}, {status:404});
  if(init.headers['If-Match']&&init.headers['If-Match']!==current.etag)return Response.json({error:'conflict'}, {status:412});
  if(method==='DELETE'){events.delete(id);return new Response(null,{status:204})}
  if(method==='PATCH'){events.set(id,{...current,...JSON.parse(init.body),etag:'"v2"'});return Response.json(events.get(id))}
  return Response.json(current);
 };
 vm.runInNewContext(code,{reminderMinutes,readReminder,encodePersonIds,decodePersonIds,validateRecurrence,searchParameters,createClient:()=>admin,Deno:{env:{get:k=>({APP_URL:'https://hh-pilot.example.test/',SUPABASE_URL:'https://test.supabase.co',GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'server-secret',SUPABASE_SERVICE_ROLE_KEY:'server-key'})[k]},serve:fn=>{handler=fn}},runCalendarCopy:async()=>({completed:1}),...transitionModule,transitionRequest:(config,action,payload)=>transitionModule.transitionRequest(config,action,payload,fakeFetch),fetch:fakeFetch,AbortSignal,Response,Request,URL,URLSearchParams,TextEncoder,Uint8Array,crypto,btoa});
 return{calls,events,request:async(body,headers={})=>{const r=await handler(new Request('https://test.supabase.co/functions/v1/google-calendar',{method:'POST',headers:{origin,authorization:'Bearer session','content-type':'application/json',...headers},body:JSON.stringify({householdId:hid,...body})}));return{status:r.status,body:await r.json()}}};
}
const draft={title:'Birthday',description:'Notes',location:'Home',person:'Chelsea',starts_at:'2027-02-06T05:00:00Z',ends_at:'2027-02-07T05:00:00Z',all_day:true,start_date:'2027-02-06',end_date:'2027-02-07'};
let f=fixture(),r=await f.request({action:'create',requestId:'a'.repeat(32),event:{...draft,recurrence:buildRecurrence({...options,frequency:'YEARLY',interval:1},'2027-02-06',true)}});assert.equal(r.status,200);assert.equal(r.body.event.recurring,true);assert.deepEqual(f.calls[0].body.recurrence,['RRULE:FREQ=YEARLY;INTERVAL=1']);assert.equal(f.calls[0].body.attendees,undefined);assert.equal(f.calls[0].body.conferenceData,undefined);
f=fixture();r=await f.request({action:'events',from:'2028-02-01T05:00:00Z',to:'2028-03-01T05:00:00Z'});assert.equal(r.body.events[0].series_id,'series1');assert.equal(r.body.events[0].recurring,true);
f=fixture();r=await f.request({action:'series',id:instance.id});assert.equal(r.status,200);assert.equal(r.body.event.id,'series1');assert.deepEqual(r.body.event.recurrence,master.recurrence);assert.equal(r.body.event.start_date,'2027-02-06');assert.equal(f.calls.length,2);
f=fixture();r=await f.request({action:'update',id:instance.id,etag:instance.etag,event:{...draft,title:'Just this birthday',start_date:'2028-02-06',end_date:'2028-02-07'}});assert.equal(r.status,200);assert.equal(f.events.get(master.id).summary,master.summary);assert.equal(f.calls.at(-1).body.recurrence,undefined);assert.equal(f.events.get(instance.id).summary,'Just this birthday');assert.equal(f.events.get(instance.id).extendedProperties.shared.keep,'shared');
f=fixture();r=await f.request({action:'update',id:instance.id,etag:instance.etag,event:{...draft,recurrence:[]}});assert.equal(r.status,400);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,recurrence:['RRULE:FREQ=DAILY;INTERVAL=5;COUNT=3']}});assert.equal(r.status,200);assert.deepEqual(f.events.get(master.id).recurrence,['RRULE:FREQ=DAILY;INTERVAL=5;COUNT=3']);assert.equal(f.events.get(master.id).extendedProperties.private.keep,'private');
f=fixture();r=await f.request({action:'update',id:master.id,etag:'"stale"',event:draft});assert.equal(r.status,400);assert.match(r.body.error,/changed/);assert.equal(f.events.get(master.id).summary,master.summary);
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:draft});assert.equal(r.status,200);assert.deepEqual(f.events.get(master.id).recurrence,master.recurrence);
for(const id of[instance.id,master.id]){f=fixture();r=await f.request({action:'delete',id,etag:id===master.id?master.etag:instance.etag});assert.equal(r.status,200);assert.equal(f.events.has(id),false);assert.equal(f.events.has(id===master.id?instance.id:master.id),true)}
for(const config of[{member:false},{validToken:false}]){f=fixture(config);r=await f.request({action:'series',id:instance.id});assert.ok([401,403].includes(r.status));assert.equal(f.calls.length,0)}
f=fixture();r=await f.request({action:'series',id:instance.id},{origin:'https://untrusted.example'});assert.equal(r.status,403);assert.equal(f.calls.length,0);
f=fixture();r=await f.request({action:'series',id:'../other-calendar'});assert.equal(r.status,400);assert.equal(f.calls.length,0);
// Search is independent of the visible month, with stable pagination bounds.
for(const period of['all','upcoming','past']){f=fixture();r=await f.request({action:'search',query:' hockey & birthday ',period,asOf:'2026-10-18T11:00:00Z'});assert.equal(r.status,200);const u=new URL(f.calls[0].url);assert.equal(u.searchParams.get('q'),'hockey & birthday');assert.equal(u.searchParams.get('maxResults'),'50');assert.equal(u.searchParams.get('timeMin'),period==='upcoming'?'2026-10-18T11:00:00.000Z':null);assert.equal(u.searchParams.get('timeMax'),period==='past'?'2026-10-18T11:00:00.000Z':null);assert.equal(r.body.nextPageToken,'next-results');assert.equal(r.body.events[0].series_id,master.id);r=await f.request({action:'search',query:'hockey & birthday',period,asOf:r.body.asOf,pageToken:r.body.nextPageToken});assert.equal(r.status,200);assert.equal(new URL(f.calls.at(-1).url).searchParams.get('pageToken'),'next-results');assert.equal(r.body.nextPageToken,null)}
for(const change of[{query:''},{query:'x'.repeat(151)},{period:'invalid'},{pageToken:'x'.repeat(4097)},{asOf:'invalid'}]){f=fixture();r=await f.request({action:'search',query:'Hockey',period:'all',...change});assert.equal(r.status,400);assert.equal(f.calls.length,0)}
f=fixture({member:false});r=await f.request({action:'search',query:'Birthday',period:'all'});assert.equal(r.status,403);assert.equal(f.calls.length,0);
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,person:'Chelsea, Holt',person_ids:['22222222-2222-4222-8222-222222222222','child:holt']}});assert.equal(r.status,200);assert.deepEqual(r.body.event.person_ids,['22222222-2222-4222-8222-222222222222','child:holt']);assert.equal(f.events.get(master.id).extendedProperties.shared.keep,'shared');
f=fixture();f.events.get(master.id).extendedProperties.shared.hummel_people='["child:holt"]';r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,person:'Everyone'}});assert.equal(r.status,200);assert.equal(r.body.event.person_ids,undefined);
console.log('Search checks passed: all dates, past/future filters, query encoding, recurrence instances, pagination, input validation, and household access.');
console.log('Repeat checks passed: custom intervals, yearly birthdays, finite endings, DST cutoffs, Google series/occurrence separation, etag conflicts, metadata preservation, and household authorization.');

// Push reminder metadata round-trips through Google without changing other shared data.
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,reminder_minutes:30}});assert.equal(r.status,200);assert.equal(r.body.event.reminder_minutes,30);assert.equal(f.events.get(master.id).extendedProperties.shared.hummel_reminder,'30');
r=await f.request({action:'update',id:master.id,etag:r.body.event.etag,event:{...draft,reminder_minutes:null}});assert.equal(r.status,200);assert.equal(r.body.event.reminder_minutes,null);assert.equal(f.events.get(master.id).extendedProperties.shared.hummel_reminder,'');
for(const reminder_minutes of[-1,10081,1.5,'30']){f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,reminder_minutes}});assert.equal(r.status,400);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0)}

// The 30-minute switch round-trips independently of the additional reminder.
f=fixture();r=await f.request({action:'update',id:instance.id,etag:instance.etag,event:{...draft,reminder_30_enabled:false,reminder_minutes:1020}});assert.equal(r.status,200);assert.equal(r.body.event.reminder_30_enabled,false);assert.equal(r.body.event.reminder_minutes,1020);assert.equal(f.events.get(instance.id).extendedProperties.shared.hummel_reminder_30,'off');assert.equal(f.events.get(master.id).extendedProperties.shared.hummel_reminder_30,undefined);
r=await f.request({action:'update',id:instance.id,etag:r.body.event.etag,event:{...draft,reminder_30_enabled:true,reminder_minutes:1020}});assert.equal(r.status,200);assert.equal(r.body.event.reminder_30_enabled,true);assert.equal(r.body.event.reminder_minutes,1020);
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,reminder_30_enabled:false}});assert.equal(r.status,200);assert.equal(r.body.event.reminder_30_enabled,false);
f=fixture();r=await f.request({action:'update',id:master.id,etag:master.etag,event:{...draft,reminder_30_enabled:'false'}});assert.equal(r.status,400);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);

// Provider CRUD remains available only for an existing, untransferred home.
for(const action of ['create','update','delete','events','search','series']){
 f=fixture({nativeReady:true});r=await f.request({action,id:master.id,etag:master.etag,event:draft});
 assert.equal(r.status,409);assert.match(r.body.error,/Refresh HH/);assert.equal(f.calls.length,0);
}
f=fixture({nativeReady:true});r=await f.request({action:'status'});assert.equal(r.body.connected,false);assert.equal(r.body.googleConnected,true);assert.equal(JSON.stringify(r.body).includes('server-only'),false);
f=fixture({legacyBusy:true});r=await f.request({action:'update',id:master.id,etag:master.etag,event:draft});assert.equal(r.status,409);assert.equal(f.calls.length,0);
f=fixture();r=await f.request({action:'sync'});assert.equal(r.status,403);
f=fixture({role:'owner'});r=await f.request({action:'sync'});assert.equal(r.status,200);assert.equal(r.body.completed,1);
f=fixture();r=await f.request({action:'sync'},{'x-hummel-cron':'wrong'});assert.equal(r.status,401);assert.equal(f.calls.length,0);
f=fixture({validToken:false});r=await f.request({action:'sync'},{'x-hummel-cron':'scheduler-only',origin:'https://untrusted.example'});assert.equal(r.status,200);
console.log('Calendar authority gateway passed: legacy compatibility, transfer write exclusion, native cutover blocks old provider actions, safe status, owner-only sync and scheduler authentication.');

f=fixture({transition:true});r=await f.request({action:'events',from:'2028-02-01T05:00:00Z',to:'2028-03-01T05:00:00Z'});assert.equal(r.status,200);assert.deepEqual(r.body.events[0].person_ids,['33333333-3333-4333-8333-333333333333']);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r.body).includes('cccccccccccccccccccc'));
f=fixture({transition:true,member:false});r=await f.request({action:'events'});assert.equal(r.status,403);assert.equal(f.calls.length,0);
f=fixture({transition:true});r=await f.request({action:'status'});assert.equal(r.body.copyStatus,'transition');assert.equal(r.body.nativeReady,false);assert.equal(f.calls.length,0);
for(const action of ['start','transition_snapshot']){f=fixture({transition:true});r=await f.request({action});assert.ok([400,403].includes(r.status));assert.equal(f.calls.length,0)}
console.log('Transition gateway passed: membership before forwarding, no browser credentials/snapshots, no cross-household/provider selection, tag mapping, and explicit shared-source status.');
