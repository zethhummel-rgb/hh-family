import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

const db=new PGlite(),read=name=>fs.readFileSync(new URL('../database/'+name,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
await db.exec(read('schema.sql'));
await db.exec(`create table private.test_transitions(household_id uuid primary key,active boolean not null default false,write_open boolean not null default true);
create function private.household_transition_active(hid uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select active from private.test_transitions where household_id=hid),false)$$;
create function private.household_transition_write_open(hid uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select write_open from private.test_transitions where household_id=hid),true)$$;
revoke all on private.test_transitions from public,anon,authenticated;
create policy transition_items_hold on public.household_items as restrictive for all to authenticated using(not private.household_transition_active(household_id)) with check(not private.household_transition_active(household_id));
create policy transition_cutover_insert on public.household_items as restrictive for insert to authenticated with check(private.household_transition_write_open(household_id));`);
await db.exec(read('grocery-staples.sql'));
const sql=read('meal-planner.sql');await db.exec(sql);
const scalar=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0])[0];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const users={owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',member:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',outsider:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name+'@meals.invalid']);
for(const [hid,uid] of [[a,users.owner],[b,users.other]]){
 await db.query('insert into public.households(id,name,owner_id) values($1,$2,$3)',[hid,'Synthetic meal household',uid]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",[hid,uid]);
}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member','member')",[a,users.member]);
const as=async(name)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||'']);};
const ingredient=(title,category='Other')=>({id:randomUUID(),title,category});
const draft=(title='Family pasta',ingredients=[])=>({title,instructions:'',source_url:'',ingredients});
const recipe=async(content=draft(),hid=a)=>(await db.query('insert into public.household_meal_recipes(household_id,title,instructions,source_url,ingredients) values($1,$2,$3,$4,$5::jsonb) returning *',[hid,content.title,content.instructions,content.source_url,JSON.stringify(content.ingredients)])).rows[0];
const plan=async(date,content=draft(),hid=a)=>(await db.query('insert into public.household_meal_plans(household_id,meal_date,title,instructions,source_url,ingredients) values($1,$2,$3,$4,$5,$6::jsonb) returning *',[hid,date,content.title,content.instructions,content.source_url,JSON.stringify(content.ingredients)])).rows[0];
const edit=async(table,current,title)=>(await db.query(`update public.${table} set title=$1 where household_id=$2 and id=$3 and version=$4 returning *`,[title,current.household_id,current.id,current.version])).rows;
const remove=async(table,current)=>(await db.query(`delete from public.${table} where household_id=$1 and id=$2 and version=$3 returning id`,[current.household_id,current.id,current.version])).rows;
const select=(meal,ids=meal.ingredients.map(item=>item.id))=>({meal_id:meal.id,version:meal.version,ingredient_ids:ids});
const add=(selections,hid=a)=>scalar('select public.add_meal_ingredients($1,$2::jsonb)',[hid,JSON.stringify(selections)]);
const groceries=()=>scalar("select count(*)::int from public.household_items where kind='grocery' and not done and household_id=$1",[a]);

for(const table of ['household_meal_recipes','household_meal_plans']){
 assert.equal(await scalar('select count(*)::int from public.'+table),0,'No meals preloaded');
 assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]),true);
 assert.equal(await scalar("select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE')",['public.'+table]),false);
 for(const column of ['id','household_id','created_at','updated_at','version'])assert.equal(await scalar("select has_column_privilege('authenticated',$1,$2,'UPDATE')",['public.'+table,column]),false);
 for(const column of ['id','created_at','updated_at','version'])assert.equal(await scalar("select has_column_privilege('authenticated',$1,$2,'INSERT')",['public.'+table,column]),false);
}
assert.equal(await scalar("select prosecdef from pg_proc where oid='public.add_meal_ingredients(uuid,jsonb)'::regprocedure"),false);
assert.equal(await scalar("select has_function_privilege('anon','public.add_meal_ingredients(uuid,jsonb)','EXECUTE')"),false);
assert.equal(await scalar("select prosecdef from pg_proc where oid='private.maintain_meal_revision()'::regprocedure"),false);
assert.equal(await scalar("select has_function_privilege('authenticated','private.maintain_meal_revision()','EXECUTE')"),false);
assert.match(sql,/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(hid::text,816441\)\)/,'Meal additions serialize with staples');
assert.match(sql,/order by id for share/,'Selected plans stay stable through batch validation');

