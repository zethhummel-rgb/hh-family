import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

// Independent adversarial conversion checks. No network, accounts or production data.
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function moduleURI(file){
 if(cache.has(file))return cache.get(file);
 let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,quote,relative)=>'from '+JSON.stringify(moduleURI(path.resolve(path.dirname(file),relative))));
 const uri='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,uri);return uri;
}
const {prepareExternalImport}=await import(moduleURI(path.join(root,'supabase/functions/google-calendar/externalImport.ts')));
const {expandNativeEvent}=await import(moduleURI(path.join(root,'supabase/functions/google-calendar/native.ts')));
const base={id:'source-event',summary:"A plan'); DELETE FROM households; --",description:'<script>alert("not executable")</script>',location:'Home',start:{dateTime:'2026-11-03T10:00:00-05:00',timeZone:'America/Toronto'},end:{dateTime:'2026-11-03T11:00:00-05:00',timeZone:'America/Toronto'}};
const foreign={...base,extendedProperties:{private:{secret:'must not persist'},shared:{hummel_people:'foreign-user',hummel_person:'Other household',hummel_reminder:'10',hummel_reminder_30:'on',hh_event_id:'foreign-id'}},attendees:[{email:'private@example.invalid'}],conferenceData:{entryPoints:[{uri:'https://private.invalid'}]}};
const input=structuredClone(foreign),safe=await prepareExternalImport([input],'calendar@example.invalid');
assert.deepEqual(input,foreign,'Provider response is never mutated');
assert.equal(safe.entries.length,1);
const saved=safe.entries[0].event;
assert.equal(saved.title,base.summary,'SQL-like input remains ordinary event text');
assert.equal(saved.description,base.description,'HTML stays plain content; React escapes it');
assert.equal(saved.person,'Everyone');
assert.equal(saved.reminder_minutes,null);assert.equal(saved.reminder_30_enabled,false);
assert.equal(saved.extendedProperties,undefined);assert.equal(saved.attendees,undefined);assert.equal(saved.conferenceData,undefined);
assert.ok(!JSON.stringify(saved).includes('foreign-user'));
assert.equal(safe.entries[0].sourceKey,(await prepareExternalImport([base],'calendar@example.invalid')).entries[0].sourceKey,'Metadata edits do not create a new import identity');
assert.notEqual(safe.entries[0].sourceKey,(await prepareExternalImport([base],'other-calendar@example.invalid')).entries[0].sourceKey,'Different calendar event identities stay distinct');

async function rejected(event,extra=[]){const value=await prepareExternalImport([event,...extra],'calendar@example.invalid');assert.equal(value.entries.length,0);assert.ok(value.warnings.length);return value;}
await rejected({...base,recurrence:['RRULE:FREQ=WEEKLY;BYDAY=TU,TH']});
await rejected({...base,recurrence:['RRULE:FREQ=DAILY','EXDATE:20261104T150000Z']});
await rejected({...base,recurrence:['RRULE:FREQ=WEEKLY'],start:{...base.start,timeZone:'Europe/London'}});
await rejected({...base,recurrence:['RRULE:FREQ=WEEKLY'],start:{dateTime:base.start.dateTime}});
await rejected({...base,end:{...base.end,dateTime:base.start.dateTime}});
await rejected({...base,eventType:'workingLocation'});
await rejected({...base},[{...base,summary:'Conflicting duplicate identity'}]);
await rejected({...base,recurringEventId:'missing-master',originalStartTime:base.start});

const series={...base,recurrence:['RRULE:FREQ=WEEKLY;COUNT=3']};
await rejected(series,[{...base,id:'wrong-occurrence',recurringEventId:base.id,originalStartTime:{dateTime:'2026-11-04T10:00:00-05:00'}}]);
const cut=await prepareExternalImport([series,{id:'cancelled',recurringEventId:base.id,status:'cancelled',originalStartTime:{dateTime:'2026-11-10T10:00:00-05:00'}}],'calendar@example.invalid');
assert.equal(cut.entries.length,1);assert.equal(cut.entries[0].event.exceptions['2026-11-10'],null);
assert.deepEqual(expandNativeEvent(cut.entries[0].event,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z').map(e=>e.original_date),['2026-11-03','2026-11-17']);
const allDay=await prepareExternalImport([{id:'all-day',summary:'Long DST day',start:{date:'2026-11-01'},end:{date:'2026-11-02'}}],'calendar@example.invalid');
assert.equal(Date.parse(allDay.entries[0].event.ends_at)-Date.parse(allDay.entries[0].event.starts_at),25*60*60*1000);
assert.equal(allDay.entries[0].event.end_date,'2026-11-02','Exclusive provider ending date is retained');
await assert.rejects(prepareExternalImport([{...base,id:'bad\0identity'}],'calendar@example.invalid'));
console.log('Independent Google import security checks passed: literal content, metadata isolation, stable source identity, unsupported-series refusal, cancelled exceptions and DST all-day dates.');
