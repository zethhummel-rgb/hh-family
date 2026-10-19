import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/calendarAuth.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const{authenticatedCalendarRequest}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const session=(token='old',id='family-member')=>({access_token:token,user:{id}});
const failed=status=>({data:null,error:{context:{status},message:'rejected'}});
function fixture({sessions=[session()],results=[{data:{ok:true},error:null}],refreshed=session('new'),refreshError=null}={}){
 const calls=[],counts={refresh:0};let reads=0;
 return{calls,counts,client:{auth:{getSession:async()=>({data:{session:sessions[Math.min(reads++,sessions.length-1)]},error:null}),refreshSession:async()=>{counts.refresh++;return{data:{session:refreshed},error:refreshError}}},functions:{invoke:async(name,options)=>{calls.push({name,...options});return results[Math.min(calls.length-1,results.length-1)]}}}};
}
let f=fixture();await authenticatedCalendarRequest(f.client,{action:'events'});assert.equal(f.calls[0].headers.Authorization,'Bearer old');assert.equal(f.counts.refresh,0);
f=fixture({results:[failed(401),{data:{ok:true},error:null}]});await authenticatedCalendarRequest(f.client,{action:'create',requestId:'same-request'});assert.equal(f.counts.refresh,1);assert.equal(f.calls.length,2);assert.equal(f.calls[1].headers.Authorization,'Bearer new');assert.deepEqual(f.calls[0].body,f.calls[1].body);
f=fixture({results:[failed(401)]});await authenticatedCalendarRequest(f.client,{action:'events'});assert.equal(f.calls.length,2);assert.equal(f.counts.refresh,1);
for(const result of[failed(400),failed(409),{data:null,error:{message:'network failed'}}]){f=fixture({results:[result]});await authenticatedCalendarRequest(f.client,{action:'create'});assert.equal(f.calls.length,1);assert.equal(f.counts.refresh,0)}
f=fixture({sessions:[null]});await assert.rejects(authenticatedCalendarRequest(f.client,{}),/Sign in again/);assert.equal(f.calls.length,0);
f=fixture({results:[failed(401)],refreshError:Error('expired'),refreshed:null});await assert.rejects(authenticatedCalendarRequest(f.client,{}),/Sign in again/);assert.equal(f.calls.length,1);
f=fixture({sessions:[session(),session('other','another-member')],results:[failed(401)]});await assert.rejects(authenticatedCalendarRequest(f.client,{}),/Sign in again/);assert.equal(f.calls.length,1);assert.equal(f.counts.refresh,0);
f=fixture({sessions:[session(),session('already-renewed')],results:[failed(401),{data:{ok:true},error:null}]});await authenticatedCalendarRequest(f.client,{});assert.equal(f.counts.refresh,0);assert.equal(f.calls[1].headers.Authorization,'Bearer already-renewed');
console.log('Calendar auth checks passed: explicit session, one 401 retry, stable mutation payload, no non-auth retries, signed-out/changed-user guards, concurrent renewal reuse.');