await as('owner');
const rice=ingredient('2 cups rice','Pantry'),carrots=ingredient('2 carrots','Produce'),oil=ingredient('Olive oil','Pantry');
const original=await recipe({...draft('Rice dinner',[rice,carrots,oil]),instructions:'Rinse the rice.\n  Keep this indentation.',source_url:'https://example.invalid/recipe?size=4#method'});
const first=await plan('2026-11-01',original),second=await plan('2026-11-02',draft('Leftovers'));
assert.equal(first.version,1);assert.equal(+new Date(first.created_at),+new Date(first.updated_at));
assert.equal(first.ingredients[0].title,'2 cups rice','Quantity text is preserved exactly');
assert.equal(first.instructions,original.instructions,'Instructions retain line breaks');
await assert.rejects(plan('2026-11-01',draft('Accidental replacement')),/unique/,'Occupied dates cannot be silently overwritten');
await assert.rejects(db.query('update public.household_meal_plans set meal_date=$1 where id=$2',['2026-11-01',second.id]),/unique/);
assert.equal(await scalar('select meal_date::text from public.household_meal_plans where id=$1',[second.id]),'2026-11-02','A date collision keeps the original plan intact');
const movable=await plan('2026-11-08',original);
const moved=(await db.query('update public.household_meal_plans set meal_date=$1 where household_id=$2 and id=$3 and version=$4 returning *',['2026-11-09',a,movable.id,movable.version])).rows[0];
assert.equal(moved.version,2);assert.deepEqual(moved.ingredients,original.ingredients);assert.equal(moved.title,original.title);
assert.equal(await scalar("select count(*)::int from public.household_meal_plans where meal_date='2026-11-08'"),0,'Moving a dinner frees its former date');
const copied=await plan('2026-11-10',moved);assert.notEqual(copied.id,moved.id);assert.equal(copied.version,1);assert.deepEqual(copied.ingredients,moved.ingredients,'Copying creates an independent snapshot');
await remove('household_meal_plans',moved);assert.equal(await scalar('select count(*)::int from public.household_meal_plans where id=$1',[copied.id]),1,'Removing the original leaves the copied dinner');await remove('household_meal_plans',copied);
await assert.rejects(plan('infinity'),/constraint/);await assert.rejects(plan('2026-02-30'),/date/);
for(const title of ['', ' \t\n\u00a0\u2009\ufeff', 'x'.repeat(161)])await assert.rejects(recipe(draft(title)),/constraint/);
await assert.rejects(recipe({...draft(),instructions:'x'.repeat(10001)}),/constraint/);
for(const source_url of ['javascript:alert(1)','data:text/html,hi','//example.invalid','https://','https://example.invalid/with space','https://example.invalid/\npath','https:\\example.invalid','https://example.invalid/\u00a0x','https://example.invalid/'+ 'x'.repeat(2048)])await assert.rejects(recipe({...draft(),source_url}),/constraint/);
for(const ingredients of [null,{},'rice',1,[null],['rice'],[{}],[{...rice,id:'bad'}],[{...rice,title:42}],[{...rice,title:'\u00a0'}],[{...rice,title:'x'.repeat(161)}],[{...rice,category:'Surprise'}],[{...rice,extra:true}],[rice,rice],Array.from({length:61},()=>ingredient('Beans'))])await assert.rejects(recipe({...draft(),ingredients}),/constraint|cannot delete/);
const maximum=await recipe({...draft('x'.repeat(160),Array.from({length:60},()=>ingredient('x'.repeat(160)))),instructions:'x'.repeat(10000)});assert.equal(maximum.ingredients.length,60);
await assert.rejects(db.query('insert into public.household_meal_plans(household_id,meal_date,title,version) values($1,$2,$3,999)',[a,'2026-11-03','Spoof']),/permission/);
await assert.rejects(db.query('update public.household_meal_recipes set household_id=$1 where id=$2',[b,original.id]),/permission/);
await assert.rejects(db.query("update public.household_meal_plans set updated_at='2099-01-01' where id=$1",[first.id]),/permission/);
const literal="Soup'); DELETE FROM public.households; --",html='<img src=x onerror="alert(1)">\n<script>alert(2)</script>';
const literalMeal=await recipe({...draft(literal,[ingredient(literal)]),instructions:html});
assert.equal(literalMeal.title,literal);assert.equal(literalMeal.instructions,html);assert.equal(await scalar('select count(*)::int from public.households'),1);
const changedRecipe=(await edit('household_meal_recipes',original,'Changed favourite'))[0];
assert.equal(changedRecipe.version,2);assert.equal(+new Date(changedRecipe.created_at),+new Date(original.created_at));
assert.equal(await scalar('select title from public.household_meal_plans where id=$1',[first.id]),'Rice dinner','Recipe edits leave plan snapshots unchanged');
await remove('household_meal_recipes',changedRecipe);
assert.equal(await scalar('select count(*)::int from public.household_meal_plans where id=$1',[first.id]),1,'Deleting a recipe retains its dated plan');

