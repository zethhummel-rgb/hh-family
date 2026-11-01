import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

const db=new PGlite(),read=name=>fs.readFileSync(new URL('../database/'+name,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
await db.exec(read('schema.sql'));
await db.exec(read('family-notes.sql'));
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const users={owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',member:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',outsider:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name+'@notes.invalid']);
for(const [hid,uid] of [[a,users.owner],[b,users.other]]){
 await db.query('insert into public.households(id,name,owner_id) values($1,$2,$3)',[hid,'Synthetic notes household',uid]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",[hid,uid]);
}
await db.query("insert into public.household_members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member','member')",[a,users.member]);
const as=async(name)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||'']);};
const create=async(title='School details',body='Bring indoor shoes.\nPickup is by the side door.',hid=a)=>(await db.query('insert into public.household_notes(household_id,title,body) values($1,$2,$3) returning *',[hid,title,body])).rows[0];
const edit=async(note,title,body=note.body)=>(await db.query('update public.household_notes set title=$1,body=$2 where household_id=$3 and id=$4 and version=$5 returning *',[title,body,note.household_id,note.id,note.version])).rows;
const pin=async(note,pinned)=>(await db.query('update public.household_notes set pinned=$1 where household_id=$2 and id=$3 and version=$4 returning *',[pinned,note.household_id,note.id,note.version])).rows;
const remove=async(note)=>(await db.query('delete from public.household_notes where household_id=$1 and id=$2 and version=$3 returning id',[note.household_id,note.id,note.version])).rows;
assert.equal(await scalar('select count(*)::int from public.household_notes'),0,'No note is preloaded');
assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.household_notes'::regclass"),true);
assert.equal(await scalar("select has_table_privilege('anon','public.household_notes','SELECT,INSERT,UPDATE,DELETE')"),false);
assert.equal(await scalar("select prosecdef from pg_proc where oid='private.maintain_family_note()'::regprocedure"),false,'Trigger keeps invoker rights');
assert.equal(await scalar("select has_function_privilege('authenticated','private.maintain_family_note()','EXECUTE')"),false,'Trigger cannot be called by the browser');
for(const column of ['id','household_id','created_at','updated_at','version'])assert.equal(await scalar("select has_column_privilege('authenticated','public.household_notes',$1,'UPDATE')",[column]),false);
for(const column of ['id','created_at','updated_at','version'])assert.equal(await scalar("select has_column_privilege('authenticated','public.household_notes',$1,'INSERT')",[column]),false);

await as('owner');const first=await create();
assert.equal(first.version,1);assert.equal(first.pinned,false);assert.equal(+new Date(first.created_at),+new Date(first.updated_at));
assert.equal(first.body,'Bring indoor shoes.\nPickup is by the side door.','Line breaks are retained');
for(const blank of ['', ' \t\n ', '\u00a0\u2009\ufeff']){
 await assert.rejects(create(blank),/constraint/);
 await assert.rejects(create('Blank note',blank),/constraint/);
}
await assert.rejects(create('x'.repeat(161)),/constraint/);await assert.rejects(create('Long note','x'.repeat(10001)),/constraint/);
const limit=await create('x'.repeat(160),'x'.repeat(10000));assert.equal(limit.title.length,160);assert.equal(limit.body.length,10000);
await assert.rejects(db.query('insert into public.household_notes(household_id,title,body,version) values($1,$2,$3,999)',[a,'Spoof version','No']),/permission/);
await assert.rejects(db.query("update public.household_notes set updated_at='2099-01-01' where id=$1",[first.id]),/permission/);
await assert.rejects(db.query('update public.household_notes set household_id=$1 where id=$2',[b,first.id]),/permission/);
const sql="School'); DELETE FROM public.households; --",html='<img src=x onerror="alert(1)">\n<script>alert(2)</script>';
const literal=await create(sql,html);assert.equal(literal.title,sql);assert.equal(literal.body,html);
assert.equal(await scalar('select count(*)::int from public.households'),1,'SQL-looking note text never executes');
const ownerVersion=(await edit(first,'Updated school details'))[0];assert.equal(ownerVersion.version,2);
assert.equal(+new Date(ownerVersion.created_at),+new Date(first.created_at),'Edits keep original creation time');
assert.ok(+new Date(ownerVersion.updated_at)>=+new Date(first.updated_at),'Update time comes from the server');

await as('member');
assert.equal(await scalar('select count(*)::int from public.household_notes'),3,'Members see the shared notes');
assert.deepEqual(await edit(first,'Stale overwrite'),[],'A stale editor cannot overwrite a newer note');
assert.deepEqual(await remove(first),[],'A stale delete cannot delete a changed note');
assert.deepEqual(await pin(first,true),[],'A stale pin cannot overwrite a newer edit');
let current=(await edit(ownerVersion,'Shared edit','Updated by a second member.\nKeep this line.'))[0];assert.equal(current.version,3);
current=(await pin(current,true))[0];assert.equal(current.pinned,true);assert.equal(current.version,4);
assert.equal(current.body,'Updated by a second member.\nKeep this line.','Pin changes only the flag and revision');
current=(await pin(current,false))[0];assert.equal(current.version,5);assert.equal(current.pinned,false);
const byMember=await create('Made by a member','This belongs to the family.');
assert.equal((await remove(limit)).length,1,'Members can remove household notes');
assert.deepEqual(await remove(limit),[],'Repeating a delete cannot affect another note');

