import {readRecurrence} from './recurrence.ts';

// One shared expansion engine for HH views, search, Google import and push delivery.
const zone='America/Toronto';
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const partsFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export type NativeEvent={id:string;title:string;description:string;location:string;person:string;person_ids?:string[]|null;reminder_minutes?:number|null;reminder_30_enabled?:boolean;starts_at:string;ends_at:string;all_day:boolean;start_date:string|null;end_date:string|null;version?:number;recurrence?:string[];exceptions?:Record<string,Partial<NativeEvent>|null>;source?:'home'|'google';series_id?:string|null;original_date?:string;recurring?:boolean};
export const localDate=(iso:string)=>dateFormat.format(new Date(iso));
function shift(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function localParts(iso:string){return Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map(p=>[p.type,p.value]))}
export function nativeInstant(date:string,time:string,offsetHint=0){
 const [y,m,d]=date.split('-').map(Number),[h,min,s]=time.split(':').map(Number),target=Date.UTC(y,m-1,d,h,min,s||0);let guess=target;
 // Keep the original first-occurrence choice around overnight DST transitions.
 guess+=h<3?0:offsetHint;
 for(let i=0;i<4;i++){
  const result=new Date(guess).toISOString(),p=localParts(result);
  const delta=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  if(!delta)return result;
  guess+=delta;
 }
 // Skip nonexistent wall times at spring-forward, following recurrence semantics.
 return null;
}
function occurrenceContext(master:NativeEvent){
 const first=master.all_day?master.start_date!:localDate(master.starts_at);
 const p=localParts(master.starts_at),time=`${p.hour}:${p.minute}:${p.second}`;
 const offset=Date.parse(master.starts_at)-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
 return {first,time:master.all_day?'00:00':time,offset,duration:Date.parse(master.ends_at)-Date.parse(master.starts_at)};
}
function occurrence(master:NativeEvent,date:string,context:ReturnType<typeof occurrenceContext>,start?:string):NativeEvent|null{
 const starts_at=start??nativeInstant(date,context.time,context.offset);if(!starts_at)return null;
 const days=Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(context.first+'T12:00:00Z'))/86400000);
 const end_date=master.all_day?shift(master.end_date!,days):null;
 const ends_at=master.all_day?nativeInstant(end_date!,'00:00',context.offset)!:new Date(Date.parse(starts_at)+context.duration).toISOString();
 return {...master,exceptions:undefined,recurrence:undefined,id:master.id+'@'+date,series_id:master.id,original_date:date,recurring:true,source:'home',starts_at,ends_at,start_date:master.all_day?date:null,end_date};
}
export function occurrenceForDate(master:NativeEvent,date:string):NativeEvent|null{return occurrence(master,date,occurrenceContext(master))}
// Only calendar/time arithmetic is cached, never event content, people or household identifiers.
const countedPrefixes=new Map<string,{index:number;count:number}>();
export function expandNativeEvent(master:NativeEvent,from:string,to:string,limit=2000,firstOnly=false,work?:()=>void):NativeEvent[]{
 let steps=0;const tick=()=>{if(++steps>100000)throw Error('Calendar repeat work limit reached. Choose a smaller date range.');work?.()};
 tick();
 const low=Date.parse(from),high=Date.parse(to),overlaps=(e:NativeEvent)=>Date.parse(e.starts_at)<high&&Date.parse(e.ends_at)>low;
 if(!master.recurrence?.length)return overlaps(master)?[{...master,source:'home'}]:[];
 const options=readRecurrence(master.recurrence,master.all_day);if(!options)throw Error('This event has an unsupported repeat pattern.');
 const context=occurrenceContext(master),first=context.first,[year,month,day]=first.split('-').map(Number);
 const result:NativeEvent[]=[],exceptions=master.exceptions||{};let count=0;
 const add=(e:NativeEvent)=>{if(overlaps(e)){if(firstOnly){if(!result.length||e.starts_at<result[0].starts_at||e.starts_at===result[0].starts_at&&e.id<result[0].id)result[0]=e}else{result.push(e);if(result.length>limit)throw Error('Too many repeating events. Choose a smaller date range.')}}};
 // Retain moved instances even when their original date is outside this view.
 for(const date in exceptions){if(!Object.prototype.hasOwnProperty.call(exceptions,date))continue;tick();const change=exceptions[date];if(change){if(change.starts_at&&change.ends_at&&!overlaps(change as NativeEvent))continue;const original=occurrence(master,date,context);if(original)add({...original,...change,id:original.id,series_id:master.id,original_date:date,recurring:true,source:'home',recurrence:undefined,exceptions:undefined})}}
 const final=localDate(new Date(high).toISOString());
 const earliest=localDate(new Date(low-context.duration-86400000).toISOString());
 let firstIndex=0;
 if(options.frequency==='DAILY'||options.frequency==='WEEKLY')firstIndex=Math.max(0,Math.floor((Date.parse(earliest+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000/(options.interval*(options.frequency==='WEEKLY'?7:1))));
 else {const [ey,em]=earliest.split('-').map(Number);firstIndex=Math.max(0,Math.floor((options.frequency==='MONTHLY'?(ey-year)*12+em-month:ey-year)/options.interval)-1)}
 function dateAt(index:number):string|null|undefined{
  if(options!.frequency==='DAILY'||options!.frequency==='WEEKLY')return shift(first,index*options!.interval*(options!.frequency==='WEEKLY'?7:1));
  const d=new Date(first+'T12:00:00Z');d.setUTCDate(1);if(options!.frequency==='MONTHLY')d.setUTCMonth(month-1+index*options!.interval);else d.setUTCFullYear(year+index*options!.interval);
  if(d.getUTCFullYear()>9999)return undefined;
  d.setUTCDate(day);if(d.getUTCDate()!==day||options!.frequency==='YEARLY'&&d.getUTCMonth()!==month-1)return null;
  return d.toISOString().slice(0,10);
 }
 if(options.ending==='after'&&firstIndex>0){
  const key=JSON.stringify([first,context.time,options.frequency,options.interval,options.count]);
  const saved=countedPrefixes.get(key);let index=saved&&saved.index<=firstIndex?saved.index:0;count=index?saved!.count:0;
  // Count skipped history without constructing events or converting their end times.
  for(;index<firstIndex&&count<options.count;index++){tick();const date=dateAt(index);if(date===undefined)break;if(date&&nativeInstant(date,context.time,context.offset))count++}
  countedPrefixes.delete(key);countedPrefixes.set(key,{index,count});if(countedPrefixes.size>128)countedPrefixes.delete(countedPrefixes.keys().next().value!);
 }
 // Direct date stepping avoids day-by-day scans for monthly/yearly intervals.
 for(let index=firstIndex;index<3700000&&(options.ending!=='after'||count<options.count);index++){
  tick();const date=dateAt(index);if(date===undefined)break;if(!date)continue;
  if(date>final||options.ending==='on'&&date>options.until)break;
  const start=nativeInstant(date,context.time,context.offset);if(!start)continue;
  count++;
  if(!Object.prototype.hasOwnProperty.call(exceptions,date)){const item=occurrence(master,date,context,start)!;add(item);if(firstOnly&&overlaps(item))break}
 }
 result.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));return firstOnly?result.slice(0,1):result;
}
export function expandNativeEvents(masters:NativeEvent[],from:string,to:string,work?:()=>void):NativeEvent[]{
 const events:NativeEvent[]=[];
 for(const master of masters){events.push(...expandNativeEvent(master,from,to,2000,false,work));if(events.length>10000)throw Error('Too many events. Choose a smaller date range.')}
 return events.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
}
