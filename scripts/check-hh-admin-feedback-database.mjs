import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {PGlite} = await import(process.env.HH_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const id = number => `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const host = id(1);
const admin = id(2);
const member = id(3);
const household = id(4);
const ideaArea = 'New Feature Suggestion';
const submitterEmail = 'member@hh-feedback.invalid';
const preview = {id:id(500),actorId:member,householdId:household,area:ideaArea,message:'Could we filter the fictional family calendar?'};

async function signIn(userId, aal) {
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:userId,aal})]);
}

async function result(kind, before = {}) {
  const query = kind === undefined
    ? db.query('select public.hh_admin_feedback() as inbox')
    : db.query('select public.hh_admin_feedback($1,$2,$3) as inbox', [kind,before.created_at ?? null,before.id ?? null]);
  return (await query).rows[0].inbox;
}

async function capturePreview(payload) {
  return (await db.query('select public.hh_capture_feedback_preview($1::jsonb) as response',[JSON.stringify(payload)])).rows[0].response;
}

async function feedbackMail(action,payload) {
  return (await db.query('select public.feedback_mail_service($1,$2::jsonb) as response',[action,JSON.stringify(payload)])).rows[0].response;
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
  `);
  for (const name of ['schema','calendar','member-colours','pilot','pilot-seven-spots','pilot-fourteen-spots','invitation-email']) {
    await db.exec(read(`database/${name}.sql`));
  }
  for (const name of [
    '20261105182751_hh_send_feedback',
    '20261110231839_hh_one_email_invitations',
    '20261112181000_hh_pilot_request_mail',
    '20261126210000_hh_site_admin_dashboard',
    '20261126213000_hh_admin_content',
    '20261126220000_hh_admin_auth_policy',
    '20261126233000_hh_admin_feedback',
  ]) {
    await db.exec(read(`supabase/migrations/${name}.sql`));
  }
  await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now()),($5,$6,now())',
    [host,'host@hh-feedback.invalid',admin,'admin@hh-feedback.invalid',member,submitterEmail]);
  await db.exec("insert into private.pilot_hosts values ('host@hh-feedback.invalid')");
  await db.query("insert into private.hh_site_admins(user_id,verified_email,pilot_host_user_id) values ($1,'admin@hh-feedback.invalid',$2)",[admin,host]);
  await db.query("insert into public.households(id,name,owner_id) values ($1,'Fictional home',$2)",[household,member]);
  await db.query("insert into public.household_members(user_id,household_id,display_name,role) values ($1,$2,'Fictional member','owner')",[member,household]);

  await db.exec('set role anon');
  await assert.rejects(result(), {code:'42501'});
  await assert.rejects(capturePreview(preview), {code:'42501'});
  await signIn(member,'aal2');
  await assert.rejects(result(), /Admin access required/);
  await assert.rejects(db.query('select * from private.feedback_submissions'), {code:'42501'});
  await signIn(admin,'aal1');
  await assert.rejects(result(), /Verify your second factor/);
  await signIn(admin,'aal2');
  assert.deepEqual(await result(), {submissions:[],has_more:false});
  await assert.rejects(db.query('select * from private.feedback_submissions'), {code:'42501'});
  await assert.rejects(capturePreview(preview), {code:'42501'});

  // Repeated timestamps exercise the UUID tie breaker across exact page boundaries.
  const rows = Array.from({length:71}, (_,index) => ({
    id:id(index + 100),
    area:index % 3 === 0 ? ideaArea : index % 3 === 1 ? 'Calendar' : 'Other / General feedback',
    message:`Fictional submission ${index}\nA second line.`,
    created_at:index < 2 ? '2026-11-24T18:30:00+00:00' : '2026-11-25T18:30:00+00:00',
    status:index % 2 === 0 ? 'sent' : 'uncertain',
  }));
  await db.exec('reset role');
  await db.query(`
    insert into private.feedback_submissions(id,actor_id,household_id,area,message,created_at,status)
    select r.id,$1,$2,r.area,r.message,r.created_at,r.status
    from jsonb_to_recordset($3::jsonb) as r(id uuid,area text,message text,created_at timestamptz,status text)
  `, [member,household,JSON.stringify(rows)]);

  await signIn(admin,'aal2');
  const all = await result();
  assert.equal(all.submissions.length,30);
  assert.equal(all.has_more,true);
  assert.deepEqual(all.submissions.map(row => row.id), rows.slice(-30).reverse().map(row => row.id));
  for (const row of all.submissions) {
    assert.deepEqual(Object.keys(row).sort(), ['area','created_at','id','message']);
  }
  for (const protectedValue of [member,household,submitterEmail]) {
    assert.equal(JSON.stringify(all).includes(protectedValue),false);
  }
  const pageTwo = await result('all',all.submissions.at(-1));
  const pageThree = await result('all',pageTwo.submissions.at(-1));
  assert.equal(pageTwo.has_more,true);
  assert.equal(pageTwo.submissions.length,30);
  assert.equal(pageThree.has_more,false);
  assert.equal(pageThree.submissions.length,11);
  assert.deepEqual([...all.submissions,...pageTwo.submissions,...pageThree.submissions].map(row => row.id),
    [...rows].reverse().map(row => row.id));
  assert.deepEqual(await result('all',pageThree.submissions.at(-1)),{submissions:[],has_more:false});

  const ideas = await result('ideas');
  assert.equal(ideas.has_more,false);
  assert.deepEqual(ideas.submissions.map(row => row.id),rows.filter(row => row.area === ideaArea).reverse().map(row => row.id));
  assert.ok(ideas.submissions.every(row => row.area === ideaArea));
  const feedback = await result('feedback');
  const olderFeedback = await result('feedback',feedback.submissions.at(-1));
  assert.equal(feedback.has_more,true);
  assert.equal(olderFeedback.has_more,false);
  assert.deepEqual([...feedback.submissions,...olderFeedback.submissions].map(row => row.id),
    rows.filter(row => row.area !== ideaArea).reverse().map(row => row.id));
  assert.equal(all.submissions[0].message,rows.at(-1).message);
  await assert.rejects(result('calendar'), /Choose a valid feedback filter/);
  await assert.rejects(result(null), /Choose a valid feedback filter/);
  await assert.rejects(result('all',{created_at:rows.at(-1).created_at}), /cursor requires both/);
  await assert.rejects(result('all',{id:rows.at(-1).id}), /cursor requires both/);

  await db.exec('reset role');
  await db.exec('update private.hh_admin_auth_policy set require_mfa=false where id');
  await signIn(admin,'aal1');
  assert.deepEqual(await result(),all);
  await signIn(member,'aal2');
  await assert.rejects(result(), /Admin access required/);
  await signIn(host,'aal2');
  await assert.rejects(result(), /Admin access required/);

  await db.exec('reset role;set role service_role');
  const historicPayload = row => ({...preview,id:row.id,area:row.area,message:row.message});
  assert.deepEqual(await capturePreview(historicPayload(rows[0])),{status:'sent'});
  assert.deepEqual(await capturePreview(historicPayload(rows[1])),{status:'pending'});
  assert.deepEqual(await capturePreview(preview),{status:'saved'});
  assert.deepEqual(await capturePreview({...preview,message:'  '+preview.message+'  '}),{status:'saved'});
  await assert.rejects(capturePreview({...preview,message:'A different suggestion'}), /Submission mismatch/);
  await assert.rejects(capturePreview({...preview,area:'Calendar'}), /Submission mismatch/);
  await assert.rejects(capturePreview({...preview,actorId:admin}), /Household membership required/);
  assert.deepEqual(await capturePreview({...preview,id:id(501)}),{status:'limited'});
  assert.deepEqual(await feedbackMail('claim',preview),{status:'pending'});
  assert.deepEqual(await feedbackMail('finish',{id:preview.id,actorId:member,status:'sent'}),{updated:false});
  await db.exec('reset role');
  assert.deepEqual((await db.query('select status,sent_at from private.feedback_submissions where id=$1',[preview.id])).rows,
    [{status:'preview',sent_at:null}]);
  await signIn(admin,'aal1');
  const previewItem = (await result('ideas')).submissions.find(row => row.id === preview.id);
  assert.ok(previewItem);
  assert.equal(previewItem.message, preview.message);
  console.log('Admin feedback checks passed: access policy, pagination, filters, restricted fields, and service-only TEST preview saves.');
} finally {
  await db.close();
}
