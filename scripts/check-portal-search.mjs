import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const hid='test-home',calls=[],tables=new Map();let fail='',abortAfterRead=false;
const add=(table,rows)=>tables.set(table,rows.map(row=>({household_id:hid,...row})));
add('household_items',Array.from({length:201},(_,i)=>({id:String(i).padStart(4,'0'),kind:i===200?'task':'grocery',title:i===200?'Book family camp':'Camp snack '+i,done:i===200,category:'Pantry'})));
add('household_grocery_staples',[{id:'staple',title:'Camp coffee',category:'Pantry'}]);
add('household_events',[{id:'event',title:'Summer plans',description:'Family camp registration',person_ids:['person'],starts_at:'2027-06-01T12:00:00Z',exceptions:{'2027-06-02':{title:'Swimming lesson'}}}]);
add('household_notes',[{id:'note',title:'Packing notes',body:'Remember the family camp tickets'},{id:'foreign',household_id:'another-home',title:'Camp secret',body:'Not ours'}]);
add('household_meal_plans',[{id:'plan',title:'Picnic',meal_date:'2026-01-01',meal_type:'lunch',ingredients:[{title:'Camp beans'}]}]);
add('household_meal_recipes',[{id:'recipe',title:'Chili',instructions:'For family camp'}]);
add('household_people',[{id:'person',display_name:'Camper'}]);
add('household_members',[{user_id:'member',display_name:'Camper Alex'}]);
const client={from(table){const filters={},call={table,filters};calls.push(call);let cursor='',key='id';return {
 select(fields){call.fields=fields;return this},eq(k,v){filters[k]=v;return this},order(k){key=k;return this},limit(n){assert.equal(n,200);return this},abortSignal(signal){call.signal=signal;return this},gt(k,v){assert.equal(k,key);cursor=v;return this},
 then(resolve){if(table===fail)return resolve({error:{message:'Unavailable'}});if(abortAfterRead)controller.abort();resolve({data:(tables.get(table)||[]).filter(row=>row[key]>cursor).slice(0,200)});}
}}};
const mod={},controller=new AbortController();
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/portalSearchData.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:mod,require:()=>({supabase:client})});
const index=await mod.loadPortalIndex(hid,controller.signal);
assert.equal(index.unavailable.length,0);assert.equal(index.rows.filter(r=>r.kind==='task').length,1,'Completed tasks beyond page one remain searchable');
assert(!index.rows.some(r=>r.title==='Camp secret'),'Never display a row from another household');
assert(calls.every(call=>call.filters.household_id===hid&&call.signal===controller.signal),'Every request is scoped and cancellable');
const matches=mod.searchPortal(index.rows,'family camp');
assert.deepEqual([...new Set(matches.map(r=>r.page))].sort(),['Calendar','Household','Meals','Notes','Reminders']);
assert.equal(mod.searchPortal(index.rows,'swimming lesson')[0].kind,'event','Search recurring exception text');
assert(mod.searchPortal(index.rows,'camper').some(row=>row.kind==='event'),'Resolve assigned profile names in event search');
assert.equal(mod.searchPortal(mod.portalPages(),'feedback')[0].id,'feedback','Settings tools open their specific page');
assert.equal(mod.searchPortal(index.rows,'camp beans')[0].kind,'meal_plan','Search ingredients and old meal plans');
assert.equal(mod.searchPortal(index.rows,"'),household_id.neq.test-home").length,0,'Search punctuation is literal text, never API query syntax');
assert.equal(mod.searchPortal(index.rows,'').length,0);
const local=mod.localGroceryResults([{id:'draft',kind:'grocery',title:'Offline café',grocery_store:'Costco'},{id:'task',kind:'task',title:'Private task'}]);
assert.equal(local.length,1);assert.equal(mod.searchPortal(local,'cafe costco')[0].id,'draft','Pending groceries and accents are searchable');
fail='household_notes';const partial=await mod.loadPortalIndex(hid,controller.signal);
assert.deepEqual(Array.from(partial.unavailable),['Notes']);assert(partial.rows.some(r=>r.kind==='task'),'Failures in one section leave other sections available');
fail='';abortAfterRead=true;await assert.rejects(mod.loadPortalIndex(hid,controller.signal),/cancelled/);
console.log('Portal search passed: all sections, completed tasks, older plans, note bodies, ingredients, repeating-event text, pagination, household isolation, literal queries, local groceries, partial failures and cancellation.');
