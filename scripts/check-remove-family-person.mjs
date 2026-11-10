import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  grant usage on schema auth to authenticated;
  create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
`);
for (const path of ['database/schema.sql','database/pilot.sql']) await db.exec(read(path));
await db.exec('create table private.push_devices (household_id uuid, user_id uuid)');
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter(name => name.endsWith('_hh_remove_family_person.sql'));
assert.equal(migrations.length,1);
await db.exec(read('supabase/migrations/' + migrations[0]));

const [owner,member,otherOwner,home,otherHome,linked,profile,otherProfile] = Array.from(
  {length:8}, (_,i) => `10000000-0000-4000-8000-00000000000${i+1}`
);
await db.query(`insert into auth.users values
  ($1,'owner@example.invalid',now()),($2,'member@example.invalid',now()),($3,'other@example.invalid',now())`, [owner,member,otherOwner]);
await db.query(`insert into public.households(id,name,owner_id) values
  ($1,'First household',$2),($3,'Other household',$4)`, [home,owner,otherHome,otherOwner]);
await db.query(`insert into public.household_members(household_id,user_id,display_name,role) values
  ($1,$2,'Owner','owner'),($1,$3,'Member','member'),($4,$5,'Other owner','owner')`, [home,owner,member,otherHome,otherOwner]);
await db.query(`insert into public.household_people(id,household_id,display_name,calendar_color,linked_user_id) values
  ($1,$2,'Linked profile','#123456',$3),($4,$2,'Family profile','#123456',null),($5,$6,'Other profile','#123456',null)`,
  [linked,home,member,profile,otherProfile,otherHome]);
await db.query(`insert into public.household_items(household_id,kind,title,person) values ($1,'task','Shared plan','Member')`, [home]);
await db.query(`insert into public.household_invites(household_id,email,token_hash,used_at) values
  ($1,'member@example.invalid','pending',null),($1,'member@example.invalid','used',now()),
  ($2,'member@example.invalid','other household',null)`, [home,otherHome]);
await db.query('insert into private.push_devices values ($1,$2),($1,$3)', [home,member,owner]);

const become = async (role,id='') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role ' + role);
};
const remove = (household,kind,id) => db.query('select public.remove_family_person($1,$2,$3)',[household,kind,id]);
await become('anon');
await assert.rejects(remove(home,'profile',profile), /permission denied/);
await become('authenticated',member);
await assert.rejects(remove(home,'profile',profile), /Only the household owner/);
assert.equal((await db.query('select id from public.household_items')).rows.length,1);
await become('authenticated',owner);
await assert.rejects(remove(otherHome,'profile',otherProfile), /Only the household owner/);
await assert.rejects(remove(home,'profile',otherProfile), /no longer in your household/);
await assert.rejects(remove(home,'member',owner), /Choose a family member/);
await remove(home,'profile',profile);
await remove(home,'member',member);
await assert.rejects(remove(home,'member',member), /no longer in your household/);
await become('authenticated',member);
assert.deepEqual((await db.query('select id from public.household_items')).rows,[]);
await db.exec('reset role');
assert.equal((await db.query('select id from auth.users where id=$1',[member])).rows.length,1);
assert.equal((await db.query('select linked_user_id from public.household_people where id=$1',[linked])).rows[0].linked_user_id,null);
assert.deepEqual((await db.query('select id from public.household_people where id=$1',[profile])).rows,[]);
assert.equal((await db.query('select id from public.household_people where id=$1',[otherProfile])).rows.length,1);
assert.equal((await db.query('select title from public.household_items')).rows[0].title,'Shared plan');
assert.deepEqual((await db.query('select token_hash from public.household_invites order by token_hash')).rows.map(r=>r.token_hash),['other household','used']);
assert.deepEqual((await db.query('select user_id from private.push_devices')).rows.map(r=>r.user_id),[owner]);
await db.close();
console.log('Family removal checks passed: owner-only access, household isolation, owner protection, profile removal, account preservation and revocation of access, invitations and notifications.');
