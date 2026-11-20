import {nativeInstant,type NativeEvent} from '../google-calendar/native.ts';

const graphOrigin='https://graph.microsoft.com';
const selectedFields='id,subject,body,location,start,end,isAllDay,type,isCancelled,changeKey,sensitivity,isOrganizer,attendees,transactionId,isOnlineMeeting,hasAttachments';
const eventQuery=new URLSearchParams({'$select':selectedFields}).toString();
const maxEvents=500;

export type OutlookEvent={
 id:string;subject?:string;body?:{contentType:string;content:string};location?:{displayName?:string};
 start?:{dateTime:string;timeZone:string};end?:{dateTime:string;timeZone:string};isAllDay?:boolean;
 type?:string;isCancelled?:boolean;sensitivity?:string;isOrganizer?:boolean;attendees?:unknown[];
 changeKey?:string;transactionId?:string;isOnlineMeeting?:boolean;hasAttachments?:boolean;'@odata.etag'?:string;
};
export type EventFields=Pick<NativeEvent,'title'|'description'|'location'|'starts_at'|'ends_at'|'all_day'|'start_date'|'end_date'>;
export type CalendarChoice={id:string;name:string};

export class OutlookProblem extends Error {
 readonly issue:'retry'|'reconnect'|'review';
 constructor(issue:OutlookProblem['issue'],message:string){super(message);this.issue=issue}
}

export function graphId(id:unknown):id is string {
 return typeof id==='string'&&/^[A-Za-z0-9!_+=@.:-]{1,1000}$/.test(id)&&id!=='.'&&id!=='..';
}
function segment(id:string) {
 if(!graphId(id))throw new OutlookProblem('review','Microsoft returned an invalid calendar identifier.');
 return encodeURIComponent(id);
}

export function createGraph(accessToken:string,expiresAt:number,request=fetch) {
 async function get<T>(path:string,method='GET',body?:unknown,etag?:string):Promise<T|null> {
  const remaining=expiresAt-Date.now();
  if(remaining<1000)throw new OutlookProblem('retry','Outlook sync ran out of time and will resume.');
  const response=await request(graphOrigin+path,{
   method,redirect:'error',signal:AbortSignal.timeout(Math.min(8000,remaining)),
   headers:{
    Authorization:'Bearer '+accessToken,'Content-Type':'application/json',
    Prefer:'IdType="ImmutableId", outlook.timezone="UTC", outlook.body-content-type="text"',
    ...(etag?{'If-Match':etag}:{})
   },
   body:body===undefined?undefined:JSON.stringify(body)
  });
  if(response.status===404)return null;
  if(response.status===401||response.status===403)throw new OutlookProblem('reconnect','Reconnect Outlook to restore calendar access.');
  if(response.status===412||response.status===409)throw new OutlookProblem('retry','Outlook changed during sync. Try again.');
  if(!response.ok)throw new OutlookProblem('retry','Microsoft Outlook could not finish syncing.');
  return response.status===204?true as T:await response.json() as T;
 }

 async function list<T>(path:string,query:URLSearchParams,limit:number):Promise<T[]> {
  const result:T[]=[];
  let next=path+'?'+query.toString();
  const visited=new Set<string>();
  while(next) {
   if(visited.has(next)||visited.size>=12)throw new OutlookProblem('review','This calendar is too large for the trial.');
   visited.add(next);
   const page=await get<{value:T[];'@odata.nextLink'?:string}>(next);
   if(!Array.isArray(page?.value))throw new OutlookProblem('retry','The selected Outlook calendar could not be read.');
   result.push(...page.value);
   if(result.length>limit)throw new OutlookProblem('review','This calendar is too large for the trial.');
   const continuation=page['@odata.nextLink'];
   next='';
   if(continuation) {
    const url=new URL(continuation);
    if(url.origin!==graphOrigin||decodeURIComponent(url.pathname)!==decodeURIComponent(path)||url.username||url.password||url.hash)
     throw new OutlookProblem('retry','Microsoft returned an invalid calendar page.');
    next=path+url.search;
   }
  }
  return result;
 }

 const base=(calendar:string)=>'/v1.0/me/calendars/'+segment(calendar);
 const eventPath=(calendar:string,id:string)=>base(calendar)+'/events/'+segment(id);
 const calendarPath='/v1.0/me/calendars';
 async function calendarOptions() {
  const calendars=await list<CalendarChoice&{canEdit:boolean}>(calendarPath,new URLSearchParams({'$select':'id,name,canEdit','$top':'100'}),100);
  return calendars.filter(c=>graphId(c.id)&&typeof c.name==='string'&&c.name.trim());
 }
 return {
  identity:()=>get<{id:string;mail?:string;userPrincipalName?:string}>('/v1.0/me?$select=id,mail,userPrincipalName'),
  calendars:async()=>(await calendarOptions()).filter(c=>c.canEdit===true).map(c=>({id:c.id,name:c.name.slice(0,200)})),
  familyCalendar:async()=>{
   const existing=(await calendarOptions()).filter(c=>c.name.trim().toLowerCase()==='hh family');
   if(existing.length>1)throw new OutlookProblem('review','More than one Outlook calendar is named HH Family. Choose the one you want from the list.');
   if(existing.length===1&&existing[0].canEdit!==true)
    throw new OutlookProblem('review','An HH Family calendar already exists. Choose an Outlook calendar you can edit.');
   const calendar=existing[0]??await get<CalendarChoice&{canEdit:boolean}>(calendarPath,'POST',{name:'HH Family'});
   if(!calendar||!graphId(calendar.id)||calendar.canEdit!==true||calendar.name.trim().toLowerCase()!=='hh family')
    throw new OutlookProblem('retry','Outlook could not confirm the HH Family calendar.');
   return {id:calendar.id,name:'HH Family'};
  },
  calendar:(calendar:string)=>get<{id:string;canEdit:boolean}>(base(calendar)+'?$select=id,canEdit'),
  events:(calendar:string)=>list<OutlookEvent>(base(calendar)+'/events',new URLSearchParams({'$select':selectedFields,'$top':'100'}),maxEvents),
  // Lookup across the mailbox by immutable ID to distinguish a deleted
  // event from one moved elsewhere. This lookup does not read event details.
  exists:(id:string)=>get<{id:string}>('/v1.0/me/events/'+segment(id)+'?$select=id'),
  event:(calendar:string,id:string)=>get<OutlookEvent>(eventPath(calendar,id)+'?'+eventQuery),
  create:(calendar:string,event:EventFields,transactionId:string)=>get<OutlookEvent>(base(calendar)+'/events','POST',{...outlookFields(event),transactionId}),
  update:(calendar:string,id:string,event:EventFields,current:EventFields,etag:string)=>
   get<OutlookEvent>(eventPath(calendar,id),'PATCH',outlookChanges(event,current),etag),
  remove:(calendar:string,id:string,etag:string)=>get<boolean>(eventPath(calendar,id),'DELETE',undefined,etag)
 };
}

