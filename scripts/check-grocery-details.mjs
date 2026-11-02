import fs from 'node:fs';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {PGlite} from '@electric-sql/pglite';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
await db.exec(read('database/schema.sql'));await db.exec(read('database/recurring-reminders.sql'));await db.exec(read('database/reminder-completion-guard.sql'));
await db.exec(`create table private.test_transitions(hid uuid primary key,active boolean default false,write_open boolean default true);
create function private.household_transition_active(id uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select active from private.test_transitions where hid=id),false)$$;
create function private.household_transition_write_open(id uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select write_open from private.test_transitions where hid=id),true)$$;
create policy transition_hold on public.household_items as restrictive for all to authenticated using(not private.household_transition_active(household_id) and private.household_transition_write_open(household_id)) with check(not private.household_transition_active(household_id) and private.household_transition_write_open(household_id));`);
await db.exec(read('database/grocery-staples.sql'));await db.exec(read('database/meal-planner.sql'));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const users={owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',member:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',outsider:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name+'@groceries.invalid']);
for(const [hid,id] of [[a,users.owner],[b,users.other]]){await db.query("insert into public.households(id,name,owner_id) values($1,'Synthetic grocery home',$2)",[hid,id]);await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Alex','owner')",[hid,id])}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Sam','member')",[a,users.member]);
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const as=async(name)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||''])};
const insert=async(title='Kidney beans',category='Pantry',hid=a)=>(await db.query("insert into public.household_items(household_id,kind,title,category) values($1,'grocery',$2,$3) returning *",[hid,title,category])).rows[0];
await as('owner');const original=await insert('Keep 2 cans in title');const before=await scalar('select to_jsonb(i) from public.household_items i where id=$1',[original.id]);
await db.exec('reset role');const sql=read('database/grocery-details.sql');await db.exec(sql);
const migrations=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('_grocery_details.sql'));assert.equal(migrations.length,1);assert.equal(sql,read('supabase/migrations/'+migrations[0]));
await as('owner');assert.deepEqual(await scalar("select to_jsonb(i)-array['grocery_quantity','grocery_unit','grocery_store'] from public.household_items i where id=$1",[original.id]),before,'Migration preserves every existing item field');
const item=await insert("Beans'); delete from public.households; --",'Deli');
let updated=(await db.query("update public.household_items set grocery_quantity=2,grocery_unit='cans',grocery_store='Costco' where id=$1 and reminder_version=$2 returning *",[item.id,item.reminder_version])).rows[0];assert.equal(updated.reminder_version,2);assert.equal(updated.grocery_quantity,'2');
await as('member');assert.equal(await scalar('select grocery_store from public.household_items where id=$1',[item.id]),'Costco');
assert.deepEqual((await db.query("update public.household_items set title='Stale' where id=$1 and reminder_version=1 returning id",[item.id])).rows,[]);
await db.query('update public.household_items set done=true where id=$1',[item.id]);assert.equal(await scalar('select reminder_version from public.household_items where id=$1',[item.id]),3,'Old-client pickup advances revision');
await db.query('update public.household_items set done=false,grocery_quantity=3 where id=$1 and reminder_version=3',[item.id]);assert.equal(await scalar('select grocery_unit from public.household_items where id=$1',[item.id]),'cans','Reusing picked-up items preserves details');
for(const expression of ['grocery_quantity=0','grocery_quantity=-2','grocery_quantity=10000','grocery_quantity=1.0001',"grocery_quantity='NaN'","grocery_quantity='Infinity'","grocery_store=repeat('x',81)","grocery_store=' '","grocery_unit=repeat('x',31)","grocery_quantity=null,grocery_unit='cans'"]){await assert.rejects(db.query('update public.household_items set '+expression+' where id=$1',[item.id]),/constraint/)}
await db.query('update public.household_items set grocery_quantity=0.5,grocery_unit=$1,grocery_store=$2 where id=$3',['kg',"Store'); DROP TABLE auth.users; --",item.id]);
assert.equal(await scalar('select count(*)::int from public.households'),1);
await assert.rejects(db.query('update public.household_items set reminder_version=100 where id=$1',[item.id]),/permission/);
assert.equal(await scalar("select has_function_privilege('authenticated','private.maintain_grocery_revision()','EXECUTE')"),false);
assert.equal(await scalar("select prosecdef from pg_proc where oid='private.maintain_grocery_revision()'::regprocedure"),false);
// Deli flows through both existing batching paths without rewriting ingredient text.
const staple=await scalar("insert into public.household_grocery_staples(household_id,title,category) values($1,'Sliced ham','Deli') returning id",[a]);assert.deepEqual(await scalar('select public.add_grocery_staples($1,$2::uuid[])',[a,[staple]]),{added:1,skipped:0});assert.deepEqual(await scalar('select public.add_grocery_staples($1,$2::uuid[])',[a,[staple]]),{added:0,skipped:1});
const ingredientId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';const meal=(await db.query("insert into public.household_meal_plans(household_id,title,meal_date,ingredients) values($1,'Sandwiches','2026-11-04',$2::jsonb) returning *",[a,JSON.stringify([{id:ingredientId,title:'200 g turkey',category:'Deli'}])])).rows[0];
assert.deepEqual(await scalar('select public.add_meal_ingredients($1,$2::jsonb)',[a,JSON.stringify([{meal_id:meal.id,version:meal.version,ingredient_ids:[ingredientId]}])]),{added:1,skipped:0});assert.equal(await scalar("select title from public.household_items where title='200 g turkey'"),'200 g turkey');
// Task triggers retain recurrence, anchored dates and single-completion behavior.
const task=(await db.query("insert into public.household_items(household_id,kind,title,due,repeat_unit) values($1,'task','Monthly task','2026-01-31','month') returning *",[a])).rows[0];
await db.query('update public.household_items set done=true where id=$1',[task.id]);const next=(await db.query('select * from public.household_items where id=$1',[task.id])).rows[0];assert.equal(next.reminder_version,2);assert.equal(next.done,false);assert.ok(next.due>task.due);await db.query('update public.household_items set done=true where id=$1',[task.id]);assert.equal(await scalar('select reminder_version from public.household_items where id=$1',[task.id]),2);
await assert.rejects(db.query('update public.household_items set grocery_quantity=1 where id=$1',[task.id]),/constraint/);
for(const name of ['other','outsider','']){await as(name);assert.equal(await scalar('select count(*)::int from public.household_items where household_id=$1',[a]),0);assert.deepEqual((await db.query('update public.household_items set grocery_quantity=7 where id=$1 returning id',[item.id])).rows,[]);await assert.rejects(insert('Foreign','Deli',a),/row-level security/)}
await db.exec('reset role;set role anon');await assert.rejects(db.query('select grocery_store from public.household_items'),/permission/);
await db.exec('reset role');await db.query('insert into private.test_transitions values($1,true,true)',[a]);await as('owner');assert.deepEqual((await db.query('update public.household_items set grocery_quantity=7 where id=$1 returning id',[item.id])).rows,[]);
await db.exec('reset role');await db.query('update private.test_transitions set active=false,write_open=false where hid=$1',[a]);await as('owner');assert.deepEqual((await db.query('delete from public.household_items where id=$1 returning id',[item.id])).rows,[]);
await db.exec('reset role');await db.query('delete from private.test_transitions where hid=$1',[a]);await db.query('delete from public.household_members where user_id=$1',[users.member]);await as('member');assert.equal(await scalar('select count(*)::int from public.household_items'),0,'Removed-member JWT cannot read details');
await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);assert.equal(await scalar('select count(*)::int from public.household_items'),0);assert.equal(await scalar('select count(*)::int from public.households'),1);await db.close();
console.log('Grocery database checks passed: unchanged existing records, shared details, Deli staples/meal batches, decimal/length/kind validation, literal SQL input, RLS/anonymous/removed-member isolation, stale writes, old-client revisions, task recurrence, transition guards and cascades. Synthetic local data only.');

