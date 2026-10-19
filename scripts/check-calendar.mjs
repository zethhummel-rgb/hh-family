import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/calendarData.ts',import.meta.url),'utf8');const dates=source.slice(source.indexOf('export function eventRequestId'),source.indexOf('export async function googleRequest'));
const js=ts.transpileModule(dates,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {zonedISO,shiftDay,eventRequestId,eventDateLabel,halfHourAfter}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
assert.equal(zonedISO('2026-10-18','10:00'),'2026-10-18T14:00:00.000Z');
assert.equal(zonedISO('2026-12-18','10:00'),'2026-12-18T15:00:00.000Z');
assert.throws(()=>zonedISO('2026-03-08','02:30'),/does not exist/);
assert.equal((Date.parse(zonedISO('2026-11-02'))-Date.parse(zonedISO('2026-11-01')))/3600000,25);
assert.equal(shiftDay('2026-12-31',1),'2027-01-01');
assert.match(eventRequestId(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
console.log('Calendar checks passed: Eastern time, DST gap, 25-hour all-day event, date rollover, request IDs.');

assert.equal(eventDateLabel({all_day:false,starts_at:'2026-10-22T00:30:00Z',ends_at:'2026-10-22T01:30:00Z'}),'Wed, Oct 21, 2026');
assert.equal(eventDateLabel({all_day:true,start_date:'2026-12-31',end_date:'2027-01-02'}),'Thu, Dec 31, 2026 – Fri, Jan 1, 2027');

assert.deepEqual(halfHourAfter('2026-10-18','19:20'),{date:'2026-10-18',time:'19:50'});
assert.deepEqual(halfHourAfter('2026-12-31','23:45'),{date:'2027-01-01',time:'00:15'});
assert.deepEqual(halfHourAfter('2026-10-18','23:30'),{date:'2026-10-19',time:'00:00'});
assert.equal(halfHourAfter('2026-10-18',''),null);
