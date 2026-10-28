import {nativeInstant,localDate,occurrenceForDate,type NativeEvent} from './native.ts';
import {validateRecurrence} from './recurrence.ts';
import {encodePersonIds,decodePersonIds} from './tags.ts';
import {readReminder} from './reminders.ts';
import {calendarReminders} from '../event-reminders/logic.ts';

export class CopyError extends Error{
 constructor(public code:'reconnect'|'retry'|'needs_attention'|'missing'|'conflict'|'budget'){super(code)}
}
type RequestGoogle=(path:string,method?:string,body?:unknown)=>Promise<any>;
const iso=(value:string)=>new Date(value).toISOString();
export function copyShape(e:NativeEvent){return {starts_at:iso(e.starts_at),ends_at:iso(e.ends_at),all_day:e.all_day,start_date:e.start_date,end_date:e.end_date,recurrence:e.recurrence||[]}}
export function googleCopy(e:NativeEvent){
 return {summary:e.title,description:e.description,location:e.location,status:'confirmed',
  start:e.all_day?{date:e.start_date}:{dateTime:iso(e.starts_at),timeZone:'America/Toronto'},
  end:e.all_day?{date:e.end_date}:{dateTime:iso(e.ends_at),timeZone:'America/Toronto'},
  recurrence:e.recurrence||[],extendedProperties:{shared:{hummel_person:e.person,hummel_people:e.person_ids==null?'':encodePersonIds(e.person_ids),
   hummel_reminder:e.reminder_minutes==null?'':String(e.reminder_minutes),hummel_reminder_30:e.reminder_30_enabled===false?'off':'on',hh_source:'native',hh_event_id:e.series_id||e.id}}};
}
function date(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new CopyError('needs_attention');
 return value;
}
function importRule(rules:unknown,start:string,allDay:boolean){
 if(rules==null||Array.isArray(rules)&&!rules.length)return [];
 if(!Array.isArray(rules)||rules.length!==1||typeof rules[0]!=='string'||!rules[0].startsWith('RRULE:'))throw new CopyError('needs_attention');
 const pairs=rules[0].slice(6).split(';').map((part:string)=>part.split('='));
 if(pairs.some((p:string[])=>p.length!==2)||new Set(pairs.map((p:string[])=>p[0])).size!==pairs.length)throw new CopyError('needs_attention');
 const p=Object.fromEntries(pairs),day=new Date(start+'T12:00:00Z').getUTCDay(),weekdays=['SU','MO','TU','WE','TH','FR','SA'];
 if(p.BYDAY){if(p.FREQ!=='WEEKLY'||p.BYDAY!==weekdays[day])throw new CopyError('needs_attention');delete p.BYDAY}
 if(p.BYMONTHDAY){if(!['MONTHLY','YEARLY'].includes(p.FREQ)||Number(p.BYMONTHDAY)!==Number(start.slice(8)))throw new CopyError('needs_attention');delete p.BYMONTHDAY}
 if(p.BYMONTH){if(p.FREQ!=='YEARLY'||Number(p.BYMONTH)!==Number(start.slice(5,7)))throw new CopyError('needs_attention');delete p.BYMONTH}
 delete p.WKST;
 if(Object.keys(p).some(k=>!['FREQ','INTERVAL','COUNT','UNTIL'].includes(k))||p.COUNT&&p.UNTIL)throw new CopyError('needs_attention');
 const rule='RRULE:FREQ='+p.FREQ+';INTERVAL='+(p.INTERVAL||'1')+(p.COUNT?';COUNT='+p.COUNT:p.UNTIL?';UNTIL='+p.UNTIL:'');
 try{return validateRecurrence([rule],start,allDay)||[]}catch{throw new CopyError('needs_attention')}
}
function nativeFields(e:any,fallback?:NativeEvent){
 const all_day=!!e.start?.date,shared=e.extendedProperties?.shared||{};
 const start_date=all_day?date(e.start.date):null,end_date=all_day?date(e.end?.date):null;
 const starts_at=all_day?nativeInstant(start_date!,'00:00'):iso(e.start?.dateTime),ends_at=all_day?nativeInstant(end_date!,'00:00'):iso(e.end?.dateTime);
 if(!starts_at||!ends_at||Date.parse(ends_at)<=Date.parse(starts_at))throw new CopyError('needs_attention');
 const person_ids=shared.hummel_people===undefined?fallback?.person_ids:decodePersonIds(shared.hummel_people);
  const value={title:e.summary===''?'(Untitled event)':e.summary??fallback?.title??'(Untitled event)',description:e.description??fallback?.description??'',location:e.location??fallback?.location??'',
  person:shared.hummel_person??fallback?.person??'Everyone',person_ids:person_ids??null,
  reminder_minutes:shared.hummel_reminder===undefined?fallback?.reminder_minutes??null:readReminder(shared.hummel_reminder),
  reminder_30_enabled:shared.hummel_reminder_30===undefined?fallback?.reminder_30_enabled??true:shared.hummel_reminder_30!=='off',
  starts_at,ends_at,all_day,start_date,end_date};
 if(typeof value.title!=='string'||!value.title||value.title.length>160||typeof value.description!=='string'||value.description.length>4000||typeof value.location!=='string'||value.location.length>300||typeof value.person!=='string'||!value.person||value.person.length>60)throw new CopyError('needs_attention');
 return value;
}
async function importId(hid:string,gid:string,baseline:Record<string,number>){
 const match=/^home([a-f0-9]{32})$/.exec(gid);
 if(match){const h=match[1],id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;if(baseline[id]!==undefined)return id}
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('hh-google-transfer:'+hid+':'+gid)));
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const h=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
// No partial transfer: normalize every series and exception before committing.
// Unsupported provider data leaves the existing Google source active, with a
// private exact snapshot retained for support/recovery.
export async function prepareGoogleTransfer(hid:string,items:any[],baseline:Record<string,number>){
 const records=new Map<string,{googleId:string;event:NativeEvent;shape:unknown}>();
 for(const e of items){
  if(e.status==='cancelled'||e.recurringEventId)continue;
  if(typeof e.id!=='string'||e.id.length>1200)throw new CopyError('needs_attention');
  const fields=nativeFields(e);
  if(e.recurrence?.length&&e.start?.timeZone&&!['America/Toronto','America/New_York','Canada/Eastern'].includes(e.start.timeZone))throw new CopyError('needs_attention');
  const event:NativeEvent={...fields,id:await importId(hid,e.id,baseline),recurrence:importRule(e.recurrence,fields.all_day?fields.start_date!:localDate(fields.starts_at),fields.all_day),exceptions:{}};
  records.set(e.id,{googleId:e.id,event,shape:copyShape(event)});
 }
 for(const e of items.filter(e=>e.recurringEventId)){
  const record=records.get(e.recurringEventId);
  if(!record){if(items.some(master=>master.id===e.recurringEventId&&master.status==='cancelled'))continue;throw new CopyError('needs_attention')}
  const original=e.originalStartTime?.date?date(e.originalStartTime.date):e.originalStartTime?.dateTime?localDate(iso(e.originalStartTime.dateTime)):null;
  if(!original||!record.event.recurrence?.length)throw new CopyError('needs_attention');
  record.event.exceptions![original]=e.status==='cancelled'?null:nativeFields(e,record.event);
 }
 const ids=new Set(Array.from(records.values(),r=>r.event.id));
 return {events:Array.from(records.values()),deleted:Object.keys(baseline).filter(id=>!ids.has(id))};
}
export function transferReminderAliases(records:{googleId:string;event:NativeEvent}[],expanded:any[]){
 const aliases=[];
 for(const e of expanded){
  if(e.status==='cancelled')continue;
  const record=records.find(r=>r.googleId===(e.recurringEventId||e.id));if(!record)continue;
  const all_day=!!e.start?.date,start=all_day?e.start.date:e.start?.dateTime,shared=e.extendedProperties?.shared||{};
  if(!start)throw new CopyError('needs_attention');
  const original=e.recurringEventId?(e.originalStartTime?.date||localDate(iso(e.originalStartTime?.dateTime))):null;
  for(const reminder of calendarReminders([{id:e.id,title:'',starts_at:e.start?.dateTime||'',all_day,start_date:all_day?e.start.date:null,
   reminder_minutes:readReminder(shared.hummel_reminder),reminder_30_enabled:shared.hummel_reminder_30!=='off'}])){
   aliases.push({eventId:record.event.id,occurrenceDate:original,allDay:all_day,nativeStart:all_day?null:iso(start),startDate:all_day?start:null,
    minutes:reminder.reminder_minutes,googleKey:`${e.id}:${start}:${reminder.reminder_minutes}`});
  }
 }
 return aliases;
}

