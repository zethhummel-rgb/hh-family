import {expandNativeEvent, type NativeEvent} from '../google-calendar/native.ts';

export type Reply = 'yes' | 'maybe' | 'no';
export const replyLabels = {
 yes:'Yes · Add to calendar',
 maybe:'Maybe · Add to calendar',
 no:'No · Decline'
} satisfies Record<Reply,string>;
export const isReply = (value:unknown):value is Reply => value==='yes'||value==='maybe'||value==='no';
export type GuestEvent = {
 id:string;
 title:string;
 location:string;
 startsAt:string;
 endsAt:string;
 allDay:boolean;
 startDate:string|null;
 endDate:string|null;
};

export function guestEvent(master:NativeEvent, occurrence:string):GuestEvent|null {
 let event=master;
 if(master.recurrence?.length){
  if(!occurrence)return null;
  const change=master.exceptions?.[occurrence];
  const pivot=Date.parse(change?.starts_at||occurrence+'T12:00:00Z');
  if(!Number.isFinite(pivot))return null;
  const from=new Date(pivot-86400000).toISOString(),to=new Date(pivot+86400000).toISOString();
  const instance=expandNativeEvent(master,from,to).find(row=>row.original_date===occurrence);
  if(!instance)return null;
  event=instance;
 }else if(occurrence)return null;
 return {
  id:event.id,title:event.title,location:event.location,startsAt:event.starts_at,endsAt:event.ends_at,
  allDay:event.all_day,startDate:event.start_date,endDate:event.end_date
 };
}

export function guestEventDate(event:GuestEvent){
 if(event.allDay&&event.startDate&&event.endDate){
  const format=new Intl.DateTimeFormat('en-CA',{dateStyle:'full',timeZone:'UTC'});
  return format.formatRange(new Date(event.startDate),new Date(Date.parse(event.endDate)-86400000))+' · All day';
 }
 const format=new Intl.DateTimeFormat('en-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'});
 return format.formatRange(new Date(event.startsAt),new Date(event.endsAt))+' Eastern time';
}
