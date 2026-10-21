import {reminderLabel} from '../supabase/functions/google-calendar/reminders';
import {selectedPeople,personLabel,type PersonProfile} from './people';
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,Check,Repeat2,Trash2,X} from 'lucide-react';
import {type FamilyEvent,type EventDraft,halfHourAfter,eventDate,eventEndDate,eventRequestId,shiftDay,timePart,zonedISO,TIME_ZONE} from './calendarData';
import {buildRecurrence,readRecurrence,repeatDescription,type RepeatFrequency,type RepeatOptions} from '../supabase/functions/google-calendar/recurrence';
type Props={event:FamilyEvent|null;date:string;profiles:PersonProfile[];connected:boolean;onClose:()=>void;onSave:(draft:EventDraft,current:FamilyEvent|null,requestId:string)=>Promise<void>;onDelete:(event:FamilyEvent)=>Promise<void>;onLoadSeries:(event:FamilyEvent)=>Promise<FamilyEvent>};
const defaults:RepeatOptions={frequency:'WEEKLY',interval:1,ending:'never',until:'',count:10};
const errorText=(e:unknown)=>e instanceof Error?e.message:(e as {message?:string})?.message||'Could not save the event.';
export default function EventEditor({event,date,profiles,connected,onClose,onSave,onDelete,onLoadSeries}:Props){
 const [reminder,setReminder]=useState<number|null>(event?event.reminder_minutes??null:30);
 const [current,setCurrent]=useState(event),[scope,setScope]=useState<'occurrence'|'series'>('occurrence');
 const [title,setTitle]=useState(event?.title||''),[description,setDescription]=useState(event?.description||''),[location,setLocation]=useState(event?.location||''),[taggedIds,setTaggedIds]=useState<string[]>(()=>selectedPeople(event,profiles)),[tagsChanged,setTagsChanged]=useState(false),[start,setStart]=useState(event?eventDate(event):date),[end,setEnd]=useState(event?eventEndDate(event):date),[startTime,setStartTime]=useState(event&&!event.all_day?timePart(event.starts_at):'09:00'),[endTime,setEndTime]=useState(event&&!event.all_day?timePart(event.ends_at):'09:30'),[allDay,setAllDay]=useState(event?.all_day||false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
 const initialRepeat=readRecurrence(event?.recurrence,event?.all_day||false);
 const [frequency,setFrequency]=useState<RepeatFrequency|'none'|'existing'>(initialRepeat?.frequency||(event?.recurrence?.length?'existing':'none')),[repeat,setRepeat]=useState<RepeatOptions>(initialRepeat||defaults),[repeatDirty,setRepeatDirty]=useState(false);
 const occurrenceOnly=!!event?.series_id&&scope==='occurrence',wholeSeries=!!current?.recurrence?.length&&scope==='series';
 const modal=useRef<HTMLElement>(null),busyRef=useRef(busy),closeRef=useRef(onClose),requestId=useRef(eventRequestId());busyRef.current=busy;closeRef.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;modal.current?.querySelector('input')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busyRef.current)closeRef.current();if(e.key==='Tab'){const a=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||[]);if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0]?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}},[]);
 function loadFields(e:FamilyEvent){setCurrent(e);setReminder(e.reminder_minutes??null);setTitle(e.title);setDescription(e.description);setLocation(e.location);setTaggedIds(selectedPeople(e,profiles));setTagsChanged(false);setStart(eventDate(e));setEnd(eventEndDate(e));setStartTime(e.all_day?'09:00':timePart(e.starts_at));setEndTime(e.all_day?'10:00':timePart(e.ends_at));setAllDay(e.all_day);const r=readRecurrence(e.recurrence,e.all_day);setFrequency(r?.frequency||(e.recurrence?.length?'existing':'none'));setRepeat(r||defaults);setRepeatDirty(false);setConfirmDelete(false)}
 async function changeScope(next:'occurrence'|'series'){
  if(!event||next===scope)return;setBusy(true);setError('');
  try{const target=next==='series'?await onLoadSeries(event):event;loadFields(target);setScope(next)}catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 function changeRepeat(update:Partial<RepeatOptions>){setRepeat(old=>({...old,...update}));setRepeatDirty(true)}
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   if(!title.trim())throw Error('Give this event a name.');if(end<start)throw Error('The end date must be on or after the start date.');
   const exclusiveEnd=allDay?shiftDay(end,1):end,starts_at=zonedISO(start,allDay?'00:00':startTime),ends_at=zonedISO(exclusiveEnd,allDay?'00:00':endTime);
   if(ends_at<=starts_at)throw Error('End time must be after start time.');
   const draft:EventDraft={reminder_minutes:reminder,title:title.trim(),description:description.trim(),location:location.trim(),person:current&&!tagsChanged?current.person:personLabel(taggedIds,profiles),...(!current||tagsChanged?{person_ids:taggedIds}:Array.isArray(current.person_ids)?{person_ids:current.person_ids}:{}),starts_at,ends_at,all_day:allDay,start_date:allDay?start:null,end_date:allDay?exclusiveEnd:null};
   if(!occurrenceOnly){
    if(frequency==='existing'&&current?.all_day!==allDay)throw Error('Choose a new repeat pattern before changing this series between all-day and timed.');
    if(!current||repeatDirty)draft.recurrence=frequency==='none'?[]:frequency==='existing'?undefined:buildRecurrence({...repeat,frequency},start,allDay);
   }
   await onSave(draft,current,requestId.current);onClose();
  }catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 const repeatEnabled=frequency!=='none'&&frequency!=='existing';
 const changeLabel=wholeSeries?'the whole series':event?.recurring?'this occurrence':'this event';
 return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
  <section className="modal event-modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" ref={modal}>
   <button type="button" className="modal-close icon-button" aria-label="Close event editor" disabled={busy} onClick={onClose}><X/></button>
   <span className="round-icon sage"><CalendarDays/></span><h2 id="event-editor-title">{event?'Edit family plans.':'Make a little time.'}</h2>
   <p className="event-form-note">{connected?'Saves to your connected Google family calendar.':'Shared with your household in HH.'}</p>
   {event?.series_id&&<div className="series-scope"><label>Apply changes to<select value={scope} disabled={busy} onChange={e=>changeScope(e.target.value as 'occurrence'|'series')}><option value="occurrence">Only this occurrence</option><option value="series">The whole series</option></select></label><p className="field-help">{busy?'Loading…':scope==='series'?'Editing the original event and its repeat pattern. Changes apply to past and future occurrences.':'Other dates in this series stay as they are.'} Switching this choice reloads the saved details.</p></div>}
   <form onSubmit={submit}><fieldset disabled={busy} className="event-fields">
    <label>Event name<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Birthday dinner"/></label>
    <label className="toggle-label"><input type="checkbox" checked={allDay} onChange={e=>{setAllDay(e.target.checked);if(e.target.checked)setEnd(start);if(repeatEnabled)setRepeatDirty(true)}}/>All-day event</label>
    <div className="form-grid"><label>{wholeSeries?'First event starts':'Starts'}<input type="date" required value={start} onChange={e=>{setStart(e.target.value);if(allDay||end<e.target.value)setEnd(e.target.value)}}/></label><label>Ends<input type="date" required min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
    {!allDay&&<div className="form-grid"><label>Start time<input type="time" required value={startTime} onChange={e=>{setStartTime(e.target.value);const next=halfHourAfter(start,e.target.value);if(next){setEndTime(next.time);setEnd(next.date)}}}/></label><label>End time<input type="time" required value={endTime} onChange={e=>setEndTime(e.target.value)}/></label></div>}
    <p className="field-help timezone-note">Eastern time · {TIME_ZONE}</p>
    <div className="reminder-settings"><label>Additional reminder<select aria-label="Event reminder" value={reminder===null?'none':String(reminder)} onChange={e=>setReminder(e.target.value==='none'?null:Number(e.target.value))}><option value="none">No additional reminder</option>{Array.from(new Set([0,5,10,15,30,60,120,1440,2880,10080,...(reminder==null?[]:[reminder])])).sort((a,b)=>a-b).map(m=><option key={m} value={m}>{reminderLabel(m)}</option>)}</select></label><p className="field-help">Every event sends a notification 30 minutes before. Choose another time here for an additional reminder. Tagged people need notifications enabled on their devices.{allDay?' All-day reminders are counted back from 9 AM Eastern.':''}</p></div>
    <div className="repeat-settings"><label><span className="repeat-heading"><Repeat2 size={15}/>Repeat</span><select aria-label="Repeat" value={occurrenceOnly?'occurrence':frequency} disabled={occurrenceOnly} onChange={e=>{setFrequency(e.target.value as typeof frequency);setRepeatDirty(true)}}>
     {occurrenceOnly?<option value="occurrence">Part of a repeating series</option>:<><option value="none">Does not repeat</option><option value="DAILY">Daily / every few days</option><option value="WEEKLY">Weekly / every few weeks</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly / birthdays</option>{frequency==='existing'&&<option value="existing">Custom Google pattern · keep existing</option>}</>}
    </select></label>
    {occurrenceOnly?<p className="field-help">Choose “The whole series” above to change how it repeats.</p>:repeatEnabled&&<>
     <div className="repeat-interval"><label>Repeat every<input type="number" required min="1" max="999" step="1" inputMode="numeric" value={Number.isNaN(repeat.interval)?'':repeat.interval} onChange={e=>changeRepeat({interval:e.target.valueAsNumber})}/></label><span>{{DAILY:'day(s)',WEEKLY:'week(s)',MONTHLY:'month(s)',YEARLY:'year(s)'}[frequency]}</span></div>
     <p className="field-help">{frequency==='WEEKLY'?`On ${new Date(start+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'long'})}. Use 2 weeks for biweekly.`:frequency==='MONTHLY'?'On this day of the month. Months without that date are skipped.':frequency==='YEARLY'?'On this date each year. February 29 repeats in leap years.':'Counted in calendar days, keeping the same Eastern time.'}</p>
     <label>Repeat ends<select value={repeat.ending} onChange={e=>changeRepeat({ending:e.target.value as RepeatOptions['ending']})}><option value="never">Never</option><option value="on">On a date</option><option value="after">After a number of occurrences</option></select></label>
     {repeat.ending==='on'&&<label>Last repeat date<input type="date" required min={start} value={repeat.until} onChange={e=>changeRepeat({until:e.target.value})}/></label>}
     {repeat.ending==='after'&&<label>Number of occurrences<input type="number" min="1" max="9999" step="1" required value={Number.isNaN(repeat.count)?'':repeat.count} onChange={e=>changeRepeat({count:e.target.valueAsNumber})}/><span className="field-help">Includes the first event.</span></label>}
     {Number.isInteger(repeat.interval)&&repeat.interval>0&&<p className="repeat-summary">{repeatDescription({...repeat,frequency:frequency as RepeatFrequency})}</p>}
    </>}
    </div>
    <fieldset className="event-tag-picker"><legend>Who’s it for?</legend><label><input type="checkbox" checked={!taggedIds.length} onChange={()=>{setTaggedIds([]);setTagsChanged(true)}}/><span className="tag-everyone-dots">{profiles.map(p=><i key={p.id} style={{backgroundColor:p.color}}/>)}</span>Everyone</label>{profiles.map(p=><label key={p.id}><input type="checkbox" checked={taggedIds.includes(p.id)} onChange={e=>{setTagsChanged(true);setTaggedIds(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}}/><i className="person-dot" style={{backgroundColor:p.color}}/>{p.name}</label>)}<p className="field-help">Choose one or more people, or Everyone for a family plan.</p></fieldset>
    <label>Location (optional)<input maxLength={300} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Where are we going?"/></label>
    <label>Notes (optional)<textarea rows={3} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Anything the family should know…"/></label>
    {error&&<div className="error" role="alert">{error}</div>}
    <button className="button primary wide" disabled={busy||!title.trim()}>{busy?'Saving…':wholeSeries?'Save whole series':event?'Save changes':'Add event'}<Check size={17}/></button>
   </fieldset></form>
   {event&&<div className="event-delete">{confirmDelete?<><p>Delete {changeLabel} for everyone?</p><button className="button danger" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onDelete(current!);onClose()}catch(e){setError(errorText(e))}finally{setBusy(false)}}}>Yes, delete {wholeSeries?'whole series':event.recurring?'occurrence':'event'}</button><button className="text-button" disabled={busy} onClick={()=>setConfirmDelete(false)}>Keep event</button></>:<button className="text-button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/>Delete {wholeSeries?'whole series':event.recurring?'occurrence':'event'}</button>}</div>}
  </section>
 </div>;
}
