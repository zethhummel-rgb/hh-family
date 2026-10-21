import type {PersonProfile} from './people';
import {useEffect,useRef,useState} from 'react';
import {Search} from 'lucide-react';
import {EventCard} from './Calendar';
import EventDetails from './EventDetails';
import {type FamilyEvent} from './calendarData';
import {type SearchPage,type SearchPeriod} from './calendarSearchData';
export type SearchEvents=(query:string,period:SearchPeriod,pageToken?:string,asOf?:string)=>Promise<SearchPage>;
export default function CalendarSearch({onSearch,onEdit,profiles}:{profiles:PersonProfile[];onSearch:SearchEvents;onEdit:(event:FamilyEvent)=>void}){
 const [query,setQuery]=useState(''),[period,setPeriod]=useState<SearchPeriod>('all'),[events,setEvents]=useState<FamilyEvent[]>([]),[page,setPage]=useState<SearchPage|null>(null),[loading,setLoading]=useState(false),[searched,setSearched]=useState(false),[error,setError]=useState(''),[details,setDetails]=useState<FamilyEvent|null>(null);
 const generation=useRef(0),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();return()=>{generation.current++}},[]);
 function reset(){generation.current++;setLoading(false);setEvents([]);setPage(null);setSearched(false);setError('')}
 async function search(more=false){
  const id=++generation.current;setLoading(true);setError('');
  try{const result=await onSearch(query.trim(),period,more?page?.nextPageToken||undefined:undefined,more?page?.asOf:undefined);if(id!==generation.current)return;setEvents(old=>{const merged=more?[...old,...result.events]:result.events;return Array.from(new Map(merged.map(e=>[e.id,e])).values())});setPage(result);setSearched(true)}catch(e){if(id===generation.current)setError(e instanceof Error?e.message:(e as {message?:string})?.message||'Could not search the calendar.')}finally{if(id===generation.current)setLoading(false)}
 }
 return <section className="calendar-search" aria-label="Calendar search">
  <form className="calendar-search-form" onSubmit={e=>{e.preventDefault();search()}}>
   <label>Search family events<input ref={input} type="search" maxLength={150} required placeholder="Hockey, birthdays, dentist…" value={query} onChange={e=>{reset();setQuery(e.target.value)}}/></label>
   <div className="search-period" role="group" aria-label="Search dates">{([['all','All dates'],['upcoming','Upcoming'],['past','Past']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={period===value} className={period===value?'selected':''} onClick={()=>{reset();setPeriod(value)}}>{label}</button>)}</div>
   <button className="button primary" disabled={loading||!query.trim()}><Search size={16}/>{loading?'Searching…':'Search calendar'}</button>
  </form>
  <p className="field-help">Search names, notes, and locations across your family calendar. Results are in date order, oldest first. HH repeating series appear once, with separately changed dates also searchable.</p>
  {error&&<div className="error" role="alert">{error}<button onClick={()=>search()}>Try again</button></div>}
  <div aria-live="polite" className="calendar-search-status">{loading?'Searching your calendar…':searched?events.length?`${events.length}${page?.nextPageToken?'+':''} matching event${events.length===1?'':'s'}`:'No matching events. Try another word or date option.':'Choose a word and search past, future, or all dates.'}</div>
  <div className="calendar-search-results">{events.map(event=><EventCard key={event.id} event={event} profiles={profiles} onEdit={setDetails} showDate/>)}</div>
  {page?.nextPageToken&&<button className="button soft wide" disabled={loading} onClick={()=>search(true)}>{loading?'Loading…':'Show more results'}</button>}
  {details&&<EventDetails profiles={profiles} event={details} onClose={()=>setDetails(null)} onEdit={event=>{setDetails(null);onEdit(event)}}/>}
 </section>;
}
