import type {FamilyEvent} from './calendarData';
import type {ReminderItem} from './taskReminders';

export type WeekDay={date:string;events:FamilyEvent[];tasks:ReminderItem[]};
export type WeekOverview={start:string;end:string;days:WeekDay[];overdue:ReminderItem[];eventCount:number;taskCount:number};
export type OverviewMode='upcoming'|'week';
const easternDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'});
function validDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function shift(date:string,days:number){const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}

// Calendar dates use UTC arithmetic; event instants are always read in Eastern
// time. Neither the host zone nor a 23/25-hour DST day changes the seven dates.
export function weekRange(anchor:string){
 if(!validDate(anchor))throw Error('Choose a valid date for the week.');
 const weekday=new Date(anchor+'T12:00:00Z').getUTCDay();
 const start=shift(anchor,-weekday);
 return {start,end:shift(start,7),days:Array.from({length:7},(_,i)=>shift(start,i))};
}
export function upcomingRange(today:string){
 if(!validDate(today))throw Error('Choose a valid current date.');
 return {start:today,end:shift(today,7),days:Array.from({length:7},(_,i)=>shift(today,i))};
}
export function overviewRange(anchor:string,today:string,mode:OverviewMode){return mode==='upcoming'?upcomingRange(today):weekRange(anchor)}
export function adjacentWeek(anchor:string,today:string,mode:OverviewMode,direction:-1|1){
 const start=weekRange(mode==='upcoming'?today:anchor).start;
 return shift(start,direction*7);
}
function spansDay(event:FamilyEvent,date:string){
 if(event.all_day)return !!event.start_date&&!!event.end_date&&validDate(event.start_date)&&validDate(event.end_date)&&event.start_date<=date&&event.end_date>date;
 const start=Date.parse(event.starts_at),end=Date.parse(event.ends_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return false;
 // Subtract a millisecond from the exclusive end: an event ending at midnight
 // belongs to the preceding date, not the newly starting day.
 return easternDate.format(start)<=date&&easternDate.format(end-1)>=date;
}
const compareEvents=(a:FamilyEvent,b:FamilyEvent)=>Number(b.all_day)-Number(a.all_day)||(Date.parse(a.starts_at)-Date.parse(b.starts_at)||0)||a.title.localeCompare(b.title,'en')||a.id.localeCompare(b.id,'en');
const compareTasks=(a:ReminderItem,b:ReminderItem)=>a.due.localeCompare(b.due)||((a.reminder_time||'99:99').localeCompare(b.reminder_time||'99:99'))||a.title.localeCompare(b.title,'en')||a.id.localeCompare(b.id,'en');

export function buildWeekOverview(events:FamilyEvent[],items:ReminderItem[],anchor:string,today:string,mode:OverviewMode='week'):WeekOverview{
 const range=overviewRange(anchor,today,mode);
 if(!validDate(today))throw Error('Choose a valid current date.');
 const uniqueEvents=[...new Map(events.map(event=>[event.id,event])).values()];
 const pendingTasks=[...new Map(items.map(item=>[item.id,item])).values()].filter(item=>item.kind==='task'&&!item.done&&validDate(item.due));
 const days=range.days.map(date=>({date,events:uniqueEvents.filter(event=>spansDay(event,date)).sort(compareEvents),tasks:pendingTasks.filter(item=>item.due===date).sort(compareTasks)}));
 // A completed repeating reminder already stores its next due date. Show that
 // next date even while it waits in Done; never invent further completions.
 const overdue=range.start<=today&&today<range.end?pendingTasks.filter(item=>item.due<today).sort(compareTasks):[];
 return {start:range.start,end:range.end,days,overdue,eventCount:new Set(days.flatMap(day=>day.events.map(event=>event.id))).size,taskCount:days.reduce((total,day)=>total+day.tasks.length,0)};
}
