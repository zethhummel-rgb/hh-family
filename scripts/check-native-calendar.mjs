import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(compile(s)).toString('base64');
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const recurrenceUri=uri(read('supabase/functions/google-calendar/recurrence.ts'));
const nativeUri=uri(read('supabase/functions/google-calendar/native.ts').replace("'./recurrence.ts'",JSON.stringify(recurrenceUri)));
const native=await import(nativeUri),{expandNativeEvent,expandNativeEvents,occurrenceForDate,nativeInstant}=native;
const {buildRecurrence,validateRecurrence}=await import(recurrenceUri);
const id='11111111-1111-4111-8111-111111111111',hid='22222222-2222-4222-8222-222222222222';
const options={frequency:'WEEKLY',interval:2,ending:'never',until:'',count:10};
const master={id,title:'Family plans',description:'Notes',location:'Home',person:'Everyone',person_ids:[],reminder_minutes:15,starts_at:'2026-10-21T23:20:00.000Z',ends_at:'2026-10-22T00:20:00.000Z',all_day:false,start_date:null,end_date:null,version:1,source:'home',recurrence:buildRecurrence(options,'2026-10-21',false),exceptions:{}};
const dates=events=>events.map(e=>native.localDate(e.starts_at));
let events=expandNativeEvent(master,'2026-10-01T00:00:00Z','2026-12-01T00:00:00Z');
assert.deepEqual(dates(events),['2026-10-21','2026-11-04','2026-11-18']);
assert.equal(events[0].starts_at,'2026-10-21T23:20:00.000Z');assert.equal(events[1].starts_at,'2026-11-05T00:20:00.000Z');assert.equal(events[0].id,id+'@2026-10-21');assert.equal(events[0].series_id,id);
const repeat=(changes,start='2026-10-21',allDay=false)=>({...master,recurrence:buildRecurrence({...options,...changes},start,allDay)});
assert.deepEqual(dates(expandNativeEvent(repeat({frequency:'DAILY',interval:5,ending:'after',count:3}),'2026-10-01T00:00:00Z','2027-01-01T00:00:00Z')),['2026-10-21','2026-10-26','2026-10-31']);
assert.deepEqual(dates(expandNativeEvent(repeat({ending:'on',until:'2026-11-04'}),'2026-10-01T00:00:00Z','2027-01-01T00:00:00Z')),['2026-10-21','2026-11-04']);
const allDay={...master,all_day:true,start_date:'2026-10-31',end_date:'2026-11-01',starts_at:'2026-10-31T04:00:00.000Z',ends_at:'2026-11-01T04:00:00.000Z',recurrence:buildRecurrence({...options,frequency:'MONTHLY',interval:1,ending:'after',count:4},'2026-10-31',true)};
events=expandNativeEvent(allDay,'2026-10-01T00:00:00Z','2027-06-01T00:00:00Z');assert.deepEqual(events.map(e=>e.start_date),['2026-10-31','2026-12-31','2027-01-31','2027-03-31']);
const birthday={...allDay,start_date:'2028-02-29',end_date:'2028-03-01',starts_at:'2028-02-29T05:00:00Z',ends_at:'2028-03-01T05:00:00Z',recurrence:buildRecurrence({...options,frequency:'YEARLY',interval:1,ending:'after',count:3},'2028-02-29',true)};
assert.deepEqual(expandNativeEvent(birthday,'2027-01-01T00:00:00Z','2037-01-01T00:00:00Z').map(e=>e.start_date),['2028-02-29','2032-02-29','2036-02-29']);
const fall={...allDay,start_date:'2026-11-01',end_date:'2026-11-02',starts_at:'2026-11-01T04:00:00Z',ends_at:'2026-11-02T05:00:00Z',recurrence:buildRecurrence({...options,frequency:'DAILY',interval:1,ending:'after',count:2},'2026-11-01',true)};
events=expandNativeEvent(fall,'2026-11-01T00:00:00Z','2026-11-04T00:00:00Z');assert.equal((Date.parse(events[0].ends_at)-Date.parse(events[0].starts_at))/3600000,25);assert.equal((Date.parse(events[1].ends_at)-Date.parse(events[1].starts_at))/3600000,24);
assert.equal(nativeInstant('2027-03-14','02:30'),null);
const gap={...master,starts_at:'2027-03-13T07:30:00Z',ends_at:'2027-03-13T08:00:00Z',recurrence:buildRecurrence({...options,frequency:'DAILY',interval:1,ending:'after',count:2},'2027-03-13',false)};
assert.deepEqual(dates(expandNativeEvent(gap,'2027-03-01T00:00:00Z','2027-03-20T00:00:00Z')),['2027-03-13','2027-03-15']);
const moved={...master,exceptions:{'2026-11-04':null,'2026-10-21':{title:'Moved dinner',starts_at:'2027-01-10T22:00:00Z',ends_at:'2027-01-10T23:00:00Z'}}};
assert.deepEqual(dates(expandNativeEvent(moved,'2026-10-01T00:00:00Z','2026-11-10T00:00:00Z')),[]);
events=expandNativeEvent(moved,'2027-01-10T00:00:00Z','2027-01-11T00:00:00Z');assert.equal(events.length,1);assert.equal(events[0].title,'Moved dinner');assert.equal(events[0].original_date,'2026-10-21');
assert.deepEqual(expandNativeEvent({...master,recurrence:[]},'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z'),[]);
assert.equal(expandNativeEvent(master,'2090-01-01T00:00:00Z','2090-02-01T00:00:00Z').length,2);
const {reminderDue,isDue,deliveryKey}=await import(uri(read('supabase/functions/event-reminders/logic.ts')));
events=expandNativeEvents([master],'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z');assert.equal(new Date(reminderDue(events[0])).toISOString(),'2026-11-05T00:05:00.000Z');assert.ok(isDue(events[0],Date.parse('2026-11-05T00:06:00Z')));assert.notEqual(deliveryKey(events[0]),deliveryKey(events[1]));
// Execute real client operations against a scoped, optimistic in-memory fixture.
const cjs=ts.transpileModule(read('src/calendarData.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const records=new Map([[id,{...structuredClone(master),household_id:hid}]]);let calls=[];
const supabase={from:()=>{const filters={};let operation='select',payload;const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q},order:()=>q,range:async()=>({data:[...records.values()].filter(e=>e.household_id===filters.household_id),error:null}),update:value=>{operation='update';payload=value;return q},insert:value=>{operation='insert';payload=value;return q},delete:()=>{operation='delete';return q},single:async()=>execute(),maybeSingle:async()=>execute()};function execute(){calls.push({operation,payload,filters});if(operation==='insert'){records.set(payload.id,payload);return {data:{id:payload.id}}}const row=records.get(filters.id);if(!row||row.household_id!==filters.household_id||filters.version!==undefined&&row.version!==filters.version)return {data:null,error:operation==='select'?Error('Not found'):null};if(operation==='update')Object.assign(row,payload);if(operation==='delete')records.delete(filters.id);return {data:operation==='select'?structuredClone(row):{id:row.id}}}return q}};
const exports={};vm.runInNewContext(cjs,{exports,require:path=>path==='./supabase'?{supabase}:path.includes('/native')?native:path.includes('/recurrence')?{validateRecurrence}:{},Intl,Date,crypto,Uint8Array,Error});
const client=exports,instance=(await client.getEvents(hid,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',false))[0];
const draft={title:'Only this date',description:'',location:'',person:'Everyone',starts_at:instance.starts_at,ends_at:instance.ends_at,all_day:false,start_date:null,end_date:null,reminder_minutes:15,reminder_30_enabled:false};
await client.saveEvent(hid,draft,instance,false,'unused');assert.equal(records.get(id).exceptions['2026-11-04'].title,'Only this date');assert.equal(records.get(id).title,'Family plans');
const toggled=await client.getEvents(hid,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',false);
assert.equal(toggled[0].reminder_30_enabled,false);assert.equal(toggled[0].reminder_minutes,15);assert.notEqual(toggled[1].reminder_30_enabled,false);
await assert.rejects(client.saveEvent(hid,draft,instance,false,'unused'),/changed/);
const updated=(await client.getEvents(hid,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',false))[0];await client.deleteEvent(hid,updated,false);assert.equal(records.get(id).exceptions['2026-11-04'],null);assert.equal((await client.getEvents(hid,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',false)).length,1);
await assert.rejects(client.getEventSeries('33333333-3333-4333-8333-333333333333',updated));
const series=await client.getEventSeries(hid,updated);await client.saveEvent(hid,{...draft,recurrence:['RRULE:FREQ=DAILY;INTERVAL=5;COUNT=4']},series,false,'unused');assert.deepEqual(Array.from(records.get(id).recurrence),['RRULE:FREQ=DAILY;INTERVAL=5;COUNT=4']);
const current=await client.getEventSeries(hid,updated);await client.deleteEvent(hid,current,false);assert.equal(records.size,0);
// Search sees repeats whose first event is in the past, and edited titles.
const searchExports={};vm.runInNewContext(ts.transpileModule(read('src/calendarSearchData.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:searchExports,require:path=>path==='./calendarData'?{nativeMasters:async()=>[structuredClone(moved)],googleRequest:()=>{throw Error('Google must not be used')}}:path.endsWith('/native')?native:{searchParameters:b=>({...b,asOf:b.asOf||'2026-11-01T00:00:00Z'})},Date,Error});
let page=await searchExports.searchCalendar(hid,false,'family','upcoming');assert.equal(page.events.length,1);assert.equal(page.events[0].original_date,'2026-11-18');
page=await searchExports.searchCalendar(hid,false,'moved','upcoming');assert.equal(page.events.length,1);assert.equal(page.events[0].title,'Moved dinner');
page=await searchExports.searchCalendar(hid,false,'moved','past');assert.equal(page.events.length,0);
const savedRule=moved.recurrence;moved.recurrence=[];page=await searchExports.searchCalendar(hid,false,'moved','upcoming');assert.equal(page.events.length,0);moved.recurrence=savedRule;
// Optional Google connect preserves edited and cancelled native occurrences.
const {importNativeExceptions}=await import(uri(read('supabase/functions/google-calendar/nativeImport.ts').replace("'./native.ts'",JSON.stringify(nativeUri))));
const requests=[],states=new Map();
await importNativeExceptions(moved,'events/master',async(path,method='GET',body)=>{requests.push({path,method,body});if(method==='GET'){const date=new URL('https://test/'+path).searchParams.get('originalStart');const original=new Date(date).toISOString();return {items:[{id:original,originalStartTime:{dateTime:original},status:states.get(original)||'confirmed'}]}}states.set(path.split('/').at(-1),method==='DELETE'?'cancelled':'confirmed');return {};},e=>({summary:e.title,start:e.starts_at,recurrence:e.recurrence}));
assert.equal(requests.filter(r=>r.method==='DELETE').length,1);assert.equal(requests.find(r=>r.method==='PATCH').body.summary,'Moved dinner');assert.equal(requests.find(r=>r.method==='PATCH').body.recurrence,undefined);
assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.path.startsWith('events/')&&!r.path.startsWith('events/master/')));
console.log('Native repeat checks passed: intervals, count/end dates, skipped month/leap dates, DST, stable identities, moved/cancelled occurrences, reminders, series editing, stale writes and household scoping.');

// Old large-count series: count history once without materializing every occurrence.
const ancient={...master,id:'expired-audit',starts_at:'1900-01-01T14:00:00Z',ends_at:'1900-01-01T15:00:00Z',recurrence:['RRULE:FREQ=DAILY;INTERVAL=1;COUNT=9999'],exceptions:{}};
let work=0;const began=performance.now();
assert.deepEqual(expandNativeEvents(Array.from({length:10},(_,i)=>({...ancient,id:'expired-'+i})),'2026-10-22T00:00:00Z','2026-10-30T00:00:00Z',()=>{work++}),[]);
assert.ok(work<11000,'Matching expired series must reuse their bounded historical count');
console.log('Expired ten-series regression:',work,'work checks,',Math.round(performance.now()-began),'ms.');
// A later-window cache cannot hide earlier occurrences, changed rules or moved exceptions.
assert.equal(expandNativeEvent(ancient,'1900-01-01T00:00:00Z','1900-01-04T00:00:00Z').length,3);
assert.equal(expandNativeEvent({...ancient,recurrence:['RRULE:FREQ=DAILY;INTERVAL=1;COUNT=2']},'1900-01-01T00:00:00Z','1900-01-04T00:00:00Z').length,2);
assert.equal(expandNativeEvent({...ancient,exceptions:{'1900-01-01':{title:'Moved from expired series',starts_at:'2026-10-22T13:00:00Z',ends_at:'2026-10-22T14:00:00Z'}}},'2026-10-22T00:00:00Z','2026-10-23T00:00:00Z').length,1);
// The selected count must still exclude nonexistent spring-forward wall times.
assert.deepEqual(dates(expandNativeEvent(gap,'2027-03-15T00:00:00Z','2027-03-20T00:00:00Z')),['2027-03-15']);
const ambiguous={...master,starts_at:'2026-11-02T06:30:00Z',ends_at:'2026-11-02T07:00:00Z',recurrence:['RRULE:FREQ=YEARLY;INTERVAL=1;COUNT=2']};
assert.equal(nativeInstant('2026-11-01','01:30',5*3600000),'2026-11-01T05:30:00.000Z');
let checks=0;assert.throws(()=>expandNativeEvents([{...ancient,starts_at:'1901-01-01T14:00:00Z',ends_at:'1901-01-01T15:00:00Z'}],'2026-10-22T00:00:00Z','2026-10-30T00:00:00Z',()=>{if(++checks>100)throw Error('test budget')}),/test budget/);assert.equal(checks,101);

// Count ranking across short months, leap years and DST must agree with the full series.
for(const [series,fullFrom,fullTo,windowFrom,windowTo] of [
 [allDay,'2026-10-01T00:00:00Z','2027-06-01T00:00:00Z','2027-03-01T00:00:00Z','2027-04-01T00:00:00Z'],
 [birthday,'2028-01-01T00:00:00Z','2037-01-01T00:00:00Z','2032-01-01T00:00:00Z','2037-01-01T00:00:00Z'],
 [{...gap,recurrence:['RRULE:FREQ=DAILY;INTERVAL=1;COUNT=3']},'2027-03-01T00:00:00Z','2027-03-20T00:00:00Z','2027-03-16T00:00:00Z','2027-03-20T00:00:00Z']
]){const full=expandNativeEvent(series,fullFrom,fullTo);const expected=full.filter(e=>Date.parse(e.starts_at)<Date.parse(windowTo)&&Date.parse(e.ends_at)>Date.parse(windowFrom));assert.deepEqual(expandNativeEvent(series,windowFrom,windowTo),expected)}
