import {googleRequest,nativeMasters,type FamilyEvent} from './calendarData';
import {expandNativeEvent,occurrenceForDate} from '../supabase/functions/google-calendar/native';
import {searchParameters,type SearchPeriod} from '../supabase/functions/google-calendar/search';
export type {SearchPeriod};
export type SearchPage={events:FamilyEvent[];nextPageToken:string|null;asOf:string};
export function nativeSearchFilter(query:string){const pattern=JSON.stringify('%'+query.replace(/[\\%_]/g,'\\$&')+'%');return ['title','description','location'].map(field=>field+'.ilike.'+pattern).join(',')}
export async function searchCalendar(householdId:string,connected:boolean,query:string,period:SearchPeriod,pageToken?:string,asOf?:string):Promise<SearchPage>{
 const validated=searchParameters({query,period,pageToken,asOf});
 if(connected)return googleRequest('search',{householdId,query:query.trim(),period,...(pageToken?{pageToken}:{}),asOf:validated.asOf});
 const offset=pageToken?Number(pageToken):0;if(!Number.isInteger(offset)||offset<0)throw Error('Please start the search again.');
 const matches=(e:FamilyEvent)=>[e.title,e.description,e.location].some(s=>s.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const events:FamilyEvent[]=[];
 for(const master of await nativeMasters(householdId)){
  const from=period==='upcoming'?validated.asOf:[master.starts_at,...Object.values(master.exceptions||{}).flatMap(e=>e?.starts_at?[e.starts_at]:[])].sort()[0];
  const to=period==='past'?validated.asOf:'9999-12-30T00:00:00Z';
  if(Date.parse(from)>=Date.parse(to))continue;
  // Show a series once, represented by its next matching occurrence. This keeps
  // never-ending daily repeats from filling every page of a calendar search.
  const unchanged={...master,exceptions:Object.fromEntries(Object.keys(master.exceptions||{}).map(date=>[date,null]))};
  const candidate=expandNativeEvent(unchanged,from,to,2000,true)[0] as FamilyEvent|undefined;
  if(candidate&&matches(candidate))events.push(candidate);
  if(!master.recurrence?.length)continue;
  for(const date of Object.keys(master.exceptions||{})){
   if(!master.exceptions?.[date])continue;
   const original=occurrenceForDate(master,date),change=master.exceptions[date];
   const changed=original?{...original,...change,id:original.id,source:'home' as const}:null;
   if(changed&&Date.parse(changed.ends_at)>Date.parse(from)&&Date.parse(changed.starts_at)<Date.parse(to)&&matches(changed)&&!events.some(e=>e.id===changed.id))events.push(changed);
  }
 }
 events.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
 return {events:events.slice(offset,offset+50),nextPageToken:events.length>offset+50?String(offset+50):null,asOf:validated.asOf};
}
