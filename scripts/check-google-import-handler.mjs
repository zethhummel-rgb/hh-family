import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function uri(file){if(cache.has(file))return cache.get(file);let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;code=code.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(uri(path.resolve(path.dirname(file),p))));const value='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,value);return value;}
const {handleImportAction,handleImportCallback}=await import(uri(path.join(root,'supabase/functions/google-calendar/import.ts')));
const userId='11111111-1111-4111-8111-111111111111',hid='22222222-2222-4222-8222-222222222222',previewId='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const config={clientId:'synthetic-client',clientSecret:'synthetic-secret',callback:'https://project.invalid/functions/v1/google-calendar/callback',app:'https://hh.invalid/hh-family/'};
const scopes='https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly';
const calls=[],requests=[];let state=null,active=null,pendingCompletion=null,granted=scopes,failRpc=false;
const admin={rpc:async(name,{action,payload})=>{assert.equal(name,'google_import_service');calls.push({action,payload});if(failRpc)return {error:{message:'internal detail with credential must not escape'}};
 if(action==='start'){state={id:previewId,householdId:payload.householdId,userId:payload.userId,hash:payload.hash,verifier:payload.verifier};return {data:{}}}
 if(action==='state_take'){if(!state||state.hash!==payload.hash)return {data:null};const record=state;state=null;return {data:record}}
 if(action==='authorized'){pendingCompletion=payload.completionHash;active={accessToken:payload.accessToken,expiresAt:'2026-11-01T18:00:00Z',calendars:payload.calendars};return {data:{}}}
 if(action==='get')return {data:pendingCompletion?null:active};
 if(action==='complete'){if(payload.userId!==userId||payload.hash!==pendingCompletion||!pendingCompletion)return {error:{message:'Import authorization expired'}};pendingCompletion=null;return {data:{}}}
 if(action==='cancel'){active=null;return {data:{}}}
 if(action==='commit')return {data:{imported:1,skipped:0}};
 if(action==='preview'){assert.equal(payload.entries.length,1);return {data:{previewId,entries:payload.entries.map(e=>({sourceKey:e.sourceKey,title:e.event.title,duplicate:false}))}}}
 throw Error('Unexpected RPC '+action);
}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),init});if(String(url)==='https://oauth2.googleapis.com/token'){assert.equal(init.method,'POST');const body=new URLSearchParams(init.body);assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('redirect_uri'),config.callback);assert.ok(body.get('code_verifier'));return Response.json({access_token:'synthetic-readonly-access-token',refresh_token:'must-never-store-refresh',expires_in:3600,scope:granted})}
 assert.equal(init.headers.Authorization,'Bearer synthetic-readonly-access-token');assert.equal(init.method,undefined,'Google calendar API receives reads only');
 if(String(url).includes('/users/me/calendarList?'))return Response.json({items:[{id:'calendar@example.invalid',summary:'Synthetic calendar',accessRole:'owner'}]});
 assert.ok(String(url).startsWith('https://www.googleapis.com/calendar/v3/calendars/calendar%40example.invalid/events?'));
 const params=new URL(url).searchParams;assert.equal(params.get('singleEvents'),'false');assert.equal(params.get('showDeleted'),'true');
 return Response.json({items:[{id:'event',summary:'Family walk',start:{dateTime:'2026-11-03T10:00:00-05:00'},end:{dateTime:'2026-11-03T11:00:00-05:00'}}]});};
