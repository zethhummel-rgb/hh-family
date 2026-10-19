import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';import assert from 'node:assert/strict';
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const load=async p=>import('data:text/javascript;base64,'+Buffer.from(compile(fs.readFileSync(new URL(p,import.meta.url),'utf8'))).toString('base64'));
const logic=await load('../supabase/functions/event-reminders/logic.ts');
const {validSubscription,reminderDue,isDue,recipients,deliveryKey}=logic;
const {reminderMinutes,readReminder}=await load('../supabase/functions/google-calendar/reminders.ts');
for(const v of[-1,10081,2.5,'15',NaN])assert.throws(()=>reminderMinutes(v));assert.equal(reminderMinutes(null),null);assert.equal(reminderMinutes(0),0);assert.equal(readReminder(''),null);assert.equal(readReminder('15'),15);
const members=[{user_id:'zeth',display_name:'Zeth Hummel'},{user_id:'chelsea',display_name:'Chelsea Hummel'}];
const event={id:'hockey',title:'Hockey',starts_at:'2026-10-21T23:20:00Z',all_day:false,reminder_minutes:15,person_ids:[]};
assert.equal(reminderDue(event),Date.parse('2026-10-21T23:05:00Z'));
assert.equal(isDue(event,Date.parse('2026-10-21T23:04:59Z')),false);assert.equal(isDue(event,Date.parse('2026-10-21T23:05:00Z')),true);assert.equal(isDue(event,Date.parse('2026-10-21T23:10:00Z')),false);
assert.equal(isDue({...event,reminder_minutes:null},Date.parse(event.starts_at)),false);
for(const [day,time]of[['2026-10-18','13:00:00Z'],['2026-11-01','14:00:00Z'],['2027-03-14','13:00:00Z']])assert.equal(reminderDue({...event,all_day:true,start_date:day,reminder_minutes:0}),Date.parse(day+'T'+time));
assert.deepEqual(recipients(event,members),['zeth','chelsea']);assert.deepEqual(recipients({...event,person_ids:['chelsea']},members),['chelsea']);assert.deepEqual(recipients({...event,person_ids:['outsider']},members),[]);
assert.deepEqual(recipients({...event,person_ids:undefined,person:'Zeth'},members),['zeth']);assert.notEqual(deliveryKey(event),deliveryKey({...event,starts_at:'2026-10-28T23:20:00Z'}));assert.notEqual(deliveryKey(event),deliveryKey({...event,reminder_minutes:30}));
const subscription={endpoint:'https://web.push.apple.com/test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};assert.equal(validSubscription(subscription).endpoint,subscription.endpoint);
for(const endpoint of['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user:password@fcm.googleapis.com/x','https://web.push.apple.com:444/x','https://metadata.google.internal/x'])assert.throws(()=>validSubscription({...subscription,endpoint}));
const raw=fs.readFileSync(new URL('../supabase/functions/event-reminders/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const hid='11111111-1111-4111-8111-111111111111';
function fixture({member=true,validToken=true,connected=false,removed=false,stale=false,cancelled=false,expired=false,task=false,completedTask=false,futureTask=false,googleFailure=false,cronSecret='scheduler-only'}={}){
 let handler,pushes=0,claimed=false,retired=false;const calls=[];
 const now=Date.now();const dueEvent={...event,starts_at:new Date(now+14*60000).toISOString()};
 const device={id:'device',household_id:hid,user_id:'zeth',subscription};
 const query=table=>{const q={select:()=>q,eq:()=>q,not:()=>q,gte:()=>q,lte:()=>q,limit:async()=>({data:table==='household_items'?(task&&!completedTask?[{id:'11111111-1111-4111-8111-111111111111',title:'Hockey',person:'Everyone',remind_at:new Date(now+(futureTask?86400000:-60000)).toISOString()}]:[]):task||cancelled?[]:[{...dueEvent,...(stale?{reminder_minutes:null}:{})}],error:null}),maybeSingle:async()=>({data:member?{user_id:'zeth'}:null,error:null}),single:async()=>({data:{owner_id:'zeth'},error:null}),then:resolve=>resolve({data:table==='household_people'?[]:members,error:null})};return q};
 const admin={auth:{getUser:async()=>({data:{user:validToken?{id:'zeth'}:null},error:!validToken})},from:query,rpc:async(name,{action,payload})=>{
  calls.push(action);
  if(name==='calendar_service')return {data:connected?{migrationComplete:true,calendarId:'family',userId:'zeth',refreshToken:'never-to-client'}:null};
  const data={config:'public-vapid-key',secrets:{cronSecret,keys:{publicKey:'public',privateKey:'server-only'}},lock:true,unlock:{},households:[hid],devices:[device],status:{enabled:true},subscribe:{enabled:true},unsubscribe:{},test:device,retire:{},finish:{}};
  if(action==='claim'){const ok=!claimed&&!removed;claimed=true;return {data:ok}}
  if(action==='retire')retired=true;return {data:data[action],error:null};
 }};
 const fetch=async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token')return googleFailure?Response.json({error:'revoked'},{status:401}):Response.json({access_token:'google-only'});
  if(url.startsWith('https://www.googleapis.com/calendar/'))return Response.json({items:cancelled?[{id:'cancelled',status:'cancelled'}]:[{id:'hockey',summary:'Hockey',start:{dateTime:dueEvent.starts_at},extendedProperties:{shared:{hummel_people:'[]',hummel_reminder:stale?'':'15'}}}]});
  assert.equal(url,subscription.endpoint);assert.equal(init.redirect,'error');pushes++;return new Response(null,{status:expired?410:201});
 };
 const webpush={generateVAPIDKeys:()=>({publicKey:'public',privateKey:'server-only'}),generateRequestDetails:(s,p,o)=>{assert.equal(o.TTL,300);assert.equal(o.vapidDetails.privateKey,'server-only');assert.equal(o.contentEncoding,'aes128gcm');assert.equal(JSON.parse(p).title,'Hockey');return {endpoint:s.endpoint,headers:{Authorization:'VAPID encrypted'},body:'encrypted bytes'}}};
 vm.runInNewContext(compile(raw),{...logic,createClient:()=>admin,webpush,Deno:{env:{get:k=>({APP_URL:'https://hh-pilot.example.test/',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'never-to-client',GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'never-to-client'})[k]},serve:fn=>handler=fn},fetch,Response,Request,URL,URLSearchParams,TextEncoder,Uint8Array,crypto,AbortSignal});
 return{calls,get pushes(){return pushes},get retired(){return retired},request:async(body,headers={})=>{const r=await handler(new Request('https://test.supabase.co/functions/v1/event-reminders',{method:'POST',headers:{origin:'https://hh-pilot.example.test',authorization:'Bearer session',...headers},body:JSON.stringify({householdId:hid,...body})}));return {status:r.status,data:await r.json()}}};
}
let f=fixture(),r=await f.request({action:'status'});assert.equal(r.status,200);assert.equal(r.data.publicKey,'public-vapid-key');assert.equal(JSON.stringify(r.data).includes('server-only'),false);assert.equal(f.calls.includes('secrets'),false);
for(const config of[{member:false},{validToken:false}]){f=fixture(config);r=await f.request({action:'subscribe',subscription});assert.ok([401,403].includes(r.status));assert.equal(f.calls.includes('subscribe'),false)}
f=fixture();r=await f.request({action:'subscribe',subscription:{...subscription,endpoint:'https://127.0.0.1/private'}});assert.equal(r.status,400);assert.equal(f.calls.includes('subscribe'),false);
f=fixture();r=await f.request({action:'dispatch'});assert.equal(r.status,400);assert.equal(f.pushes,0);
f=fixture();r=await f.request({action:'dispatch'},{'x-hummel-cron':'wrong'});assert.equal(r.status,401);assert.equal(f.pushes,0);
for(const connected of[false,true]){f=fixture({connected});r=await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(r.status,200);assert.equal(f.pushes,1);await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.pushes,1);assert.equal(f.calls.includes('unlock'),true)}
for(const config of[{removed:true},{stale:true},{cancelled:true},{connected:true,stale:true},{connected:true,cancelled:true}]){f=fixture(config);await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.pushes,0)}
f=fixture({expired:true});await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.retired,true);
// Service worker does not cache pages. It always displays push and constrains click navigation.
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),handlers={};let shown,opened;
const scope='https://hh-pilot.example.test/';
vm.runInNewContext(sw,{URL,self:{registration:{scope,showNotification:async(title,options)=>shown={title,...options}},location:{origin:new URL(scope).origin},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened=url},skipWaiting:async()=>{},addEventListener:(name,handler)=>handlers[name]=handler}});
let work;handlers.push({data:{json:()=>({title:'Hockey',body:'Soon',date:'2026-10-21',eventId:'hockey'})},waitUntil:p=>work=p});await work;assert.equal(shown.title,'Hockey');assert.equal(new URL(shown.data.url).searchParams.get('reminder_event'),'hockey');
handlers.notificationclick({notification:{...shown,close:()=>{}},waitUntil:p=>work=p});await work;assert.ok(opened.startsWith(scope));assert.equal(handlers.fetch,undefined);
console.log('Reminder checks passed: Eastern/DST and all-day timing, tagged recipients, household recipient routing, native/Google delivery, cancelled/disabled/removed-member guards, deduplication, expired-device cleanup, authenticated APIs, scheduler credential, endpoint allowlist, encrypted push contract, and safe notification clicks.');

