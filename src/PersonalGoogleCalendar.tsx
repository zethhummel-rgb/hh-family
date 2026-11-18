import {useEffect,useState} from 'react';
import {googleRequest} from './calendarData';
import {completePersonalCalendarReturn} from './personalCalendarReturn';

type Connection={
 configured:boolean;available:boolean;usesExistingCopy:boolean;connected:boolean;
 status:'off'|'pending'|'up_to_date'|'reconnect'|'needs_attention'|'retry';
};
const labels={
 off:'Google Calendar is off',pending:'Updating your Google copy',up_to_date:'Google copy is up to date',
 reconnect:'Reconnect to keep syncing',needs_attention:'Some events couldn’t sync',retry:'Waiting to retry sync'
};
export default function PersonalGoogleCalendar({householdId,userId,returnResult}:{
 householdId:string;userId:string;returnResult?:'return'|'denied';
}){
 const [connection,setConnection]=useState<Connection|null>(null);
 const [busy,setBusy]=useState(false),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=(action:string,payload:Record<string,unknown>={})=>googleRequest('personal_'+action,{householdId,...payload});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  const load=()=>googleRequest('personal_status',{householdId}).then(data=>{if(active)setConnection(data)});
  const initialLoad=async()=>{
   if(returnResult==='denied')setNotice('Google Calendar permission was declined.');
   if(returnResult==='return'&&!retry){
    setBusy(true);
    try{
     await completePersonalCalendarReturn(householdId+':'+userId,receipt=>googleRequest('personal_complete',{householdId,...receipt}));
     if(active)setNotice('Google Calendar connected. Your HH events will start syncing.');
    }catch(e){if(active)setError((e as Error).message)}
    finally{if(active)setBusy(false)}
   }
   try{await load()}catch{if(active)setError(current=>current||'Could not load your Google connection.')}
  };
  void initialLoad();
  const timer=setInterval(()=>{if(!document.hidden)void load().catch(()=>{})},60000);
  return()=>{active=false;clearInterval(timer)};
 },[householdId,userId,returnResult,retry]);
 async function connect(){
  setBusy(true);setError('');setNotice('');
  try{
   const data=await request('start');
   if(typeof data.url!=='string'||new URL(data.url).origin!=='https://accounts.google.com')throw Error('Could not open Google Calendar.');
   location.assign(data.url);
  }catch(e){setError((e as Error).message);setBusy(false)}
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
 if(connection?.usesExistingCopy)return null;
 return <div className="settings-detail-card settings-calendar-card">
  <h3>My Google Calendar</h3>
  <p>See your household’s HH events on a separate calendar in your Google account. Make changes in HH to keep your copy up to date.</p>
  {connection&&<span className="settings-connection"><i className={connection.connected?'connected':''}/>{labels[connection.status]}</span>}
  {(busy||notice)&&<p role="status">{busy?'Working on your Google connection…':notice}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {!connection&&!error&&!busy&&<p role="status">Loading your Google connection…</p>}
  {!connection&&error&&<button type="button" className="text-button" onClick={()=>{setError('');setRetry(n=>n+1)}}>Try again</button>}
  {connection&&!connection.configured&&<p>Personal Google Calendar connections are being prepared.</p>}
  {connection?.configured&&connection.available&&!confirmDisconnect&&<button type="button" className="button soft wide" disabled={busy} onClick={connect}>
   {connection.connected?'Reconnect my Google Calendar':'Connect my Google Calendar'}
  </button>}
  {connection?.connected&&!confirmDisconnect&&<button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmDisconnect(true)}>Disconnect my Google Calendar</button>}
  {confirmDisconnect&&<div>
   <p>Your copy will stop updating. You can remove the old calendar in Google Calendar.</p>
   <button type="button" className="button soft" disabled={busy} onClick={disconnect}>Disconnect</button>{' '}
   <button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmDisconnect(false)}>Cancel</button>
  </div>}
 </div>;
}
