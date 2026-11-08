import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file){
 const source=fs.readFileSync(new URL('../src/'+file+'.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',code)(name=>{assert.equal(name,'./loginStorage');return load('loginStorage')},module,module.exports);
 return module.exports;
}
const api=load('householdNavigation');
const values=new Map(),store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const original={version:1,tab:'Groceries',calendarView:'Agenda',grocery:{search:'apples',store:'store:metro',scrollY:836}};
assert.equal(api.loadNavigation('alex','home-a',store).tab,'Home');
api.saveNavigation('alex','home-a',original,store);
assert.deepEqual(load('householdNavigation').loadNavigation('alex','home-a',store),original,'A fresh app module restores the shopping screen and context');
for(const [user,home] of [['sam','home-a'],['alex','home-b'],['sam','home-b']])assert.equal(api.loadNavigation(user,home,store).tab,'Home','Another account/home does not inherit the shopping screen');
api.saveNavigation('sam','home-a',{...original,tab:'Calendar'},store);
assert.deepEqual(api.loadNavigation('alex','home-a',store),original);
assert.equal(api.loadNavigation('sam','home-a',store).tab,'Calendar');
assert.notEqual(api.navigationKey('a:b','c'),api.navigationKey('a','b:c'),'Scope components cannot collide through separators');
assert.deepEqual(api.entryNavigation(original,new URLSearchParams()),original);
for(const [query,tab] of [['reminder_task=task','Reminders'],['reminder_date=2026-11-02','Calendar'],['reminder_event=event','Calendar'],['reminder_task=task&reminder_date=2026-11-02','Reminders']]){
 const next=api.entryNavigation(original,new URLSearchParams(query));assert.equal(next.tab,tab);assert.deepEqual(next.grocery,original.grocery);
}
assert.equal(original.tab,'Groceries','Notification routing never mutates the stored snapshot');
for(const tab of api.householdTabs){api.saveNavigation('test','home',{...original,tab},store);assert.equal(api.loadNavigation('test','home',store).tab,tab)}
for(const bad of ['More','Settings','javascript:alert(1)','https://example.invalid','Login','Lists',null])assert.equal(api.cleanNavigation({...original,tab:bad}).tab,'Home','Unrecognized screens and transient overlays cannot reopen');
for(const bad of ['{broken','null','[]','false',JSON.stringify({...original,version:99})]){store.setItem(api.navigationKey('test','home'),bad);assert.equal(api.loadNavigation('test','home',store).tab,'Home')}
const trimmed=api.cleanNavigation({...original,grocery:{search:'a'.repeat(10000),store:'store:'+'x'.repeat(1000),scrollY:-4},tokens:'never save',dialog:{draft:'private'}});
assert.equal(trimmed.grocery.search.length,160);assert.equal(trimmed.grocery.store,'all');assert.equal(trimmed.grocery.scrollY,0);
assert.deepEqual(Object.keys(trimmed),['version','tab','calendarView','grocery'],'Only navigation preferences are serialized, never records, tokens or drafts');
for(const scrollY of [Infinity,NaN,'99',null])assert.equal(api.cleanNavigation({...original,grocery:{...original.grocery,scrollY}}).grocery.scrollY,0);
assert.equal(api.cleanNavigation({...original,grocery:{...original.grocery,scrollY:1e20}}).grocery.scrollY,10000000);
for(const calendarView of api.calendarViews){
 api.saveNavigation('alex','views',{...original,calendarView},store);
 assert.equal(load('householdNavigation').loadNavigation('alex','views',store).calendarView,calendarView,'Cold restart keeps each calendar preference');
 assert.equal(api.loadNavigation('sam','views',store).calendarView,'Agenda','Another account starts with its own preference');
 assert.equal(api.loadNavigation('alex','other-home',store).calendarView,'Agenda','Another household has its own preference');
 assert.equal(api.entryNavigation(api.loadNavigation('alex','views',store),new URLSearchParams('reminder_date=2026-11-30')).calendarView,calendarView,'Notification routing preserves the chosen calendar view');
}
for(const calendarView of [undefined,null,'Day','Month<script>',{},99])assert.equal(api.cleanNavigation({...original,calendarView}).calendarView,'Agenda','Older or invalid preferences safely default to Agenda');
assert.equal(api.cleanNavigation({...original,grocery:null,calendarView:'Month'}).calendarView,'Month','An unrelated damaged grocery preference does not reset the calendar');
const blocked={getItem(){throw Error('Storage blocked')},setItem(){throw Error('Storage full')}};
assert.doesNotThrow(()=>api.saveNavigation('alex','home-a',original,blocked));assert.equal(api.loadNavigation('alex','home-a',blocked).tab,'Home');
store.setItem('homeRefreshTab','Groceries');assert.equal(api.loadNavigation('new','new',store).tab,'Home','Unscoped legacy refresh state cannot leak between accounts');
console.log('Household navigation checks passed: cold restart, account/home isolation, explicit notification priority, valid screens only, bounded preferences, malformed/blocked storage and legacy-key isolation. No backend calls.');