await as('member');
assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),2,'Members share all household meals');
let current=(await edit('household_meal_plans',first,'Rice and carrots'))[0];
assert.equal(current.version,2);
assert.deepEqual(await edit('household_meal_plans',first,'Stale overwrite'),[]);assert.deepEqual(await remove('household_meal_plans',first),[]);
const memberRecipe=await recipe(draft('Member favourite'));
const latestRecipe=(await edit('household_meal_recipes',memberRecipe,'Shared favourite'))[0];
assert.deepEqual(await edit('household_meal_recipes',memberRecipe,'Stale recipe'),[]);assert.deepEqual(await remove('household_meal_recipes',memberRecipe),[]);
await db.query("insert into public.household_items(household_id,kind,title,category) values($1,'grocery','  OLIVE\u00a0OIL  ','Other')",[a]);
await db.query("insert into public.household_items(household_id,kind,title,category,done) values($1,'grocery','2 cups rice','Pantry',true)",[a]);
await db.query("insert into public.household_items(household_id,kind,title,category) values($1,'task','2 carrots','Other')",[a]);
await assert.rejects(add([select(first)]),/Meal plan changed/);
assert.equal(await groceries(),1,'Stale batches add nothing');
assert.deepEqual(await add([select(current)]),{added:2,skipped:1},'Manual open groceries match; picked history and tasks do not block additions');
assert.deepEqual(await add([select(current)]),{added:0,skipped:3},'Repeated selection cannot duplicate open groceries');
assert.equal(await scalar("select category from public.household_items where kind='grocery' and title='2 carrots'"),'Produce');
assert.equal(await scalar("select person from public.household_items where kind='grocery' and title='2 carrots'"),'Everyone');
assert.equal(await scalar("select count(*)::int from public.household_items where kind='grocery' and done"),1,'Picked-up history is retained');
const oneCup=ingredient('1 cup rice','Pantry'),sameCarrots=ingredient('  2 CARROTS ','Other'),beans=ingredient('Beans','Pantry');
const third=await plan('2026-11-03',draft('Another dinner',[oneCup,sameCarrots,beans]));
assert.deepEqual(await add([select(third)]),{added:2,skipped:1},'Different quantities remain distinct; case/whitespace duplicates skip');
const staple=await scalar("insert into public.household_grocery_staples(household_id,title,category) values($1,'Beans','Pantry') returning id",[a]);
assert.deepEqual(await scalar('select public.add_grocery_staples($1,$2::uuid[])',[a,[staple]]),{added:0,skipped:1},'Staples and meal ingredients share the same open list');
await db.query("update public.household_items set done=true where household_id=$1 and kind='grocery' and title='2 carrots'",[a]);
assert.deepEqual(await add([select(current,[carrots.id])]),{added:1,skipped:0},'Picking up an ingredient allows the next shop');