// Device registration is account-bound and refreshes an expired session only once.
const clientSource=fs.readFileSync(new URL('../src/push.ts',import.meta.url),'utf8');
function clientFixture({status=200,changed=false}={}){
 const calls=[];let refreshes=0,reads=0;const session={user:{id:'account'},access_token:'initial'};
 const supabase={auth:{getSession:async()=>({data:{session:++reads>1&&changed?{...session,user:{id:'other'}}:session}}),refreshSession:async()=>{refreshes++;return {data:{session:{...session,access_token:'renewed'}}}}},functions:{invoke:async(name,options)=>{calls.push({name,...options});return status!==200&&calls.length===1?{error:{context:{status,json:async()=>({error:'Rejected'})}}}:{data:{enabled:true}}}}};
 const exports={};vm.runInNewContext(ts.transpileModule(clientSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({supabase}),URL,Uint8Array,atob});return {calls,get refreshes(){return refreshes},request:exports.pushRequest};
}
let client=clientFixture({status:401});await client.request('subscribe',hid,{subscription});assert.equal(client.calls.length,2);assert.equal(client.refreshes,1);assert.equal(client.calls[1].headers.Authorization,'Bearer renewed');assert.equal(client.calls[0].name,'event-reminders');assert.deepEqual(client.calls[0].body,client.calls[1].body);
client=clientFixture({status:401,changed:true});await assert.rejects(client.request('subscribe',hid,{subscription}));assert.equal(client.calls.length,1);assert.equal(client.refreshes,0);
client=clientFixture({status:400});await assert.rejects(client.request('subscribe',hid,{subscription}));assert.equal(client.calls.length,1);assert.equal(client.refreshes,0);

