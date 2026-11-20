import {localDate, nativeInstant} from '../google-calendar/native.ts';
import {buildRecurrence, readRecurrence, validDate, type RepeatOptions} from '../google-calendar/recurrence.ts';
import type {EventFields} from './graph.ts';

const zone='Eastern Standard Time';
const supportedZones=[zone,'America/Toronto','America/New_York','Canada/Eastern'];
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const patterns={DAILY:'daily',WEEKLY:'weekly',MONTHLY:'absoluteMonthly',YEARLY:'absoluteYearly'} as const;
type Pattern={type:string;interval:number;daysOfWeek?:string[];firstDayOfWeek?:string;dayOfMonth?:number;month?:number};
type Range={type:string;startDate:string;recurrenceTimeZone?:string;endDate?:string;numberOfOccurrences?:number};
export type GraphRepeat={pattern:Pattern;range:Range};
export type SeriesFields=EventFields&{recurrence?:string[];exceptions?:Record<string,EventFields|null>};

const startDay=(event:EventFields)=>event.start_date??localDate(event.starts_at);
const weekday=(day:string)=>weekdays[new Date(day+'T12:00:00Z').getUTCDay()];
const monthDay=(day:string)=>Number(day.slice(8));
const month=(day:string)=>Number(day.slice(5,7));

// HH skips dates missing from the calendar. Leave such monthly/yearly
// patterns alone until their Outlook behavior is confirmed.
const supportedDate=(frequency:string,day:string)=>
 frequency==='MONTHLY'?monthDay(day)<=28:frequency!=='YEARLY'||day.slice(5)!=='02-29';

export function graphRepeat(event:SeriesFields):GraphRepeat|null {
 if(!event.recurrence?.length)return null;
 const options=readRecurrence(event.recurrence,event.all_day),day=startDay(event);
 if(!options||!supportedDate(options.frequency,day))return null;
 const {frequency,interval,ending,until,count}=options;
 const pattern:Pattern={type:patterns[frequency],interval};
 if(frequency==='WEEKLY')Object.assign(pattern,{daysOfWeek:[weekday(day)],firstDayOfWeek:'sunday'});
 if(frequency==='MONTHLY'||frequency==='YEARLY')pattern.dayOfMonth=monthDay(day);
 if(frequency==='YEARLY')pattern.month=month(day);
 const range:Range={startDate:day,recurrenceTimeZone:zone,type:'noEnd'};
 if(ending==='on')Object.assign(range,{type:'endDate',endDate:until});
 if(ending==='after')Object.assign(range,{type:'numbered',numberOfOccurrences:count});
 return {pattern,range};
}

export function outlookRule(event:EventFields,repeat:GraphRepeat|undefined,originalZone:string|undefined):string[]|null {
 const day=startDay(event),p=repeat?.pattern,r=repeat?.range;
 const frequency=(Object.keys(patterns) as RepeatOptions['frequency'][]).find(key=>patterns[key]===p?.type);
 if(!p||!r||!frequency||!supportedDate(frequency,day)||r.startDate!==day||
  !supportedZones.includes(r.recurrenceTimeZone||originalZone||''))return null;
 if(frequency==='WEEKLY'&&(p.daysOfWeek?.length!==1||p.daysOfWeek[0]!==weekday(day)))return null;
 if((frequency==='MONTHLY'||frequency==='YEARLY')&&p.dayOfMonth!==monthDay(day))return null;
 if(frequency==='YEARLY'&&p.month!==month(day))return null;
 const ending=r.type==='numbered'?'after':r.type==='endDate'?'on':r.type==='noEnd'?'never':null;
 if(!ending)return null;
 try{return buildRecurrence({frequency,interval:p.interval,ending,until:r.endDate??'',count:r.numberOfOccurrences??0},day,event.all_day)}
 catch{return null;}
}

const wallClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Toronto',dateStyle:'short',timeStyle:'medium',hourCycle:'h23'});
export function outlookWallClock(instant:string,date:string|null) {
 return {dateTime:date?date+'T00:00:00':wallClock.format(new Date(instant)).replace(' ','T'),timeZone:zone};
}

export function outlookOccurrenceDate(id:unknown):string|null {
 if(typeof id!=='string'||!id.startsWith('OID.'))return null;
 const date=id.slice(id.lastIndexOf('.')+1);
 return validDate(date)?date:null;
}

export function outlookInstanceWindow(date:string) {
 const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 return {startDateTime:nativeInstant(date,'00:00')!,endDateTime:nativeInstant(next,'00:00')!};
}