export async function runCalendarCopy(admin:any,hid:string,config:{clientId:string;clientSecret:string},fetcher:typeof fetch=fetch){
 const service=async(action:string,extra:Record<string,unknown>={})=>{
  const r=await admin.rpc('calendar_copy_service',{action,payload:{householdId:hid,...extra}});
  if(r.error)throw new CopyError('retry');return r.data;
 };
 const claim=await service('claim');if(!claim)return {busy:true};
 const lease=claim.lease,deadline=Date.now()+20000;let requests=0,problem:string|null=null,completed=0,transferred=false;
 const rpc=(action:string,extra:Record<string,unknown>={})=>service(action,{lease,...extra});
 const budget=()=>{if(Date.now()>deadline||requests>=24)throw new CopyError('budget')};
 try{
  if(claim.nativeReady&&!claim.work.length)return {completed:0};
  const c=await admin.rpc('calendar_service',{action:'connection_get',payload:{householdId:hid}});
  const connection=c.data;if(c.error||!connection?.refreshToken||!config.clientId||!config.clientSecret)throw new CopyError('reconnect');
  budget();requests++;
  const token=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:connection.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(8000)});
  const credentials=await token.json();
  if(!token.ok||!credentials.access_token)throw new CopyError(token.status>=500?'retry':'reconnect');
  const request:RequestGoogle=async(path,method='GET',body)=>{
   budget();requests++;
   const url=new URL('https://www.googleapis.com/calendar/v3/'+path);
   if(method!=='GET')url.searchParams.set('sendUpdates','none');
   const response=await fetcher(url.toString(),{method,headers:{Authorization:'Bearer '+credentials.access_token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
   if(response.status===204)return null;
   const value=await response.json();
   if(!response.ok){if([401,403].includes(response.status))throw new CopyError('reconnect');if([404,410].includes(response.status))throw new CopyError('missing');if(response.status===409)throw new CopyError('conflict');throw new CopyError(response.status===400?'needs_attention':'retry')}
   return value;
  };
  const base='calendars/'+encodeURIComponent(connection.calendarId)+'/events';
  if(!claim.nativeReady){
   const snapshot=async()=>{
    const events:any[]=[];let page='';
    do{const q=new URLSearchParams({showDeleted:'true',singleEvents:'false',maxResults:'1000',...(page?{pageToken:page}:{})});
     const result=await request(base+'?'+q);events.push(...(result.items||[]));page=result.nextPageToken||'';
     if(events.length>1000)throw new CopyError('needs_attention');
    }while(page);return events;
   };
   const original=await snapshot(),archived=await rpc('archive',{events:original});
   let incoming;
   try{incoming=await prepareGoogleTransfer(hid,original,claim.baseline||{})}catch(e){throw e instanceof CopyError?e:new CopyError('needs_attention')}
   const upcoming:any[]=[];let page='';
   do{
    const q=new URLSearchParams({singleEvents:'true',showDeleted:'false',timeMin:new Date(Date.now()-86400000).toISOString(),timeMax:new Date(Date.now()+8*86400000).toISOString(),maxResults:'1000',...(page?{pageToken:page}:{})});
    const result=await request(base+'?'+q);upcoming.push(...(result.items||[]));page=result.nextPageToken||'';
    if(upcoming.length>2000)throw new CopyError('needs_attention');
   }while(page);
   const deliveryAliases=transferReminderAliases(incoming.events,upcoming);
   // A second complete read detects edits while the preservation pass ran.
   const verified=await snapshot(),fingerprint=(events:any[])=>JSON.stringify(events.map(e=>[e.id,e.etag||JSON.stringify(e)]).sort((a,b)=>a[0].localeCompare(b[0])));
   if(fingerprint(original)!==fingerprint(verified))throw new CopyError('retry');
   budget();await rpc('import',{...incoming,deliveryAliases,snapshotHash:archived.snapshotHash});
   transferred=true;return {transferred:true,imported:incoming.events.length};
  }
  for(const job of claim.work){
   const args={eventId:job.eventId,revision:job.revision};let rotate=false;
   try{
    budget();const event:NativeEvent|null=job.event,dates=event?Object.keys(event.exceptions||{}):[];
    let link=await rpc('prepare',{...args,shape:event?copyShape(event):null,dates});if(!link)continue;
    const remove=async(gid:string)=>{try{await request(base+'/'+encodeURIComponent(gid),'DELETE')}catch(e){if(!(e instanceof CopyError)||e.code!=='missing')throw e}};
    for(const gid of link.retired_ids||[]){await remove(gid);await rpc('retired_done',{...args,googleId:gid})}
    if(!event){await remove(link.google_id);await rpc('event_done',{...args,deleted:true});completed++;continue}
    if(!link.base_done){
     let existing;
     try{existing=await request(base+'/'+encodeURIComponent(link.google_id));if(existing.status==='cancelled')rotate=true}
     catch(e){if(!(e instanceof CopyError)||e.code!=='missing')throw e;if(link.synced_version!=null)rotate=true}
     if(rotate){link=await rpc('prepare',{...args,shape:copyShape(event),dates,rotate:true});if(!link)continue;
      for(const gid of link.retired_ids||[]){await remove(gid);await rpc('retired_done',{...args,googleId:gid})}existing=null}
     const body=googleCopy(event);
     try{
      if(existing)await request(base+'/'+encodeURIComponent(link.google_id),'PATCH',{...body,extendedProperties:{...existing.extendedProperties,shared:{...existing.extendedProperties?.shared,...body.extendedProperties.shared}}});
      else await request(base,'POST',{...body,id:link.google_id});
     }catch(e){
      if(e instanceof CopyError&&e.code==='conflict'){
       // A cancelled provider ID cannot be re-used. Allocate once in Postgres;
       // retries then use that same replacement ID instead of duplicating it.
       await rpc('prepare',{...args,shape:copyShape(event),dates,rotate:true});throw new CopyError('retry');
      }throw e;
     }
     await rpc('base_done',args);
    }
    for(const day of link.pending_dates||[]){
     budget();
     if(event.recurrence?.length){
      const original=occurrenceForDate(event,day);if(!original)throw new CopyError('needs_attention');
      const q=new URLSearchParams({originalStart:event.all_day?day:original.starts_at,showDeleted:'true',maxResults:'250',timeZone:'America/Toronto'});
      const result=await request(base+'/'+encodeURIComponent(link.google_id)+'/instances?'+q);
      const instance=result.items?.find((e:any)=>event.all_day?e.originalStartTime?.date===day:Date.parse(e.originalStartTime?.dateTime)===Date.parse(original.starts_at));
      if(instance){
       const change=event.exceptions?.[day];
       if(change===null){if(instance.status!=='cancelled')await remove(instance.id)}
       else {const body=googleCopy({...original,...(change||{}),recurrence:[]});delete (body as any).recurrence;
        await request(base+'/'+encodeURIComponent(instance.id),'PATCH',{...body,extendedProperties:{...instance.extendedProperties,shared:{...instance.extendedProperties?.shared,...body.extendedProperties.shared}}})}
      }else if(event.exceptions?.[day]!==undefined)throw new CopyError('needs_attention');
     }
     await rpc('date_done',{...args,date:day});
    }
    await rpc('event_done',{...args,version:event.version,dates});completed++;
   }catch(e){
    const code=e instanceof CopyError?e.code:'retry';
    if(code==='budget')break;
    if(code==='reconnect')throw e;
    if(code==='missing')await rpc('prepare',{...args,shape:job.event?copyShape(job.event):null,dates:Object.keys(job.event?.exceptions||{}),rotate:true});
    await rpc('event_failed',{...args,error:code==='needs_attention'?'needs_attention':'retry'});
   }
  }
  return {completed};
 }catch(e){problem=e instanceof CopyError&&['reconnect','needs_attention'].includes(e.code)?e.code:'retry';return {completed,error:problem,transferred}}
 finally{await rpc('finish',{error:problem})}
}