await as('other');const other=await plan('2026-11-01',draft('Another household',[ingredient('Private ingredient')]),b);
assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),1);
assert.equal(await scalar('select count(*)::int from public.household_meal_recipes'),0);
await assert.rejects(recipe(draft('Foreign'),a),/row-level security/);await assert.rejects(plan('2026-11-04',draft('Foreign'),a),/row-level security/);
assert.deepEqual(await edit('household_meal_plans',current,'Foreign'),[]);assert.deepEqual(await remove('household_meal_recipes',latestRecipe),[]);
await assert.rejects(add([select(current)],a),/membership/);
await as('owner');
const untouched=await plan('2026-11-04',draft('Untouched',[ingredient('New batch item')]));const before=await groceries();
for(const invalid of [select(other),{...select(third),version:999},{...select(third),ingredient_ids:[randomUUID()]}]){
 await assert.rejects(add([select(untouched),invalid]),/Meal plan changed/);assert.equal(await groceries(),before,'All-or-none batch validation prevents partial additions');
}
for(const selections of [null,{},'rice',[],[null],[1],[{}],[{...select(current),extra:true}],[{...select(current),meal_id:'invalid'}],[{...select(current),version:0}],[{...select(current),version:1.5}],[{...select(current),version:2147483648}],[{...select(current),version:'2'}],[{...select(current),ingredient_ids:null}],[{...select(current),ingredient_ids:[null]}],[{...select(current),ingredient_ids:['bad']}],[{...select(current),ingredient_ids:[carrots.id,carrots.id]}],[select(current),select(current)]])await assert.rejects(add(selections));
const sixty=Array.from({length:60},(_,i)=>ingredient('Limit item '+i));
const limitA=await plan('2026-11-05',draft('Limit A',sixty)),limitB=await plan('2026-11-06',draft('Limit B',sixty));
await assert.rejects(add([select(limitA),select(limitB,sixty.slice(0,41).map(item=>item.id))]),/100/);
assert.equal(await groceries(),before,'Over-limit batches add nothing');
assert.deepEqual(await add([select(limitA),select(limitB,sixty.slice(0,40).map(item=>item.id))]),{added:60,skipped:40},'100 selections accepted and exact duplicates across dinners skipped');
await db.exec('reset role');await db.query('insert into private.test_transitions(household_id,active) values($1,true)',[a]);
await as('owner');await assert.rejects(add([select(untouched)]),/household transfer/);
await db.exec('reset role');await db.query('update private.test_transitions set active=false,write_open=false where household_id=$1',[a]);
await as('owner');await assert.rejects(add([select(untouched)]),/household transfer/);
await db.exec('reset role');await db.query('update private.test_transitions set write_open=true where household_id=$1',[a]);
await as('owner');assert.deepEqual(await add([select(untouched)]),{added:1,skipped:0});
const groceryCount=await groceries();await remove('household_meal_plans',untouched);
assert.equal(await groceries(),groceryCount,'Deleting a plan does not remove groceries');await assert.rejects(add([select(untouched)]),/Meal plan changed/);
await db.exec('reset role');
await db.exec("create function private.reject_test_grocery() returns trigger language plpgsql as $$begin if new.title='Reject later grocery' then raise exception 'Synthetic grocery rejection';end if;return new;end$$; create trigger reject_test_grocery before insert on public.household_items for each row execute function private.reject_test_grocery();");
await as('owner');const rollbackPlan=await plan('2026-11-07',draft('Atomic rollback',[ingredient('Earlier grocery'),ingredient('Reject later grocery')]));
await assert.rejects(add([select(rollbackPlan)]),/Synthetic grocery rejection/);assert.equal(await groceries(),groceryCount,'An insert failure rolls back earlier groceries in the same RPC');