const calls=[];let result={data:{id:'saved'},error:null},transition=false;
const fake={from(table){const call={table,filters:[]};const q={insert(value){call.operation='insert';call.value=value;return q},update(value){call.operation='update';call.value=value;return q},select(){return q},eq(k,v){call.filters.push([k,v]);return q},single(){calls.push(call);return Promise.resolve(result)},maybeSingle(){calls.push(call);return Promise.resolve(result)}};return q}};
const exports={};vm.runInNewContext(ts.transpileModule(read('src/groceryData.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:path=>path==='./supabase'?{supabase:fake}:path==='./data'?{transitionActive:async()=>transition}:{groceryCategories:['Produce','Deli','Pantry']},Intl,Number,Error});
const g=exports,draft={title:' Kidney beans ',category:'Pantry',grocery_quantity:2,grocery_unit:' cans ',grocery_store:' Costco '};
assert.equal(g.groceryDetails(draft),'2  cans  ·  Costco ');assert.equal(g.groceryDetails({grocery_quantity:0.5,grocery_unit:'kg',grocery_store:null}),'0.5 kg');assert.equal(g.groceryDetails({}),'');
assert.equal(g.groceryMatches({...draft,title:'Kidney beans'},'costco','store:costco'),true);assert.equal(g.groceryMatches(draft,'','none'),false);assert.equal(g.groceryMatches({title:'Milk'},'milk','none'),true);
for(const quantity of [0,-1,NaN,Infinity,10000,1.0001])assert.throws(()=>g.validateGrocery({...draft,grocery_quantity:quantity}),/quantity/);
await g.saveGrocery(a,draft,null,'id');assert.equal(calls[0].value.grocery_unit,'cans');assert.equal(calls[0].value.household_id,a);
await g.saveGrocery(a,{...draft,grocery_quantity:null,grocery_unit:null,grocery_store:null},{id:'item',reminder_version:7},'unused',true);assert.equal(calls[1].value.done,false);assert.equal(calls[1].value.grocery_store,null);assert.deepEqual(Array.from(calls[1].filters,pair=>Array.from(pair)),[['household_id',a],['kind','grocery'],['id','item'],['reminder_version',7]]);
result={data:null,error:null};await assert.rejects(g.saveGrocery(a,draft,{id:'item',reminder_version:7},'unused'),/changed or was removed/);transition=true;const beforeCalls=calls.length;await assert.rejects(g.saveGrocery(a,draft,null,'id'),/transfer/);assert.equal(calls.length,beforeCalls);
const groupedItems=[
 {id:'beans',kind:'grocery',title:'Beans',category:'Pantry',done:0,grocery_store:' Costco '},
 {id:'ham',kind:'grocery',title:'Ham',category:'Deli',done:0,grocery_store:'costco'},
 {id:'apple',kind:'grocery',title:'Apple',category:'Produce',done:0,grocery_store:'Metro'},
 {id:'plain',kind:'grocery',title:'No store',category:'Pantry',done:0},
 {id:'picked',kind:'grocery',title:'Picked',category:'Pantry',done:1,grocery_store:'Costco'},
 {id:'task',kind:'task',title:'Task',category:'Pantry',done:0}
];
const groupedBefore=JSON.stringify(groupedItems),stores=g.groceryGroups(groupedItems,'store'),departments=g.groceryGroups(groupedItems,'department');
assert.deepEqual(Array.from(stores,x=>x.title),['Costco','Metro','No store set']);assert.deepEqual(Array.from(stores[0].items,x=>x.id),['ham','beans']);assert.deepEqual(Array.from(departments,x=>x.title),['Produce','Deli','Pantry']);assert.equal(stores.flatMap(x=>x.items).length,4);assert.equal(JSON.stringify(groupedItems),groupedBefore,'Grouping never mutates shared records');assert.equal(g.groceryGroups(groupedItems.filter(item=>g.groceryMatches(item,'beans','all')),'store').length,1);
console.log('Grocery grouping passed: department order, case-insensitive stores, unassigned last, picked/task exclusion, search compatibility and no record mutation.');
console.log('Grocery client checks passed: display, optional details, validation, store/search filtering, atomic scoped saves, picked-up reuse, stale conflicts and transfer blocking. Mocked requests only.');
