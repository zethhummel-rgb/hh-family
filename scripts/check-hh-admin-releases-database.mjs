import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {PGlite}=await import(process.env.HH_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const uid=(n)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const people={host:uid(1),operator:uid(2),otherAdmin:uid(3),member:uid(4)};
const release=(id,version,hash)=>({id:uid(id),version,commit_sha:hash.repeat(40),artifact_run_id:String(200+id),artifact_sha256:hash.repeat(64)});
const first=release(10,'V4.0','a'),second=release(11,'V4.1','b');
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(person,aal='aal1')=>{
 await db.exec('reset role;set role authenticated;');
 await db.query("select set_config('fixture.claims',$1,false)",[JSON.stringify({sub:people[person],aal})]);
};
const service=async()=>db.exec("reset role;set role service_role; select set_config('fixture.claims','{}',false);");
const account=(action,payload={})=>value('select public.hh_admin_releases($1,$2)',[action,payload]);
const worker=(action,payload)=>value('select public.hh_release_worker($1,$2)',[action,payload]);
const content=(action,payload={})=>value('select public.hh_admin_content($1,$2)',[action,payload]);
const memberContent=()=>value('select public.hh_member_content()');
const notices=()=>value('select public.hh_member_notice_history()');
const queue=(id,expectedUpdatedAt,actor=people.operator)=>worker('queue',{release_id:id,actor_id:actor,expected_updated_at:expectedUpdatedAt});
const setOperation=(operation)=>db.query("select set_config('fixture.storage.operation',$1,false)",[operation]);
const path=`${first.id}/artwork.webp`;

try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;grant usage on schema auth to authenticated;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.jwt() returns jsonb language sql stable as $$select current_setting('fixture.claims',true)::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
  grant execute on function auth.uid(),auth.jwt() to authenticated;
  create schema storage;grant usage on schema storage to authenticated;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text references storage.buckets(id),name text,metadata jsonb,version text default gen_random_uuid()::text,primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to authenticated;
  create function storage.allow_any_operation(operations text[]) returns boolean language sql stable as $$
   select coalesce(current_setting('fixture.storage.operation',true)=any(operations),false)
  $$;`);
 for(const name of ['schema','calendar','member-colours','pilot','pilot-seven-spots','pilot-fourteen-spots','invitation-email']){
  await db.exec(read(`database/${name}.sql`));
 }
 for(const name of ['20261112181000_hh_pilot_request_mail','20261126210000_hh_site_admin_dashboard','20261126213000_hh_admin_content',
  '20261126220000_hh_admin_auth_policy','20261126230000_hh_seasonal_palette_schedule','20261126234000_hh_member_ratings',
  '20261126235000_hh_notice_images','20261126235500_hh_notice_history_version','20261126235900_hh_artwork_only_notices',
  '20261127000100_hh_rating_prompt_snooze','20261127001000_hh_admin_releases']){
  await db.exec(read(`supabase/migrations/${name}.sql`));
 }
 for(const [person,id] of Object.entries(people))await db.query('insert into auth.users values($1,$2,now())',[id,person.toLowerCase()+'@fixture.invalid']);
 await db.exec("insert into private.pilot_hosts values('host@fixture.invalid');");
 for(const person of ['operator','otherAdmin'])await db.query('insert into private.hh_site_admins values($1,$2,$3)',[people[person],person.toLowerCase()+'@fixture.invalid',people.host]);
 await as('host');
 await value("select public.create_household('Fixture Household','Fixture Host')");
 const invitation=await value("select public.create_household_invite('member@fixture.invalid')");
 await as('member');
 await value('select public.accept_household_invite($1,$2)',[invitation,'Fixture Member']);
 await assert.rejects(account('snapshot'),/Admin access required/);
 await assert.rejects(worker('register',first),/permission denied/);
 assert.deepEqual((await memberContent()).notices,[]);
 await as('operator');
 await assert.rejects(account('snapshot'),/Verify your second factor/);
 await as('operator','aal2');
 assert.deepEqual(await account('snapshot'),{can_release:true,releases:[]});
 await assert.rejects(account('queue',{release_id:first.id}),/Unsupported release action/);
 await assert.rejects(worker('queue',{release_id:first.id,actor_id:people.operator}),/permission denied/);
 await assert.rejects(db.query('select * from private.hh_app_releases'),/permission denied/);

 await service();
 await assert.rejects(db.query('select * from private.hh_app_releases'),/permission denied/);
 for(const correction of [{artifact_sha256:'missing'},{commit_sha:'missing'},{artifact_run_id:'0'},{version:'V4.10'}]){
  await assert.rejects(worker('register',{...first,...correction}),/Invalid tested release metadata/);
 }
 const ready=(await worker('register',first)).release;
 assert.equal(ready.status,'ready');
 assert.equal(ready.title,'');
 assert.equal(ready.image_path,null);
 assert.equal('claim_id' in ready,false);
 assert.deepEqual((await worker('register',{...first,artifact_run_id:Number(first.artifact_run_id)})).release,ready);
 await assert.rejects(worker('register',{...first,artifact_run_id:'999'}),/different tested artifact/);
 await assert.rejects(worker('register',{...first,id:uid(80)}),/commit already belongs/);
 await worker('register',second);
 await assert.rejects(queue(first.id,ready.updated_at,people.member),/Admin access required/);
 await assert.rejects(queue(first.id),/draft changed/);
 await assert.rejects(queue(first.id,'not-a-timestamp'),/draft changed/);
 await assert.rejects(queue(first.id,ready.updated_at),/Enter a title/);
 await assert.rejects(worker('retry_publish',{id:first.id}),/Verify this deployment/);

 await as('operator','aal2');
 const draft=(await account('save_draft',{release_id:first.id,title:' Outline title ',body:'',version:'V8.8',artifact_sha256:'changed'})).releases.find(r=>r.id===first.id);
 assert.deepEqual({title:draft.title,body:draft.body,version:draft.version,artifact_sha256:draft.artifact_sha256},
  {title:'Outline title',body:'',version:first.version,artifact_sha256:first.artifact_sha256});
 await assert.rejects(content('publish_notice',{id:first.id,title:'Reserved',body:'Ordinary post',kind:'notice'}),/Publish this update through Releases/);
 await assert.rejects(account('save_draft',{release_id:first.id,image_path:`${second.id}/artwork.webp`,image_alt:'Other'}),/valid image/);
 await assert.rejects(account('save_draft',{release_id:first.id,image_path:path,image_alt:''}),/Describe the image/);
 const artwork={release_id:first.id,title:'',body:'',image_path:path,image_alt:' Fixture artwork '};
 await assert.rejects(account('save_draft',artwork),/Upload the image before saving/);
 const savedSecond=(await account('save_draft',{release_id:second.id,title:'Second release',body:'Second release notes.'})).releases.find(r=>r.id===second.id);
 await setOperation('object.upload');
 await db.query("insert into storage.objects(bucket_id,name) values('hh-notice-images',$1)",[path]);
 const beforeReplacement=(await account('save_draft',artwork)).releases.find(r=>r.id===first.id);
 assert.equal('image_version' in beforeReplacement,false);
 await setOperation('object.upload_update');
 assert.equal((await db.query("update storage.objects set version=gen_random_uuid()::text where name=$1 returning name",[path])).rows.length,1);
 await service();
 await assert.rejects(queue(first.id,draft.updated_at),/draft changed/);
 await assert.rejects(queue(first.id,beforeReplacement.updated_at),/artwork changed/);
 await as('operator','aal2');
 const savedArtwork=(await account('save_draft',artwork)).releases.find(r=>r.id===first.id);
 assert.notEqual(savedArtwork.updated_at,beforeReplacement.updated_at);
 await service();
 await assert.rejects(queue(first.id,beforeReplacement.updated_at),/draft changed/);
 const queued=(await queue(first.id,savedArtwork.updated_at)).release;
 assert.equal(queued.status,'queued');
 assert.equal(queued.image_alt,'Fixture artwork');
 assert.deepEqual((await queue(first.id,savedArtwork.updated_at)).release,queued);
 await queue(second.id,savedSecond.updated_at);
 await as('operator','aal2');
 await assert.rejects(account('save_draft',artwork),/draft is locked/);
 assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning name",[path])).rows.length,0);
 await setOperation('object.delete');
 assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length,0);
 await setOperation('object.upload');
 await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('hh-notice-images',$1)",[`${first.id}/artwork.jpg`]),/row-level security/);

 await service();
 const current=await worker('claim',{id:first.id});
 assert.equal(current.claimed,true);
 assert.match(current.claim_id,/^[0-9a-f-]{36}$/);
 assert.equal(current.release.status,'deploying');
 assert.deepEqual(await worker('claim',{id:first.id}),{claimed:false,release:current.release});
 assert.equal((await worker('claim',{id:second.id})).claimed,false);
 await assert.rejects(queue(first.id),/cannot be queued now/);
 const own={id:first.id,claim_id:current.claim_id};
 const proof={...own,version:first.version,commit_sha:first.commit_sha,artifact_sha256:first.artifact_sha256};
 await assert.rejects(worker('verified',{...proof,commit_sha:'f'.repeat(40)}),/hosted build does not match/);
 await assert.rejects(worker('verified',{...proof,artifact_sha256:'f'.repeat(64)}),/hosted build does not match/);
 await assert.rejects(worker('verified',{...proof,artifact_sha256:undefined}),/hosted build does not match/);
 await assert.rejects(worker('verified',{...proof,claim_id:uid(70)}),/no longer active/);
 await assert.rejects(worker('publish',own),/Verify this deployment/);
 const verified=(await worker('verified',proof)).release;
 assert.equal(verified.status,'verified');
 assert.deepEqual((await worker('verified',proof)).release,verified);
 assert.equal((await worker('claim',{id:second.id})).claimed,false);
 await assert.rejects(worker('failed',own),/not deploying/);
 await as('member');
 assert.deepEqual((await notices()).notices,[]);
 await service();
 const published=(await worker('retry_publish',{release_id:first.id})).release;
 assert.equal(published.status,'published');
 assert.deepEqual((await worker('publish',own)).release,published);
 assert.deepEqual((await worker('retry_publish',{release_id:first.id})).release,published);
 assert.deepEqual((await worker('verified',proof)).release,published);
 await as('member');
 const post=(await notices()).notices[0];
 assert.deepEqual({id:post.id,kind:post.kind,title:post.title,image_path:post.image_path,release_version:post.release_version},
  {id:first.id,kind:'update',title:'',image_path:path,release_version:first.version});
 assert.equal((await memberContent()).notices.length,1);
 await as('otherAdmin','aal2');
 await content('publish_notice',{id:uid(99),kind:'notice',title:'Normal announcement',body:'Still allowed.'});

 await service();
 const previous=await worker('claim',{id:second.id});
 assert.equal(previous.claimed,true);
 const stale={id:second.id,claim_id:previous.claim_id};
 const failed=(await worker('failed',{...stale,reason:'Deployment failed.'})).release;
 assert.equal(failed.error,'Deployment failed.');
 assert.equal(failed.title,'Second release');
 assert.deepEqual((await worker('failed',{...stale,error:'Retry report'})).release,failed);
 const secondProof={version:second.version,commit_sha:second.commit_sha,artifact_sha256:second.artifact_sha256};
 await assert.rejects(worker('verified',{...stale,...secondProof}),/not deploying/);
 await as('operator','aal2');
 const retryDraft=(await account('save_draft',{release_id:second.id,title:'Edited retry draft',body:'Second release notes.'})).releases.find(r=>r.id===second.id);
 await service();
 await assert.rejects(queue(second.id,savedSecond.updated_at),/draft changed/);
 await queue(second.id,retryDraft.updated_at);
 const liveAttempt=await worker('claim',{id:second.id});
 assert.notEqual(liveAttempt.claim_id,previous.claim_id);
 await assert.rejects(worker('failed',stale),/no longer active/);
 await assert.rejects(worker('publish',stale),/no longer active/);
 await assert.rejects(worker('retry_publish',{id:second.id}),/Verify this deployment/);
 await db.exec('reset role;');
 const staleTimestamp=await value("update private.hh_app_releases set updated_at=now()-interval '61 minutes' where id=$1 returning to_jsonb(updated_at)",[second.id]);
 await service();
 const recovered=(await queue(second.id,staleTimestamp)).release;
 assert.equal(recovered.status,'queued');
 assert.equal(recovered.title,'Edited retry draft');
 await assert.rejects(worker('verified',{id:second.id,claim_id:liveAttempt.claim_id,...secondProof}),/no longer active/);
 await db.exec('reset role;update private.hh_admin_auth_policy set require_mfa=false;');
 await as('operator');
 assert.equal((await account('snapshot')).can_release,true);
 await db.exec('reset role;set role anon;');
 await assert.rejects(account('snapshot'),/permission denied/);
 await assert.rejects(worker('claim',{id:second.id}),/permission denied/);
 console.log('HH Releases database checks passed: private state, fixed builds, verified exact claims, protected artwork, authorized queueing, timeout recovery, and once-only publishing.');
}finally{
 await db.close();
}
