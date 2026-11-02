import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
await db.exec(read('database/schema.sql'));
await db.exec(read('database/recurring-reminders.sql'));
await db.exec(read('database/reminder-completion-guard.sql'));
await db.exec(`create table private.test_transitions(hid uuid primary key,active boolean not null default false,write_open boolean not null default true);
create function private.household_transition_active(id uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select active from private.test_transitions where hid=id),false)$$;
create function private.household_transition_write_open(id uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select write_open from private.test_transitions where hid=id),true)$$;`);
for(const name of ['grocery-staples.sql','meal-planner.sql','grocery-details.sql'])await db.exec(read('database/'+name));
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const users={owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',member:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',outsider:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name+'@full-meals.invalid']);
for(const [hid,id] of [[a,users.owner],[b,users.other]]){
 await db.query("insert into public.households(id,name,owner_id) values($1,'Synthetic meal home',$2)",[hid,id]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Alex','owner')",[hid,id]);
}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Sam','member')",[a,users.member]);
const as=async(name)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||''])};
const ingredient=(title,category='Pantry')=>({id:randomUUID(),title,category});
const dinnerIngredients=[ingredient('2 cans beans'),ingredient('200 g turkey','Deli')];
await as('owner');
const dinner=(await db.query("insert into public.household_meal_plans(household_id,meal_date,title,instructions,source_url,ingredients) values($1,'2026-11-04','Existing dinner','Keep\n  these notes.','https://example.invalid/family-recipe',$2::jsonb) returning *",[a,JSON.stringify(dinnerIngredients)])).rows[0];
await db.query('update public.household_meal_plans set title=$1 where id=$2',['Existing dinner, edited',dinner.id]);
const recipe=(await db.query("insert into public.household_meal_recipes(household_id,title,ingredients) values($1,'Existing favourite',$2::jsonb) returning *",[a,JSON.stringify(dinnerIngredients)])).rows[0];
const grocery=(await db.query("insert into public.household_items(household_id,kind,title,grocery_quantity,grocery_unit,grocery_store) values($1,'grocery','Milk',2,'cartons','Metro') returning *",[a])).rows[0];
const before=await scalar('select to_jsonb(p) from public.household_meal_plans p where id=$1',[dinner.id]);
const policies=await scalar("select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='household_meal_plans'");
await db.exec('reset role');
const sql=read('database/full-meal-planning.sql');await db.exec(sql);
const migrations=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(file=>file.endsWith('_full_meal_planning.sql'));
assert.equal(migrations.length,1);assert.equal(sql,read('supabase/migrations/'+migrations[0]));
assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.household_meal_plans'::regclass"),true);
assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='household_meal_plans'"),policies,'Membership policies stay exactly as deployed');
assert.equal(await scalar("select has_table_privilege('anon','public.household_meal_plans','SELECT,INSERT,UPDATE,DELETE')"),false);
assert.equal(await scalar("select has_column_privilege('authenticated','public.household_meal_plans','meal_type','INSERT,UPDATE')"),true);
assert.equal(await scalar("select has_column_privilege('authenticated','public.household_meal_plans','id','INSERT')"),true);
assert.equal(await scalar("select has_column_privilege('authenticated','public.household_meal_recipes','id','INSERT')"),false);
for(const column of ['id','household_id','created_at','updated_at','version'])assert.equal(await scalar("select has_column_privilege('authenticated','public.household_meal_plans',$1,'UPDATE')",[column]),false);
assert.equal(await scalar("select count(*)::int from pg_indexes where tablename='household_meal_plans' and indexdef like '%(household_id, meal_date, id)%'"),1,'Date-range reads keep a matching household-leading index');
assert.equal(await scalar("select prosecdef from pg_proc where oid='public.add_meal_ingredients(uuid,jsonb)'::regprocedure"),false);
await as('owner');
assert.deepEqual(await scalar("select to_jsonb(p)-'meal_type' from public.household_meal_plans p where id=$1",[dinner.id]),before,'Every old dinner field, identity, date, version and timestamp stays unchanged');
assert.equal(await scalar('select meal_type from public.household_meal_plans where id=$1',[dinner.id]),'supper');
assert.deepEqual((await db.query('select * from public.household_meal_recipes where id=$1',[recipe.id])).rows[0],recipe,'Saved recipes are untouched');
assert.deepEqual((await db.query('select * from public.household_items where id=$1',[grocery.id])).rows[0],grocery,'Existing grocery quantities and stores are untouched');
const addPlan=async(type,title,ingredients=[],hid=a)=>(await db.query("insert into public.household_meal_plans(household_id,meal_date,meal_type,title,ingredients) values($1,'2026-11-04',$2,$3,$4::jsonb) returning *",[hid,type,title,JSON.stringify(ingredients)])).rows[0];
const slots=[];
for(const type of ['breakfast','lunch','supper','snacks'])slots.push(await addPlan(type,'One '+type,[ingredient('Shared bread'),ingredient(type+' ingredient')]));
const extra=await addPlan('lunch','Another lunch',[ingredient('2 cups rice')]);
assert.equal(await scalar("select count(*)::int from public.household_meal_plans where household_id=$1 and meal_date='2026-11-04'",[a]),6,'All slots and multiple meals in one slot coexist');
const oldClient=(await db.query("insert into public.household_meal_plans(household_id,meal_date,title) values($1,'2026-11-04','Old client dinner') returning *",[a])).rows[0];
assert.equal(oldClient.meal_type,'supper','Older clients retain the original dinner default');
const requestId=randomUUID();
const explicitInsert=id=>db.query("insert into public.household_meal_plans(id,household_id,meal_date,meal_type,title) values($1,$2,'2026-11-04','lunch','Retry-safe lunch') returning *",[id,a]);
const requested=(await explicitInsert(requestId)).rows[0];
await assert.rejects(explicitInsert(requestId),/unique/);
assert.deepEqual((await db.query('select * from public.household_meal_plans where id=$1',[requestId])).rows[0],requested,'Duplicate creation IDs never alter timestamps, version or existing content');
const intentional=(await explicitInsert(randomUUID())).rows[0];assert.notEqual(intentional.id,requested.id,'Different request IDs allow deliberately repeated meals');
await assert.rejects(db.query('update public.household_meal_plans set id=$1 where id=$2',[randomUUID(),requestId]),/permission/);

