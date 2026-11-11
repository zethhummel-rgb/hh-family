import assert from 'node:assert/strict';
import {calendarFile,eventHelpers,eventId,fixture,googleCalendarLink,home} from './event-guest-fixture.mjs';

const target={eventId,occurrence:''},invite={...target,action:'send',email:'guest@example.invalid',message:'Bring a snack & <b>something</b>',version:1};
const host={auth:'host'};
const test=await fixture(),live=await fixture({test:false}),failure=await fixture({test:false,sendError:true});
try{
 assert.equal((await test.request(invite)).status,401);
 assert.equal((await test.request(invite,{auth:'outsider'})).status,404);
 assert.equal((await test.request(invite,{...host,origin:'https://example.invalid'})).status,403);
 assert.equal((await test.request({...invite,version:99},host)).status,409);
 for(const role of ['anon','authenticated']){
  await test.db.exec('set role '+role);
  await assert.rejects(test.db.query("select public.event_guest_service('list','{}')"),/permission denied/);
  await assert.rejects(test.db.query('select * from private.event_guest_invitations'),/permission denied/);
  await test.db.exec('reset role');
 }
 await test.db.exec('set role service_role');
 const first=await test.request(invite,host);
 assert.equal(first.status,200,await first.clone().text());
 const result=await first.json();
 assert.equal(result.delivery,'preview');
 assert.equal(test.sent.length,0);
 const url=new URL(result.preview.yes);
 const token=new URLSearchParams(url.hash.slice(1)).get('event-invite');
 assert.equal(url.pathname,'/hummel-home/');
 assert.equal(url.search,'');
 assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await test.request(invite,host)).status,400);
 const list=async()=>await (await test.request({...target,action:'list'},host)).json();
 const id=(await list())[0].id;
 assert.equal((await test.request({action:'preview',token},{method:'GET'})).status,405);
 const preview=await (await test.request({action:'preview',token,reply:'no'})).json();
 assert.equal(preview.event.title,'Family dinner');
 assert.equal(preview.event.description,undefined);
 assert.equal(preview.reply,null);
 assert.equal((await list())[0].reply,null);
 assert.equal((await test.request({action:'respond',token:'b'.repeat(64),reply:'yes'})).status,404);
 assert.equal((await test.request({action:'respond',token,reply:'unknown'})).status,400);
 for(const reply of ['yes','maybe','no']){
  assert.equal((await (await test.request({action:'respond',token,reply})).json()).reply,reply);
  assert.equal((await list())[0].reply,reply);
 }
 const revoke=await test.request({...target,action:'revoke',id},host);
 assert.equal((await revoke.json()).revoked,true);
 assert.equal((await test.request({action:'preview',token})).status,404);
 assert.equal((await test.request({action:'respond',token,reply:'yes'})).status,404);
 assert.equal((await list()).length,0);
 assert.equal((await live.request(invite,host)).status,200);
 assert.equal(live.sent.length,1);
 assert.equal(live.sent[0].to,invite.email);
 assert.equal(live.sent[0].subject,"You're invited to an event on HH");
 assert.ok(live.sent[0].html.includes('&lt;b&gt;something&lt;/b&gt;'));
 assert.ok(live.sent[0].html.includes('/hh-family/#event-invite='));
 assert.ok(!live.sent[0].text.includes('Private note'));
 assert.equal((await (await failure.request(invite,host)).json()).delivery,'unknown');
 assert.equal((await failure.request(invite,host)).status,400);
 assert.equal(failure.sent.length,1);

 const event=preview.event;
 const file=calendarFile(event,'Dinner,\nBring: tea; 👋'.repeat(10));
 const unfolded=file.replace(/\r\n /g,'');
 assert.ok(unfolded.includes('DTSTART:20901118T230000Z'));
 assert.ok(unfolded.includes('DESCRIPTION:Dinner\\,\\nBring: tea\\;'));
 assert.ok(file.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
 const allDay={...event,allDay:true,startDate:'2090-11-18',endDate:'2090-11-20'};
 assert.ok(calendarFile(allDay,'').includes('DTEND;VALUE=DATE:20901120'));
 assert.equal(new URL(googleCalendarLink(allDay,'')).searchParams.get('dates'),'20901118/20901120');
 const master={...test.master,recurrence:['RRULE:FREQ=DAILY;COUNT=3']};
 assert.equal(eventHelpers.guestEvent(master,'2090-11-19').startsAt,'2090-11-19T23:00:00.000Z');
 assert.equal(eventHelpers.guestEvent({...master,exceptions:{'2090-11-19':null}},'2090-11-19'),null);
 assert.equal(eventHelpers.guestEvent(master,'2090-11-25'),null);

 for(let attempt=1;attempt<=4;attempt++){
  const response=await test.request(invite,host);
  assert.equal(response.status,200,await response.clone().text());
  await test.request({...target,action:'revoke',id:(await list())[0].id},host);
 }
 await test.db.exec('reset role');
 await test.db.query('delete from public.household_events where id=$1',[eventId]);
 await test.db.query("insert into public.household_events(id,household_id,title,starts_at,ends_at) values($1,$2,'New dinner','2090-11-18T23:00Z','2090-11-19T01:00Z')",[eventId,home]);
 const limited=await test.request(invite,host);
 assert.match((await limited.json()).error,/limit reached/);
 console.log('Event guest checks passed: access, private details, review versions, test and live delivery branches, safe RSVP links, changes, revocation, throttling, recurrence, and calendar formats.');
}finally{await Promise.all([test.db.close(),live.db.close(),failure.db.close()])}
