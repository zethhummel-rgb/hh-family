import {prepareGoogleTransfer} from './copy.ts';
import {expandNativeEvent,localDate,occurrenceForDate,type NativeEvent} from './native.ts';
import {validDate} from './recurrence.ts';

export type ExternalImportEntry={sourceKey:string;googleId:string;event:NativeEvent};
export type ExternalImportPreview={entries:ExternalImportEntry[];warnings:{title:string;reason:string;kind:'skipped'|'info'}[];cancelled:number};
const easternZones=new Set(['America/Toronto','America/New_York','Canada/Eastern']);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const title=(event:any)=>typeof event?.summary==='string'&&event.summary.trim()?event.summary:'(Untitled event)';
const dateTime=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&validDate(value.slice(0,10))&&Number.isFinite(Date.parse(value));

function validateProviderFields(event:any,master=false){
 if(typeof event.summary==='string'&&event.summary!==''&&!event.summary.trim())throw Error('The event needs a title before it can be imported.');
 if(event.eventType&&event.eventType!=='default')throw Error('This Google event type is not supported.');
 if(event.start?.date){if(event.start.dateTime||!event.end?.date||event.end.dateTime)throw Error('The all-day dates could not be preserved.');}
 else if(!dateTime(event.start?.dateTime)||!dateTime(event.end?.dateTime)||event.end?.date)throw Error('The event times could not be preserved.');
 if(master&&event.recurrence?.length&&!event.start?.date){
  if(!easternZones.has(event.start?.timeZone)||event.end?.timeZone&&!easternZones.has(event.end.timeZone))throw Error('Repeating events must use Eastern time to keep their times correct in HH.');
 }
}
// Never adopt identity tags, reminder settings, or native IDs embedded in an
// external calendar. The importing member selects HH people and reminders later.
function sanitize(event:any){
 return {...event,extendedProperties:{shared:{hummel_person:'Everyone',hummel_people:'[]',hummel_reminder:'',hummel_reminder_30:'off'}}};
}
function validateOriginal(master:NativeEvent,change:any,seen:Set<string>){
 const original=change.originalStartTime;
 if(master.all_day?!original?.date||original.dateTime:!dateTime(original?.dateTime)||original.date)throw Error('A changed occurrence has an unsupported original date.');
 const day=master.all_day?original.date:localDate(original.dateTime);
 if(seen.has(day))throw Error('More than one changed occurrence uses the same original date.');
 seen.add(day);
 const occurrence=occurrenceForDate(master,day);
 if(!occurrence||!master.all_day&&Date.parse(occurrence.starts_at)!==Date.parse(original.dateTime))throw Error('A changed occurrence cannot be matched safely to its series.');
 const clean={...master,exceptions:{}};
 const active=expandNativeEvent(clean,occurrence.starts_at,new Date(Date.parse(occurrence.starts_at)+1).toISOString());
 if(!active.some(e=>e.original_date===day))throw Error('A changed occurrence falls outside its repeat pattern.');
}
function validateUntil(event:any,converted:NativeEvent){
 if(converted.all_day||!event.recurrence?.length)return;
 const match=/(?:^|;)UNTIL=(\d{8}T\d{6}Z)(?:;|$)/.exec(event.recurrence[0].slice(6));
 if(!match)return;
 const u=match[1],instant=`${u.slice(0,4)}-${u.slice(4,6)}-${u.slice(6,8)}T${u.slice(9,11)}:${u.slice(11,13)}:${u.slice(13,15)}Z`;
 const day=localDate(instant),last=occurrenceForDate(converted,day);
 // HH stores an inclusive ending day. Reject a provider ending halfway through
 // that day if normalization would accidentally include one additional event.
 if(last&&Date.parse(last.starts_at)>Date.parse(instant)){
  const matches=expandNativeEvent({...converted,exceptions:{}},last.starts_at,new Date(Date.parse(last.starts_at)+1).toISOString());
  if(matches.length)throw Error('This repeat ending needs adjustment before it can be copied safely.');
 }
}

