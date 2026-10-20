import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/passwordRecovery.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createPasswordRecovery,recoveryClientOptions}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const email='person@hh-qa.invalid',password='Synthetic QA password only';
function fixture(){const calls=[],options={verifyError:null,updateError:null,requestError:null,returnedEmail:email,session:true};return{calls,options,auth:{
 signOut:async arg=>{calls.push(['signOut',arg]);return{error:null}},
 resetPasswordForEmail:async(...args)=>{calls.push(['request',...args]);return{error:options.requestError}},
 verifyOtp:async arg=>{calls.push(['verify',arg]);return{data:{user:{id:'qa-user',email:options.returnedEmail},session:options.session?{user:{id:'qa-user'}}:null},error:options.verifyError}},
 updateUser:async arg=>{calls.push(['update',arg]);return{error:options.updateError}}
}}}
const make=f=>createPasswordRecovery(f.auth,'https://example.invalid/?reset=1');
let f=fixture(),r=make(f);assert.equal(await r.request('  PERSON@HH-QA.INVALID '),email);assert.equal(f.calls.find(c=>c[0]==='request')[1],email);
for(const [code,pw,confirm] of [['123',password,password],['123456','short','short'],['123456',password,'different']]){f=fixture();r=make(f);await assert.rejects(r.complete(email,code,pw,confirm));assert.equal(f.calls.length,0)}
f=fixture();r=make(f);f.options.verifyError={message:'expired'};await assert.rejects(r.complete(email,'123456',password,password),/incorrect or has expired/);assert.equal(f.calls.some(c=>c[0]==='update'),false);assert.equal(f.calls.find(c=>c[0]==='verify')[1].type,'recovery');
for(const mismatch of ['other-email','no-session']){f=fixture();r=make(f);if(mismatch==='other-email')f.options.returnedEmail='another@hh-qa.invalid';else f.options.session=false;await assert.rejects(r.complete(email,'123456',password,password));assert.equal(f.calls.some(c=>c[0]==='update'),false)}
f=fixture();r=make(f);f.options.updateError={code:'same_password'};await assert.rejects(r.complete(email,'123456',password,password),/different/);f.options.updateError=null;await r.complete(email,'123456',password,password);assert.equal(f.calls.filter(c=>c[0]==='verify').length,1);assert.equal(f.calls.filter(c=>c[0]==='update').length,2);assert.deepEqual(f.calls.at(-1),['signOut',{scope:'local'}]);
f=fixture();r=make(f);f.options.updateError={status:401};await assert.rejects(r.complete(email,'123456',password,password),/expired/);f.options.updateError=null;await r.complete(email,'654321',password,password);assert.equal(f.calls.filter(c=>c[0]==='verify').length,2);
f=fixture();r=make(f);f.options.updateError={code:'same_password'};await assert.rejects(r.complete(email,'123456',password,password));await r.request(email);f.options.updateError=null;await r.complete(email,'654321',password,password);assert.equal(f.calls.filter(c=>c[0]==='verify').length,2);
f=fixture();r=make(f);f.options.requestError={status:429};await assert.rejects(r.request(email),/wait/);
f=fixture();let finish;f.auth.verifyOtp=()=>new Promise(resolve=>{finish=()=>resolve({data:{user:{id:'qa-user',email},session:{user:{id:'qa-user'}}},error:null})});r=make(f);const pending=r.complete(email,'123456',password,password);await new Promise(resolve=>setTimeout(resolve,0));await assert.rejects(r.complete(email,'123456',password,password),/wait/);finish();await pending;assert.equal(f.calls.filter(c=>c[0]==='update').length,1);
assert.deepEqual(recoveryClientOptions.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'hh-password-recovery'});
const template=fs.readFileSync(new URL('../supabase/templates/password-recovery.html',import.meta.url),'utf8');assert.ok(template.includes('{{ .Token }}'));assert.ok(!template.includes('ConfirmationURL'));assert.ok(!template.includes('TokenHash'));assert.ok(template.includes('https://zethhummel-rgb.github.io/hh-family/?reset=1'));
console.log('Password recovery checks passed: recovery-only OTP, identity matching, wrong/expired code denial, password validation before verification, retry after consumed code, expiry/resend invalidation, duplicate submit guard, memory-only isolated session, and scanner-safe email template. No emails sent or passwords changed.');
