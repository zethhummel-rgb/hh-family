export type ReminderEvent={id:string;task_id?:string;title:string;location?:string;person?:string;person_ids?:string[]|null;reminder_minutes?:number|null;reminder_30_enabled?:boolean;starts_at:string;all_day:boolean;start_date?:string|null};
export type ReminderMember={user_id:string;display_name:string};
export function calendarReminders(events:ReminderEvent[]):ReminderEvent[]{
 return events.flatMap(event=>{
  const extra=event.reminder_minutes;
  const minutes=event.reminder_30_enabled===false?[]:[30];
  if(extra!=null&&Number.isInteger(extra)&&extra>=0&&extra<=10080&&extra!==30)minutes.push(extra);
  return minutes.map(reminder_minutes=>({...event,reminder_minutes}));
 });
}
export function validSubscription(value:any){
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>4096)throw Error('Invalid notification subscription.');
 const url=new URL(value.endpoint),host=url.hostname;
 const allowed=host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com');
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed)throw Error('This notification service is not supported.');
 if(!/^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh||'')||!/^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth||''))throw Error('Invalid notification encryption keys.');
 return {endpoint:url.href,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
function easternMorning(day:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return NaN;
 const [y,m,d]=day.split('-').map(Number),target=Date.UTC(y,m-1,d,9);let guess=target;
 for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(guess).map(p=>[p.type,p.value]));guess+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)}
 return guess;
}
export function reminderDue(e:ReminderEvent){
 const m=e.reminder_minutes;if(m==null||!Number.isInteger(m)||m<0||m>10080)return null;
 const start=e.all_day?easternMorning(e.start_date||''):Date.parse(e.starts_at);
 return Number.isFinite(start)?start-m*60000:null;
}
export function isDue(e:ReminderEvent,now:number){const due=reminderDue(e);return due!==null&&due<=now&&due>now-5*60000}
export type ReminderPerson={id:string;display_name:string;linked_user_id:string|null};
export function recipients(e:ReminderEvent,members:ReminderMember[],people:ReminderPerson[]=[]){
 const ids=e.person_ids;
 if(Array.isArray(ids)){
  if(ids.length===0)return members.map(m=>m.user_id);
  // A child/profile without a login notifies the household's opted-in accounts.
  if(people.some(p=>ids.includes(p.id)&&!p.linked_user_id))return members.map(m=>m.user_id);
  return members.filter(m=>ids.includes(m.user_id)||people.some(p=>ids.includes(p.id)&&p.linked_user_id===m.user_id)).map(m=>m.user_id);
 }
 if(!e.person||e.person.toLowerCase()==='everyone')return members.map(m=>m.user_id);
 const normalized=(s:string)=>s.trim().toLowerCase();
 const profile=people.find(p=>normalized(p.display_name)===normalized(e.person!));
 if(profile)return profile.linked_user_id?members.filter(m=>m.user_id===profile.linked_user_id).map(m=>m.user_id):members.map(m=>m.user_id);
 const exact=members.filter(m=>normalized(m.display_name)===normalized(e.person!));if(exact.length)return exact.map(m=>m.user_id);
 const first=members.filter(m=>normalized(m.display_name).split(/\s+/)[0]===normalized(e.person!));return first.length===1?[first[0].user_id]:[];
}
export function deliveryKey(e:ReminderEvent){return `${e.id}:${e.all_day?e.start_date:e.starts_at}:${e.reminder_minutes}`}
export function notificationPayload(e:ReminderEvent){
 const date=e.all_day?new Date(e.start_date+'T12:00:00Z'):new Date(e.starts_at);
 const when=new Intl.DateTimeFormat('en-CA',{timeZone:e.all_day?'UTC':'America/Toronto',weekday:'short',month:'short',day:'numeric',...(e.all_day?{}:{hour:'numeric',minute:'2-digit'})}).format(date);
 return {title:e.title.slice(0,160),body:(when+(e.all_day?' · All day':' Eastern')+(e.location?' · '+e.location:'')).slice(0,350),eventId:e.task_id?undefined:e.id,taskId:e.task_id,date:e.all_day?e.start_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),tag:deliveryKey(e)};
}