await as('outsider');assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),0);assert.equal(await scalar('select count(*)::int from public.household_meal_recipes'),0);
await assert.rejects(recipe(),/row-level security/);await assert.rejects(plan('2026-11-08'),/row-level security/);await assert.rejects(add([select(current)]),/membership/);
await as('');await assert.rejects(add([select(current)]),/membership/);assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),0);
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.household_meal_recipes'),/permission/);await assert.rejects(db.query('select * from public.household_meal_plans'),/permission/);await assert.rejects(add([select(current)]),/permission/);
await db.exec('reset role');await db.query('delete from auth.users where id=$1',[users.member]);
assert.equal(await scalar('select count(*)::int from public.household_meal_recipes where id=$1',[latestRecipe.id]),1,'Removing one member retains shared favourites');
await as('member');assert.equal(await scalar('select count(*)::int from public.household_meal_plans'),0);await assert.rejects(add([select(current)]),/membership/);
await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);
assert.equal(await scalar('select count(*)::int from public.household_meal_plans where household_id=$1',[a]),0);assert.equal(await scalar('select count(*)::int from public.household_meal_recipes where household_id=$1',[a]),0);
assert.equal(await scalar('select count(*)::int from public.household_meal_plans where id=$1',[other.id]),1,'Whole-home deletion does not affect another household');
await db.close();
console.log('Meal database checks passed: current-membership isolation, protected revisions, snapshot preservation, date collisions, strict JSON/URL limits, literal SQL/HTML text, atomic grocery batches, exact amounts, retries, picked history, transition guards and household cleanup. Synthetic data only.');