for(const invalid of [null,'','dinner','Breakfast','supper ',"lunch'); delete from public.households; --"]){
 await assert.rejects(addPlan(invalid,'Invalid slot'),/constraint|null/);
 await assert.rejects(db.query('update public.household_meal_plans set meal_type=$1 where id=$2',[invalid,extra.id]),/constraint|null/);
}
const literal="Toast'); DROP TABLE public.households; --";
const literalPlan=await addPlan('breakfast',literal,[ingredient(literal)]);assert.equal(literalPlan.title,literal);
assert.equal(await scalar('select count(*)::int from public.households'),1,'SQL-looking input remains literal text');
await as('member');
const changed=(await db.query("update public.household_meal_plans set meal_type='snacks',meal_date='2026-11-05' where household_id=$1 and id=$2 and version=$3 returning *",[a,extra.id,extra.version])).rows[0];
assert.equal(changed.version,2);assert.equal(changed.meal_type,'snacks');assert.deepEqual(changed.ingredients,extra.ingredients);
assert.deepEqual((await db.query("update public.household_meal_plans set meal_type='supper' where household_id=$1 and id=$2 and version=$3 returning id",[a,extra.id,extra.version])).rows,[],'Stale slot moves cannot overwrite newer edits');
assert.deepEqual((await db.query('delete from public.household_meal_plans where household_id=$1 and id=$2 and version=$3 returning id',[a,extra.id,extra.version])).rows,[],'Stale removal retains moved meal');
const selection=plan=>({meal_id:plan.id,version:plan.version,ingredient_ids:plan.ingredients.map(item=>item.id)});
const shop=(plans,hid=a)=>scalar('select public.add_meal_ingredients($1,$2::jsonb)',[hid,JSON.stringify(plans.map(selection))]);
assert.deepEqual(await shop(slots),{added:5,skipped:3},'One day shops all slots and skips exact duplicate ingredient lines');
assert.deepEqual(await shop(slots),{added:0,skipped:8},'Retry leaves open groceries unduplicated');
const shoppingCount=await scalar("select count(*)::int from public.household_items where household_id=$1 and kind='grocery'",[a]);
await assert.rejects(shop([literalPlan,extra]),/Meal plan changed/);
assert.equal(await scalar("select count(*)::int from public.household_items where household_id=$1 and kind='grocery'",[a]),shoppingCount,'Stale meal rolls back the whole ingredient selection');
assert.deepEqual(await shop([changed]),{added:1,skipped:0});
assert.equal(await scalar("select title from public.household_items where title='2 cups rice'"),'2 cups rice','Ingredient amounts retain their exact wording');
assert.equal(await scalar("select grocery_quantity from public.household_items where title='2 cups rice'"),null,'No guessed conversion to structured grocery quantities');
await as('other');const foreign=await addPlan('breakfast','Private breakfast',[ingredient('Private ingredient')],b);
assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),1);
await assert.rejects(addPlan('lunch','Foreign write',[],a),/row-level security/);
assert.deepEqual((await db.query("update public.household_meal_plans set meal_type='snacks' where id=$1 returning id",[changed.id])).rows,[]);
assert.deepEqual((await db.query('delete from public.household_meal_plans where id=$1 returning id',[changed.id])).rows,[]);
await assert.rejects(shop(slots,a),/membership/);
await as('owner');await assert.rejects(shop([literalPlan,foreign]),/Meal plan changed/);
for(const name of ['outsider','']){await as(name);assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),0);await assert.rejects(addPlan('snacks','Forbidden'),/row-level security/);await assert.rejects(shop(slots),/membership/)}
await db.exec('reset role;set role anon');await assert.rejects(db.query('select meal_type from public.household_meal_plans'),/permission/);await assert.rejects(shop(slots),/permission/);
await db.exec('reset role');await db.query('delete from public.household_members where user_id=$1',[users.member]);await as('member');assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),0);await assert.rejects(shop(slots),/membership/);
await db.exec('reset role');await db.query('insert into private.test_transitions values($1,true,true)',[a]);await as('owner');await assert.rejects(shop([literalPlan]),/household transfer/);
await db.exec('reset role');await db.query('update private.test_transitions set active=false,write_open=false where hid=$1',[a]);await as('owner');await assert.rejects(shop([literalPlan]),/household transfer/);
await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);assert.equal(await scalar('select count(*)::int from public.household_meal_plans where household_id=$1',[a]),0);assert.equal(await scalar('select count(*)::int from public.household_meal_plans where household_id=$1',[b]),1);
await db.close();
console.log('Full meal planning database checks passed: exact existing-data preservation, all four slots, multiple entries, old-client defaults, scoped privileges/RLS, literal SQL input, stale edits/removals, all-slot grocery batches, exact quantity text, transfer guards and household cleanup. Synthetic local records only.');

