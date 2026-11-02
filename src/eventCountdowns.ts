import {expandNativeEvent} from '../supabase/functions/google-calendar/native';
import {eventDate,zonedISO,type FamilyEvent} from './calendarData';
import {supabase} from './supabase';

export type EventCountdown={masterId:string;event:FamilyEvent;date:string;days:number};
function ordinal(date:string){
 const stamp=Date.parse(date+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)throw Error('Choose a valid countdown date.');
 return stamp/86400000;
}
export function countdownLabel(days:number){return days===0?'Today!':days===1?'Tomorrow':days.toLocaleString('en-CA')+' days'}
export function selectEventCountdowns(masters:FamilyEvent[],today:string):EventCountdown[]{
 const day=ordinal(today),from=zonedISO(today);let work=0;
 const tick=()=>{if(++work>100000)throw Error('These countdown repeats need a refresh. Please try again.')};
 const result:EventCountdown[]=[];
 for(const master of masters){
  if(master.countdown_enabled!==true)continue;
  // firstOnly stops at the next valid start instead of expanding years of
  // repeats. Include far-future trips, leap birthdays and moved exceptions.
  // startsOnly excludes an earlier multi-day occurrence still in progress.
  const next=expandNativeEvent(master,from,'9999-12-31T23:59:59.999Z',1,true,tick,true)[0] as FamilyEvent|undefined;
  if(!next)continue;
  const date=eventDate(next),days=Math.round(ordinal(date)-day);
  if(days>=0)result.push({masterId:master.id,event:next,date,days});
 }
 return result.sort((a,b)=>a.days-b.days||a.event.starts_at.localeCompare(b.event.starts_at)||a.masterId.localeCompare(b.masterId));
}
export async function loadCurrentCountdown(hid:string,masterId:string,today:string):Promise<EventCountdown|null>{
 const result=await supabase.from('household_events').select('*').eq('household_id',hid).eq('id',masterId).maybeSingle();
 if(result.error)throw Error(result.error.message||'Could not open this countdown.');
 if(!result.data)return null;
 return selectEventCountdowns([{...result.data,source:'home'} as FamilyEvent],today)[0]||null;
}
