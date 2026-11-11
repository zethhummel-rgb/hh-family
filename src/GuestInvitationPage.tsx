import {useEffect,useRef,useState} from 'react';
import {CalendarDays,Check} from 'lucide-react';
import {guestEventDate,replyLabels,type Reply} from '../supabase/functions/event-guests/event';
import {calendarFile,googleCalendarLink} from './guestCalendar';
import {guestHHCalendar,guestSignInLink,publicGuestRequest,replyStatus,type GuestInvitation,type GuestCalendarStatus} from './eventGuestApi';
import './event-guests.css';

export default function GuestInvitationPage({token,suggested}:{token:string;suggested:Reply|null}){
 const [invite,setInvite]=useState<GuestInvitation|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[calendar,setCalendar]=useState(false);
 const [hh,setHH]=useState<GuestCalendarStatus|null>(null),[hhBusy,setHHBusy]=useState(false),[hhAdded,setHHAdded]=useState(false);
 const sending=useRef(false),calendarHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  let current=true;
  publicGuestRequest('preview',token).then(data=>{if(current){
   setInvite(data);setCalendar(suggested!=='no'&&(data.reply==='yes'||data.reply==='maybe'));
  }}).catch(e=>{if(current)setError(e.message)});
  return()=>{current=false};
 },[token,suggested]);
 useEffect(()=>{if(calendar)calendarHeading.current?.focus()},[calendar]);
 useEffect(()=>{
  if(!calendar)return;
  let current=true,revision=0;
  const refresh=()=>{
   const request=++revision;
   guestHHCalendar(token).then(result=>{if(current&&request===revision)setHH(result)}).catch(()=>{if(current&&request===revision)setHH({state:'unavailable'})});
  };
  refresh();window.addEventListener('focus',refresh);
  return()=>{current=false;window.removeEventListener('focus',refresh)};
 },[calendar,token]);

 async function respond(reply:Reply){
  if(sending.current)return;
  sending.current=true;setBusy(true);setError('');setCalendar(false);setHH(null);setHHAdded(false);
  try{setInvite(await publicGuestRequest('respond',token,reply));setCalendar(reply!=='no')}
  catch(e){setError((e as Error).message)}
  finally{sending.current=false;setBusy(false)}
 }

 async function addToHH(){
  if(hhBusy)return;
  setHHBusy(true);setError('');
  try{const result=await guestHHCalendar(token,true);setHH(result);setHHAdded(result.state==='view')}
  catch(e){setError((e as Error).message)}
  finally{setHHBusy(false)}
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
     {hhAdded&&<p className="guest-rsvp-status" role="status">Added to your HH calendar.</p>}
     {hh?.state==='view'&&<a className="button primary" href={'./?'+new URLSearchParams({reminder_event:hh.eventId,reminder_date:hh.date})}>View in HH Calendar</a>}
     {hh?.state==='add'&&<button type="button" className="button primary" disabled={hhBusy} onClick={()=>void addToHH()}>{hhBusy?'Adding…':'Add to HH Calendar'}</button>}
     {hh?.state==='sign-in'&&<a className="button soft" href={guestSignInLink(token,invite.reply)}>Sign in to add to HH</a>}
     {hh?.state==='wrong-account'&&<p className="field-help">Use the HH account for the invited email address. <a href="./" target="_blank" rel="noreferrer">Open HH to switch accounts</a></p>}
     {hh?.state==='no-household'&&<p className="field-help">Set up your HH household to add this event to its calendar.</p>}
     {hh?.state==='unavailable'&&<p className="field-help">HH Calendar is unavailable for this invitation right now.</p>}
     <a className="button soft" href={googleCalendarLink(invite.event,invite.message)} target="_blank" rel="noreferrer">Google Calendar</a>
     <button type="button" className="button soft" onClick={download}>Apple Calendar or Outlook (.ics)</button>
     <p className="field-help">Open the event in your calendar and save it.</p>
     <button type="button" className="text-button" disabled={hhBusy} onClick={()=>{setCalendar(false);setHH(null)}}>Change my reply</button>
    </section>:<div className="guest-reply-actions">
     {(Object.keys(replyLabels) as Reply[]).map(reply=><button key={reply} type="button" className={'button '+(reply===(suggested||'yes')?'primary':'soft')} disabled={busy} onClick={()=>void respond(reply)}>{replyLabels[reply]}</button>)}
    </div>}
   </>:<><h1>Event invitation</h1>{!error&&<p role="status">Opening your invitation…</p>}</>}
   {error&&<p className="error" role="alert">{error}</p>}
  </article>
 </main>;
}
