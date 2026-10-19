import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
function compile(path,imports={},globals={}){
 const exports={};const source=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name]},URL,Request,Response,TextEncoder,TextDecoder,btoa,atob,setTimeout,clearTimeout,console,...globals},{filename:path});return exports;
}
const message=compile('supabase/functions/invitation-email/message.ts');
const smtp=compile('supabase/functions/invitation-email/smtp.ts',{'./message.ts':message});
const token='a'.repeat(64),id='10000000-0000-4000-8000-000000000001',app='https://example.invalid/hh/';
const invite={kind:'family',email:'guest@example.invalid',token,deliveryId:id,householdName:'<script>Family</script>',senderName:'Host & Home',expiresAt:'2026-11-01T18:00:00Z'};
let mail=message.invitationMessage(invite,app+'?stale=1#old');
assert.ok(mail.text.includes(app+'?invite='+token));assert.ok(mail.html.includes('&lt;script&gt;Family&lt;/script&gt;'));assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('Host &amp; Home'));assert.ok(!mail.text.includes('stale='));assert.ok(mail.text.includes(invite.email));
assert.ok(message.invitationMessage({...invite,kind:'pilot'},app).text.includes('?pilot='+token));
for(const address of ['x\r\nBcc:bad@example.invalid','bad@example.invalid>','x@invalid',''])assert.equal(message.validMailAddress(address),false);
for(const bad of ['http://example.invalid/','https://user:pass@example.invalid/'])assert.throws(()=>message.invitationMessage(invite,bad));
assert.throws(()=>message.invitationMessage({...invite,token:'bad'},app));

function connection(replies){
 const bytes=new TextEncoder().encode(replies);let offset=0,written='',closed=false;
 return {get written(){return written},get closed(){return closed},async read(buffer){if(offset===bytes.length)return null;const count=Math.min(7,buffer.length,bytes.length-offset);buffer.set(bytes.subarray(offset,offset+count));offset+=count;return count},async write(buffer){const count=Math.min(13,buffer.length);written+=new TextDecoder().decode(buffer.subarray(0,count));return count},close(){closed=true}};
}
const settings={...mail,from:'sender@example.invalid',to:invite.email,password:'abcdefghijklmnop',deliveryId:id};
let conn=connection('220 ready\r\n250-smtp\r\n250 AUTH PLAIN\r\n235 ok\r\n250 ok\r\n250 ok\r\n354 send data\r\n250 accepted\r\n');
await smtp.sendGmail(settings,async()=>conn);
assert.equal(conn.closed,true);assert.ok(conn.written.includes('AUTH PLAIN '+btoa('\0'+settings.from+'\0'+settings.password)));
assert.ok(conn.written.includes('RCPT TO:<guest@example.invalid>\r\n'));assert.ok(conn.written.endsWith('\r\n.\r\n'));assert.ok(conn.written.includes('multipart/alternative'));assert.ok(!conn.written.includes('QUIT'));
const encodedText=conn.written.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replaceAll('\r\n','');assert.equal(Buffer.from(encodedText,'base64').toString(),mail.text);
conn=connection('220 ready\r\n250 ok\r\n535 authentication failed\r\n');await assert.rejects(smtp.sendGmail(settings,async()=>conn),/did not accept/);assert.equal(conn.closed,true);assert.ok(!conn.written.includes('MAIL FROM'));
conn=connection('220 ready\r\n250 ok\r\n235 ok\r\n250 ok\r\n550 denied\r\n');await assert.rejects(smtp.sendGmail(settings,async()=>conn));assert.ok(!conn.written.includes('DATA'));
let connected=false;await assert.rejects(smtp.sendGmail({...settings,to:'x\r\nBcc:bad@example.invalid'},async()=>{connected=true;return conn}));assert.equal(connected,false);
let timeoutClosed=false;await assert.rejects(smtp.sendGmail(settings,async()=>({read:()=>new Promise(()=>{}),write:async()=>1,close(){timeoutClosed=true}}),5),/timed out/);assert.equal(timeoutClosed,true);
let lateClosed=false;await assert.rejects(smtp.sendGmail(settings,()=>new Promise(resolve=>setTimeout(()=>resolve({close(){lateClosed=true}}),10)),1));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(lateClosed,true);

