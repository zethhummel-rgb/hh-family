import {useEffect,useRef,useState} from 'react';
import {CalendarDays,Check} from 'lucide-react';
import {guestEventDate,replyLabels,type Reply} from '../supabase/functions/event-guests/event';
import {calendarFile,googleCalendarLink} from './guestCalendar';
import {publicGuestRequest,replyStatus,type GuestInvitation} from './eventGuestApi';
import './event-guests.css';

export default function GuestInvitationPage({token,suggested}:{token:string;suggested:Reply|null}){
 const [invite,setInvite]=useState<GuestInvitation|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[calendar,setCalendar]=useState(false);
 const sending=useRef(false),calendarHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  let current=true;
  publicGuestRequest('preview',token).then(data=>{if(current)setInvite(data)}).catch(e=>{if(current)setError(e.message)});
  return()=>{current=false};
 },[token]);
 useEffect(()=>{if(calendar)calendarHeading.current?.focus()},[calendar]);

 async function respond(reply:Reply){
  if(sending.current)return;
  sending.current=true;setBusy(true);setError('');setCalendar(false);
  try{setInvite(await publicGuestRequest('respond',token,reply));setCalendar(reply!=='no')}
  catch(e){setError((e as Error).message)}
  finally{sending.current=false;setBusy(false)}
 }

 function download(){
  if(!invite)return;
  const url=URL.createObjectURL(new Blob([calendarFile(invite.event,invite.message)],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='hh-event.ics';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }

 return <main className="guest-invitation-page">
  <article className="guest-invitation-card">
   <div className="auth-brand"><img src="./icon.svg" alt=""/><span>HH</span></div>
   {invite?<><p>{invite.sender} invited you</p><h1>{invite.event.title}</h1>
    <p><CalendarDays size={17} aria-hidden="true"/> {guestEventDate(invite.event)}</p>
    {invite.event.location&&<p>{invite.event.location}</p>}
    {invite.message&&<p className="guest-message">{invite.message}</p>}
    {invite.reply&&<p className="guest-rsvp-status" role="status"><Check size={16}/> Your reply: {replyStatus[invite.reply]}</p>}
    {calendar?<section className="guest-calendar-options" aria-labelledby="guest-calendar-title">
     <h2 id="guest-calendar-title" ref={calendarHeading} tabIndex={-1}>Add to your calendar</h2>
     <a className="button soft" href={googleCalendarLink(invite.event,invite.message)} target="_blank" rel="noreferrer">Google Calendar</a>
     <button type="button" className="button soft" onClick={download}>Apple Calendar or Outlook (.ics)</button>
     <p className="field-help">Open the event in your calendar and save it.</p>
     <button type="button" className="text-button" onClick={()=>setCalendar(false)}>Change my reply</button>
    </section>:<div className="guest-reply-actions">
     {(Object.keys(replyLabels) as Reply[]).map(reply=><button key={reply} type="button" className={'button '+(reply===(suggested||'yes')?'primary':'soft')} disabled={busy} onClick={()=>void respond(reply)}>{replyLabels[reply]}</button>)}
    </div>}
   </>:<><h1>Event invitation</h1>{!error&&<p role="status">Opening your invitation…</p>}</>}
   {error&&<p className="error" role="alert">{error}</p>}
  </article>
 </main>;
}
