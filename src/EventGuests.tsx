import {createContext,useCallback,useEffect,useRef,useState} from 'react';
import {MailPlus} from 'lucide-react';
import type {FamilyEvent} from './calendarData';
import {eventDateLabel,eventTime} from './calendarData';
import {testEnvironment} from './config';
import {hostGuestRequest,replyStatus,type Guest,type GuestDelivery} from './eventGuestApi';
import {replyLabels,type Reply} from '../supabase/functions/event-guests/event';
import './event-guests.css';

export const EventGuestContext=createContext(false);

const deliveryLabels={sending:'Sending',sent:'Awaiting reply',unknown:'Delivery unconfirmed',preview:'Awaiting reply'};

type EditorOptions={saveForm?:string;series:boolean;disabled:boolean;onBusyChange:(busy:boolean)=>void};

export default function EventGuests({event,editor}:{event:FamilyEvent|null;editor?:EditorOptions}){
 const [open,setOpen]=useState(false),[guests,setGuests]=useState<Guest[]>([]),[loaded,setLoaded]=useState(false);
 const [email,setEmail]=useState(''),[message,setMessage]=useState(''),[review,setReview]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[cancel,setCancel]=useState<Guest|null>(null);
 const [preview,setPreview]=useState<GuestDelivery['preview']>();
 const pending=useRef(false),input=useRef<HTMLInputElement>(null);
 const id=event?.series_id||event?.id,occurrence=event?.original_date||'';
 const past=!!event&&Date.parse(event.ends_at)<=Date.now();
 const locked=busy||editor?.disabled;
 const {saveForm,series,onBusyChange}=editor||{};
 const load=useCallback(async()=>{
  if(!id)return;
  setError('');
  try{setGuests(await hostGuestRequest<Guest[]>('list',id,occurrence));setLoaded(true)}
  catch(e){setError((e as Error).message)}
 },[id,occurrence]);
 useEffect(()=>{if(open&&!series)void load()},[open,series,load]);
 useEffect(()=>{setReview(false)},[id,occurrence,event?.version]);
 useEffect(()=>{if(onBusyChange&&open&&!saveForm&&!series)input.current?.focus()},[onBusyChange,open,saveForm,series]);

 async function change(action:'send'|'revoke'){
  if(pending.current||locked||!event||!id||series||(action==='send'&&saveForm))return;
  pending.current=true;setBusy(true);onBusyChange?.(true);setError('');setNotice('');
  try{
   if(action==='send'){
    const result=await hostGuestRequest<GuestDelivery>('send',id,occurrence,{email,message,version:event.version});
    setNotice(result.delivery==='preview'?'TEST invitation ready. Open a reply link below.':result.delivery==='sent'?'Invitation sent.':'Email delivery could not be confirmed.');
    setPreview(result.preview);setReview(false);setEmail('');setMessage('');
   }else{
    const result=await hostGuestRequest<{revoked:boolean}>('revoke',id,occurrence,{id:cancel?.id});
    setNotice(result.revoked?'Invitation cancelled.':'This invitation is already unavailable.');
    setCancel(null);setPreview(undefined);
   }
   await load();
  }catch(e){setError((e as Error).message)}
  finally{pending.current=false;setBusy(false);onBusyChange?.(false)}
 }

 return <section className="event-guest-section" aria-label="Event guests">
  <button className="button soft" type="button" aria-expanded={open} disabled={locked} onClick={()=>setOpen(v=>!v)}><MailPlus size={17}/>{editor?'Invite friends':'Invite guests & view RSVPs'}</button>
  {open&&<>
   {series?<p className="field-help">To invite friends to a repeating event, open the date you want to share.</p>:saveForm?<div className="event-guest-prepare">
    <p className="field-help">{event?'Save your changes before reviewing the invitation.':'Save this event to open the invitation form.'}</p>
    <button type="submit" className="button soft" form={saveForm} name="intent" value="invite" disabled={locked}>Save &amp; invite friends</button>
   </div>:event&&!past&&<form onSubmit={e=>{e.preventDefault();setReview(true);setError('');setNotice('');setPreview(undefined)}}>
    <label>Guest email<input ref={input} type="email" maxLength={254} required value={email} disabled={locked||review} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Message for this guest (optional)<textarea maxLength={500} rows={2} value={message} disabled={locked||review} onChange={e=>setMessage(e.target.value)}/></label>
    {review?<div className="event-guest-review">
     <h3>Review invitation</h3>
     <p>{email}</p><p><strong>{event.title}</strong><br/>{eventDateLabel(event)} · {event.all_day?'All day':eventTime(event)+' Eastern time'}</p>
     {event.location&&<p>{event.location}</p>}{message.trim()&&<p className="guest-message">{message.trim()}</p>}
     <div className="event-guest-controls">
      <button type="button" className="text-button" disabled={locked} onClick={()=>{setReview(false);requestAnimationFrame(()=>input.current?.focus())}}>Edit address or message</button>
      <button type="button" className="button primary" disabled={locked} onClick={()=>void change('send')}>{busy?'Working…':testEnvironment?'Create TEST invitation':'Send invitation'}</button>
     </div>
    </div>:<button type="submit" className="button soft" disabled={locked}>Review invitation</button>}
   </form>}
   {notice&&<p role="status">{notice}</p>}
   {preview&&<div className="event-guest-preview" aria-label="TEST email links">
    {(Object.keys(replyLabels) as Reply[]).map(reply=><a key={reply} href={preview[reply]} target="_blank" rel="noreferrer">{replyLabels[reply]}</a>)}
   </div>}
   {event&&!series&&<div className="event-guest-responses">
    <h3>Guest replies</h3>
    {guests.length?<ul>{guests.map(guest=><li key={guest.id}>
     <span>{guest.email}<strong>{guest.reply?replyStatus[guest.reply]:deliveryLabels[guest.delivery]}</strong></span>
     {cancel?.id===guest.id?<div className="event-guest-controls">
      <button type="button" className="text-button" disabled={locked} onClick={()=>setCancel(null)}>Keep invitation</button>
      <button type="button" className="button soft" disabled={locked} onClick={()=>void change('revoke')}>Cancel invitation</button>
     </div>:!past&&<button type="button" className="text-button" disabled={locked} aria-label={'Cancel invitation for '+guest.email} onClick={()=>setCancel(guest)}>Cancel</button>}
    </li>)}</ul>:loaded?<p className="field-help">No guests invited yet.</p>:null}
    <button type="button" className="text-button" disabled={locked} onClick={()=>void load()}>Refresh replies</button>
   </div>}
   {error&&<p className="error" role="alert">{error}</p>}
  </>}
 </section>;
}