function server({configured=true,user=true,claim={status:'claimed',claimId:id,deliveryId:id,email:invite.email,senderName:'Host',householdName:'Home',expiresAt:invite.expiresAt},sendError=null,finishError=false,claimError=null}={}){
 let handler;const calls=[],sent=[];const env={APP_URL:app,SUPABASE_URL:'https://backend.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-private-key',...(configured?{HH_EMAIL_APP_PASSWORD:'abcd efgh ijkl mnop'}:{})};
 compile('supabase/functions/invitation-email/index.ts',{
  'npm:@supabase/supabase-js@2.118.0':{createClient:()=>({auth:{getUser:async()=>({data:{user:user?{id}:null},error:null})},rpc:async(name,args)=>{calls.push({name,...args});return{data:args.action==='claim'?claim:{updated:true},error:args.action==='claim'?claimError:finishError?{message:'private failure'}:null}}})},
  './message.ts':message,'./smtp.ts':{sendGmail:async value=>{sent.push(value);if(sendError)throw sendError}}
 },{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}}});
 const request=async(body={action:'send',kind:'family',token},{origin='https://example.invalid',auth='Bearer session',method='POST'}={})=>handler(new Request(app,{method,headers:{Origin:origin,...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 return{calls,sent,request};
}
let f=server();let response=await f.request({...invite,action:'send',email:'attacker@example.invalid',url:'https://attacker.invalid'});assert.equal(response.status,200);assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,invite.email);assert.ok(f.sent[0].text.includes(app+'?invite='+token));assert.ok(!f.sent[0].text.includes('attacker'));assert.equal(f.calls[1].action,'finish');assert.equal(f.calls[1].payload.status,'sent');assert.equal(f.sent[0].password,'abcdefghijklmnop');assert.ok(!(await response.text()).includes('abcdefghijklmnop'));
for(const [options,status] of [[{auth:''},401],[{origin:'https://other.invalid'},403],[{method:'GET'},405]]){f=server();assert.equal((await f.request(undefined,options)).status,status);assert.equal(f.calls.length,0);assert.equal(f.sent.length,0)}
f=server({user:false});assert.equal((await f.request()).status,401);assert.equal(f.sent.length,0);
f=server();assert.equal((await f.request(undefined,{method:'OPTIONS'})).status,204);assert.equal(f.calls.length,0);
for(const body of ['{',null,{}, {action:'send',kind:'wrong',token},{action:'send',kind:'family',token:'bad'},'x'.repeat(2049)]){f=server();assert.equal((await f.request(body)).status,400);assert.equal(f.calls.length,0)}
f=server({configured:false});response=await f.request();assert.equal(response.status,503);assert.equal((await response.json()).setupRequired,true);assert.equal(f.calls.length,0);
for(const [status,code] of [['sent',200],['sending',409],['cooldown',429]]){f=server({claim:{status}});assert.equal((await f.request()).status,code);assert.equal(f.sent.length,0);assert.equal(f.calls.length,1)}
f=server({claimError:{message:'This invitation is unavailable, expired, or not yours to send'}});assert.equal((await f.request()).status,400);assert.equal(f.sent.length,0);
f=server({sendError:Error('synthetic SMTP failure with secret')});response=await f.request();assert.equal(response.status,400);assert.equal(f.calls[1].payload.status,'failed');assert.ok(!(await response.text()).includes('secret'));
f=server({finishError:true});assert.equal((await f.request()).status,200);assert.equal(f.sent.length,1);assert.equal(f.calls.length,2);

const session=(access_token='old',userId='owner')=>({access_token,user:{id:userId}});
const failed=status=>({data:null,error:{context:{status,json:async()=>({error:'Safe delivery error'})}}});
function client({sessions=[session()],results=[{data:{sent:true},error:null}],refreshed=session('fresh')}={}){
 const calls=[],rpcs=[];let reads=0,refreshes=0;
 const api={auth:{getSession:async()=>({data:{session:sessions[Math.min(reads++,sessions.length-1)]},error:null}),refreshSession:async()=>{refreshes++;return{data:{session:refreshed},error:null}}},functions:{invoke:async(name,args)=>{calls.push({name,...args});return results[Math.min(calls.length-1,results.length-1)]}},rpc:async(name,args)=>{rpcs.push({name,...args});return{data:name==='create_household_invite'?token:{token},error:null}}};
 return{...compile('src/invitationEmail.ts',{'./supabase':{supabase:api}},{location:{origin:'https://example.invalid',pathname:'/hh/'}}),calls,rpcs,get refreshes(){return refreshes}};
}
f=client();let result=await f.createEmailInvitation('family',' GUEST@EXAMPLE.INVALID ');assert.equal(result.sent,true);assert.equal(f.rpcs[0].name,'create_household_invite');assert.equal(f.rpcs[0].invite_email,invite.email);assert.ok(result.url.includes('?invite='+token));
f=client();result=await f.createEmailInvitation('pilot',invite.email);assert.equal(f.rpcs[0].name,'pilot_invitations');assert.ok(result.url.includes('?pilot='+token));
f=client({results:[failed(503)]});result=await f.createEmailInvitation('family',invite.email);assert.equal(result.sent,false);assert.ok(result.url);assert.equal(result.error,'Safe delivery error');await f.deliverInvitation(result);assert.equal(f.rpcs.length,1);assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.token,token);
f=client({results:[failed(401),{data:{sent:true},error:null}]});await f.sendInvitationEmail('family',token);assert.equal(f.calls.length,2);assert.equal(f.refreshes,1);assert.equal(f.calls[1].headers.Authorization,'Bearer fresh');assert.equal(JSON.stringify(f.calls[0].body),JSON.stringify(f.calls[1].body));
f=client({results:[failed(401)]});await assert.rejects(f.sendInvitationEmail('family',token));assert.equal(f.calls.length,2);
f=client({results:[failed(401)],sessions:[session(),session('other','other-owner')]});await assert.rejects(f.sendInvitationEmail('family',token),/Sign in again/);assert.equal(f.calls.length,1);assert.equal(f.refreshes,0);
f=client({results:[failed(401)],refreshed:session('other','other-owner')});await assert.rejects(f.sendInvitationEmail('family',token),/Sign in again/);assert.equal(f.calls.length,1);
f=client({sessions:[null]});await assert.rejects(f.sendInvitationEmail('family',token),/Sign in again/);assert.equal(f.calls.length,0);
console.log('Invitation email checks passed: safe email templates and URLs, chunked TLS SMTP/MIME/auth/rejection/timeouts, authenticated server permissions, database-only recipient, deduplication, safe failures, copy-link fallback, stable retries and account-change guards. No external emails or databases contacted.');
