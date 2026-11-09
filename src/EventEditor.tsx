import {useTutorialPractice} from './InteractiveTutorial';
import InputCardHandle,{submitInputCard} from './InputCardHandle';
import {useUnsavedChanges,useModalScrollLock} from './useUnsavedChanges';
import {reminderLabel} from '../supabase/functions/google-calendar/reminders';
import {selectedPeople,personLabel,isUnassigned,type PersonProfile} from './people';
import {useEffect,useId,useRef,useState} from 'react';
import {Bell,BellPlus,Check,MapPin,Repeat2,Timer,Trash2} from 'lucide-react';
import {type FamilyEvent,type EventDraft,movedEventEnd,dayKey,eventDate,eventEndDate,eventRequestId,shiftDay,timePart,zonedISO} from './calendarData';
import {buildRecurrence,readRecurrence,repeatDescription,type RepeatFrequency,type RepeatOptions} from '../supabase/functions/google-calendar/recurrence';
type Props={event:FamilyEvent|null;date:string;profiles:PersonProfile[];connected:boolean;onClose:()=>void;onSave:(draft:EventDraft,current:FamilyEvent|null,requestId:string)=>Promise<void>;onDelete:(event:FamilyEvent)=>Promise<void>;onLoadSeries:(event:FamilyEvent)=>Promise<FamilyEvent>};
const defaults:RepeatOptions={frequency:'WEEKLY',interval:1,ending:'never',until:'',count:10};
const errorText=(e:unknown)=>e instanceof Error?e.message:(e as {message?:string})?.message||'Could not save the event.';
// A select makes quarter-hour choices consistent across desktop and iPhone pickers.
// Retain an existing off-quarter time (including a duration-preserving end) until changed.
const quarterHours=Array.from({length:96},(_,i)=>String(Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0'));
function EventTimeSelect({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const choices=quarterHours.includes(value)?quarterHours:[...quarterHours,value].sort();
 return <select aria-label={label} required value={value} onChange={e=>onChange(e.target.value)}>{choices.map(time=>{const [hour,minute]=time.split(':'),h=Number(hour);return <option key={time} value={time}>{h%12||12}:{minute} {h<12?'AM':'PM'}</option>})}</select>;
}
export default function EventEditor({event,date,profiles,connected,onClose,onSave,onDelete,onLoadSeries}:Props){
 const [countdown,setCountdown]=useState(event?.countdown_enabled===true);
 const [reminder30,setReminder30]=useState(event?.reminder_30_enabled!==false);
 const [reminder,setReminder]=useState<number|null>(event?.reminder_minutes===30?null:event?.reminder_minutes??null);
 const [current,setCurrent]=useState(event),[scope,setScope]=useState<'occurrence'|'series'>('occurrence');
 const [title,setTitle]=useState(event?.title||''),[description,setDescription]=useState(event?.description||''),[location,setLocation]=useState(event?.location||''),[taggedIds,setTaggedIds]=useState<string[]>(()=>selectedPeople(event,profiles)),[tagsChanged,setTagsChanged]=useState(false),[unassigned,setUnassigned]=useState(()=>!!event&&isUnassigned(event)),[start,setStart]=useState(event?eventDate(event):date),[end,setEnd]=useState(event?(event.all_day?eventEndDate(event):dayKey(new Date(event.ends_at))):date),[startTime,setStartTime]=useState(event&&!event.all_day?timePart(event.starts_at):'09:00'),[endTime,setEndTime]=useState(event&&!event.all_day?timePart(event.ends_at):'09:30'),[allDay,setAllDay]=useState(event?.all_day||false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
 const initialRepeat=readRecurrence(event?.recurrence,event?.all_day||false);
 const [frequency,setFrequency]=useState<RepeatFrequency|'none'|'existing'>(initialRepeat?.frequency||(event?.recurrence?.length?'existing':'none')),[repeat,setRepeat]=useState<RepeatOptions>(initialRepeat||defaults),[repeatDirty,setRepeatDirty]=useState(false);
 const snapshot=JSON.stringify([title,description,location,taggedIds,tagsChanged,unassigned,start,end,startTime,endTime,allDay,frequency,repeat,countdown,reminder30,reminder]);
 const baseline=useRef(snapshot),resetBaseline=useRef(false);if(resetBaseline.current){baseline.current=snapshot;resetBaseline.current=false}const guard=useUnsavedChanges(snapshot!==baseline.current,busy,onClose,()=>{submitInputCard(modal.current);return false});useModalScrollLock();
 const formId=useId(),errorTarget=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error){errorTarget.current?.scrollIntoView({block:'nearest'});errorTarget.current?.focus()}},[error]);
 const occurrenceOnly=!!event?.series_id&&scope==='occurrence',wholeSeries=!!current?.recurrence?.length&&scope==='series';
 const modal=useRef<HTMLElement>(null),busyRef=useRef(busy),closeRef=useRef(onClose),requestId=useRef(eventRequestId());busyRef.current=busy;closeRef.current=guard.requestClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;modal.current?.querySelector('input')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busyRef.current)closeRef.current();if(e.key==='Tab'){const a=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||[]);if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0]?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus({preventScroll:true})}},[]);
 function loadFields(e:FamilyEvent){resetBaseline.current=true;setCurrent(e);setCountdown(e.countdown_enabled===true);setReminder30(e.reminder_30_enabled!==false);setReminder(e.reminder_minutes===30?null:e.reminder_minutes??null);setTitle(e.title);setDescription(e.description);setLocation(e.location);setTaggedIds(selectedPeople(e,profiles));setTagsChanged(false);setUnassigned(isUnassigned(e));setStart(eventDate(e));setEnd(e.all_day?eventEndDate(e):dayKey(new Date(e.ends_at)));setStartTime(e.all_day?'09:00':timePart(e.starts_at));setEndTime(e.all_day?'10:00':timePart(e.ends_at));setAllDay(e.all_day);const r=readRecurrence(e.recurrence,e.all_day);setFrequency(r?.frequency||(e.recurrence?.length?'existing':'none'));setRepeat(r||defaults);setRepeatDirty(false);setConfirmDelete(false)}
 async function loadScope(next:'occurrence'|'series'){
  if(!event||next===scope)return;setBusy(true);setError('');
  try{const target=next==='series'?await onLoadSeries(event):event;loadFields(target);setScope(next)}catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 function changeScope(next:'occurrence'|'series'){guard.requestClose(()=>void loadScope(next))}
 function moveStartDate(next:string){if(allDay){const days=(Date.parse(end)-Date.parse(start))/86400000;if(next&&Number.isFinite(days)&&days>=0)setEnd(shiftDay(next,days))}else{const moved=movedEventEnd(start,startTime,end,endTime,next,startTime);if(moved){setEnd(moved.date);setEndTime(moved.time)}}setStart(next)}
 function changeRepeat(update:Partial<RepeatOptions>){setRepeat(old=>({...old,...update}));setRepeatDirty(true)}
 const tutorial=useTutorialPractice();
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   if(!title.trim())throw Error('Give this event a name.');if(end<start)throw Error('The end date must be on or after the start date.');
   const exclusiveEnd=allDay?shiftDay(end,1):end,starts_at=zonedISO(start,allDay?'00:00':startTime),ends_at=zonedISO(exclusiveEnd,allDay?'00:00':endTime);
   if(ends_at<=starts_at)throw Error('End time must be after start time.');
   const draft:EventDraft={reminder_30_enabled:unassigned?false:reminder30,reminder_minutes:unassigned?null:reminder,title:title.trim(),description:description.trim(),location:location.trim(),person:current&&!tagsChanged?current.person:unassigned?'Unassigned':personLabel(taggedIds,profiles),...(!current||tagsChanged?{person_ids:taggedIds}:Array.isArray(current.person_ids)?{person_ids:current.person_ids}:{}),starts_at,ends_at,all_day:allDay,start_date:allDay?start:null,end_date:allDay?exclusiveEnd:null};
   if(!occurrenceOnly){
    if(!connected)draft.countdown_enabled=countdown;
    if(frequency==='existing'&&current?.all_day!==allDay)throw Error('Choose a new repeat pattern before changing this series between all-day and timed.');
    if(!current||repeatDirty)draft.recurrence=frequency==='none'?[]:frequency==='existing'?undefined:buildRecurrence({...repeat,frequency},start,allDay);
   }
   if(tutorial.intercept('event'))return;
   await onSave(draft,current,requestId.current);onClose();
  }catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 const repeatEnabled=frequency!=='none'&&frequency!=='existing';
 const changeLabel=wholeSeries?'the whole series':event?.recurring?'this occurrence':'this event';
 return <div className="modal-backdrop input-card-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)guard.requestClose()}}>
  <section className="modal event-modal compact-event-modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" ref={modal}>
   <InputCardHandle onRequestClose={()=>guard.requestClose()} modal={modal} dirty={snapshot!==baseline.current} busy={busy} onClose={onClose} onSave={()=>submitInputCard(modal.current)}/><header className="event-editor-header"><button type="button" className="event-cancel" aria-label="Close event editor" disabled={busy} onClick={()=>guard.requestClose()}>Cancel</button><h2 id="event-editor-title">{event?'Edit event':'New event'}</h2><div className="event-save-bar"><button type="submit" form={formId} className="button primary" aria-label={wholeSeries?'Save whole series':event?'Save changes':'Add event'} disabled={busy||!title.trim()}>{busy?'Saving…':'Save'}</button></div></header>
   <div className="event-editor-body">
    {error&&<div className="error" role="alert" ref={errorTarget} tabIndex={-1}>{error}</div>}
    {connected&&<p className="event-context-note">Your Google calendar stays active until its HH transfer is verified.</p>}
    {event?.series_id&&<div className="series-scope"><label>Apply changes to<select value={scope} disabled={busy} onChange={e=>changeScope(e.target.value as 'occurrence'|'series')}><option value="occurrence">Only this occurrence</option><option value="series">The whole series</option></select></label><p className="field-help">{busy?'Loading.':scope==='series'?'Changes apply to every occurrence.':'Other dates in this series stay as they are.'} Switching reloads the saved details.</p></div>}
    <form id={formId} onSubmit={submit}><fieldset disabled={busy} className="event-fields">
     <div className="event-input-group event-basics"><input aria-label="Event name" required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Event name"/><label className="event-location-input"><MapPin size={17} aria-hidden="true"/><input aria-label="Location (optional)" maxLength={300} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Add location"/></label></div>
     <div className="event-input-group event-schedule">
      <div className="event-date-row"><span>{wholeSeries?'First start':'Starts'}</span><div className={'event-date-controls'+(allDay?' all-day-controls':'')}><input type="date" aria-label={wholeSeries?'First event starts':'Starts'} required value={start} onChange={e=>moveStartDate(e.target.value)}/>{!allDay&&<EventTimeSelect label="Start time" value={startTime} onChange={value=>{setStartTime(value);const next=movedEventEnd(start,startTime,end,endTime,start,value);if(next){setEndTime(next.time);setEnd(next.date)}}}/>}</div></div>
      <div className="event-date-row"><span>Ends</span><div className={'event-date-controls'+(allDay?' all-day-controls':'')}><input type="date" aria-label="Ends" required min={start} value={end} onChange={e=>setEnd(e.target.value)}/>{!allDay&&<EventTimeSelect label="End time" value={endTime} onChange={setEndTime}/>}</div></div>
      <label className="event-setting-row"><span>All day</span><input className="event-compact-switch" type="checkbox" role="switch" aria-label="All-day event" checked={allDay} onChange={e=>{setAllDay(e.target.checked);if(e.target.checked)setEnd(start);if(repeatEnabled)setRepeatDirty(true)}}/></label>
          <div className="repeat-settings"><label className="event-setting-row"><span className="repeat-heading"><Repeat2 size={15}/>Repeat</span><select aria-label="Repeat" value={occurrenceOnly?'occurrence':frequency} disabled={occurrenceOnly} onChange={e=>{setFrequency(e.target.value as typeof frequency);setRepeatDirty(true)}}>
     {occurrenceOnly?<option value="occurrence">Repeating series</option>:<><option value="none">Never</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>{frequency==='existing'&&<option value="existing">Custom pattern</option>}</>}
    </select></label>
    {occurrenceOnly?<p className="field-help">Choose “The whole series” above to change how it repeats.</p>:repeatEnabled&&<>
     <div className="repeat-interval"><label>Repeat every<input type="number" required min="1" max="999" step="1" inputMode="numeric" value={Number.isNaN(repeat.interval)?'':repeat.interval} onChange={e=>changeRepeat({interval:e.target.valueAsNumber})}/></label><span>{{DAILY:'day(s)',WEEKLY:'week(s)',MONTHLY:'month(s)',YEARLY:'year(s)'}[frequency]}</span></div>
     <p className="field-help">{frequency==='WEEKLY'?`On ${new Date(start+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'long'})}. Use 2 weeks for biweekly.`:frequency==='MONTHLY'?'On this day of the month. Months without that date are skipped.':frequency==='YEARLY'?'On this date each year. February 29 repeats in leap years.':'Counted in calendar days, keeping the same Eastern time.'}</p>
     <label>Repeat ends<select className="repeat-end-select" value={repeat.ending} onChange={e=>changeRepeat({ending:e.target.value as RepeatOptions['ending']})}><option value="never">Never</option><option value="on">On a date</option><option value="after">After a number of occurrences</option></select></label>
     {repeat.ending==='on'&&<label>Last repeat date<input type="date" required min={start} value={repeat.until} onChange={e=>changeRepeat({until:e.target.value})}/></label>}
     {repeat.ending==='after'&&<label>Number of occurrences<input type="number" min="1" max="9999" step="1" required value={Number.isNaN(repeat.count)?'':repeat.count} onChange={e=>changeRepeat({count:e.target.valueAsNumber})}/><span className="field-help">Includes the first event.</span></label>}
     {Number.isInteger(repeat.interval)&&repeat.interval>0&&<p className="repeat-summary">{repeatDescription({...repeat,frequency:frequency as RepeatFrequency})}</p>}
    </>}
    </div>


     </div>
     <fieldset className="event-tag-picker"><legend>Who's it for?</legend><label><input type="checkbox" checked={!unassigned&&!taggedIds.length} onChange={()=>{setUnassigned(false);setTaggedIds([]);setTagsChanged(true)}}/><Check size={14} className="event-chip-check"/><span>Everyone</span></label><label><input type="checkbox" aria-label="No one selected" checked={unassigned} onChange={()=>{setUnassigned(true);setTaggedIds([]);setTagsChanged(true);setReminder30(false);setReminder(null)}}/><Check size={14} className="event-chip-check"/><span>No one</span></label>{profiles.map(p=><label key={p.id} title={p.name}><input type="checkbox" aria-label={p.name} checked={!unassigned&&taggedIds.includes(p.id)} onChange={e=>{setUnassigned(false);setTagsChanged(true);setTaggedIds(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}}/><i className="person-dot" style={{backgroundColor:p.color}}/><span>{profiles.filter(other=>other.name.split(/\s+/)[0]===p.name.split(/\s+/)[0]).length===1?p.name.split(/\s+/)[0]:p.name}</span><Check size={12} className="event-person-check"/></label>)}</fieldset>
     <p className="event-sharing-note">{unassigned?'Visible to your household. No notifications.':'Shared with your household.'}</p>
     <div className="event-input-group event-alerts">
      <label className="event-setting-row"><span><Bell size={16}/>30-minute alert</span><input className="event-compact-switch" type="checkbox" role="switch" aria-label="30-minute alert" checked={!unassigned&&reminder30} disabled={unassigned} onChange={e=>setReminder30(e.target.checked)}/></label>
      <label className="event-setting-row"><span><BellPlus size={16}/>Additional alert</span><select aria-label="Event reminder" disabled={unassigned} value={unassigned||reminder===null?'none':String(reminder)} onChange={e=>setReminder(e.target.value==='none'?null:Number(e.target.value))}><option value="none">None</option>{Array.from(new Set([0,5,10,15,60,120,1440,2880,10080,...(reminder==null?[]:[reminder])])).sort((a,b)=>a-b).map(m=><option key={m} value={m}>{reminderLabel(m)}</option>)}</select></label>
      <label className="event-setting-row"><span><Timer size={16}/>Show countdown</span><input className="event-compact-switch" type="checkbox" role="switch" aria-label="Show countdown" checked={countdown} disabled={connected||occurrenceOnly} onChange={e=>setCountdown(e.target.checked)}/></label>
      {(connected||occurrenceOnly||allDay)&&<p className="field-help">{connected?'Countdowns are available after the calendar moves to HH.':occurrenceOnly?'To change the countdown, choose The whole series above.':''}{allDay?' All-day alerts count back from 9 AM Eastern.':''}</p>}
     </div>
     <div className="event-input-group event-notes"><label>Notes<textarea aria-label="Notes (optional)" rows={2} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Anything the family should know…"/></label></div>
     <p className="event-context-note">Times shown in Eastern time.</p>
    </fieldset></form>
       {event&&<div className="event-delete">{confirmDelete?<><p>Delete {changeLabel} for everyone?</p><button className="button danger" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onDelete(current!);onClose()}catch(e){setError(errorText(e))}finally{setBusy(false)}}}>Yes, delete {wholeSeries?'whole series':event.recurring?'occurrence':'event'}</button><button className="text-button" disabled={busy} onClick={()=>setConfirmDelete(false)}>Keep event</button></>:<button className="text-button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/>Delete {wholeSeries?'whole series':event.recurring?'occurrence':'event'}</button>}</div>}

   </div>
   {guard.confirmation}
  </section>
 </div>;
}