const calls=[];let respond=()=>({data:[],error:null});
const fakeClient={from(table){
 const call={table,filters:[]};const chain={
  select(fields){call.fields=fields;return chain},eq(key,value){call.filters.push([key,value]);return chain},gte(key,value){call.filters.push([key,'>=',value]);return chain},lt(key,value){call.filters.push([key,'<',value]);return chain},gt(key,value){call.after=[key,value];return chain},order(key){call.order=key;return chain},limit(count){call.limit=count;return chain},
  insert(value){call.operation='insert';call.value=value;return chain},update(value){call.operation='update';call.value=value;return chain},delete(){call.operation='delete';return chain},single(){return chain},maybeSingle(){return chain},then(resolve,reject){calls.push(call);return Promise.resolve(respond(call)).then(resolve,reject)}
 };return chain;
},rpc(name,args){const call={rpc:name,args};calls.push(call);return Promise.resolve(respond(call))}};
globalThis.__mealClient=fakeClient;
try{
 const source=fs.readFileSync(new URL('../src/mealPlannerData.ts',import.meta.url),'utf8').replace("import {supabase} from './supabase';",'const supabase=globalThis.__mealClient;').replace("import {groceryCategories} from './groceryStaplesData';","const groceryCategories=['Produce','Dairy & eggs','Meat & fish','Bakery','Pantry','Frozen','Household','Other'];");
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const api=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const make=i=>({id:'00000000-0000-0000-0000-'+String(i).padStart(12,'0'),household_id:a,...draft('Meal '+i,[rice]),meal_type:'supper',meal_date:new Date(Date.UTC(2026,0,i)).toISOString().slice(0,10),version:4,created_at:'2026-11-01T14:00:00Z',updated_at:'2026-11-01T15:00:00Z'});
 const many=Array.from({length:201},(_,i)=>make(i+1));respond=call=>({data:call.after?many.slice(200):many.slice(0,200),error:null});
 assert.equal((await api.loadSavedMeals(a)).length,201);assert.deepEqual(calls[1].after,['id',many[199].id]);assert.ok(calls.every(call=>call.order==='id'&&call.limit===200));
 calls.length=0;assert.equal((await api.loadMealPlans(a,'2026-01-01','2027-01-01')).length,201);
 assert.ok(calls.every(call=>JSON.stringify(call.filters)===JSON.stringify([['household_id',a],['meal_date','>=','2026-01-01'],['meal_date','<','2027-01-01']])),'Every page retains household and half-open date limits');
 for(const [from,to] of [['2026-02-30','2026-03-08'],['2026-11-01','2026-11-01'],['2026-01-01','2028-01-01']])await assert.rejects(api.loadMealPlans(a,from,to),/range/);
 calls.length=0;respond=()=>({data:null,error:null});const stale=make(1);
 await assert.rejects(api.saveSavedMeal(a,draft('Changed'),stale),api.MealConflictError);await assert.rejects(api.deleteSavedMeal(a,stale),api.MealConflictError);
 await assert.rejects(api.saveMealPlan(a,{...draft('Changed'),meal_date:'2026-11-02',meal_type:'supper'},stale),api.MealConflictError);await assert.rejects(api.deleteMealPlan(a,stale),api.MealConflictError);
 assert.ok(calls.every(call=>JSON.stringify(call.filters)===JSON.stringify([['household_id',a],['id',stale.id],['version',4]])),'All mutations carry household, ID and original version');
 respond=()=>({data:null,error:{code:'23505',message:'Synthetic insert conflict'}});await assert.rejects(api.saveMealPlan(a,{...draft(),meal_date:'2026-11-02',meal_type:'supper'}),/Synthetic insert conflict/);
 calls.length=0;respond=call=>({data:{...stale,...call.value},error:null});
 const input={...draft('  Rice dinner  ',[rice]),instructions:'Line 1\n  line 2\n',source_url:'https://example.invalid/recipe'};
 await api.saveMealPlan(a,{...input,meal_date:'2026-11-03',meal_type:'lunch'});
 assert.deepEqual(calls[0].value,{id:calls[0].value.id,household_id:a,...input,title:'Rice dinner',meal_date:'2026-11-03',meal_type:'lunch'},'Client preserves quantity text and instructions, sends only editable fields');
 const count=calls.length;
 for(const invalid of [{...input,title:'\u00a0'},{...input,ingredients:[rice,rice]},{...input,ingredients:[{...rice,id:'invalid'}]},{...input,source_url:'javascript:alert(1)'},{...input,source_url:'https://example.invalid/space here'}])await assert.rejects(api.saveSavedMeal(a,invalid));
 assert.equal(calls.length,count,'Invalid fields fail before a request');
 calls.length=0;respond=()=>({data:{added:1,skipped:0},error:null});
 assert.deepEqual(await api.addMealIngredients(a,[{meal_id:stale.id,version:4,ingredient_ids:[rice.id]}]),{added:1,skipped:0});
 assert.deepEqual(calls[0],{rpc:'add_meal_ingredients',args:{hid:a,selections:[{meal_id:stale.id,version:4,ingredient_ids:[rice.id]}]}},'Grocery RPC sends stored IDs/version only');
 assert.deepEqual(await api.addMealIngredients(a,[{meal_id:stale.id,version:4,ingredient_ids:[rice.id,crypto.randomUUID()]}]),{added:1,skipped:0},'Combined ingredients can produce fewer grocery lines than selected ingredients');
 respond=()=>({data:{added:0,skipped:0},error:null});await assert.rejects(api.addMealIngredients(a,[{meal_id:stale.id,version:4,ingredient_ids:[rice.id]}]),/confirm/);
 respond=()=>({data:null,error:{code:'P0001',message:'Meal plan changed. Refresh and choose ingredients again'}});await assert.rejects(api.addMealIngredients(a,[{meal_id:stale.id,version:4,ingredient_ids:[rice.id]}]),api.MealConflictError);
 respond=()=>({data:{added:2,skipped:0},error:null});await assert.rejects(api.addMealIngredients(a,[{meal_id:stale.id,version:4,ingredient_ids:[rice.id]}]),/confirm/);
 assert.equal(api.validMealDate('2024-02-29'),true);assert.equal(api.validMealDate('2026-02-29'),false);
 console.log('Meal client checks passed: complete pagination, date-scoped reads, revision filters, typed conflicts and server errors, preserved instructions and quantities, input rejection and identifier-only grocery batches. Mocked requests only.');
}finally{delete globalThis.__mealClient}
