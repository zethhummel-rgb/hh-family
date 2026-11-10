import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=ts.transpileModule(read('supabase/functions/invitation-registration/index.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const token='a'.repeat(64),email='invited@example.invalid',userId='10000000-0000-4000-8000-000000000001';
function server(options={}){
 let handler;const calls=[];let record={email,householdName:'The Test Home',userId:null,confirmed:false,...options.record};
 const admin={rpc:async(name,args)=>{calls.push(['lookup',name,args]);return{data:record,error:options.lookupError||null}},auth:{admin:{
  createUser:async args=>{calls.push(['create',args]);if(options.concurrent)record={...record,userId,confirmed:true};return{data:{user:{id:userId,email}},error:options.createError||null}},
  getUserById:async id=>{calls.push(['get',id]);return{data:{user:{id,email:options.currentEmail||email,email_confirmed_at:options.currentConfirmed?'2026-01-01':null}},error:null}},
  updateUserById:async(id,args)=>{calls.push(['update',id,args]);return{data:{},error:options.updateError||null}}
 }}};
 vm.runInNewContext(source,{exports:{},require:()=>({createClient:()=>admin}),URL,Request,Response,Deno:{env:{get:key=>({SUPABASE_URL:'https://ybizqfghnplcxlmlhvyn.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'})[key]},serve:fn=>handler=fn}});
 return{calls,request:(body={action:'register',kind:'family',token,name:'Invited Person',password:'Fixture-password-123'},origin='https://zethhummel-rgb.github.io',method='POST')=>handler(new Request('https://example.invalid/',{method,headers:{origin,'content-type':'application/json'},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}))};
}
let f=server(),r=await f.request();assert.equal(r.status,200);assert.deepEqual(await r.json(),{email,registered:true});assert.equal(f.calls[0][2].register_attempt,true);assert.equal(f.calls[1][1].email_confirm,true);assert.equal(f.calls[1][1].email,email);assert.equal(f.calls.length,2);
for(const kind of ['family','pilot']){
 f=server();r=await f.request({action:'preview',kind,token,email:'attacker@example.invalid',userId:'attacker'});assert.equal(r.status,200);assert.equal((await r.json()).email,email);assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].register_attempt,false);
 f=server();r=await f.request({action:'register',kind,token,email:'attacker@example.invalid',name:'Name',password:'Fixture-password-123'});assert.equal(r.status,200);assert.equal(f.calls[1][1].email,email);
}
f=server({record:{userId,confirmed:true}});r=await f.request();assert.equal(r.status,200);assert.equal(f.calls.length,1,'Existing confirmed accounts never change');
f=server({record:{userId,confirmed:false}});r=await f.request();assert.equal(r.status,200);assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),['update',userId,{email_confirm:true}]);assert.equal(f.calls.some(c=>c[0]==='create'),false);
f=server({record:{userId,confirmed:false},currentEmail:'changed@example.invalid'});assert.equal((await f.request()).status,400);assert.equal(f.calls.some(c=>c[0]==='update'),false);
f=server({record:{userId,confirmed:false},currentConfirmed:true});await f.request();assert.equal(f.calls.some(c=>c[0]==='update'),false);
f=server({concurrent:true,createError:{message:'already exists'}});assert.equal((await f.request()).status,200);assert.equal(f.calls.some(c=>c[0]==='update'),false);
f=server({createError:{message:'internal secret'}});r=await f.request();assert.equal(r.status,400);assert.doesNotMatch(await r.text(),/secret/);
f=server({lookupError:{message:'This invitation is invalid, expired or already used. Ask for a new invitation.'}});assert.equal((await f.request()).status,400);assert.equal(f.calls.length,1);
f=server({lookupError:{message:'Too many attempts. Wait an hour before trying this invitation again.'}});assert.equal((await f.request()).status,429);assert.equal(f.calls.length,1);
for(const body of [null,'{',{},'x'.repeat(4097),{action:'register',kind:'family',token:'bad',name:'Name',password:'valid-password'},{action:'register',kind:'family',token,name:' ',password:'valid-password'}]){f=server();assert.equal((await f.request(body)).status,400);assert.equal(f.calls.length,0)}
for(const [origin,method,status] of [['https://attacker.invalid','POST',403],['https://zethhummel-rgb.github.io','GET',405],['https://zethhummel-rgb.github.io','OPTIONS',204]]){f=server();assert.equal((await f.request(undefined,origin,method)).status,status);assert.equal(f.calls.length,0)}
f=server();assert.equal((await f.request({action:'register',kind:'pilot',token,name:'Name',password:'short'})).status,400);assert.equal(f.calls.length,1);

const {PGlite}=await import(process.env.HH_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
for(const p of ['schema.sql','pilot.sql','invitation-registration.sql'])await db.exec(read('database/'+p));
const owner=userId,member='10000000-0000-4000-8000-000000000002',pilot='10000000-0000-4000-8000-000000000003',wrong='10000000-0000-4000-8000-000000000004';
for(const [id,address] of [[owner,'host@example.invalid'],[member,email],[pilot,'pilot@example.invalid'],[wrong,'wrong@example.invalid']])await db.query('insert into auth.users values($1,$2,now())',[id,address]);
await db.exec("insert into private.pilot_hosts values('host@example.invalid');");
const as=async(role,id='')=>{await db.exec('reset role;set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])};
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
await as('authenticated',owner);const home=await value("select public.create_household('The Fixture Home','Owner')");
const familyToken=await value('select public.create_household_invite($1)',[email]);const pilotToken=(await value("select public.pilot_invitations('create','pilot@example.invalid')")).token;
const lookup=(kind,code,attempt=false)=>value('select public.invitation_registration($1,$2,$3)',[kind,code,attempt]);
for(const role of ['anon','authenticated']){await as(role,owner);await assert.rejects(lookup('family',familyToken),/permission denied/);await assert.rejects(db.query('select * from private.invitation_registration_attempts'),/permission denied/)}
await as('service_role');assert.equal((await lookup('family',familyToken)).email,email);assert.equal((await lookup('pilot',pilotToken)).email,'pilot@example.invalid');
for(let i=0;i<10;i++)await lookup('family',familyToken,true);await assert.rejects(lookup('family',familyToken,true),/Too many attempts/);
await as('authenticated',wrong);await assert.rejects(value('select public.accept_household_invite($1,$2)',[familyToken,'Wrong']),/different email/);
await as('authenticated',member);assert.equal(await value('select public.accept_household_invite($1,$2)',[familyToken,'Member']),home);
await as('service_role');await assert.rejects(lookup('family',familyToken),/already used/);await assert.rejects(lookup('pilot',familyToken),/already used/);
await as('authenticated',pilot);assert.notEqual(await value("select public.create_pilot_household($1,'The Pilot Home','Pilot')",[pilotToken]),home);
await as('service_role');await assert.rejects(lookup('pilot',pilotToken),/already used/);
await as('authenticated',owner);const expired=await value("select public.create_household_invite('expired@example.invalid')"),revoked=await value("select public.create_household_invite('revoked@example.invalid')");
await db.exec("reset role;update public.household_invites set expires_at=now()-interval '1 second' where email='expired@example.invalid';delete from public.household_invites where email='revoked@example.invalid';");
await as('service_role');for(const t of [expired,revoked,'b'.repeat(64),'bad'])await assert.rejects(lookup('family',t),/invalid, expired or already used/);
await db.close();
console.log('One-email invitation checks passed: both kinds, server-bound email, no SMTP, no password overwrite, pending-account verification, concurrency recovery, preview safety, rate limits, grants, cross-email denial, expiry, revocation and used-code rejection.');
