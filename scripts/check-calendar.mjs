import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/calendarData.ts',import.meta.url),'utf8');const dates=source.slice(source.indexOf('export function eventRequestId'),source.indexOf('export async function googleRequest'));
const js=ts.transpileModule(dates,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const calendarModule='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {zonedISO,shiftDay,eventRequestId,eventDateLabel,halfHourAfter}=await import(calendarModule);
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

const holidaySource=fs.readFileSync(new URL('../src/calendarHolidays.ts',import.meta.url),'utf8').replace("'./calendarData'",JSON.stringify(calendarModule));
const holidayJs=ts.transpileModule(holidaySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {calendarHolidays}=await import('data:text/javascript;base64,'+Buffer.from(holidayJs).toString('base64'));
const holidays2026=calendarHolidays(2026),holidays2027=calendarHolidays(2027);
for(const [date,name] of Object.entries({
 '2026-02-16':'Family Day','2026-04-03':'Good Friday','2026-04-05':'Easter Sunday','2026-04-06':'Easter Monday',
 '2026-05-18':'Victoria Day','2026-07-01':'Canada Day','2026-08-03':'Civic Holiday','2026-09-07':'Labour Day',
 '2026-09-30':'National Day for Truth and Reconciliation','2026-10-12':'Thanksgiving','2026-11-11':'Remembrance Day',
 '2026-12-24':'Christmas Eve','2026-12-25':'Christmas Day','2026-12-26':'Boxing Day',
}))assert.equal(holidays2026.get(date)?.name,name);
assert.equal(holidays2027.get('2027-03-28')?.name,'Easter Sunday');
assert.equal(holidays2027.get('2027-05-24')?.name,'Victoria Day');
assert.equal(holidays2027.get('2027-08-02')?.name,'Civic Holiday');
assert.equal(holidays2027.get('2027-08-03'),undefined);
console.log('Canadian and Ontario holiday dates passed for 2026 and 2027.');
