import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = name => fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const store = new Map();
const now = {user:'a',key:'login',member:true,online:true,transition:false,timeout:false};
const home='home', rows = new Map();
const item = (id,version=1,done=false) => ({id,household_id:home,kind:'grocery',category:'Produce',title:id,reminder_version:version,done});
function identity(user){now.user=user;store.set(now.key,JSON.stringify({user:{id:user}}));}
identity('a');
const backing={getItem:key=>store.get(key)??null,setItem:(key,val)=>store.set(key,val),removeItem:key=>store.delete(key)};
const locks={request:async (name,opts,fn)=>(fn||opts)({name})};
let writes=0,afterWrite=null;
const client={
 auth:{getSession:async()=>({data:{session:{user:{id:now.user}}}})},
 rpc:()=>({abortSignal:async()=>({data:now.transition})}),
 from(table){
   const filters={};let patch,insert;
   const query={
     eq(key,value){filters[key]=value;return this},select(){return this},abortSignal(){return this},
     update(value){patch=value;return this},order(){return this},
     insert(value){insert=value;return this},
     async maybeSingle(){
       if(table==='household_members')return {data:now.member?{household_id:home}:null};
       if(insert){
         if(rows.has(insert.id))return {error:Error('duplicate key')};
         const record={...insert,reminder_version:1};rows.set(insert.id,record);writes++;
         if(afterWrite){const fn=afterWrite;afterWrite=null;await fn();}
         if(now.timeout){now.timeout=false;return {error:Error('lost response')};}
         return {data:{...record}};
       }
       const record=rows.get(filters.id);
       if(!record||!Object.entries(filters).every(([k,v])=>record[k]===v))return {data:null};
       if(patch){Object.assign(record,patch);record.reminder_version++;writes++;
         if(afterWrite){const fn=afterWrite;afterWrite=null;await fn();}
         if(now.timeout){now.timeout=false;return {error:Error('lost response')};}}
       return {data:{...record}};
     },
     then(resolve){resolve({data:[...rows.values()]})}
   };return query;
 }
};
const mod={};
const mocks={'./config':{authNamespace:'test'},'./supabase':{supabase:client,accountStorage:{store:()=>backing},
 activeAccountStorageCurrent:()=>true,currentAccountStorage:()=>({key:now.key,remember:true})}};
