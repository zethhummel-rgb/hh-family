import {supabase} from './supabase';
import {authenticatedCalendarRequest} from './calendarAuth';
export type FamilyEvent={id:string;title:string;description:string;location:string;person:string;person_ids?:string[]|null;reminder_minutes?:number|null;starts_at:string;ends_at:string;all_day:boolean;start_date:string|null;end_date:string|null;version?:number;etag?:string;source:'home'|'google';recurring?:boolean;series_id?:string|null;recurrence?:string[]};
export type EventDraft=Omit<FamilyEvent,'id'|'source'|'version'|'etag'|'recurring'|'series_id'>;
export type CalendarConnection={configured:boolean;connected:boolean;calendarName?:string;setupRequired?:boolean;importIncomplete?:boolean};
export function eventRequestId(){const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export const TIME_ZONE='America/Toronto';
export function dayKey(date:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
export function dateObj(key:string){return new Date(key+'T12:00:00')}
export function shiftDay(key:string,delta:number){const d=dateObj(key);d.setDate(d.getDate()+delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function zonedISO(date:string,time='00:00'){
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);const target=Date.UTC(y,m-1,d,h,min);let guess=target;
 for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(guess);const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);guess+=target-represented}
 const result=new Date(guess);const actual=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(result);if(dayKey(result)!==date||actual!==time)throw Error('That time does not exist because the clocks change. Choose another time.');return result.toISOString();
}
export function halfHourAfter(date:string,time:string){
 if(!/^\d{2}:\d{2}$/.test(time))return null;
 const [hour,minute]=time.split(':').map(Number);if(hour>23||minute>59)return null;
 const total=hour*60+minute+30;return {date:total>=1440?shiftDay(date,1):date,time:`${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`};
}
export function eventDate(e:FamilyEvent){return e.all_day?e.start_date!:dayKey(new Date(e.starts_at))}
export function eventEndDate(e:FamilyEvent){return e.all_day?shiftDay(e.end_date!,-1):dayKey(new Date(new Date(e.ends_at).getTime()-1))}
export function timePart(value:string){return new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))}
export function eventTime(e:FamilyEvent){return e.all_day?'All day':new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date(e.starts_at))}
export function eventDateLabel(e:FamilyEvent){
 const format=(date:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
 const start=eventDate(e),end=eventEndDate(e);return start===end?format(start):format(start)+' – '+format(end);
}
export async function googleRequest(action:string,payload:Record<string,unknown>={}){
 const r=await authenticatedCalendarRequest(supabase,{action,...payload});
 if(r.error){let message=r.error.message;try{const json=await r.error.context?.json();message=json?.error||message}catch{}throw Error(message)}
 if(r.data?.error)throw Error(r.data.error);return r.data;
}
export async function calendarStatus(householdId:string):Promise<CalendarConnection>{return googleRequest('status',{householdId})}
export async function getEvents(hid:string,from:string,to:string,connected:boolean):Promise<FamilyEvent[]>{
 if(connected){const d=await googleRequest('events',{householdId:hid,from,to});return d.events}
 const r=await supabase.from('household_events').select('*').eq('household_id',hid).lt('starts_at',to).gt('ends_at',from).order('starts_at');if(r.error)throw r.error;return r.data.map(e=>({...e,source:'home' as const}));
}
export async function saveEvent(hid:string,draft:EventDraft,current:FamilyEvent|null,connected:boolean,requestId:string){
 if(connected){return googleRequest(current?'update':'create',{householdId:hid,event:draft,id:current?.id,etag:current?.etag,requestId:requestId.replaceAll('-','')})}
 if(draft.recurrence?.length)throw Error('Connect Google to save repeating events.');
 const {recurrence,...nativeDraft}=draft;
 const r=current?await supabase.from('household_events').update({...nativeDraft,version:(current.version||1)+1}).eq('household_id',hid).eq('id',current.id).eq('version',current.version||1).select('id').maybeSingle():await supabase.from('household_events').insert({...nativeDraft,household_id:hid,id:requestId}).select('id').single();
 if(r.error)throw r.error;if(!r.data)throw Error('This event changed on another device. Close this form and refresh before editing again.');
}
export async function deleteEvent(hid:string,event:FamilyEvent,connected:boolean){
 if(connected)return googleRequest('delete',{householdId:hid,id:event.id,etag:event.etag});
 const r=await supabase.from('household_events').delete().eq('household_id',hid).eq('id',event.id).eq('version',event.version||1).select('id').maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error('This event changed on another device. Refresh before deleting it.');
}

export async function getEventSeries(hid:string,event:FamilyEvent):Promise<FamilyEvent>{const data=await googleRequest('series',{householdId:hid,id:event.id});return data.event}