export async function prepareExternalImport(raw:any[],calendarId:string):Promise<ExternalImportPreview>{
 if(!Array.isArray(raw)||raw.length>2000||typeof calendarId!=='string'||!calendarId||calendarId.length>1024||calendarId.includes('\0'))throw Error('This calendar is too large or could not be read safely.');
 const result:ExternalImportPreview={entries:[],warnings:[],cancelled:0},ids=new Map<string,any>(),duplicates=new Set<string>();
 for(const event of raw){
  if(!event||typeof event!=='object'||typeof event.id!=='string'||!event.id||event.id.length>1200||event.id.includes('\0'))throw Error('Google returned an invalid event identity.');
  if(ids.has(event.id))duplicates.add(event.id);else ids.set(event.id,event);
  if(event.status==='cancelled')result.cancelled++;
 }
 const changes=new Map<string,any[]>();
 for(const event of raw)if(event.recurringEventId){
  if(typeof event.recurringEventId!=='string')throw Error('Google returned an invalid series identity.');
  const group=changes.get(event.recurringEventId)||[];group.push(event);changes.set(event.recurringEventId,group);
 }
 let remindersOmitted=false;
 for(const master of ids.values()){
  if(master.recurringEventId)continue;
  if(master.status==='cancelled'){
   if(duplicates.has(master.id))result.warnings.push({title:title(master),reason:'Not imported: Google returned duplicate event identities. Please try again.',kind:'skipped'});
   continue;
  }
  const group=[master,...(changes.get(master.id)||[])];
  try{
   if(group.some(e=>duplicates.has(e.id)))throw Error('Google returned duplicate event identities. Please try again.');
   validateProviderFields(master,true);
   for(const change of group.slice(1))if(change.status!=='cancelled'){
    validateProviderFields(change);if(change.recurrence?.length)throw Error('A changed occurrence has its own repeat pattern.');
   }
   const prepared=await prepareGoogleTransfer(calendarId,group.map(sanitize),{});
   if(prepared.events.length!==1)throw Error('The event could not be copied safely.');
   const event=prepared.events[0].event;
   if(event.recurrence?.length){
    const first=occurrenceForDate(event,event.all_day?event.start_date!:localDate(event.starts_at));
    if(!first||Date.parse(first.starts_at)!==Date.parse(event.starts_at)||Date.parse(first.ends_at)!==Date.parse(event.ends_at))throw Error('This repeating event starts during an ambiguous clock change and cannot be copied safely.');
   }
   validateUntil(master,event);
   const seen=new Set<string>();for(const change of group.slice(1))validateOriginal(event,change,seen);
   const sourceKey=await digest(calendarId+'\0'+master.id),h=sourceKey.slice(0,12)+'5'+sourceKey.slice(13,16)+(8+(parseInt(sourceKey[16],16)&3)).toString(16)+sourceKey.slice(17,32);
   event.id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
   result.entries.push({sourceKey,googleId:master.id,event});
   if(group.some(e=>e.reminders?.useDefault||e.reminders?.overrides?.length))remindersOmitted=true;
  }catch(error){
   const reason=error instanceof Error&&error.message!=='needs_attention'?error.message:'This event has dates, details, or a repeat pattern that HH cannot preserve yet.';
   result.warnings.push({title:title(master),reason:'Not imported: '+reason,kind:'skipped'});
  }
 }
 for(const [id,group]of changes)if(!ids.has(id))result.warnings.push({title:title(group.find(e=>e.status!=='cancelled')||group[0]),reason:'Not imported: the original repeating series was missing from Google’s response.',kind:'skipped'});
 if(remindersOmitted)result.warnings.push({title:'Notification settings',reason:'Google notification preferences are not copied. Choose HH’s 30-minute reminder when importing; extra reminders can be added afterward.',kind:'info'});
 return result;
}
