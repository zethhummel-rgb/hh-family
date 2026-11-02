import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=fs.readFileSync(new URL('../src/weekOverview.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {weekRange,upcomingRange,overviewRange,adjacentWeek,buildWeekOverview}=await import(url);

assert.deepEqual(weekRange('2026-11-01'),{start:'2026-11-01',end:'2026-11-08',days:['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07']});
assert.equal(weekRange('2026-10-31').start,'2026-10-25','Saturday stays in the preceding Sunday–Saturday week');
assert.equal(weekRange('2026-11-02').start,'2026-11-01');
assert.equal(weekRange('2027-01-01').start,'2026-12-27');
assert.equal(weekRange('2027-01-01').end,'2027-01-03');
assert.equal(weekRange('2028-02-29').start,'2028-02-27');
assert.throws(()=>weekRange('2026-02-30'),/valid date/);
assert.throws(()=>weekRange(''),/valid date/);
assert.deepEqual(upcomingRange('2026-11-04'),{start:'2026-11-04',end:'2026-11-11',days:['2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10']});
assert.deepEqual(upcomingRange('2026-12-29').days,['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
assert.deepEqual(upcomingRange('2028-02-27').days,['2028-02-27','2028-02-28','2028-02-29','2028-03-01','2028-03-02','2028-03-03','2028-03-04']);
assert.throws(()=>upcomingRange('2026-02-30'),/valid current date/);
assert.equal(overviewRange('2026-11-04','2026-11-05','upcoming').start,'2026-11-05','The default follows today after midnight rather than its original anchor');
assert.equal(overviewRange('2026-11-01','2026-11-05','week').start,'2026-11-01','Explicitly browsed calendar weeks stay anchored');
assert.equal(adjacentWeek('2026-11-04','2026-11-04','upcoming',1),'2026-11-08');
assert.equal(adjacentWeek('2026-11-04','2026-11-04','upcoming',-1),'2026-10-25');
assert.equal(adjacentWeek('2026-11-08','2026-11-04','week',1),'2026-11-15');
assert.equal(adjacentWeek('2026-11-08','2026-11-04','week',-1),'2026-11-01');
assert.equal(overviewRange('2026-11-15','2026-11-04','upcoming').start,'2026-11-04','Reset returns to the rolling seven-day range');
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
const result=buildWeekOverview([...events,events[5]],[...items,task],'2026-10-27','2026-10-27');
assert.equal(result.days.length,7);assert.equal(result.eventCount,8,'Each expanded occurrence is counted once, even if it spans several days');
assert.equal(result.taskCount,4,'Next repeating task dates count once without forecasting more repeats');
assert.deepEqual(result.days[0].events.map(e=>e.id),['all-day-span','before','cross-midnight']);
assert.deepEqual(result.days[1].events.map(e=>e.id),['all-day-span','cross-midnight','tuesday-utc-monday-local','overlap']);
assert.deepEqual(result.days[2].events.map(e=>e.id),['all-day-span','overlap','midnight-end']);
assert.deepEqual(result.days[3].events.map(e=>e.id),['all-day-span','series@2026-10-28']);
assert.deepEqual(result.days[6].events.map(e=>e.id),[],'Sunday belongs to the next calendar week');
assert.deepEqual(result.days[5].tasks.map(t=>t.id),['waiting'],'Waiting-in-Done repeat shows its real next due date');
assert.deepEqual(result.overdue.map(t=>t.id),['overdue','earlier-week']);
assert.deepEqual(buildWeekOverview(events,items,'2026-11-02','2026-10-27').overdue,[],'Overdue section belongs only to the actual current week');
assert.deepEqual({events,items},original,'Input records and their ordering are never mutated');
const empty=buildWeekOverview([],[],'2026-11-01','2026-11-01');
assert.equal(empty.eventCount,0);assert.equal(empty.taskCount,0);assert.ok(empty.days.every(day=>day.events.length===0&&day.tasks.length===0));
const rolling=buildWeekOverview(events,items,'2026-10-27','2026-10-27','upcoming');
assert.equal(rolling.start,'2026-10-27');assert.equal(rolling.end,'2026-11-03');
assert.ok(rolling.days.every(day=>day.date>='2026-10-27'),'The default never shows a past day');
assert.deepEqual(rolling.days[0].events.map(e=>e.id),['all-day-span','overlap','midnight-end'],'Today includes ongoing multi-day and overnight plans');
assert.equal(rolling.days[5].date,'2026-11-01');
assert.deepEqual(rolling.days[5].events.map(e=>e.id),['dst-day'],'Fall DST day remains one displayed date');
assert.deepEqual(rolling.days[6].events.map(e=>e.id),['after-week'],'The rolling range crosses Sunday without dropping next-week plans');
assert.deepEqual(rolling.days.flatMap(day=>day.tasks.map(item=>item.id)),['today','task','waiting']);
assert.deepEqual(rolling.overdue.map(item=>item.id),['overdue','earlier-week'],'Earlier unfinished tasks remain available separately');
const tomorrow=buildWeekOverview(events,items,'2026-10-27','2026-10-28','upcoming');
assert.equal(tomorrow.days[0].date,'2026-10-28');assert.equal(tomorrow.days[6].date,'2026-11-03');
assert.ok(!tomorrow.days.some(day=>day.tasks.some(item=>item.id==='today')),'Yesterday falls out after midnight');
const spring=buildWeekOverview([{...base,id:'spring-day',all_day:true,start_date:'2026-03-08',end_date:'2026-03-09',starts_at:'2026-03-08T05:00:00Z',ends_at:'2026-03-09T04:00:00Z'}],[],'2026-03-08','2026-03-08');
assert.deepEqual(spring.days[0].events.map(e=>e.id),['spring-day']);
assert.equal(spring.days[0].date,'2026-03-08');
assert.equal(upcomingRange('2026-03-07').days[6],'2026-03-13','A 23-hour day does not change the seven displayed dates');
const ordered=buildWeekOverview([{...base,id:'z',title:'Same'},{...base,id:'a',title:'Same'},{...base,id:'first',title:'A plan'}],[],'2026-10-26','2026-10-26');
assert.deepEqual(ordered.days[1].events.map(e=>e.id),['first','a','z']);
const previousZone=process.env.TZ;
try{
 const expected=buildWeekOverview(events,items,'2026-10-27','2026-10-27','upcoming');
 for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){
  process.env.TZ=zone;
  const {buildWeekOverview:inZone}=await import(url+'#'+zone);
  assert.deepEqual(inZone(events,items,'2026-10-27','2026-10-27','upcoming'),expected,'Host time zone must not change the HH week: '+zone);
 }
}finally{if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone}
// Render the real overview components with synthetic data. Supabase and its
// calendar request adapter are blocked, so these view checks cannot reach live
// household APIs. The actual date helpers and JSX remain in use.
const require=createRequire(import.meta.url),moduleCache=new Map();
function loadView(file){
 if(moduleCache.has(file))return moduleCache.get(file).exports;
 const module={exports:{}};moduleCache.set(file,module);
 const source=fs.readFileSync(file,'utf8');
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const localRequire=name=>{
  if(name.endsWith('.css'))return {};
  if(name==='./supabase'||name==='./calendarAuth')return new Proxy({},{get(){throw Error('Overview views must not access a backend')}});
  if(!name.startsWith('.'))return require(name);
  let next=path.resolve(path.dirname(file),name);if(!fs.existsSync(next))next=['.ts','.tsx'].map(ext=>next+ext).find(candidate=>fs.existsSync(candidate));
  assert.ok(next,'Resolve view dependency '+name);return loadView(next);
 };
 new Function('require','module','exports',code)(localRequire,module,module.exports);return module.exports;
}
const {default:WeekView,WeekPreview}=loadView(fileURLToPath(new URL('../src/WeekOverview.tsx',import.meta.url)));
const noop=()=>{},meal=(date,title,meal_type='supper')=>({id:date+title,household_id:'home-a',meal_date:date,meal_type,title,ingredients:[],instructions:'',source_url:'',version:1,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'});
const viewProps={events:[],items:[],today:'2026-11-04',calendarLoading:false,calendarError:'',itemsLoading:false,itemsError:'',loadedRange:{from:'2026-11-04T05:00:00Z',to:'2026-11-11T05:00:00Z'},meals:[meal('2026-11-03','Past dinner'),meal('2026-11-04','Soup tonight'),meal('2026-11-10','Tacos next Tuesday'),meal('2026-11-11','Outside range')],mealsError:'',mealsLoadedRange:{from:'2026-11-04',to:'2026-11-11'},anchor:'2026-11-04',onAnchor:noop,onRange:noop,onMealRange:noop,onBack:noop,onRefresh:noop,onEvent:noop,onTask:noop,onMeal:noop,onAddEvent:noop,onAllTasks:noop,onMealPlanner:noop,profiles:[]};
const render=(overrides={})=>renderToStaticMarkup(createElement(WeekView,{...viewProps,...overrides}));
const mealView=render();
assert.match(mealView,/Soup tonight/);assert.match(mealView,/Tacos next Tuesday/);assert.doesNotMatch(mealView,/Past dinner|Outside range/,'Meal rows respect the rolling seven displayed dates');
assert.match(mealView,/Supper · Whole household/,'Meals are distinct household plans without person filters');
assert.match(mealView,/Open meal planner/,'The overview offers a route to planning even on an empty week');
assert.match(render({calendarError:'Calendar unavailable',loadedRange:null}),/Soup tonight/,'Calendar failures do not hide ready dinner plans');
const staleMealRange=render({mealsLoadedRange:{from:'2026-10-25',to:'2026-11-01'}});
assert.doesNotMatch(staleMealRange,/Soup tonight|Tacos next Tuesday/,'An old meal range cannot populate the current overview');
assert.match(staleMealRange,/Loading meal plans/);assert.doesNotMatch(staleMealRange,/A little room to breathe/,'Unknown dinner availability is never presented as an empty day');
assert.doesNotMatch(render({mealsError:'Could not load meals'}),/Soup tonight/);assert.match(render({mealsError:'Could not load meals'}),/Meal plans could not be loaded/);
const preview=renderToStaticMarkup(createElement(WeekPreview,{...viewProps,onOpen:noop}));
assert.match(preview,/2 meals/,'Home counts only dinner plans in its next-seven-day window');
assert.match(renderToStaticMarkup(createElement(WeekPreview,{...viewProps,onOpen:noop,mealsLoadedRange:null})),/Loading meals/);
assert.match(renderToStaticMarkup(createElement(WeekPreview,{...viewProps,onOpen:noop,mealsError:'Unavailable'})),/Meals unavailable/);
console.log('Week overview checks passed: Sunday–Saturday calendar weeks, today-first rolling seven days, midnight advance, week navigation/reset, Eastern dates independent of host timezone, year/leap boundaries, exclusive multi-day ends, 23/25-hour DST dates, distinct recurring occurrences, next-due repeat tasks, overdue/done/undated/grocery handling, stable sorting, and separately loaded dinner rows/counts without stale or false-empty meal states.');

const fullDay=render({meals:[meal('2026-11-04','Fruit snack','snacks'),meal('2026-11-04','Porridge','breakfast'),meal('2026-11-04','Packed lunch','lunch'),meal('2026-11-04','Extra lunch','lunch'),meal('2026-11-04','Soup','supper')]});
for(const label of ['Breakfast','Lunch','Supper','Snacks'])assert.match(fullDay,new RegExp(label+' · Whole household'));
assert.ok(fullDay.indexOf('Porridge')<fullDay.indexOf('Packed lunch')&&fullDay.indexOf('Soup')<fullDay.indexOf('Fruit snack'),'Meal sections keep chronological order');
assert.match(fullDay,/Extra lunch/,'Multiple same-slot entries are retained');
