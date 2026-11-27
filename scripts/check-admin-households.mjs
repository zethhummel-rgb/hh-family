import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../supabase/functions/admin-households/index.ts',import.meta.url),'utf8').replace(/^import [^\r\n]*\r?\n/,'');
let handler,calls=[];
function createClient(url,key,options){
 const authorization=options.global.headers.Authorization;
 return {
  auth:{async getUser(token){
   assert.equal(authorization,'Bearer '+token);
   if(token==='expired')return {error:{message:'Invalid'},data:{user:null}};
   return {data:{user:{email_confirmed_at:token==='unconfirmed'?null:'2026-01-01'}}};
  }},
  async rpc(name,args){
   calls.push({name,args,authorization});
   if(authorization!=='Bearer admin')return {error:{code:'42501',message:'Admin access required'}};
   return {data:args.action==='list'?[]:{deleted:true}};
  },
 };
}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient,Deno:{env:{get:()=>''},serve(fn){handler=fn}},Response});
const origin='https://zethhummel-rgb.github.io';
async function invoke(token,body={},extra={}){return handler(new Request('https://example.invalid',{method:'POST',headers:{origin,...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)}))}
assert.equal((await invoke(null)).status,401);
assert.equal((await invoke('expired')).status,401);
assert.equal((await invoke('member',{action:'list'})).status,403);
assert.equal((await invoke('issuer',{action:'list'})).status,403);
assert.equal((await invoke('unconfirmed',{action:'list'})).status,403);
assert.equal((await invoke('admin',{action:'list'},{origin:'https://evil.invalid'})).status,403);
assert.equal((await invoke('admin',{action:'delete',householdId:'bad',confirmation:'Home'})).status,400);
assert.equal(calls.length,2);
assert.equal((await invoke('admin',{action:'list',actorId:'spoofed'})).status,200);
assert.equal(calls[2].authorization,'Bearer admin');
assert.equal('actorId' in calls[2].args.payload,false);
assert.equal((await invoke('admin',{action:'delete',householdId:'10000000-0000-4000-8000-000000000001',confirmation:'Synthetic'})).status,200);
assert.equal(calls[3].authorization,'Bearer admin');
console.log('Admin Edge checks passed: missing/expired sessions, ordinary members, wrong origin, invalid deletion, and spoofed actor denied. Mocked calls only.');
