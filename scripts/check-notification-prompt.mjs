import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
function load(source,globals={},dependencies={}){
 const exports={};
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(js,{exports,require:name=>{if(name in dependencies)return dependencies[name];throw Error('Unexpected dependency '+name)},...globals});return exports;
}
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
const storage=memory(),policy=load(read('src/notificationPrompt.ts'),{localStorage:storage});
const base={installed:true,supported:true,permission:'default',handled:false,enabled:false};
assert.equal(policy.canOfferNotifications(base),true);
for(const change of [{installed:false},{supported:false},{permission:'denied'},{handled:true},{enabled:true}])assert.equal(policy.canOfferNotifications({...base,...change}),false);
assert.equal(policy.canOfferNotifications({...base,permission:'granted'}),true); // Permission alone is not a registered device.
policy.finishNotificationPrompt('user-a','home-a');
assert.equal(policy.notificationPromptHandled('user-a','home-a'),true);
assert.equal(policy.notificationPromptHandled('user-b','home-a'),false);
assert.equal(policy.notificationPromptHandled('user-a','home-b'),false);
assert.equal(load(read('src/notificationPrompt.ts'),{localStorage:storage}).notificationPromptHandled('user-a','home-a'),true);
const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
policy.finishNotificationPrompt('blocked-user','home',blocked);
assert.equal(policy.notificationPromptHandled('blocked-user','home',blocked),true);

// The actual push helper must start browser subscription before its first await.
const order=[],media={matches:false};let ios=false;
const push=load(read('src/push.ts'),{window:{isSecureContext:true,matchMedia:()=>media,PushManager:function(){},Notification:{}},navigator:{get standalone(){return ios},serviceWorker:{}},atob:value=>Buffer.from(value,'base64').toString('binary')},{'./supabase':{supabase:{auth:{async getSession(){order.push('session');return {data:{session:{user:{id:'user-a'},access_token:'test-token'}}}}},functions:{async invoke(name,options){order.push('request');assert.equal(name,'event-reminders');assert.equal(options.body.householdId,'home-a');assert.equal(options.body.action,'subscribe');return {data:{enabled:true}}}}}}});
assert.equal(push.installedApp(),false);media.matches=true;assert.equal(push.installedApp(),true);media.matches=false;ios=true;assert.equal(push.installedApp(),true);
const enabling=push.enableDevicePush({pushManager:{subscribe(options){order.push('subscribe');assert.equal(options.userVisibleOnly,true);return Promise.resolve({toJSON:()=>({endpoint:'synthetic'})})}}},'AQID','home-a','user-a');
assert.deepEqual(order,['subscribe']);await enabling;assert.deepEqual(order,['subscribe','session','request']);
await assert.rejects(push.enableDevicePush({pushManager:{subscribe(){return Promise.resolve({toJSON:()=>({endpoint:'synthetic'})})}}},'AQID','home-a','different-user'),/account changed/);assert.equal(order.filter(item=>item==='request').length,1);

// Run the real component with mocked hooks/browser APIs; no accounts, devices or requests are created.
function fixture({installed=true,permission='default',registered=false,supported=true,active=true,unavailable=false}={}){
 let cursor=0,tree;const states=[],effects=[],refs=[],events=new Map(),calls=[];
 const ownPolicy=load(read('src/notificationPrompt.ts'),{localStorage:memory()});
 const props={userId:'user-a',householdId:'home-a',active};
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next}]},useRef(initial){const index=cursor++;return refs[index]??=( {current:initial})},useEffect(callback,deps){const index=cursor++,previous=effects[index];if(!previous||deps.some((dep,i)=>dep!==previous.deps[i])){previous?.cleanup?.();effects[index]={deps,callback,pending:true}}}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 const media={addEventListener:(name,fn)=>events.set('media:'+name,fn),removeEventListener(){}};
 const browser={matchMedia:()=>media,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){}};
 const doc={hidden:false,addEventListener(){},removeEventListener(){}};
 const dependencies={'react':hooks,'react/jsx-runtime':runtime,'lucide-react':{Bell:'bell',Check:'check'},'./notification-prompt.css':{},'./notificationPrompt':ownPolicy,'./push':{installedApp:()=>installed,pushSupported:()=>supported,async preparePush(){calls.push('prepare');if(unavailable)throw Error('offline');return {pushManager:{async getSubscription(){return registered?{endpoint:'synthetic'}:null}}}},async pushRequest(action){calls.push(action);return {enabled:registered,publicKey:'AQID'}},async enableDevicePush(){calls.push('enable')}}};
 const Component=load(read('src/NotificationPrompt.tsx'),{window:browser,document:doc,Notification:{permission}},dependencies).default;
 function render(){cursor=0;tree=Component(props);for(const effect of effects)if(effect?.pending){effect.pending=false;effect.cleanup=effect.callback()}return tree}
 async function settle(){await new Promise(resolve=>setTimeout(resolve,0));return render()}
 function buttons(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(buttons);return [...(node.type==='button'?[node]:[]),...buttons(node.props?.children)]}
 return {calls,props,render,settle,buttons:()=>buttons(tree)};
}
for(const options of [{installed:false},{permission:'denied'},{supported:false},{active:false}]){const f=fixture(options);f.render();assert.equal(await f.settle(),null);assert.deepEqual(f.calls,[])}
let f=fixture({permission:'granted',registered:true});f.render();assert.equal(await f.settle(),null);assert.deepEqual(f.calls,['prepare','status']);
f=fixture({unavailable:true});f.render();assert.equal(await f.settle(),null);
f=fixture();f.render();assert.ok(await f.settle());assert.deepEqual(f.calls,['prepare','status']);
await f.buttons()[0].props.onClick();await f.settle();assert.deepEqual(f.calls,['prepare','status','enable']);
f=fixture();f.render();await f.settle();f.buttons()[1].props.onClick();assert.equal(f.render(),null);assert.ok(!f.calls.includes('enable'));
f=fixture();f.render();await f.settle();f.props.active=false;assert.equal(f.render(),null);
console.log('Installed notification prompt passed: iOS/standalone detection, browser/blocked/unsupported silence, onboarding gating, actual device status, tap-only enable, dismissal, account/home isolation, storage failures and offline handling. No external requests or permission prompts.');
