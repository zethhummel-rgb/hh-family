import {useEffect,useId,useRef,useState} from 'react';
import {authenticatedCalendarRequest} from './calendarAuth';
import {completeOutlookReturn} from './outlookCalendarReturn';
import {supabase} from './supabase';
import CalendarSetupChoices,{type CalendarSetupMode} from './CalendarSetupChoices';

type Choice={id:string;name:string};
type Status={available:boolean;active?:boolean;calendarName?:string;syncedAt?:string;calendars?:Choice[];importEvents?:boolean;
 problem?:'retry'|'reconnect'|'review'|null};
const problems={
 retry:'Outlook sync was interrupted. Try again in a moment.',
 reconnect:'Reconnect Outlook to continue syncing.',
 review:'Some events need review. HH kept both copies where it found a conflict.'
};

function savedMode(key:string):CalendarSetupMode|null{
 try{
  const saved=sessionStorage.getItem(key);
  return saved==='share'||saved==='two-way'?saved:null;
 }catch{return null}
}

export default function OutlookCalendar({householdId,userId,returned}:{
 householdId:string;userId:string;returned?:'return'|'denied'
}){
 const [status,setStatus]=useState<Status|null>(null),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const setupKey='hh-test:outlook-setup:'+householdId+':'+userId;
 const [mode,setMode]=useState<CalendarSetupMode|null>(()=>savedMode(setupKey));
 const pickerId=useId();
 const pending=useRef(false);
 function chooseMode(next:CalendarSetupMode|null){
  setMode(next);
  try{
   if(next)sessionStorage.setItem(setupKey,next);
   else sessionStorage.removeItem(setupKey);
  }catch{}
 }
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
    if(returned==='denied'&&active){chooseMode(null);setError('Microsoft sign-in was cancelled. You can try again.')}
   }catch(err){if(active)setError((err as Error).message)}
   try{const next=await request('status');if(active)setStatus(next)}
   catch{if(active&&returned){setStatus({available:true});setError('Outlook is unavailable right now. Try again later.')}}
  }
  void check();
  return()=>{active=false};
 },[householdId,userId,returned]);

 async function run(action:string,fields:Record<string,unknown>={},startMode?:CalendarSetupMode){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await request(action,fields);
   if(action==='authorize'){
    const url=new URL(result.url);
    if(url.origin!=='https://login.microsoftonline.com'||url.pathname!=='/consumers/oauth2/v2.0/authorize')
     throw Error('Microsoft sign-in is unavailable.');
    if(startMode)chooseMode(startMode);
    location.assign(url.href);
    return;
   }
   setStatus(await request('status'));
   if(action==='create_family'){setSelected(result.calendarId);setNotice('HH Family is selected. Start syncing to finish setup.')}
   if(action==='connect'||action==='cancel_picker'||action==='disconnect'){
    setSelected('');chooseMode(null);
   }
   if(action==='connect')setNotice('Outlook calendar connected. Your first sync will start shortly.');
   if(action==='sync')setNotice(result.skipped?'Sync is already running or needs you to reconnect.':result.problem?'':'Calendar synced.');
  }catch(err){setError((err as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }

 if(!status?.available)return null;
 const choices=status.calendars;
 const familyCalendars=choices?.filter(choice=>choice.name.trim().toLowerCase()==='hh family')??[];
 const destination=choices?.find(choice=>choice.id===selected);
 const twoWay=mode==='two-way';
 return <div className="settings-detail-card settings-calendar-card outlook-calendar-card">
  <h3>Outlook Calendar</h3>
  {choices?<div className="calendar-setup-picker">
   <p className="settings-connection"><i className="connected"/>Signed in to Microsoft</p>
   {mode?<form onSubmit={event=>{event.preventDefault();if(destination)void run('connect',{calendarId:destination.id,importEvents:twoWay})}}>
    <p><strong>{twoWay?'Sync both ways':'Send HH events to Outlook'}</strong></p>
    <p>{status.calendarName?<>Choose <strong>{status.calendarName}</strong> again to reconnect.</>:
     'Choose a calendar in Outlook for your HH plans.'}</p>
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
    <p className="settings-caption">{twoWay?
     <>Everyone in your HH household can see events, notes and locations from <strong>{destination?.name??'the selected calendar'}</strong>. New events, edits and deletions sync both ways.</>:
     <>HH sends events to <strong>{destination?.name??'the selected calendar'}</strong>. Edits and deletions to those shared events carry over. New events created only in Outlook stay there.</>}</p>
    <p className="settings-caption">Repeating events, meetings and private events stay in their original calendar.</p>
    <button type="submit" className="button primary wide" disabled={busy||!destination}>{twoWay?'Start two-way sync':'Start sharing to Outlook'}</button>
    <button type="button" className="text-button" disabled={busy} onClick={()=>{setNotice('');chooseMode(null)}}>Change how it syncs</button>
   </form>:<CalendarSetupChoices provider="Outlook" heading="Choose how to sync your plans." onChoose={chooseMode} disabled={busy}/>}
   <button type="button" className="text-button" disabled={busy} onClick={()=>void run('cancel_picker')}>Cancel Outlook setup</button>
  </div>:<>
   {status.active?<p><strong>{status.calendarName}</strong> · {status.importEvents?'Syncing both ways':'Sharing HH events'}<br/>Find it in Outlook under My calendars.</p>:
    <CalendarSetupChoices provider="Outlook" heading="Choose how to sync your plans. You’ll sign in with Microsoft next."
     disabled={busy} onChoose={next=>void run('authorize',{},next)}/>}
   <p className="settings-caption">One-time events and standard daily, weekly, monthly and yearly repeats can sync. Private events, meetings and custom repeat patterns stay in their original calendar.</p>
   {status.syncedAt&&status.active&&<p className="settings-caption">Last synced {new Date(status.syncedAt).toLocaleString()}</p>}
   {status.problem&&<p role="status">{problems[status.problem]}</p>}
   {status.active&&status.problem!=='reconnect'&&<button type="button" className="button soft wide" disabled={busy} onClick={()=>void run('sync')}>{busy?'Working…':'Sync now'}</button>}
   {status.active&&status.problem==='reconnect'&&<button type="button" className="button soft wide" disabled={busy}
    onClick={()=>void run('authorize',{},status.importEvents?'two-way':'share')}>Reconnect Outlook</button>}
   {status.active&&<button type="button" className="text-button" disabled={busy} onClick={()=>void run('disconnect')}>Disconnect Outlook</button>}
  </>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </div>;
}
