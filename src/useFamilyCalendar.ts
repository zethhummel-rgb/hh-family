import {searchCalendar,type SearchPeriod} from './calendarSearchData';
import {useCallback,useEffect,useRef,useState} from 'react';
import {type FamilyEvent,type EventDraft,type CalendarConnection,calendarSource,calendarStatus,getEvents,nativeCalendarSnapshot,saveEvent,deleteEvent,getEventSeries,dayKey,shiftDay,zonedISO,googleRequest} from './calendarData';
const message=(e:unknown)=>e instanceof Error?e.message:(e as {message?:string}).message||'Could not load the family calendar.';
export function useFamilyCalendar(hid:string){
 const [events,setEvents]=useState<FamilyEvent[]>([]),[connection,setConnection]=useState<CalendarConnection>({configured:false,connected:false}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[ready,setReady]=useState(false),[range,setRange]=useState(()=>({from:zonedISO(shiftDay(dayKey(new Date()),-7)),to:zonedISO(shiftDay(dayKey(new Date()),60))}));const generation=useRef(0);
 const [loadedRange,setLoadedRange]=useState<{from:string;to:string}|null>(null);
 const [source,setSource]=useState<'hh'|'google'|null>(null);
 const [countdowns,setCountdowns]=useState<{hid:string;masters:FamilyEvent[]}>({hid,masters:[]});
 const refresh=useCallback(async()=>{
  const id=++generation.current;setLoading(true);
  try{
   const source=await calendarSource(hid);if(id!==generation.current)return;setSource(source);
   setConnection(old=>({...old,nativeReady:source==='hh',connected:source==='google'}));
   // Optional provider status must never delay or hide a ready HH calendar.
   void calendarStatus(hid).then(status=>{if(id===generation.current)setConnection({...status,nativeReady:source==='hh',connected:source==='google'})}).catch(()=>{if(id===generation.current)setConnection(old=>({...old,copyStatus:'unavailable'}))});
   const snapshot=source==='hh'?await nativeCalendarSnapshot(hid,range.from,range.to):{events:await getEvents(hid,range.from,range.to,true),countdownMasters:[]};if(id!==generation.current)return;
   setCountdowns({hid,masters:snapshot.countdownMasters});setEvents(snapshot.events);setLoadedRange(range);setReady(true);setError('');
  }catch(e){if(id===generation.current){setReady(false);setError(message(e))}}
  finally{if(id===generation.current)setLoading(false)}
 },[hid,range]);
 useEffect(()=>{refresh();const focus=()=>refresh();window.addEventListener('focus',focus);const timer=setInterval(()=>{if(!document.hidden)refresh()},60000);return()=>{generation.current++;window.removeEventListener('focus',focus);clearInterval(timer)}},[refresh]);
 const onRange=useCallback((from:string,to:string)=>setRange(old=>old.from===from&&old.to===to?old:{from,to}),[]);
 async function save(draft:EventDraft,current:FamilyEvent|null,requestId:string){if(!ready)throw Error('Wait for the calendar to finish loading.');const saved=await saveEvent(hid,draft,current,source==='google',requestId);await refresh();return saved}
 async function remove(event:FamilyEvent){if(!ready)throw Error('Wait for the calendar to finish loading.');await deleteEvent(hid,event,source==='google');await refresh()}
 async function connect(){const d=await googleRequest('start',{householdId:hid});if(typeof d.url!=='string'||new URL(d.url).origin!=='https://accounts.google.com')throw Error('Could not open the Google connection.');location.assign(d.url)}
 return {events,countdownMasters:source==='hh'&&countdowns.hid===hid?countdowns.masters:[],connection,source,loading,error,ready,loadedRange,refresh,onRange,save,remove,connect,search:(query:string,period:SearchPeriod,pageToken?:string,asOf?:string)=>{if(!ready)throw Error('Wait for the calendar to finish loading.');return searchCalendar(hid,source==='google',query,period,pageToken,asOf)},loadSeries:(event:FamilyEvent)=>getEventSeries(hid,event)};
}
