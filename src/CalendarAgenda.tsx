import {dateObj,eventDate,eventEndDate,eventTime,TIME_ZONE,type FamilyEvent} from './calendarData';
import PeopleDots from './PeopleDots';
import type {PersonProfile} from './people';
import type {CalendarHoliday} from './calendarHolidays';

/** An event ending at midnight belongs to the preceding day only. */
export function eventsOnDay(events:FamilyEvent[],date:string){
 return events.filter(e=>eventDate(e)<=date&&eventEndDate(e)>=date)
  .sort((a,b)=>Number(b.all_day)-Number(a.all_day)||a.starts_at.localeCompare(b.starts_at)||a.title.localeCompare(b.title));
}
export function agendaTime(event:FamilyEvent,date:string){
 if(event.all_day||eventDate(event)===date)return eventTime(event);
 return eventEndDate(event)===date?'Until '+new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date(event.ends_at)):'Continues';
}
export default function CalendarAgenda({dates,events,profiles,today,threeDay,filtered,holidayOn,onEdit}:{dates:string[];events:FamilyEvent[];profiles:PersonProfile[];today:string;threeDay:boolean;filtered:boolean;holidayOn:(date:string)=>CalendarHoliday|undefined;onEdit:(event:FamilyEvent)=>void}){
 return <div className={'compact-agenda'+(threeDay?' three-day-agenda':'')} aria-label={threeDay?'Three day calendar':'Agenda calendar'}>
  {dates.map(date=>{const items=eventsOnDay(events,date),day=dateObj(date),holiday=holidayOn(date);return <section key={date} className={'agenda-day'+(date===today?' is-today':'')} aria-label={day.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} data-date={date}>
   <h3 className="agenda-day-date"><span>{day.toLocaleDateString('en-CA',{weekday:'short'})}</span><b>{day.getDate()}</b><small>{day.toLocaleDateString('en-CA',{month:'short'})}</small>{date===today&&<em>Today</em>}</h3>
   <div className="agenda-day-events">{holiday&&<p className="calendar-holiday agenda-holiday">{holiday.name}</p>}{items.map(event=><button key={event.id} className="agenda-event" onClick={()=>onEdit(event)}>
    <span className="agenda-event-time">{agendaTime(event,date)}</span>
    <span className="agenda-event-copy"><b>{event.title}</b><span className="agenda-event-meta"><PeopleDots event={event} profiles={profiles}/>{event.location&&<span className="agenda-event-location">{event.location}</span>}</span></span>
   </button>)}{!items.length&&!holiday&&<p className="agenda-no-plans">{filtered?'No matching plans':'No plans'}</p>}</div>
  </section>})}
 </div>;
}