for(const connected of[false,true]){f=fixture({task:true,connected,googleFailure:connected});r=await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(r.status,200);assert.equal(f.pushes,1);await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.pushes,1)}
f=fixture({task:true,completedTask:true});await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.pushes,0);
handlers.push({data:{json:()=>({title:'Flea and tick reminder',taskId:'11111111-1111-4111-8111-111111111111',date:'2026-10-21'})},waitUntil:p=>work=p});await work;assert.equal(new URL(shown.data.url).searchParams.get('reminder_task'),'11111111-1111-4111-8111-111111111111');assert.equal(new URL(shown.data.url).searchParams.has('reminder_date'),false);
console.log('Task reminder checks passed: independent delivery when Google is unavailable, completed reminders excluded, duplicate prevention, and reminder-list notification navigation.');

// Completed repeats wait in Done, then return on the next Eastern calendar date.
const {reminderWaiting,reminderIsDone}=await load('../src/taskReminders.ts');
const monthly={id:'dogs',kind:'task',title:'Dogs',done:0,due:'2026-11-18',repeat_unit:'month',repeat_every:1,last_completed_at:'2026-10-18T20:31:00Z'};
assert.equal(reminderWaiting(monthly,'2026-10-18'),true);
assert.equal(reminderIsDone(monthly,'2026-11-17'),true);
assert.equal(reminderIsDone(monthly,'2026-11-18'),false);
assert.equal(reminderIsDone(monthly,'2026-11-19'),false);
assert.equal(reminderIsDone({...monthly,last_completed_at:null},'2026-10-18'),false);
assert.equal(reminderIsDone({...monthly,repeat_unit:'none',done:1},'2026-11-18'),true);
assert.equal(reminderIsDone({...monthly,repeat_unit:'none',done:0,due:''},'2026-10-18'),false);
assert.equal(reminderWaiting({...monthly,kind:'grocery'},'2026-10-18'),false);
assert.equal(reminderIsDone({...monthly,due:'2027-01-01'},'2026-12-31'),true);
assert.equal(reminderIsDone({...monthly,due:'2027-01-01'},'2027-01-01'),false);
console.log('To-do checks passed: completed repeats wait in Done, exact-date reactivation, new scheduled tasks stay active, one-off completion and undated to-dos, year rollover, grocery isolation.');

f=fixture({task:true,futureTask:true});await f.request({action:'dispatch'},{'x-hummel-cron':'scheduler-only'});assert.equal(f.pushes,0);
console.log('Waiting repeats do not notify before their next scheduled time.');
