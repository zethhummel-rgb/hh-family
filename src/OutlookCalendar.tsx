import {useEffect,useId,useRef,useState} from 'react';
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

export default function OutlookCalendar({householdId,userId,returned}:{
 householdId:string;userId:string;returned?:'return'|'denied'
}){
 const [status,setStatus]=useState<Status|null>(null),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [importEvents,setImportEvents]=useState(false);
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
   setSelected(action==='create_family'?result.calendarId:'');
   if(action==='create_family'){setImportEvents(false);setNotice('HH Family is ready to connect.')}
   if(action==='sync')setNotice(result.skipped?'Sync is already running or needs you to reconnect.':result.problem?'':'Calendar synced.');
  }catch(err){setError((err as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }

 if(!status?.available)return null;
 const choices=status.calendars;
 return <div className="settings-detail-card settings-calendar-card outlook-calendar-card">
  <h3>Outlook Calendar</h3>
  {choices?<form onSubmit={event=>{event.preventDefault();void run('connect',{calendarId:selected,importEvents})}}>
   <p>Choose an existing Outlook calendar or create one for your HH plans.</p>
   <label htmlFor={pickerId}>Outlook calendar</label>
   <select id={pickerId} required value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}>
    <option value="">Choose a calendar</option>
    {choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}
   </select>
   {!status.calendarName&&<button type="button" className="text-button" disabled={busy} onClick={()=>void run('create_family')}>Create HH Family calendar</button>}
   <fieldset className="outlook-calendar-modes" disabled={busy}>
    <legend>How should this calendar sync?</legend>
    <label><input type="radio" name={pickerId+'-mode'} checked={!importEvents} onChange={()=>setImportEvents(false)}/> <span>Share HH events<span className="settings-caption">Outlook-only events stay in Outlook. Edits and deletions to shared events carry over.</span></span></label>
    <label><input type="radio" name={pickerId+'-mode'} checked={importEvents} onChange={()=>setImportEvents(true)}/> <span>Import and keep in sync<span className="settings-caption">Events from this Outlook calendar, including their notes and locations, become visible to everyone in your HH household.</span></span></label>
   </fieldset>
   <button type="submit" className="button soft wide" disabled={busy||!selected}>Connect selected calendar</button>
   <button type="button" className="text-button" disabled={busy} onClick={()=>void run('cancel_picker')}>Cancel</button>
  </form>:<>
   <p>{status.active?<><strong>{status.calendarName}</strong> · {status.importEvents?'Import and keep in sync':'Sharing HH events'}</>:'Connect a calendar from your personal Outlook or Hotmail account.'}</p>
   <p className="settings-caption">The trial covers ordinary one-time events. Private events, meetings and repeating events stay in their original calendar.</p>
   {status.syncedAt&&status.active&&<p className="settings-caption">Last synced {new Date(status.syncedAt).toLocaleString()}</p>}
   {status.problem&&<p role="status">{problems[status.problem]}</p>}
   {status.active&&status.problem!=='reconnect'&&<button type="button" className="button soft wide" disabled={busy} onClick={()=>void run('sync')}>{busy?'Working…':'Sync now'}</button>}
   {(!status.active||status.problem==='reconnect')&&<button type="button" className="button soft wide" disabled={busy} onClick={()=>void run('authorize')}>{status.calendarName?'Reconnect Outlook':'Connect Outlook'}</button>}
   {status.active&&<button type="button" className="text-button" disabled={busy} onClick={()=>void run('disconnect')}>Disconnect Outlook</button>}
  </>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </div>;
}
