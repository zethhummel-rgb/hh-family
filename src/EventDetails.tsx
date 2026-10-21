import {reminderLabel} from '../supabase/functions/google-calendar/reminders';
import PeopleDots from './PeopleDots';
import type {PersonProfile} from './people';
import {useEffect,useRef} from 'react';
import {CalendarDays,Bell,Clock,MapPin,Users,Pencil,X} from 'lucide-react';
import {eventDateLabel,eventTime,TIME_ZONE,type FamilyEvent} from './calendarData';

export default function EventDetails({event,onClose,onEdit,profiles}:{profiles:PersonProfile[];event:FamilyEvent;onClose:()=>void;onEdit:(event:FamilyEvent)=>void}){
 const modal=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement;
  modal.current?.querySelector('button')?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape')close.current();
   if(e.key==='Tab'){
    const buttons=Array.from(modal.current?.querySelectorAll<HTMLButtonElement>('button')||[]);
    if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus()}
    else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus()}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);previous?.focus()};
 },[]);
 const endTime=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date(event.ends_at));
 return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section ref={modal} className="modal event-details" role="dialog" aria-modal="true" aria-labelledby="event-details-title">
   <button type="button" className="modal-close icon-button" aria-label="Close event details" onClick={onClose}><X/></button>
   <span className="round-icon sage"><CalendarDays/></span>
   <span className="eyebrow details-eyebrow">FAMILY PLANS</span>
   <h2 id="event-details-title">{event.title}</h2>
   <dl className="event-details-list">
    <div><CalendarDays aria-hidden="true"/><div><dt>Date</dt><dd>{eventDateLabel(event)}</dd></div></div>
    <div><Clock aria-hidden="true"/><div><dt>Time</dt><dd>{event.all_day?'All day':eventTime(event)+' – '+endTime}</dd>{!event.all_day&&<small>Eastern time</small>}</div></div>
    <div><Users aria-hidden="true"/><div><dt>For</dt><dd><PeopleDots event={event} profiles={profiles}/></dd></div></div>
    <div><Bell aria-hidden="true"/><div><dt>Reminders</dt><dd>30 minutes before{event.reminder_minutes!=null&&event.reminder_minutes!==30?` · ${reminderLabel(event.reminder_minutes)}`:''}</dd>{event.all_day&&<small>Counted from 9 AM Eastern</small>}</div></div>
    {event.location&&<div><MapPin aria-hidden="true"/><div><dt>Location</dt><dd>{event.location}</dd></div></div>}
   </dl>
   {event.description&&<div className="event-details-notes"><h3>Notes</h3><p>{event.description}</p></div>}
   {event.recurring&&<p className="event-details-recurring">Part of a repeating event. Edit to change one occurrence or the whole series.</p>}
   <div className="event-details-actions"><button type="button" className="button soft" onClick={onClose}>Close</button><button type="button" className="text-button details-edit" onClick={()=>onEdit(event)}><Pencil size={15}/>Edit</button></div>
  </section>
 </div>;
}