await as('other');
const other=await create('Different home','Separate information.',b);
assert.equal(await scalar('select count(*)::int from public.household_notes'),1,'Other households see only their own notes');
await assert.rejects(create('Foreign write','No',a),/row-level security/);
assert.deepEqual(await edit(current,'Foreign edit'),[]);assert.deepEqual(await pin(current,true),[]);assert.deepEqual(await remove(current),[]);
await as('outsider');assert.equal(await scalar('select count(*)::int from public.household_notes'),0);
await assert.rejects(create('Outsider write'),/row-level security/);assert.deepEqual(await edit(current,'Outsider edit'),[]);assert.deepEqual(await remove(current),[]);
await as('');assert.equal(await scalar('select count(*)::int from public.household_notes'),0);await assert.rejects(create('No identity'),/row-level security/);
await db.exec('reset role;set role anon');
await assert.rejects(db.query('select * from public.household_notes'),/permission/);await assert.rejects(create('Anonymous'),/permission/);

await db.exec('reset role');await db.query('delete from auth.users where id=$1',[users.member]);
assert.equal(await scalar('select count(*)::int from public.household_notes where id=$1',[byMember.id]),1,'Removing one account preserves shared notes');
await as('member');assert.equal(await scalar('select count(*)::int from public.household_notes'),0,'Old JWT identity cannot bypass removed membership');
assert.deepEqual(await edit(current,'Removed-member edit'),[]);await assert.rejects(create('Removed-member create'),/row-level security/);
await as('owner');assert.equal((await remove(current)).length,1,'Owner still manages shared notes after member removal');
await db.exec('reset role');await db.query('delete from public.households where id=$1',[a]);
assert.equal(await scalar('select count(*)::int from public.household_notes where household_id=$1',[a]),0,'Household deletion removes its notes');
assert.equal(await scalar('select count(*)::int from public.household_notes where id=$1',[other.id]),1,'Another household remains intact');
await db.close();
console.log('Family notes database checks passed: shared member CRUD, household isolation, SQL/HTML literal text, server-owned metadata, stale edit/pin/delete protection, limits, member-removal preservation and household cascade. Synthetic local data only.');

// Exercise the client boundary independently: especially multi-page loading and
// carrying the original revision through edits rather than silently overwriting.
const calls=[];let respond=()=>({data:[],error:null});
const fakeClient={from(table){
 const call={table,filters:[]};
 const chain={
  select(fields){call.fields=fields;return chain},eq(key,value){call.filters.push([key,value]);return chain},gt(key,value){call.after=[key,value];return chain},
  order(key){call.order=key;return chain},limit(count){call.limit=count;return chain},
  insert(value){call.operation='insert';call.value=value;return chain},update(value){call.operation='update';call.value=value;return chain},delete(){call.operation='delete';return chain},
  single(){call.single=true;return chain},maybeSingle(){call.single=true;return chain},
  then(resolve,reject){calls.push(call);return Promise.resolve(respond(call)).then(resolve,reject)}
 };return chain;
}};
globalThis.__familyNotesClient=fakeClient;
try{
 const source=fs.readFileSync(new URL('../src/familyNotesData.ts',import.meta.url),'utf8').replace("import {supabase} from './supabase';",'const supabase=globalThis.__familyNotesClient;');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const api=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const make=(i,pinned=false)=>({id:String(i).padStart(4,'0'),household_id:a,title:'Note '+i,body:'Text',pinned,created_at:'2026-11-01T14:00:00Z',updated_at:'2026-11-01T15:00:00Z',version:4});
 const many=Array.from({length:201},(_,i)=>make(i+1,i===200));
 respond=call=>({data:call.after?many.slice(200):many.slice(0,200),error:null});
 const loaded=await api.loadFamilyNotes(a);
 assert.equal(loaded.length,201,'A household list continues past one API page');assert.equal(loaded[0].id,'0201','Pinned notes sort first after all pages load');
 assert.deepEqual(calls.map(call=>call.filters),[[['household_id',a]],[['household_id',a]]]);assert.deepEqual(calls[1].after,['id','0200']);
 assert.ok(calls.every(call=>call.order==='id'&&call.limit===200),'Pagination order is independent of mutable update dates/pins');
 calls.length=0;respond=()=>({data:null,error:null});
 const stale=make(1);
 await assert.rejects(api.saveFamilyNote(a,{title:'My draft',body:'Keep this',pinned:false},stale),api.NoteConflictError);
 await assert.rejects(api.pinFamilyNote(a,stale,true),api.NoteConflictError);
 await assert.rejects(api.deleteFamilyNote(a,stale),api.NoteConflictError);
 assert.ok(calls.every(call=>JSON.stringify(call.filters)===JSON.stringify([['household_id',a],['id',stale.id],['version',4]])),'Every change carries household, ID and original revision');
 calls.length=0;respond=call=>({data:{...stale,...call.value},error:null});
 const draft={title:'  Useful note  ',body:'First line\n  indented second line\n',pinned:true};
 await api.saveFamilyNote(a,draft);
 assert.deepEqual(calls[0].value,{household_id:a,title:'Useful note',body:draft.body,pinned:true},'The client sends plain fields, keeps note layout and leaves server metadata alone');
 const length=calls.length;
 await assert.rejects(api.saveFamilyNote(a,{...draft,body:' \n\u00a0'}),/Write a note/);
 assert.equal(calls.length,length,'Blank notes are rejected before a request');
 console.log('Family notes client checks passed: complete pagination, stable pinned order, scoped revision filters, typed conflicts, literal plain fields and multiline preservation. Mocked calls only.');
}finally{delete globalThis.__familyNotesClient}
