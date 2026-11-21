import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import {authenticatedCalendarRequest} from './calendarAuth';
import {completeOutlookReturn} from './outlookCalendarReturn';
import {supabase} from './supabase';

type Choice={id:string;name:string};
type Status={available:boolean;active?:boolean;calendarName?:string;syncedAt?:string;calendars?:Choice[];importEvents?:boolean;
 problem?:'retry'|'reconnect'|'review'|null};
const problems={
 retry:'Outlook sync was interrupted. Try again in a moment.',
 reconnect:'Reconnect Outlook to continue syncing.',
 review:'Some events need review. HH kept both copies where it found a conflict.'
};

export default function OutlookCalendar({householdId,userId,returned,onSetupComplete,onSetupCancel}:{
 householdId:string;userId:string;returned?:'return'|'denied';onSetupComplete?:()=>void;onSetupCancel?:()=>void;
}){
 const [status,setStatus]=useState<Status|null>(null),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pickerId=useId();
 const pending=useRef(false);
 async function request(action:string,fields:Record<string,unknown>={}){
  const r=await authenticatedCalendarRequest(supabase,{action,householdId,...fields},'outlook-calendar');
  if(r.error){
   const data=await r.error.context?.json?.().catch(()=>null);
   throw Error(data?.error||'Outlook could not finish this request.');
  }
  return r.data;
 }
 useEffect(()=>{
  let active=true;
  async function check(){
   try{
    if(returned==='return')await completeOutlookReturn(householdId+':'+userId,data=>request('complete',data));
    if(returned==='denied'&&active)setError('Microsoft sign-in was cancelled. You can try again.');
   }catch(err){if(active)setError((err as Error).message)}
   try{const next=await request('status');if(active)setStatus(next)}
  catch{if(active&&returned){setStatus({available:true});setError('Outlook is unavailable right now. Try again later.')}}
  }
  void check();
  return()=>{active=false};
 },[householdId,userId,returned]);

 async function run(action:string,fields:Record<string,unknown>={}){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await request(action,fields);
   if(action==='authorize'){
    const url=new URL(result.url);
    if(url.origin!=='https://login.microsoftonline.com'||url.pathname!=='/consumers/oauth2/v2.0/authorize')
     throw Error('Microsoft sign-in is unavailable.');
    location.assign(url.href);
    return;
   }
   setStatus(await request('status'));
   if(action==='create_family'){setSelected(result.calendarId);setNotice('HH Family is selected. Start syncing to finish setup.')}
   if(action==='connect'||action==='cancel_picker'||action==='disconnect')setSelected('');
   if(action==='connect'){
    setNotice('Outlook calendar connected for two-way sync.');
    onSetupComplete?.();
   }
   if(action==='cancel_picker')onSetupCancel?.();
   if(action==='sync')setNotice(result.skipped?'Sync is already running or needs you to reconnect.':result.problem?'':'Calendar synced.');
  }catch(err){setError((err as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }

 if(!status)return returned==='return'?<p role="status">Checking your Microsoft sign-in…</p>:null;
 if(!status.available)return onSetupComplete?<p role="alert">Outlook Calendar is unavailable for this household.</p>:null;
 const choices=status.calendars;
 const familyCalendars=choices?.filter(choice=>choice.name.trim().toLowerCase()==='hh family')??[];
 const destination=choices?.find(choice=>choice.id===selected);
 return <div className="settings-detail-card settings-calendar-card outlook-calendar-card">
  <h3>Outlook Calendar</h3>
  {choices?<div className="calendar-setup-picker">
   <p className="settings-connection"><i className="connected"/>Signed in to Microsoft</p>
   <form onSubmit={event=>{event.preventDefault();if(destination)void run('connect',{calendarId:destination.id,importEvents:true})}}>
    <p>{status.calendarName?<>Choose <strong>{status.calendarName}</strong> again to reconnect.</>:
     'Create an HH Family calendar or choose an Outlook calendar you already use.'}</p>
    {!status.calendarName&&familyCalendars.length<2&&<button type="button" className="button soft wide calendar-setup-family"
     disabled={busy||familyCalendars[0]?.id===selected} onClick={()=>{
      if(familyCalendars.length){setSelected(familyCalendars[0].id);setNotice('HH Family is selected. Start syncing to finish setup.')}
      else void run('create_family');
     }}>{familyCalendars.length?'Use HH Family calendar':'Create HH Family calendar'}</button>}
    <label htmlFor={pickerId}>Outlook calendar</label>
    <select id={pickerId} required value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setNotice('')}}>
     <option value="">{choices.length?'Choose an Outlook calendar':'Create HH Family to continue'}</option>
     {choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}
    </select>
    <p className="settings-caption">Everyone in your HH household can see synced events, notes and locations from <strong>{destination?.name??'the selected calendar'}</strong>. Add, edit, or delete events in either app.</p>
    <button type="submit" className="button primary wide" disabled={busy||!destination}>Start two-way sync</button>
   </form>
   <button type="button" className="text-button" disabled={busy} onClick={()=>void run('cancel_picker')}>Cancel Outlook setup</button>
  </div>:<>
   {status.active?<p><strong>{status.calendarName}</strong> · {status.importEvents?'Syncing both ways':'Sharing HH events'}<br/>Find it in Outlook under My calendars.</p>:
    <button type="button" className="calendar-setup-option" aria-labelledby={pickerId+'-title'} aria-describedby={pickerId+'-help'} disabled={busy} onClick={()=>void run('authorize')}>
     <RefreshCw size={19} aria-hidden="true"/><span><strong id={pickerId+'-title'}>Use both HH and Outlook</strong><small id={pickerId+'-help'}>Add, edit, or delete events in either app. Choose a calendar after signing in.</small></span><ArrowRight size={17} aria-hidden="true"/>
    </button>}
   <p className="settings-caption">One-time events and standard daily, weekly, monthly and yearly repeats can sync. Private events, meetings and custom repeat patterns stay in their original calendar.</p>
   {status.syncedAt&&status.active&&<p className="settings-caption">Last synced {new Date(status.syncedAt).toLocaleString()}</p>}
   {status.problem&&<p role="status">{problems[status.problem]}</p>}
   {status.active&&!onSetupComplete&&status.problem!=='reconnect'&&<button type="button" className="button soft wide" disabled={busy} onClick={()=>void run('sync')}>{busy?'Working…':'Sync now'}</button>}
   {status.active&&!onSetupComplete&&(status.problem==='reconnect'||!status.importEvents)&&<button type="button" className="button soft wide" disabled={busy}
    onClick={()=>void run('authorize')}>{status.problem==='reconnect'?'Reconnect Outlook':'Enable two-way Outlook sync'}</button>}
   {status.active&&!onSetupComplete&&<button type="button" className="text-button" disabled={busy} onClick={()=>void run('disconnect')}>Disconnect Outlook</button>}
  </>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </div>;
}
