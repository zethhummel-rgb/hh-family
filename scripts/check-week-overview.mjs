import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/weekOverview.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {weekRange,buildWeekOverview}=await import(url);

assert.deepEqual(weekRange('2026-11-01'),{start:'2026-10-26',end:'2026-11-02',days:['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']});
assert.equal(weekRange('2026-11-02').start,'2026-11-02');
assert.equal(weekRange('2027-01-01').start,'2026-12-28');
assert.equal(weekRange('2027-01-01').end,'2027-01-04');
assert.equal(weekRange('2028-02-29').start,'2028-02-28');
assert.throws(()=>weekRange('2026-02-30'),/valid date/);
assert.throws(()=>weekRange(''),/valid date/);
const base={id:'one',title:'Plan',description:'',location:'',person:'Everyone',person_ids:[],starts_at:'2026-10-26T14:00:00Z',ends_at:'2026-10-26T15:00:00Z',all_day:false,start_date:null,end_date:null,source:'home'};
const task={id:'task',kind:'task',title:'Bring permission slip',category:'',person:'Everyone',due:'2026-10-28',done:0,createdAt:'2026-10-20T12:00:00Z'};
const events=[
 {...base,id:'before',starts_at:'2026-10-25T23:00:00Z',ends_at:'2026-10-26T04:00:00Z'},
 {...base,id:'cross-midnight',starts_at:'2026-10-26T03:00:00Z',ends_at:'2026-10-26T05:00:00Z'},
 {...base,id:'tuesday-utc-monday-local',starts_at:'2026-10-27T00:30:00Z',ends_at:'2026-10-27T01:30:00Z'},
 {...base,id:'overlap',starts_at:'2026-10-27T03:30:00Z',ends_at:'2026-10-27T04:30:00Z'},
 {...base,id:'midnight-end',starts_at:'2026-10-28T02:00:00Z',ends_at:'2026-10-28T04:00:00Z'},
 {...base,id:'all-day-span',title:'Trip',all_day:true,start_date:'2026-10-25',end_date:'2026-10-29',starts_at:'2026-10-25T04:00:00Z',ends_at:'2026-10-29T04:00:00Z'},
 {...base,id:'dst-day',all_day:true,start_date:'2026-11-01',end_date:'2026-11-02',starts_at:'2026-11-01T04:00:00Z',ends_at:'2026-11-02T05:00:00Z'},
 {...base,id:'after-week',starts_at:'2026-11-02T05:00:00Z',ends_at:'2026-11-02T06:00:00Z'},
 {...base,id:'series@2026-10-28',series_id:'series',original_date:'2026-10-28',starts_at:'2026-10-28T14:00:00Z',ends_at:'2026-10-28T15:00:00Z'},
 {...base,id:'series@2026-10-30',series_id:'series',original_date:'2026-10-30',starts_at:'2026-10-30T14:00:00Z',ends_at:'2026-10-30T15:00:00Z'},
 {...base,id:'invalid',starts_at:'not-an-instant'},
 {...base,id:'reversed',starts_at:'2026-10-26T15:00:00Z',ends_at:'2026-10-26T14:00:00Z'},
];
const items=[task,{...task,id:'waiting',due:'2026-10-30',repeat_unit:'week',last_completed_at:'2026-10-23T12:00:00Z'},
 {...task,id:'done',done:1},{...task,id:'overdue',due:'2026-10-20'},
 {...task,id:'earlier-week',due:'2026-10-26'},{...task,id:'today',due:'2026-10-27'},
 {...task,id:'undated',due:''},{...task,id:'invalid-date',due:'2026-02-30'},
 {...task,id:'grocery',kind:'grocery'},{...task,id:'later',due:'2026-11-03'}];
const original=structuredClone({events,items});
const result=buildWeekOverview([...events,events[5]],[...items,task],'2026-11-01','2026-10-27');
assert.equal(result.days.length,7);assert.equal(result.eventCount,8,'Each expanded occurrence is counted once, even if it spans several days');
assert.equal(result.taskCount,4,'Next repeating task dates count once without forecasting more repeats');
assert.deepEqual(result.days[0].events.map(e=>e.id),['all-day-span','cross-midnight','tuesday-utc-monday-local','overlap']);
assert.deepEqual(result.days[1].events.map(e=>e.id),['all-day-span','overlap','midnight-end']);
assert.deepEqual(result.days[2].events.map(e=>e.id),['all-day-span','series@2026-10-28']);
assert.deepEqual(result.days[6].events.map(e=>e.id),['dst-day']);
assert.deepEqual(result.days[4].tasks.map(t=>t.id),['waiting'],'Waiting-in-Done repeat shows its real next due date');
assert.deepEqual(result.overdue.map(t=>t.id),['overdue','earlier-week']);
assert.deepEqual(buildWeekOverview(events,items,'2026-11-02','2026-10-27').overdue,[],'Overdue section belongs only to the actual current week');
assert.deepEqual({events,items},original,'Input records and their ordering are never mutated');
const empty=buildWeekOverview([],[],'2026-11-01','2026-11-01');
assert.equal(empty.eventCount,0);assert.equal(empty.taskCount,0);assert.ok(empty.days.every(day=>day.events.length===0&&day.tasks.length===0));
const spring=buildWeekOverview([{...base,id:'spring-day',all_day:true,start_date:'2026-03-08',end_date:'2026-03-09',starts_at:'2026-03-08T05:00:00Z',ends_at:'2026-03-09T04:00:00Z'}],[],'2026-03-08','2026-03-08');
assert.deepEqual(spring.days[6].events.map(e=>e.id),['spring-day']);
assert.equal(spring.days[0].date,'2026-03-02');
const ordered=buildWeekOverview([{...base,id:'z',title:'Same'},{...base,id:'a',title:'Same'},{...base,id:'first',title:'A plan'}],[],'2026-10-26','2026-10-26');
assert.deepEqual(ordered.days[0].events.map(e=>e.id),['first','a','z']);
const previousZone=process.env.TZ;
try{
 const expected=buildWeekOverview(events,items,'2026-11-01','2026-10-27');
 for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){
  process.env.TZ=zone;
  const {buildWeekOverview:inZone}=await import(url+'#'+zone);
  assert.deepEqual(inZone(events,items,'2026-11-01','2026-10-27'),expected,'Host time zone must not change the HH week: '+zone);
 }
}finally{if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone}
console.log('Week overview checks passed: Monday–Sunday, Eastern dates independent of host timezone, year/leap boundaries, exclusive multi-day ends, 23/25-hour DST dates, distinct recurring occurrences, next-due repeat tasks, overdue/done/undated/grocery handling and stable sorting.');
