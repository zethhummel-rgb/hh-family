import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const base=new URL('../supabase/functions/google-calendar/',import.meta.url),cache=new Map();
function moduleURL(path){
 const absolute=new URL(path,base);if(cache.has(absolute.href))return cache.get(absolute.href);
 let source=fs.readFileSync(absolute,'utf8');
 source=source.replace(/from '(\.\.?\/[^']+\.ts)'/g,(_,relative)=>'from '+JSON.stringify(moduleURL(new URL(relative,absolute))));
 const url='data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');cache.set(absolute.href,url);return url;
}
const {prepareExternalImport}=await import(moduleURL('externalImport.ts'));
const calendar='synthetic-import@example.invalid';
const master={id:'weekly',summary:'Weekly family plan',description:'Preserve notes',location:'Park',start:{dateTime:'2026-10-25T10:00:00-04:00',timeZone:'America/Toronto'},end:{dateTime:'2026-10-25T11:00:00-04:00',timeZone:'America/Toronto'},recurrence:['RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3'],extendedProperties:{shared:{hh_event_id:'untrusted-native-id',hummel_people:'["outside-household"]',hummel_person:'External person',hummel_reminder:'5'}},reminders:{useDefault:false,overrides:[{method:'email',minutes:15}]}};
const cancelled={id:'cancelled',recurringEventId:'weekly',status:'cancelled',originalStartTime:{dateTime:'2026-11-01T10:00:00-05:00'}};
const moved={id:'moved',summary:'Changed plan',recurringEventId:'weekly',start:{dateTime:'2026-11-09T12:00:00-05:00'},end:{dateTime:'2026-11-09T13:00:00-05:00'},originalStartTime:{dateTime:'2026-11-08T10:00:00-05:00'}};
let result=await prepareExternalImport([master,cancelled,moved],calendar);
assert.equal(result.entries.length,1);assert.equal(result.cancelled,1);
const event=result.entries[0].event;
assert.equal(event.starts_at,'2026-10-25T14:00:00.000Z');assert.deepEqual(event.recurrence,['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3']);
assert.equal(event.exceptions['2026-11-01'],null);assert.equal(event.exceptions['2026-11-08'].starts_at,'2026-11-09T17:00:00.000Z');
assert.equal(event.person,'Everyone');assert.deepEqual(event.person_ids,[]);assert.equal(event.reminder_minutes,null);assert.equal(event.reminder_30_enabled,false);
assert.deepEqual(event.exceptions['2026-11-08'].person_ids,[]);assert.equal(event.exceptions['2026-11-08'].reminder_30_enabled,false);
assert.match(result.entries[0].sourceKey,/^[a-f0-9]{64}$/);assert.match(event.id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.equal(result.entries[0].sourceKey,(await prepareExternalImport([master],calendar)).entries[0].sourceKey);
assert.notEqual(result.entries[0].sourceKey,(await prepareExternalImport([master],'another-calendar')).entries[0].sourceKey);
assert.ok(result.warnings.some(w=>w.reason.includes('notification preferences')));
assert.equal(result.warnings[0].kind,'info');
assert.equal(master.extendedProperties.shared.hummel_person,'External person','Input is never mutated');

const allDay={id:'all-day',summary:'All day DST',start:{date:'2026-11-01'},end:{date:'2026-11-02'},recurrence:['RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1']};
result=await prepareExternalImport([allDay],calendar);
assert.equal(result.entries[0].event.starts_at,'2026-11-01T04:00:00.000Z');assert.equal(result.entries[0].event.ends_at,'2026-11-02T05:00:00.000Z');
assert.equal(result.entries[0].event.end_date,'2026-11-02','Exclusive end is preserved across 25-hour day');
const earlyFallBack={...master,start:{dateTime:'2026-11-01T01:30:00-04:00',timeZone:'America/Toronto'},end:{dateTime:'2026-11-01T01:45:00-04:00',timeZone:'America/Toronto'}};
result=await prepareExternalImport([earlyFallBack],calendar);assert.equal(result.entries.length,1);assert.equal(result.entries[0].event.starts_at,'2026-11-01T05:30:00.000Z');assert.equal(result.entries[0].event.ends_at,'2026-11-01T05:45:00.000Z');
for(const invalid of [
 {...master,start:{...master.start,timeZone:'Asia/Tokyo'}},
 {...master,start:{dateTime:master.start.dateTime}},
 {...master,recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']},
 {...master,recurrence:['RRULE:FREQ=WEEKLY;UNTIL=20261101T140000Z']},
 {...master,description:'x'.repeat(4001)},
 {...master,eventType:'outOfOffice'},
 {...master,start:{dateTime:'2026-10-25T10:00:00'}},
 {...master,start:{dateTime:'2026-02-30T10:00:00-05:00',timeZone:'America/Toronto'}},
 {...master,summary:'   '},
 {...master,start:{dateTime:'2026-11-01T01:30:00-05:00',timeZone:'America/Toronto'},end:{dateTime:'2026-11-01T02:30:00-05:00',timeZone:'America/Toronto'}},
 {...master,end:{dateTime:master.start.dateTime}},
]){
 result=await prepareExternalImport([allDay,invalid],calendar);assert.equal(result.entries.length,1);assert.equal(result.entries[0].googleId,'all-day');assert.equal(result.warnings.length,1);assert.match(result.warnings[0].reason,/Not imported:/);assert.equal(result.warnings[0].kind,'skipped');
}
for(const invalidChange of [
 {...moved,originalStartTime:{dateTime:'2026-11-09T10:00:00-05:00'}},
 {...moved,originalStartTime:{dateTime:'2026-11-08T11:00:00-05:00'}},
 {...moved,originalStartTime:{dateTime:'2026-11-15T10:00:00-05:00'}},
 {...moved,recurrence:['RRULE:FREQ=DAILY']},
])assert.equal((await prepareExternalImport([master,invalidChange],calendar)).entries.length,0,'Reject unsafe whole series, not just its exception');
assert.equal((await prepareExternalImport([master,moved,{...moved,id:'another-move'}],calendar)).entries.length,0,'Duplicate original dates cannot overwrite');
assert.equal((await prepareExternalImport([master,master],calendar)).entries.length,0,'Duplicate provider identities cannot silently overwrite');
assert.equal((await prepareExternalImport([moved],calendar)).warnings.length,1,'Orphan exception is explained');
assert.equal((await prepareExternalImport([{...master,status:'cancelled'},moved],calendar)).entries.length,0,'Cancelled series is never resurrected');
await assert.rejects(prepareExternalImport(Array(2001).fill(master),calendar));
await assert.rejects(prepareExternalImport([{...master,id:'bad\0id'}],calendar));
console.log('Google import conversion checks passed: stable calendar identities, safe complete series, moved/cancelled exceptions, DST all-day ends, unsupported patterns/timezones, tags/reminder isolation, and no silent truncation.');