const calls=[];let respond=call=>({data:{id:call.value?.id||'saved',...call.value},error:null});const fake={from(table){const call={table,filters:[]};const chain={insert(value){call.value=value;return chain},update(value){call.value=value;return chain},eq(k,v){call.filters.push([k,v]);return chain},select(fields){call.fields=fields;return chain},single(){return chain},maybeSingle(){return chain},then(resolve,reject){calls.push(call);return Promise.resolve(respond(call)).then(resolve,reject)}};return chain}};
globalThis.__fullMeals=fake;
try{
 const source=read('src/mealPlannerData.ts').replace("import {supabase} from './supabase';",'const supabase=globalThis.__fullMeals;').replace("import {groceryCategories} from './groceryStaplesData';","const groceryCategories=['Pantry'];");
 const api=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
 assert.deepEqual(api.mealTypes,['breakfast','lunch','supper','snacks']);assert.equal(api.mealTypeLabels.supper,'Supper');
 const content={title:'Toast',ingredients:[],instructions:'',source_url:''};
 for(const type of api.mealTypes){await api.saveMealPlan(a,{...content,meal_date:'2026-11-04',meal_type:type});assert.equal(calls.at(-1).value.meal_type,type);assert.match(calls.at(-1).fields,/meal_type/)}
 const count=calls.length;for(const type of [null,undefined,'Dinner','lunch ',42])await assert.rejects(api.saveMealPlan(a,{...content,meal_date:'2026-11-04',meal_type:type}),/Choose breakfast/);
 assert.equal(calls.length,count,'Invalid slots never reach the API');
 const unsorted=[
 {id:'snack',meal_date:'2026-11-04',meal_type:'snacks',created_at:'2026-11-01T00:00:00Z'},
 {id:'later',meal_date:'2026-11-05',meal_type:'breakfast',created_at:'2026-11-01T00:00:00Z'},
 {id:'lunch-b',meal_date:'2026-11-04',meal_type:'lunch',created_at:'2026-11-02T00:00:00Z'},
 {id:'breakfast',meal_date:'2026-11-04',meal_type:'breakfast',created_at:'2026-11-01T00:00:00Z'},
 {id:'lunch-a',meal_date:'2026-11-04',meal_type:'lunch',created_at:'2026-11-01T00:00:00Z'},
 {id:'supper',meal_date:'2026-11-04',meal_type:'supper',created_at:'2026-11-01T00:00:00Z'}
 ];
 const snapshot=JSON.stringify(unsorted);
 assert.deepEqual(api.sortMealPlans(unsorted).map(plan=>plan.id),['breakfast','lunch-a','lunch-b','supper','snack','later']);assert.equal(JSON.stringify(unsorted),snapshot);
 const rows=new Map();let loseResponse=true;
 respond=call=>{
  if(call.value){
   if(rows.has(call.value.id))return {data:null,error:{code:'23505',message:'Duplicate ID'}};
   const row={...call.value,version:1,created_at:'2026-11-02T01:00:00Z',updated_at:'2026-11-02T01:00:00Z'};rows.set(row.id,row);
   if(loseResponse){loseResponse=false;return {data:null,error:{code:'NETWORK',message:'Connection lost after commit'}}}
   return {data:row,error:null};
  }
  const row=rows.get(call.filters.find(([key])=>key==='id')?.[1]);
  return {data:row&&row.household_id===call.filters.find(([key])=>key==='household_id')?.[1]?row:null,error:null};
 };
 const retryId=randomUUID(),retryDraft={...content,meal_date:'2026-11-04',meal_type:'breakfast'};
 await assert.rejects(api.saveMealPlan(a,retryDraft,null,retryId),/Connection lost/);
 const savedBefore=JSON.stringify(rows.get(retryId));
 const retried=await api.saveMealPlan(a,retryDraft,null,retryId);
 assert.equal(retried.id,retryId);assert.equal(rows.size,1);assert.equal(JSON.stringify(retried),savedBefore,'Lost-response retry reads original row without changing version or timestamps');
 assert.deepEqual(calls.at(-1).filters,[['household_id',a],['id',retryId]],'Duplicate resolution reads only the intended household and exact creation ID');
 const deliberate=await api.saveMealPlan(a,retryDraft,null,randomUUID());assert.notEqual(deliberate.id,retryId);assert.equal(rows.size,2,'Explicitly adding the same meal again uses a new ID');
 const mismatch=await api.saveMealPlan(a,{...retryDraft,title:'Changed draft'},null,retryId).catch(error=>error);
 assert.ok(mismatch instanceof api.MealCreationConflictError);assert.equal(JSON.stringify(rows.get(retryId)),savedBefore,'Different retry details never overwrite the previous save');
 const foreignId=randomUUID();rows.set(foreignId,{...retried,id:foreignId,household_id:b});
 const foreignFailure=await api.saveMealPlan(a,retryDraft,null,foreignId).catch(error=>error);
 assert.ok(foreignFailure instanceof api.MealCreationConflictError);assert.equal(foreignFailure.message,mismatch.message,'Foreign ID collisions reveal no other-household contents');
 assert.equal(rows.get(foreignId).household_id,b);
 const beforeInvalid=calls.length;for(const badId of ['',"'); drop table households; --",42])await assert.rejects(api.saveMealPlan(a,retryDraft,null,badId),/identify|already/);
 assert.equal(calls.length,beforeInvalid,'Malformed creation IDs fail before network access');
 console.log('Full meal planning client checks passed: validated slots/IDs, chronological immutable sorting, stable creation retries after lost responses, deliberate identical meals, mismatch protection, no foreign-data disclosure and preserved server revisions. Mocked requests only.');
}finally{delete globalThis.__fullMeals}
