import {useEffect,useId,useState} from 'react';
import {googleRequest} from './calendarData';
import {completePersonalCalendarReturn} from './personalCalendarReturn';
import CalendarSetupChoices from './CalendarSetupChoices';

type Connection={
 configured:boolean;available:boolean;twoWayAvailable?:boolean;usesExistingCopy:boolean;connected:boolean;
 status:'off'|'pending'|'up_to_date'|'reconnect'|'needs_attention'|'retry';
 twoWay?:{enabled:boolean;ready:boolean};
 existingSource?:boolean;calendarName?:string;choices?:{id:string;name:string}[];
};
const labels={
 off:'Google Calendar is off',pending:'Updating your Google copy',up_to_date:'Google copy is up to date',
 reconnect:'Reconnect to keep syncing',needs_attention:'Some events couldn’t sync',retry:'Waiting to retry sync'
};
export default function PersonalGoogleCalendar({householdId,userId,returnResult,onSetupComplete,onSetupCancel}:{
 householdId:string;userId:string;returnResult?:'return'|'denied';onSetupComplete?:()=>void;onSetupCancel?:()=>void;
}){
 const [connection,setConnection]=useState<Connection|null>(null);
 const [busy,setBusy]=useState(false),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState(''),[share,setShare]=useState(false);
 const pickerId=useId();
 const request=(action:string,payload:Record<string,unknown>={})=>googleRequest('personal_'+action,{householdId,...payload});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  const load=()=>googleRequest('personal_status',{householdId}).then(data=>{if(active)setConnection(data);return data as Connection});
  const initialLoad=async()=>{
   let completed=false;
   if(returnResult==='denied')setNotice('Google Calendar permission was declined.');
   if(returnResult==='return'&&!retry){
    setBusy(true);
    try{
     await completePersonalCalendarReturn(householdId+':'+userId,receipt=>googleRequest('personal_complete',{householdId,...receipt}));
     completed=true;
    }catch(e){if(active)setError((e as Error).message)}
    finally{if(active)setBusy(false)}
   }
   try{
    const current=await load();
    if(active&&completed&&current.connected&&!current.choices){
     setNotice(current.twoWay?.enabled?'Google Calendar connected for two-way sync.':'Google Calendar connected. Your HH events will start syncing.');
     onSetupComplete?.();
    }
   }catch{if(active)setError(current=>current||'Could not load your Google connection.')}
  };
  void initialLoad();
  const timer=setInterval(()=>{if(!document.hidden)void load().catch(()=>{})},60000);
  return()=>{active=false;clearInterval(timer)};
 },[householdId,userId,returnResult,retry,onSetupComplete]);
 async function connect(action:'start'|'existing_start'|'two_way_copy_start'){
  setBusy(true);setError('');setNotice('');
  try{
   const data=await request(action);
   if(typeof data.url!=='string'||new URL(data.url).origin!=='https://accounts.google.com')throw Error('Could not open Google Calendar.');
   location.assign(data.url);
  }catch(e){setError((e as Error).message);setBusy(false)}
 }
 async function finishExisting(cancel=false){
  setBusy(true);setError('');setNotice('');
  try{
   if(cancel)await request('existing_cancel');
   else await request('existing_connect',{calendarId:selected,acknowledgeShared:share});
   setConnection(await request('status'));setSelected('');setShare(false);
   if(cancel)onSetupCancel?.();
   else{setNotice('Google Calendar connected for two-way sync.');onSetupComplete?.()}
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function disconnect(){
  setBusy(true);setError('');setNotice('');
  try{
   await request('disconnect');
   setConfirmDisconnect(false);
   setConnection(current=>current?{...current,connected:false,status:'off'}:null);
   setNotice('Google Calendar disconnected.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function updateTwoWay(enabled?:boolean){
  setBusy(true);setError('');setNotice('');
  try{
   const twoWay=await (enabled===undefined?request('two_way_sync'):request('two_way_set',{enabled}));
   setConnection(current=>current?{...current,twoWay}:null);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 if(connection?.usesExistingCopy)return null;
 return <div className="settings-detail-card settings-calendar-card">
  <h3>My Google Calendar</h3>
  {(connection&&!connection.twoWayAvailable||connection?.connected)&&!connection?.choices&&<p>{connection?.existingSource?
   <><strong>{connection.calendarName}</strong> · Syncing both ways</>:connection?.twoWay?.enabled?
   'Edits and deletions to one-time events and supported repeating events sync both ways. This also works in Outlook when it shows the connected Google calendar.':
   connection?.connected?'Find the calendar HH created under My calendars in Google Calendar.':
   'See your household’s HH events on your connected Google calendar.'}</p>}
  {connection?.connected&&!connection.choices&&<span className="settings-connection"><i className="connected"/>{labels[connection.status]}</span>}
  {(busy||notice)&&<p role="status">{busy?'Working on your Google connection…':notice}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {!connection&&!error&&!busy&&<p role="status">Loading your Google connection…</p>}
  {!connection&&error&&<button type="button" className="text-button" onClick={()=>{setError('');setRetry(n=>n+1)}}>Try again</button>}
  {connection&&!connection.configured&&<p>Personal Google Calendar connections are being prepared.</p>}
  {connection?.choices&&<form className="calendar-setup-picker google-calendar-sync-picker" onSubmit={event=>{event.preventDefault();void finishExisting()}}>
   <p className="settings-connection"><i className="connected"/>Signed in to Google</p>
   <p>Choose the Google calendar you want to use in both apps, then start two-way sync.</p>
   <label htmlFor={pickerId}>Google calendar</label>
   <select id={pickerId} required disabled={busy} value={selected} onChange={event=>{setSelected(event.target.value);setShare(false)}}>
    <option value="">Choose a calendar</option>
    {connection.choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}
   </select>
   {!connection.choices.length&&<p>Google did not return a writable calendar available to connect.</p>}
   <label className="google-calendar-sync-consent"><input type="checkbox" disabled={busy||!selected} checked={share} onChange={event=>setShare(event.target.checked)}/>Share ordinary events, notes, and locations from this calendar with everyone in my HH household. Edits and deletions can sync both ways.</label>
   <button type="submit" className="button primary wide" disabled={busy||!selected||!share}>Start two-way sync</button>
   <button type="button" className="text-button" disabled={busy} onClick={()=>void finishExisting(true)}>Cancel Google connection</button>
  </form>}
  {connection?.configured&&connection.available&&!confirmDisconnect&&!connection.choices&&!(onSetupComplete&&connection.connected)&&(
   connection.twoWayAvailable&&!connection.connected?
    <CalendarSetupChoices disabled={busy} onChoose={calendar=>void connect(calendar==='new'?'two_way_copy_start':'existing_start')}/>:
    <button type="button" className="button soft wide" disabled={busy} onClick={()=>void connect(connection.existingSource?'existing_start':'start')}>
     {connection.connected?'Reconnect my Google Calendar':'Connect my Google Calendar'}
    </button>
  )}
  {connection?.twoWayAvailable&&<a className="text-button" href="https://hhfamily.ca/privacy.html#google-calendar" target="_blank" rel="noopener">How HH uses Google Calendar data</a>}
  {connection?.connected&&connection.twoWay&&!confirmDisconnect&&!connection.choices&&!onSetupComplete&&<div className="settings-calendar-sync">
   {connection.twoWay.enabled?<>
    <p role="status">{connection.twoWay.ready?'Two-way sync is on.':'Preparing two-way sync…'}</p>
    <button type="button" className="button soft" disabled={busy} onClick={()=>void updateTwoWay()}>Sync now</button>{' '}
    {!connection.existingSource&&<button type="button" className="text-button" disabled={busy} onClick={()=>void updateTwoWay(false)}>Turn off two-way sync</button>}
   </>:<>
    <p>Changes from this Google calendar can update or remove shared HH events.</p>
    <button type="button" className="button soft" disabled={busy} onClick={()=>void updateTwoWay(true)}>Enable two-way sync</button>
   </>}
  </div>}
  {connection?.connected&&!confirmDisconnect&&!connection.choices&&!onSetupComplete&&<button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmDisconnect(true)}>Disconnect my Google Calendar</button>}
  {confirmDisconnect&&<div>
   <p>{connection?.existingSource?'Events already copied between HH and Google will stay in both calendars.':'Your copy will stop updating. You can remove the old calendar in Google Calendar.'}</p>
   <button type="button" className="button soft" disabled={busy} onClick={disconnect}>Disconnect</button>{' '}
   <button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmDisconnect(false)}>Cancel</button>
  </div>}
 </div>;
}