const draftModule={};
vm.runInNewContext(ts.transpileModule(read('src/groceryData.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {exports:draftModule,require:n=>n==='./groceryStaplesData'?{groceryCategories:['Produce','Pantry','Dairy & eggs','Other']}:mocks[n]||{}});
mocks['./groceryData']=draftModule;
vm.runInNewContext(ts.transpileModule(read('src/offlineShopping.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {exports:mod,require:n=>mocks[n],navigator:{locks,get onLine(){return now.online}},window:{dispatchEvent(){}},Event,AbortSignal,crypto});
for(const id of ['Milk','Bread','Eggs'])rows.set(id,item(id));
Object.assign(rows.get('Milk'),{grocery_quantity:2,grocery_unit:'litres',grocery_store:'Test market'});
await mod.saveGroceries('a',home,'Test',[...rows.values(),{...item('secret task'),kind:'task'}]);
assert.equal(mod.savedTrip().rows.length,3);
assert.equal(mod.groceryItems(mod.savedTrip())[0].grocery_quantity,2);
assert.equal(mod.groceryItems(mod.savedTrip())[0].grocery_unit,'litres');
assert.equal(mod.groceryItems(mod.savedTrip())[0].grocery_store,'Test market');
store.set('shopping:v1:'+now.key,store.get('shopping:v2:'+now.key));
store.delete('shopping:v2:'+now.key);
now.online=false;
await mod.pickItem(mod.savedTrip(),'Milk',true);
assert.equal(store.has('shopping:v1:'+now.key),false,'Migrate old checkmarks into an isolated queue format');
assert.equal(store.has('shopping:v2:'+now.key),true);
await mod.syncTrip(mod.savedTrip());
assert.equal(writes,0);
assert.equal(mod.savedTrip().picks.Milk.done,true);
assert.equal(mod.groceryItems(mod.savedTrip())[0].done,1,'The regular grocery row reflects the queued checkmark');
identity('b');assert.equal(mod.savedTrip(),null);identity('a');
await mod.pickItem(mod.savedTrip(),'Bread',true);
await mod.pickItem(mod.savedTrip(),'Eggs',true);
rows.delete('Bread');rows.get('Eggs').reminder_version++;
now.online=true;now.timeout=true;
await assert.rejects(mod.syncTrip(mod.savedTrip()));
assert.equal(rows.get('Milk').done,true);
await mod.syncTrip(mod.savedTrip());
assert.equal(writes,1,'lost acknowledgement must not apply a second write');
await mod.saveGroceries('a',home,'Test',[item('Milk',1,false),...Array.from(rows.values()).filter(row=>row.id!=='Milk')]);
assert.equal(mod.groceryItems(mod.savedTrip())[0].done,1,'A slower household refresh cannot replace a newer synchronized row');
assert.equal(Object.keys(mod.savedTrip().picks).length,0);
assert.equal(mod.savedTrip().rows.find(r=>r.id==='Eggs').done,false);
assert.equal(mod.savedTrip().notices.length,2);
const draft=(title,quantity=2)=>({title,category:'Pantry',grocery_quantity:quantity,grocery_unit:'cans',grocery_store:'Test market'});
const local=id=>mod.groceryItems(mod.savedTrip()).find(row=>row.id===id);
now.online=false;
await mod.queueGrocery(mod.savedTrip(),draft('Beans'),null,'new-beans');
await mod.queueGrocery(mod.savedTrip(),draft('Black beans',3),local('new-beans'),'unused');
await mod.pickItem(mod.savedTrip(),'new-beans',true);
await mod.saveGroceries('a',home,'Test',[...rows.values()]);
assert.equal(local('new-beans').title,'Black beans');assert.equal(local('new-beans').done,1);
assert.equal(local('new-beans').grocery_quantity,3);
assert.equal(rows.has('new-beans'),false,'Adding/editing offline must not write remotely');
now.online=true;now.timeout=true;
await assert.rejects(mod.syncTrip(mod.savedTrip()));
const afterInsert=writes;
await mod.queueGrocery(mod.savedTrip(),draft('Beans for dinner',4),local('new-beans'),'unused');
await mod.syncTrip(mod.savedTrip());
assert.equal(writes,afterInsert,'Read back an uncertain insert without duplicating it');
assert.equal(local('new-beans').title,'Beans for dinner','A newer local edit survives acknowledgement of an older insert');
await mod.syncTrip(mod.savedTrip());assert.equal(rows.get('new-beans').title,'Beans for dinner');
assert.equal(rows.get('new-beans').grocery_quantity,4);assert.equal(rows.get('new-beans').done,true);
assert.equal(Object.keys(mod.savedTrip().picks).length,0);

await mod.queueGrocery(mod.savedTrip(),draft('Edited milk'),local('Milk'),'unused');
now.timeout=true;await assert.rejects(mod.syncTrip(mod.savedTrip()));
const afterEdit=writes;await mod.syncTrip(mod.savedTrip());assert.equal(writes,afterEdit,'Lost edit acknowledgement cannot write twice');
await mod.queueGrocery(mod.savedTrip(),draft('My milk'),local('Milk'),'unused');
rows.get('Milk').title='Their milk';rows.get('Milk').reminder_version++;
await mod.syncTrip(mod.savedTrip());
assert.equal(local('Milk').title,'My milk');assert.equal(mod.savedTrip().picks.Milk.conflict.server.title,'Their milk');
assert.equal(rows.get('Milk').title,'Their milk');
await mod.resolveGrocery(mod.savedTrip(),'Milk',true);await mod.syncTrip(mod.savedTrip());
assert.equal(rows.get('Milk').title,'My milk','Explicit choice retries against the reviewed version');

await mod.queueGrocery(mod.savedTrip(),draft('My eggs'),local('Eggs'),'unused');
rows.delete('Eggs');await mod.syncTrip(mod.savedTrip());
assert.equal(local('Eggs').title,'My eggs','Deleted shared item retains the local draft for review');
assert.equal(mod.savedTrip().picks.Eggs.conflict.server,null);assert.equal(rows.has('Eggs'),false);
await mod.resolveGrocery(mod.savedTrip(),'Eggs',true);await mod.syncTrip(mod.savedTrip());
assert.equal(rows.has('Eggs'),false,'Explicit add uses a new ID, never resurrects deleted IDs');
assert.equal([...rows.values()].filter(row=>row.title==='My eggs').length,1);

await mod.queueGrocery(mod.savedTrip(),draft('First title'),local('Milk'),'unused');
afterWrite=()=>mod.queueGrocery(mod.savedTrip(),draft('Newer title'),local('Milk'),'unused');
await mod.syncTrip(mod.savedTrip());assert.equal(local('Milk').title,'Newer title');
await mod.syncTrip(mod.savedTrip());assert.equal(rows.get('Milk').title,'Newer title');
await mod.queueGrocery(mod.savedTrip(),draft('Unconfirmed new item'),null,'uncertain');
now.timeout=true;await assert.rejects(mod.syncTrip(mod.savedTrip()));rows.delete('uncertain');
await mod.syncTrip(mod.savedTrip());assert.equal(rows.has('uncertain'),false);
assert.equal(mod.savedTrip().picks.uncertain.conflict.server,null);
await mod.resolveGrocery(mod.savedTrip(),'uncertain',false);assert.equal(local('uncertain'),undefined);
await assert.rejects(mod.queueGrocery(mod.savedTrip(),draft('Invalid',-1),null,'invalid'),/quantity/);
backing.failed=true;await assert.rejects(mod.queueGrocery({user:'a',home},draft('No storage'),null,'no-storage'));
backing.failed=false;assert.equal(rows.has('no-storage'),false);
await mod.pickItem(mod.savedTrip(),'Milk',false);
now.timeout=true;await assert.rejects(mod.syncTrip(mod.savedTrip()));
await mod.queueGrocery(mod.savedTrip(),draft('Draft after uncertain checkmark'),local('Milk'),'unused');
rows.get('Milk').title='Another household edit';rows.get('Milk').reminder_version++;
await mod.syncTrip(mod.savedTrip());
assert.equal(rows.get('Milk').title,'Another household edit','A matched checkmark cannot authorize overwriting newer details');
assert.equal(mod.savedTrip().picks.Milk.conflict.server.title,'Another household edit');
await mod.resolveGrocery(mod.savedTrip(),'Milk',false);
const blockedWrites=writes;
await mod.pickItem(mod.savedTrip(),'Milk',false);
now.transition=true;await assert.rejects(mod.syncTrip(mod.savedTrip()),/transfer/);assert.equal(writes,blockedWrites);
now.transition=false;now.member=false;await mod.syncTrip(mod.savedTrip());
assert.equal(mod.savedTrip(),null);assert.equal(writes,blockedWrites);
console.log('Offline grocery checks passed: saved list, scoped access, offline adds/edits/picks, validation, storage failure, immutable retries, concurrent edits, conflict choices, removals and revoked membership.');
