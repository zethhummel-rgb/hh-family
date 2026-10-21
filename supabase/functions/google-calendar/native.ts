import {readRecurrence} from './recurrence.ts';

// One shared expansion engine for HH views, search, Google import and push delivery.
const zone='America/Toronto';
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const partsFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export type NativeEvent={id:string;title:string;description:string;location:string;person:string;person_ids?:string[]|null;reminder_minutes?:number|null;reminder_30_enabled?:boolean;starts_at:string;ends_at:string;all_day:boolean;start_date:string|null;end_date:string|null;version?:number;recurrence?:string[];exceptions?:Record<string,Partial<NativeEvent>|null>;source?:'home'|'google';series_id?:string|null;original_date?:string;recurring?:boolean};
export const localDate=(iso:string)=>dateFormat.format(new Date(iso));
function shift(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function localParts(iso:string){return Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map(p=>[p.type,p.value]))}
export function nativeInstant(date:string,time:string){
 const [y,m,d]=date.split('-').map(Number),[h,min,s]=time.split(':').map(Number),target=Date.UTC(y,m-1,d,h,min,s||0);let guess=target;
 for(let i=0;i<4;i++){const p=localParts(new Date(guess).toISOString());const delta=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);if(!delta)break;guess+=delta}
 const result=new Date(guess).toISOString(),p=localParts(result);
 // Skip nonexistent wall times at spring-forward, following recurrence semantics.
 return localDate(result)===date&&+p.hour===h&&+p.minute===min?result:null;
}
export function occurrenceForDate(master:NativeEvent,date:string):NativeEvent|null{
 const first=master.all_day?master.start_date!:localDate(master.starts_at);
 const days=Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000);
 const p=localParts(master.starts_at),time=`${p.hour}:${p.minute}:${p.second}`;
 const starts_at=nativeInstant(date,master.all_day?'00:00':time);if(!starts_at)return null;
 const end_date=master.all_day?shift(master.end_date!,days):null;
 const ends_at=master.all_day?nativeInstant(end_date!,'00:00')!:new Date(Date.parse(starts_at)+Date.parse(master.ends_at)-Date.parse(master.starts_at)).toISOString();
 return {...master,exceptions:undefined,recurrence:undefined,id:master.id+'@'+date,series_id:master.id,original_date:date,recurring:true,source:'home',starts_at,ends_at,start_date:master.all_day?date:null,end_date};
}
export function expandNativeEvent(master:NativeEvent,from:string,to:string,limit=2000,firstOnly=false):NativeEvent[]{
 const low=Date.parse(from),high=Date.parse(to),overlaps=(e:NativeEvent)=>Date.parse(e.starts_at)<high&&Date.parse(e.ends_at)>low;
 if(!master.recurrence?.length)return overlaps(master)?[{...master,source:'home'}]:[];
 const options=readRecurrence(master.recurrence,master.all_day);if(!options)throw Error('This event has an unsupported repeat pattern.');
 const first=master.all_day?master.start_date!:localDate(master.starts_at),[year,month,day]=first.split('-').map(Number);
 const result:NativeEvent[]=[],exceptions=master.exceptions||{};let count=0;
 const add=(e:NativeEvent)=>{if(overlaps(e)){result.push(e);if(!firstOnly&&result.length>limit)throw Error('Too many repeating events. Choose a smaller date range.')}};
 // Retain moved instances even when their original date is outside this view.
 for(const [date,change]of Object.entries(exceptions)){if(change){const original=occurrenceForDate(master,date);if(original)add({...original,...change,id:original.id,series_id:master.id,original_date:date,recurring:true,source:'home',recurrence:undefined,exceptions:undefined})}}
 const final=localDate(new Date(high).toISOString());
 const duration=Date.parse(master.ends_at)-Date.parse(master.starts_at),earliest=localDate(new Date(low-duration-86400000).toISOString());
 let firstIndex=0;
 if(options.ending!=='after'){
  if(options.frequency==='DAILY'||options.frequency==='WEEKLY')firstIndex=Math.max(0,Math.floor((Date.parse(earliest+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000/(options.interval*(options.frequency==='WEEKLY'?7:1))));
  else {const [ey,em]=earliest.split('-').map(Number);firstIndex=Math.max(0,Math.floor((options.frequency==='MONTHLY'?(ey-year)*12+em-month:ey-year)/options.interval)-1)}
 }
 // Direct date stepping avoids day-by-day scans for monthly/yearly intervals.
 for(let index=firstIndex;index<3700000;index++){
  let date:string;
  if(options.frequency==='DAILY'||options.frequency==='WEEKLY')date=shift(first,index*options.interval*(options.frequency==='WEEKLY'?7:1));
  else {const d=new Date(first+'T12:00:00Z');d.setUTCDate(1);if(options.frequency==='MONTHLY')d.setUTCMonth(month-1+index*options.interval);else d.setUTCFullYear(year+index*options.interval);if(d.getUTCFullYear()>9999)break;d.setUTCDate(day);if(d.getUTCDate()!==day||options.frequency==='YEARLY'&&d.getUTCMonth()!==month-1)continue;date=d.toISOString().slice(0,10)}
  if(date>final||options.ending==='on'&&date>options.until)break;
  const occurrence=occurrenceForDate(master,date);if(!occurrence)continue;
  count++;if(options.ending==='after'&&count>options.count)break;
  if(!Object.prototype.hasOwnProperty.call(exceptions,date)){add(occurrence);if(firstOnly&&overlaps(occurrence))break}
 }
 result.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));return firstOnly?result.slice(0,1):result;
}
export function expandNativeEvents(masters:NativeEvent[],from:string,to:string):NativeEvent[]{
 const events=masters.flatMap(e=>expandNativeEvent(e,from,to));if(events.length>10000)throw Error('Too many events. Choose a smaller date range.');return events.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
}