try{
 const started=await handleImportAction(admin,{action:'import_start',householdId:hid,userId:other},userId,config);const auth=new URL(started.url);
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('scope'),scopes);assert.equal(auth.searchParams.get('access_type'),'online');assert.equal(auth.searchParams.get('include_granted_scopes'),'false');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.ok(auth.searchParams.get('code_challenge'));
 assert.equal(calls.at(-1).payload.userId,userId,'Body cannot substitute another actor');assert.notEqual(calls.at(-1).payload.hash,auth.searchParams.get('state'),'Only hashed state enters storage');
 const callback=new URL(config.callback);callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');
 const ok=await handleImportCallback(admin,callback,config);assert.equal(ok.status,303);assert.equal(new URL(ok.headers.get('location')).searchParams.get('calendar_import'),'ready');assert.equal(ok.headers.get('Cache-Control'),'no-store');assert.equal(ok.headers.get('Referrer-Policy'),'no-referrer');
 const authorized=calls.find(c=>c.action==='authorized').payload;assert.equal(authorized.userId,userId);assert.equal(authorized.refreshToken,undefined);assert.ok(!JSON.stringify(authorized).includes('must-never-store-refresh'));assert.ok(authorized.expiresIn<=1800);
 const before=requests.length;const replay=await handleImportCallback(admin,callback,config);assert.equal(new URL(replay.headers.get('location')).searchParams.get('calendar_import'),'error');assert.equal(requests.length,before,'Consumed callback cannot exchange another code');
 const pending=await handleImportAction(admin,{action:'import_status',householdId:hid},userId,config);assert.equal(pending.ready,false,'Consent-link forwarding cannot reveal calendars before original HH actor confirms');
 const completedURL=new URL(ok.headers.get('location')),completion=new URLSearchParams(completedURL.hash.slice(1)).get('calendar_import_token');assert.match(completion,/^[a-zA-Z0-9_-]{43}$/);assert.equal(completedURL.searchParams.get('calendar_import_token'),null,'Completion nonce stays out of query logs');
 await assert.rejects(handleImportAction(admin,{action:'import_complete',householdId:hid,token:completion},other,config));
 await handleImportAction(admin,{action:'import_complete',householdId:hid,token:completion,userId:other},userId,config);assert.equal(calls.at(-1).payload.userId,userId);assert.notEqual(calls.at(-1).payload.hash,completion);
 await assert.rejects(handleImportAction(admin,{action:'import_complete',householdId:hid,token:completion},userId,config),'Completion token is single use');
 const status=await handleImportAction(admin,{action:'import_status',householdId:hid},userId,config);assert.equal(status.ready,true);assert.equal(status.calendars.length,1);assert.ok(!JSON.stringify(status).includes('synthetic-readonly-access-token'));
 const preview=await handleImportAction(admin,{action:'import_preview',householdId:hid,calendarId:'calendar@example.invalid'},userId,config);assert.equal(preview.entries.length,1);assert.ok(!JSON.stringify(preview).includes('accessToken'));
 const beforeBad=requests.length;await assert.rejects(handleImportAction(admin,{action:'import_preview',householdId:hid,calendarId:'outside-calendar'},userId,config),/Choose a calendar/);assert.equal(requests.length,beforeBad);
 const valid={action:'import_commit',householdId:hid,previewId,sourceKeys:['a'.repeat(64)],personIds:[userId],reminder30:true,acknowledgeShared:true,userId:other,events:[{title:'malicious injected entry'}]};
 await handleImportAction(admin,valid,userId,config);const committed=calls.at(-1);assert.equal(committed.payload.userId,userId);assert.equal(committed.payload.events,undefined);assert.deepEqual(committed.payload.sourceKeys,['a'.repeat(64)]);
 await assert.rejects(handleImportAction(admin,{...valid,acknowledgeShared:false},userId,config),/confirm sharing/);
 await assert.rejects(handleImportAction(admin,{...valid,sourceKeys:['malicious SQL']},userId,config),/Choose events/);
 await handleImportAction(admin,{...valid,personIds:[],unassigned:true},userId,config);assert.equal(calls.at(-1).payload.unassigned,true);assert.equal(calls.at(-1).payload.reminder30,false);
 await assert.rejects(handleImportAction(admin,{...valid,unassigned:true},userId,config),/Choose events/);
 await assert.rejects(handleImportAction(admin,{...valid,personIds:[],unassigned:'true'},userId,config),/Choose events/);
 failRpc=true;await assert.rejects(handleImportAction(admin,{action:'import_status',householdId:hid},userId,config),error=>!error.message.includes('credential')&&error.message.includes('could not complete'));failRpc=false;
 granted='https://www.googleapis.com/auth/calendar.calendarlist.readonly';const again=await handleImportAction(admin,{action:'import_start',householdId:hid},userId,config);callback.searchParams.set('state',new URL(again.url).searchParams.get('state'));
 const denied=await handleImportCallback(admin,callback,config);assert.equal(new URL(denied.headers.get('location')).searchParams.get('calendar_import'),'error');assert.equal(calls.at(-1).action,'cancel');assert.equal(active,null);
 console.log('Google import handler checks passed: read-only/online PKCE, trusted actor, state replay refusal, scope checks, no credential leakage or refresh storage, allowlisted calendar selection, no client event injection and explicit sharing consent.');
}finally{globalThis.fetch=originalFetch}
