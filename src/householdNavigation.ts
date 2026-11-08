import {safeStorage} from './loginStorage';

export const householdTabs=['Home','Calendar','Groceries','Reminders','Week','Meals','Notes'] as const;
export type HouseholdTab=typeof householdTabs[number];
export const calendarViews=['Agenda','3 Day','Month'] as const;
export type CalendarView=typeof calendarViews[number];
export const isCalendarView=(value:unknown):value is CalendarView=>calendarViews.some(view=>view===value);
export type HouseholdNavigation={version:1;tab:HouseholdTab;calendarView:CalendarView;grocery:{search:string;store:string;scrollY:number}};
type Store=Pick<Storage,'getItem'|'setItem'>;
const saved=safeStorage(()=>localStorage);
export const navigationKey=(userId:string,householdId:string)=>`hh:navigation:v1:${encodeURIComponent(userId)}:${encodeURIComponent(householdId)}`;
export const isHouseholdTab=(value:unknown):value is HouseholdTab=>typeof value==='string'&&householdTabs.some(tab=>tab===value);
const empty=():HouseholdNavigation=>({version:1,tab:'Home',calendarView:'Agenda',grocery:{search:'',store:'all',scrollY:0}});
export function cleanNavigation(value:unknown):HouseholdNavigation{
 const fallback=empty();
 if(!value||typeof value!=='object'||Array.isArray(value))return fallback;
 const row=value as Partial<HouseholdNavigation>;
 if(row.version!==1||!isHouseholdTab(row.tab))return fallback;
 const calendarView=isCalendarView(row.calendarView)?row.calendarView:'Agenda';
 const grocery=row.grocery;
 if(!grocery||typeof grocery!=='object'||Array.isArray(grocery))return {...fallback,tab:row.tab,calendarView};
 return {version:1,tab:row.tab,calendarView,grocery:{
  search:typeof grocery.search==='string'?grocery.search.slice(0,160):'',
  store:typeof grocery.store==='string'&&(grocery.store==='all'||grocery.store==='none'||grocery.store.startsWith('store:')&&grocery.store.length>6&&grocery.store.length<=86)?grocery.store:'all',
  scrollY:typeof grocery.scrollY==='number'&&Number.isFinite(grocery.scrollY)?Math.max(0,Math.min(10000000,grocery.scrollY)):0
 }};
}
export function loadNavigation(userId:string,householdId:string,store:Store=saved):HouseholdNavigation{
 try{return cleanNavigation(JSON.parse(store.getItem(navigationKey(userId,householdId))||'null'))}catch{return empty()}
}
export function saveNavigation(userId:string,householdId:string,value:HouseholdNavigation,store:Store=saved){
 try{store.setItem(navigationKey(userId,householdId),JSON.stringify(cleanNavigation(value)))}catch{/* Keep the current screen usable when device storage is unavailable. */}
}
export function entryNavigation(value:HouseholdNavigation,params:URLSearchParams):HouseholdNavigation{
 // Explicit notification destinations take priority over the last open screen.
 const tab=params.has('reminder_task')?'Reminders':params.has('reminder_date')||params.has('reminder_event')?'Calendar':value.tab;
 return {...value,tab};
}
