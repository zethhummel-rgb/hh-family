import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

const read=name=>fs.readFileSync(new URL('../database/'+name,import.meta.url),'utf8'),db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(value text) returns uuid language sql as $$insert into vault.secrets(secret) values(value) returning id$$;
create schema cron;create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$select 1::bigint$$;`);
for(const file of ['schema.sql','calendar.sql','google_calendar.sql','calendar_integrity.sql','member-colours.sql','pilot.sql'])await db.exec(read(file));
await db.exec('alter table public.household_events add column reminder_minutes integer');
for(const file of ['native-calendar-repeats.sql','event-notification-toggle.sql','recurring-reminders.sql','reminder-completion-guard.sql'])await db.exec(read(file));
await db.exec(`create table private.calendar_copy_state(household_id uuid primary key,native_ready boolean default true);
create function private.household_transition_active(hid uuid) returns boolean language sql as $$select false$$;
create function private.household_transition_write_open(hid uuid) returns boolean language sql as $$select true$$;`);
for(const file of ['google-calendar-import.sql','grocery-staples.sql','family-notes.sql','meal-planner.sql','event-countdowns.sql','grocery-details.sql','full-meal-planning.sql'])await db.exec(read(file));
const sql=read('household-activity.sql');await db.exec(sql);
assert.equal(sql,fs.readFileSync(new URL('../supabase/migrations/20261101224407_household_activity.sql',import.meta.url),'utf8'));
const scalar=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0])[0];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const users={owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',member:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sibling:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',outsider:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name+'@activity.invalid']);
for(const [hid,uid] of [[a,users.owner],[b,users.other]]){
 await db.query('insert into public.households(id,name,owner_id) values($1,$2,$3)',[hid,'Synthetic activity home',uid]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Alex','owner')",[hid,uid]);
}
for(const name of ['member','sibling'])await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,$3,'member')",[a,users[name],name==='member'?'Sam':'Taylor']);
const as=async(name)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||'']);};
const inbox=async()=> (await db.query('select * from public.household_activity order by created_at,id')).rows;
const add=async(title='Milk',kind='grocery',hid=a)=>(await db.query('insert into public.household_items(household_id,kind,title) values($1,$2,$3) returning *',[hid,kind,title])).rows[0];
assert.equal(await scalar('select count(*)::int from public.household_activity'),0,'Existing content is not backfilled');
assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.household_activity'::regclass"),true);
for(const role of ['anon','authenticated']){
 assert.equal(await scalar("select has_table_privilege($1,'public.household_activity','INSERT,UPDATE')",[role]),false);
 assert.equal(await scalar("select has_function_privilege($1,'private.capture_household_activity()','EXECUTE')",[role]),false);
 assert.equal(await scalar("select has_function_privilege($1,'public.google_import_service(text,jsonb)','EXECUTE')",[role]),false);
}
assert.equal(await scalar("select proconfig[1] from pg_proc where oid='private.capture_household_activity()'::regprocedure"),'search_path=""');

await as('owner');const grocery=await add();assert.equal((await inbox()).length,0,'An actor has no unread copy of their own change');
await as('member');let updates=await inbox();assert.equal(updates.length,1);assert.equal(updates[0].actor_id,users.owner);assert.equal(updates[0].actor_name,'Alex');assert.equal(updates[0].recipient_id,users.member);assert.equal(updates[0].entity_id,grocery.id);assert.equal(updates[0].action,'added');
const first=updates[0];
await assert.rejects(db.query('insert into public.household_activity select * from public.household_activity'),/permission/,'A member cannot spoof actor/recipient/content');
await assert.rejects(db.query("update public.household_activity set actor_name='Someone else'"),/permission/);
await as('sibling');assert.equal((await inbox()).length,1,'Same-household recipients have independent inboxes');
await as('other');assert.equal((await inbox()).length,0);await add('Other home groceries','grocery',b);
await as('outsider');assert.equal((await inbox()).length,0);assert.equal((await db.query('delete from public.household_activity returning id')).rows.length,0);
await as('');assert.equal((await inbox()).length,0);
await db.exec('reset role;set role anon');await assert.rejects(inbox(),/permission/);

await as('owner');await add('Bread');
await as('member');await db.query('delete from public.household_activity where id=$1',[first.id]);
updates=await inbox();assert.equal(updates.length,1);assert.equal(updates[0].title,'Bread','Only IDs in the viewed snapshot are cleared');
await db.query('delete from public.household_activity where id=$1',[first.id]);assert.equal((await inbox()).length,1,'Acknowledgement retries are idempotent');
await as('sibling');assert.equal((await inbox()).length,2,'Viewing updates never clears another member');
const siblingId=(await inbox())[0].id;await as('member');assert.equal((await db.query('delete from public.household_activity where id=$1 returning id',[siblingId])).rows.length,0,'A guessed same-home inbox ID cannot be cleared');
await add('Tea');assert.ok((await inbox()).every(row=>row.actor_id!==users.member),'Own changes remain excluded');

await as('owner');
await db.query('update public.household_items set title=title where id=$1',[grocery.id]);
await as('sibling');const before=(await inbox()).length;
await as('owner');await db.query('update public.household_items set done=true where id=$1',[grocery.id]);
await as('sibling');assert.equal((await inbox()).length,before+1);assert.equal((await inbox()).at(-1).action,'completed');
await as('owner');await db.query('update public.household_items set done=false where id=$1',[grocery.id]);
await as('sibling');assert.equal((await inbox()).at(-1).action,'reopened');
await as('owner');const task=await add('Pay school fees','task');
await db.query("update public.household_items set due='2026-11-04',repeat_unit='month' where id=$1",[task.id]);
await db.query('update public.household_items set done=true where id=$1',[task.id]);
await as('sibling');assert.equal((await inbox()).at(-1).action,'completed','A repeating task advancing its due date is a single completion');

await as('owner');
const literal="Milk'); delete from public.households; -- <script>alert(1)</script>";await add(literal);
const note=(await db.query("insert into public.household_notes(household_id,title,body) values($1,'School pickup','Use the side door') returning *",[a])).rows[0];
await db.query('update public.household_notes set body=body where id=$1',[note.id]);
await db.query('update public.household_notes set pinned=true where id=$1',[note.id]);
await db.query("insert into public.household_meal_recipes(household_id,title) values($1,'Pasta')",[a]);
const meal=(await db.query("insert into public.household_meal_plans(household_id,title,meal_date) values($1,'Pizza','2026-11-06') returning *",[a])).rows[0];
await db.query("update public.household_meal_plans set meal_type='supper' where id=$1",[meal.id]);
await db.query("update public.household_meal_plans set meal_type='lunch' where id=$1",[meal.id]);
await db.query("insert into public.household_grocery_staples(household_id,title) values($1,'Eggs')",[a]);
await db.query("select public.add_household_person('Child profile','#467EB6')");
const event=(await db.query("insert into public.household_events(household_id,title,starts_at,ends_at) values($1,'Evening plan','2026-11-05T00:30:00Z','2026-11-05T01:30:00Z') returning *",[a])).rows[0];
await db.query('update public.household_events set version=version+1 where id=$1',[event.id]);
await db.query('delete from public.household_notes where id=$1',[note.id]);
await as('sibling');updates=await inbox();
assert.deepEqual([...new Set(updates.map(row=>row.entity_kind))].sort(),['grocery','task','event','note','meal_plan','meal_recipe','staple','profile'].sort());
assert.equal(updates.find(row=>row.title===literal).title,literal,'SQL/HTML-looking data remains literal text');
assert.equal(updates.filter(row=>row.entity_id===note.id).length,3,'Add, pin and removal count; metadata-only no-op does not');
assert.equal(updates.filter(row=>row.entity_id===event.id).length,1,'Event revision-only writes are not changes');
assert.equal(updates.find(row=>row.entity_id===event.id).entity_date.toISOString().slice(0,10),'2026-11-04','Event dates use Eastern time');
assert.equal(updates.find(row=>row.title==='Pizza').entity_date.toISOString().slice(0,10),'2026-11-06');
assert.equal(updates.filter(row=>row.entity_id===meal.id).length,2,'Moving supper to lunch is reported; selecting the existing slot is a no-op');
assert.equal(updates.filter(row=>row.entity_id===meal.id).at(-1).action,'updated');
assert.equal(updates.find(row=>row.entity_id===note.id&&row.action==='removed').title,'School pickup','Removed content remains identifiable until seen');

// Countdown choices use the existing calendar activity path.
await as('owner');await db.query('update public.household_events set countdown_enabled=true,version=version+1 where id=$1',[event.id]);
await as('sibling');assert.equal((await inbox()).filter(row=>row.entity_id===event.id).length,2,'Enabling a Home countdown is a shared event update');
assert.equal((await inbox()).filter(row=>row.entity_id===event.id).at(-1).action,'updated');

// No retrospective attribution to an owner for service/maintenance writes.
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const countBefore=await scalar('select count(*)::int from public.household_activity');await add('Maintenance item');
assert.equal(await scalar('select count(*)::int from public.household_activity'),countBefore);

// Exercise real, validated service-only imports through the new thin wrapper.
const api=(action,extra={})=>scalar('select public.google_import_service($1,$2)',[action,JSON.stringify({householdId:a,userId:users.owner,...extra})]);
await db.exec('set role service_role');
await api('start',{hash:'a'.repeat(64),verifier:'v'.repeat(43)});const login=await api('state_take',{hash:'a'.repeat(64)});
await api('authorized',{sessionId:login.id,accessToken:'synthetic-access-token-only',completionHash:'c'.repeat(64),expiresIn:1800,calendars:[{id:'chosen-calendar',name:'Chosen'}]});
await api('complete',{hash:'c'.repeat(64)});
const entry={sourceKey:'1'.repeat(64),event:{...event,title:'Imported plan',person_ids:[],recurrence:[],exceptions:{},starts_at:'2026-11-05T00:30:00Z',ends_at:'2026-11-05T01:30:00Z'}};
const preview=await api('preview',{calendarId:'chosen-calendar',entries:[entry]});
const commit={previewId:preview.previewId,sourceKeys:[entry.sourceKey],personIds:[],reminder30:true,acknowledgeShared:true};
await assert.rejects(api('commit',{...commit,acknowledgeShared:false}),/Confirm/);
assert.deepEqual(await api('commit',commit),{imported:1,skipped:0});
assert.deepEqual(await api('commit',commit),{imported:1,skipped:0});
assert.equal(await scalar("select coalesce(current_setting('hh.activity_actor',true),'')"),'','Import attribution cannot leak into later operations');
await as('sibling');assert.equal((await inbox()).filter(row=>row.title==='Imported plan').length,1,'An imported event is attributed once to the initiating member');

await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query("update public.household_activity set created_at=now()-interval '31 days' where recipient_id=$1",[users.member]);
await as('member');assert.equal((await inbox()).length,0,'Expired unread summaries are not returned');
await as('owner');await add('Fresh item');
await db.exec('reset role');assert.equal(await scalar("select count(*)::int from public.household_activity where created_at<now()-interval '30 days'"),0,'New activity cleans old unread rows for that home');
await db.query('delete from public.household_members where user_id=$1',[users.member]);
assert.equal(await scalar('select count(*)::int from public.household_activity where recipient_id=$1',[users.member]),0,'Leaving membership erases its personal unread inbox');
await as('member');assert.equal((await inbox()).length,0,'A removed member cannot read with an old JWT identity');
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query('delete from auth.users where id=$1',[users.member]);
await as('sibling');assert.ok((await inbox()).some(row=>row.title==='Tea'&&row.actor_id===null&&row.actor_name==='Sam'),'Removing an actor preserves the shared summary without retaining their Auth ID');
await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);
assert.equal(await scalar('select count(*)::int from public.household_activity where household_id=$1',[a]),0);
assert.equal(await scalar('select count(*)::int from public.households'),1,'Household cascade cannot affect another home');
await db.close();
console.log('Household activity database checks passed: attribution, independent recipients, membership isolation, all content kinds, no-op suppression, recurring completion, import wrapper, expiry, exact-ID acknowledgement, literal input and cascades. Synthetic local data only.');

// Client pagination and acknowledgment are tested independently of the UI.
const calls=[];let respond=()=>({data:[],error:null});
globalThis.__activityClient={from(table){const call={table,filters:[]};const q={select(){return q},delete(){call.operation='delete';return q},eq(key,value){call.filters.push([key,value]);return q},order(key){call.order=key;return q},limit(value){call.limit=value;return q},gt(key,value){call.after=[key,value];return q},in(key,value){call.ids=[key,value];return q},maybeSingle(){call.single=true;return q},then(resolve,reject){calls.push(call);return Promise.resolve(respond(call)).then(resolve,reject)}};return q}};
try{
 const source=fs.readFileSync(new URL('../src/householdActivityData.ts',import.meta.url),'utf8').replace("import {supabase} from './supabase';",'const supabase=globalThis.__activityClient;');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const client=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const row=i=>({id:String(i).padStart(4,'0'),household_id:a,recipient_id:users.member,actor_id:users.owner,actor_name:'Alex',entity_kind:'grocery',entity_id:grocery.id,action:'added',title:'Milk',entity_date:null,created_at:'2026-11-04T14:00:00Z'});
 const many=Array.from({length:201},(_,i)=>row(i+1));
 respond=call=>({data:call.after?many.slice(200):many.slice(0,200),error:null});
 assert.equal((await client.loadHouseholdActivity(a,users.member)).length,201);assert.equal(calls.length,2);
 assert.ok(calls.every(call=>JSON.stringify(call.filters)===JSON.stringify([['household_id',a],['recipient_id',users.member]])&&call.limit===200));
 calls.length=0;respond=()=>({data:null,error:null});
 await client.markHouseholdActivitySeen(a,users.member,[...many,{...row(900),recipient_id:users.sibling},{...row(901),household_id:b}]);
 assert.deepEqual(calls.map(call=>call.ids[1].length),[100,100,1]);assert.ok(calls.every(call=>call.operation==='delete'&&call.ids[0]==='id'));
 assert.deepEqual(calls.flatMap(call=>call.ids[1]),many.map(row=>row.id),'Only the displayed IDs in this recipient/home are acknowledged');
 calls.length=0;await client.loadActivityTarget(a,{...row(1),action:'removed'});assert.equal(calls.length,0);
 await assert.rejects(client.loadActivityTarget(b,row(1)),/different home/);
 respond=()=>({data:null,error:{message:'Network failure'}});await assert.rejects(client.markHouseholdActivitySeen(a,users.member,[row(1)]),/Network/);
 assert.equal(client.activitySummary([]),'');assert.equal(client.activitySummary([row(1)]),'Alex added a grocery item');assert.equal(client.activitySummary([row(1),row(2)]),'Alex made multiple changes');
 assert.equal(client.activitySummary([row(1),{...row(2),actor_id:users.sibling,actor_name:'Taylor'}]),'Your family made multiple changes');
 console.log('Household activity client checks passed: complete pagination, recipient scoping, snapshot-only clear, batched IDs, errors, safe target boundaries and banner wording.');
}finally{delete globalThis.__activityClient}