function utc(value:OutlookEvent['start']):string|null {
 if(value?.timeZone!=='UTC'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/.test(value.dateTime))return null;
 const parsed=Date.parse(value.dateTime+'Z');
 return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
function day(value:string):string|null {
 const date=value.slice(0,10);
 // Outlook all-day entries for the pilot must represent UTC or Toronto
 // midnight. Leave other zones alone rather than shift a family's dates.
 return value.slice(11)==='00:00:00.000Z'||value===nativeInstant(date,'00:00')?date:null;
}

export function eventFields(event:OutlookEvent):EventFields|null {
 if(event.type!=='singleInstance'||event.isCancelled!==false||event.sensitivity!=='normal'||
  event.isOrganizer!==true||!Array.isArray(event.attendees)||event.attendees.length>0||event.isOnlineMeeting||event.hasAttachments||
  typeof event.isAllDay!=='boolean'||event.body?.contentType?.toLowerCase()!=='text')return null;
 const start=utc(event.start),end=utc(event.end);
 if(!start||!end||end<=start)return null;
 const title=event.subject?.trim()||'',description=event.body?.content?.replace(/\r\n/g,'\n')||'',location=event.location?.displayName||'';
 if(!title||title.length>160||description.length>4000||location.length>300)return null;
 const start_date=event.isAllDay?day(start):null,end_date=event.isAllDay?day(end):null;
 if(event.isAllDay&&(!start_date||!end_date||end_date<=start_date))return null;
 return {title,description,location,all_day:event.isAllDay,start_date,end_date,
  starts_at:start_date?nativeInstant(start_date,'00:00')!:start,
  ends_at:end_date?nativeInstant(end_date,'00:00')!:end};
}

export function outlookFields(event:EventFields) {
 const dateTime=(instant:string,date:string|null)=>date?
  {dateTime:date+'T00:00:00',timeZone:'Eastern Standard Time'}:
  {dateTime:new Date(instant).toISOString().slice(0,-1),timeZone:'UTC'};
 return {subject:event.title,body:{contentType:'text',content:event.description},
  location:{displayName:event.location},isAllDay:event.all_day,
  start:dateTime(event.starts_at,event.start_date),end:dateTime(event.ends_at,event.end_date)};
}

function outlookChanges(event:EventFields,current:EventFields) {
 const next=outlookFields(event),before=outlookFields(current);
 const dateChanged=next.isAllDay!==before.isAllDay||
  JSON.stringify(next.start)!==JSON.stringify(before.start)||JSON.stringify(next.end)!==JSON.stringify(before.end);
 return {
  ...(next.subject.trim()!==before.subject.trim()?{subject:next.subject}:{}),
  ...(next.body.content.replace(/\r\n/g,'\n')!==before.body.content?{body:next.body}:{}),
  ...(next.location.displayName!==before.location.displayName?{location:next.location}:{}),
  ...(dateChanged?{start:next.start,end:next.end,isAllDay:next.isAllDay}:{})
 };
}

export function eventKey(event:EventFields) {
 return JSON.stringify([event.title.trim(),event.description.replace(/\r\n/g,'\n'),event.location,event.all_day,
  event.all_day?event.start_date:Date.parse(event.starts_at),event.all_day?event.end_date:Date.parse(event.ends_at)]);
}
