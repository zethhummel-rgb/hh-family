import {occurrenceForDate,type NativeEvent} from './native.ts';
// Retry-safe: the series has a deterministic Google ID, and exceptions target
// Google's original-start identity even after an instance has moved or vanished.
export async function importNativeExceptions(master:NativeEvent,base:string,request:(path:string,method?:string,body?:unknown)=>Promise<any>,toGoogle:(event:any)=>unknown){
 const eventsPath=base.slice(0,base.lastIndexOf('/'));
 for(const [date,change]of Object.entries(master.exceptions||{})){
  const original=occurrenceForDate(master,date);if(!original)continue;
  const params=new URLSearchParams({originalStart:master.all_day?date:original.starts_at,showDeleted:'true',maxResults:'250',timeZone:'America/Toronto'});
  const response=await request(base+'/instances?'+params);
  const instance=response.items?.find((e:any)=>master.all_day?e.originalStartTime?.date===date:Date.parse(e.originalStartTime?.dateTime)===Date.parse(original.starts_at));
  if(!instance)throw Error('A changed occurrence could not be copied. Reconnect to retry.');
  if(change===null){if(instance.status!=='cancelled')await request(eventsPath+'/'+encodeURIComponent(instance.id),'DELETE')}
  else await request(eventsPath+'/'+encodeURIComponent(instance.id),'PATCH',{...toGoogle({...original,...change,recurrence:undefined}) as object,status:'confirmed'});
 }
}
