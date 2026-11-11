import type {GuestEvent} from '../supabase/functions/event-guests/event';

const instant=(value:string)=>new Date(value).toISOString().replace(/[-:]|\.\d{3}/g,'');
const date=(value:string)=>value.replaceAll('-','');
const escape=(value:string)=>value.replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[,;]/g,'\\$&');
const encoder=new TextEncoder();

function dates(event:GuestEvent){
 return event.allDay&&event.startDate&&event.endDate
  ?[date(event.startDate),date(event.endDate)]
  :[instant(event.startsAt),instant(event.endsAt)];
}

function fold(line:string){
 let bytes=0,folded='';
 for(const char of line){
  const length=encoder.encode(char).length;
  if(bytes+length>75){folded+='\r\n ';bytes=1}
  folded+=char;bytes+=length;
 }
 return folded;
}

export function calendarFile(event:GuestEvent,message:string){
 const [start,end]=dates(event),kind=event.allDay?';VALUE=DATE':'';
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//HH Family//Event Invite//EN','CALSCALE:GREGORIAN',
  'BEGIN:VEVENT','UID:'+escape(event.id)+'@hh-family','DTSTAMP:'+instant(new Date().toISOString()),
  'DTSTART'+kind+':'+start,'DTEND'+kind+':'+end,'SUMMARY:'+escape(event.title),
  ...(event.location?['LOCATION:'+escape(event.location)]:[]),...(message?['DESCRIPTION:'+escape(message)]:[]),
  'END:VEVENT','END:VCALENDAR',''].map(fold).join('\r\n');
}

export function googleCalendarLink(event:GuestEvent,message:string){
 const url=new URL('https://calendar.google.com/calendar/render');
 url.search=new URLSearchParams({action:'TEMPLATE',text:event.title,dates:dates(event).join('/'),location:event.location,details:message}).toString();
 return url.href;
}
