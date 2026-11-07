import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let source=fs.readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
source=source.slice(0,source.lastIndexOf('createRoot('))+'\nexport {HouseholdApp};';
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const user=id=>({user:{id,email:id+'@resume.invalid',user_metadata:{display_name:id}},access_token:'synthetic'});
const member=(id,home='home-'+id)=>({user_id:id,household_id:home,display_name:id,role:'member'});
function harness(){
 const network={onLine:true};
 const slots=[],effects=[],timers=[],requests=[],listeners=new Map();let index=0,dirty=true,view,renderCount=0,homeUnmounts=0,lastHome=null,storageCurrent=true;
 const Household=()=>null;
 function client(name){
  const instance={name,session:user(name),callback:null,
   auth:{getSession:async()=>({data:{session:instance.session},error:null}),onAuthStateChange:callback=>{instance.callback=callback;return {data:{subscription:{unsubscribe(){instance.callback=null}}}}}},
   rpc:async()=>({data:{is_host:false}}),
   from(table){assert.equal(table,'household_members');const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q},maybeSingle:()=>new Promise(resolve=>requests.push({instance,filters,kind:'self',resolve})),order:()=>new Promise(resolve=>requests.push({instance,filters,kind:'members',resolve}))};return q}
  };return instance;
 }
 let selected=client('alex');
 const react={
  useState(initial){const i=index++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true}}]},
  useRef(initial){const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
  useEffect(callback,deps){const i=index++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(old.deps[j],value))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=callback()})}},
  useSyncExternalStore(_subscribe,getSnapshot){index++;return getSnapshot()},
 };
 const supabaseModule={get supabase(){return selected},staySignedIn:()=>true,subscribeLogin:()=>()=>{},loginStorageWarning:()=>'',visitStorage:{getItem:()=>null,setItem(){},removeItem(){}},recoveryEntry:false,activeAccountStorageCurrent:()=>storageCurrent};
 const module={exports:{}};
 const imports=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='./supabase')return supabaseModule;
  if(name==='./offlineShopping')return {savedTrip:()=>null,forgetShopping:()=>{}};
  if(name==='./Household')return {default:Household};
  if(name==='./pilot')return {invitationFrom:()=>({pilot:'',family:''}),initialAuthMode:()=> 'login'};
  if(name==='lucide-react')return new Proxy({},{get:(_o,key)=>key});
  if(name==='./config')return {backendConfigured:true};
  return {default:()=>null};
 };
 const win={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}};
 new Function('require','module','exports','location','window','document','setTimeout','navigator',code)(imports,module,module.exports,{search:'',pathname:'/',origin:'https://hh.invalid'},win,{hidden:false},fn=>timers.push(fn),network);
 function findHome(node){if(!node||typeof node!=='object')return null;if(node.type===Household)return node;const children=node.props?.children;for(const child of Array.isArray(children)?children:[children]){const match=findHome(child);if(match)return match}return null}
 function render(){index=0;dirty=false;view=module.exports.HouseholdApp();const next=findHome(view);if(lastHome&&(!next||next.key!==lastHome.key))homeUnmounts++;lastHome=next;renderCount++;for(const effect of effects.splice(0))effect()}
 async function settle(){for(let i=0;i<12;i++){await Promise.resolve();if(dirty)render()}}
 async function runTimers(){for(const fn of timers.splice(0))fn();await settle()}
 async function reply(kind,data,error=null){const at=requests.findIndex(r=>r.kind===kind);assert.notEqual(at,-1,'Expected '+kind+' request');const request=requests.splice(at,1)[0];request.resolve({data,error});await settle();return request}
 async function open(){await settle();await reply('self',member('alex'));await reply('members',[member('alex')]);assert.equal(lastHome?.props.userId,'alex');homeUnmounts=0}
 async function emit(event,session=selected.session){selected.session=session;selected.callback(event,session);await settle();await runTimers()}
 return {set online(value){network.onLine=value},open,emit,reply,settle,runTimers,requests,timers,member,client,get home(){return lastHome},get unmounts(){return homeUnmounts},get renders(){return renderCount},get selected(){return selected},set selected(value){selected=value;dirty=true},set storageCurrent(value){storageCurrent=value},fire:name=>listeners.get(name)?.()};
}
{
 const h=harness();await h.open();const key=h.home.key;
 await h.emit('SIGNED_IN');assert.equal(h.home.key,key,'Same-user wake keeps home mounted during first read');
 await h.reply('self',member('alex'));assert.equal(h.home.key,key,'Home remains during members read');
 await h.reply('members',[member('alex')]);assert.equal(h.unmounts,0,'Repeated SIGNED_IN never unmounts the verified home');
 await h.emit('TOKEN_REFRESHED');assert.equal(h.requests.length,0);assert.equal(h.unmounts,0,'Token refresh preserves view');
 h.fire('focus');await h.settle();assert.equal(h.unmounts,0,'Focus session restore keeps same view');
 await h.emit('SIGNED_IN');await h.reply('self',null);assert.equal(h.home,null,'Missing membership immediately removes the previous home');
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');
 const stale=h.requests.shift();await h.emit('SIGNED_OUT',null);assert.equal(h.home,null,'Logout clears old home before stale reads finish');
 stale.resolve({data:member('alex'),error:null});await h.settle();assert.equal(h.home,null);assert.equal(h.requests.length,0,'Stale user read cannot fetch members after sign-out');
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');await h.reply('self',member('alex'));
 const stale=h.requests.shift();await h.emit('SIGNED_IN',user('sam'));assert.equal(h.home,null,'Switch clears old identity before revalidation');
 stale.resolve({data:[member('alex')],error:null});await h.settle();assert.equal(h.home,null,'Old household list cannot restore switched account');
 await h.reply('self',member('sam'));await h.reply('members',[member('sam')]);assert.equal(h.home.props.userId,'sam');
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');await h.reply('self',member('alex','new-home'));
 assert.equal(h.home,null,'Known household change clears previous home before new members load');
 await h.reply('members',[member('alex','new-home')]);assert.equal(h.home.props.householdId,'new-home');assert.equal(h.unmounts,1);
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');await h.reply('self',null,{message:'Membership temporarily unavailable'});assert.equal(h.home,null,'Failed membership verification retains conservative no-home behavior');
 await h.emit('SIGNED_IN');await h.reply('self',member('alex'));await h.reply('members',[member('alex')]);assert.equal(h.home.props.userId,'alex','A later verified retry restores access');
 h.storageCurrent=false;h.fire('focus');await h.settle();assert.equal(h.home,null,'Storage account revocation clears verified home');
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');const stale=h.requests.shift();
 h.selected=h.client('alex');await h.settle();assert.equal(h.home,null,'Changing client cannot reuse prior client verification even for the same user');
 stale.resolve({data:member('alex'),error:null});await h.settle();
 await h.reply('self',member('alex'));await h.reply('members',[member('alex')]);assert.equal(h.home.props.userId,'alex');
 await h.emit('PASSWORD_RECOVERY');assert.equal(h.home,null,'Recovery screens cannot expose a remembered home');
}
{
 const h=harness();await h.open();const c=h.selected;
 c.callback('SIGNED_IN',user('sam'));c.callback('SIGNED_OUT',null);c.callback('SIGNED_IN',user('sam'));await h.settle();await h.runTimers();
 assert.equal(h.requests.length,1,'Queued events from a prior identity epoch cannot re-enter membership');
 await h.reply('self',member('sam'));await h.reply('members',[member('sam')]);assert.equal(h.home.props.userId,'sam');
}
{
 const h=harness();await h.open();await h.emit('SIGNED_IN');await h.reply('self',member('alex'));await h.reply('members',[]);
 assert.equal(h.home,null,'Removal between self and members reads cannot re-establish old membership');
}
console.log('Auth resume checks passed: same-user wake retains the mounted household; token/focus continuity, membership removal, logout, user/client/home switch, recovery, failed checks, revoked storage and stale/queued responses remain isolated. Mocked auth and membership reads only.');

{
 const h=harness();await h.open();h.online=false;await h.emit('SIGNED_IN');await h.reply('self',null,{message:'Failed to fetch',status:0});
 assert.equal(h.home.props.userId,'alex','Losing the network keeps the already verified household mounted');
 await h.emit('SIGNED_IN');await h.reply('self',null,{message:'Forbidden',status:403});
 assert.equal(h.home,null,'Explicit access denial still clears the household while offline');
}
