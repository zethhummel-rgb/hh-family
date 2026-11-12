import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function compile(path,imports={},globals={}){
 const exports={};
 const source=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>{assert.ok(name in imports,name);return imports[name]},Request,Response,TextEncoder,TextDecoder,crypto,...globals},{filename:path});
 return exports;
}

const address=compile('supabase/functions/invitation-email/message.ts');
const common=compile('shared/feedback.ts');
const message=compile('supabase/functions/request-pilot-invitation/message.ts',{'../invitation-email/message.ts':address,'../../../shared/feedback.ts':common});
const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema private;grant usage on schema private to service_role;');
 await db.exec(read('supabase/migrations/20261112181000_hh_pilot_request_mail.sql'));
 const service=async(action,payload)=>(await db.query('select public.pilot_request_mail_service($1,$2::jsonb) as state',[action,JSON.stringify(payload)])).rows[0].state;
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(service('claim',{}),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 const env={SUPABASE_URL:'https://njpdqiwrwgoothkstoql.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic',HH_EMAIL_APP_PASSWORD:'abcdefghijklmnop'};
 let handler,failDelivery=false;
 const sent=[];
 compile('supabase/functions/request-pilot-invitation/index.ts',{
  'npm:@supabase/supabase-js@2.118.0':{createClient:()=>({rpc:async(name,{action,payload})=>{
   assert.equal(name,'pilot_request_mail_service');
   return {data:await service(action,payload),error:null};
  }})},
  '../invitation-email/smtp.ts':{sendGmail:async mail=>{sent.push(mail);if(failDelivery)throw Error('Private SMTP detail')}},
  '../invitation-email/message.ts':address,
  './message.ts':message,
 },{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}}});
 const answers={requestId:crypto.randomUUID(),name:'Alex & Sam',email:'ALEX@example.invalid',source:'An event invite',interest:'yes',message:'Hello <script> 🏡'};
 const request=(payload=answers,origin='https://zethhummel-rgb.github.io',method='POST')=>handler(new Request('https://fixture.invalid',{
  method,headers:{Origin:origin},...(method==='POST'?{body:typeof payload==='string'?payload:JSON.stringify(payload)}:{}),
 }));
 assert.equal((await request(answers,'https://wrong.invalid')).status,403);
 assert.equal((await request(answers,undefined,'OPTIONS')).status,204);
 assert.deepEqual(await (await request(answers,undefined,'GET')).json(),{configured:true,preview:false});
 for(const invalid of [{...answers,email:'bad'},{...answers,interest:'constructor'},{...answers,source:''},{...answers,website:'spam'},'x'.repeat(8193)]){
  assert.equal((await request(invalid)).status,400);
 }
 assert.equal(sent.length,0);
 const response=await request({...answers,to:'arbitrary@example.invalid'});
 assert.equal(response.status,200);
 assert.equal((await response.json()).sent,true);
 assert.equal(sent[0].to,'hummelhomeapp@gmail.com');
 assert.equal(sent[0].replyTo,'alex@example.invalid');
 assert.equal(sent[0].subject,'[HH] Invitation request');
 assert.match(sent[0].text,/An event invite/);
 assert.match(sent[0].html,/Alex &amp; Sam/);
 assert.match(sent[0].html,/&lt;script&gt;/);
 assert.equal((await request()).status,200);
 assert.equal((await request({...answers,source:'A changed answer'})).status,409);
 assert.equal(sent.length,1);

 failDelivery=true;
 const retry={...answers,requestId:crypto.randomUUID()};
 const failed=await request(retry);
 assert.equal(failed.status,502);
 assert.ok(!(await failed.text()).includes('Private SMTP detail'));
 assert.equal((await request(retry)).status,409);
 assert.equal(sent.length,2);
 failDelivery=false;
 assert.equal((await request({...answers,requestId:crypto.randomUUID()})).status,200);
 assert.equal((await request({...answers,requestId:crypto.randomUUID()})).status,429);
 assert.equal(sent.length,3);

 await db.exec('reset role');
 const rows=(await db.query('select * from private.pilot_request_delivery')).rows;
 assert.equal(rows.length,3);
 assert.ok(!JSON.stringify(rows).includes('alex@example.invalid'));
 assert.ok(!JSON.stringify(rows).includes('An event invite'));
}finally{await db.close()}
console.log('Pilot request checks passed: public form validation, fixed recipient, safe reply address, private delivery records, duplicate prevention, rate limits and uncertain delivery.');
