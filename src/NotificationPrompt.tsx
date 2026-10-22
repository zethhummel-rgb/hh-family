import {useEffect,useRef,useState} from 'react';
import {Bell,Check} from 'lucide-react';
import {enableDevicePush,installedApp,preparePush,pushRequest,pushSupported} from './push';
import {canOfferNotifications,finishNotificationPrompt,notificationPromptHandled} from './notificationPrompt';
import './notification-prompt.css';

export default function NotificationPrompt({userId,householdId,active}:{userId:string;householdId:string;active:boolean}){
 const [ready,setReady]=useState<{registration:ServiceWorkerRegistration;publicKey:string}|null>(null),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 useEffect(()=>{
  if(!active){setReady(null);return}
  let alive=true,generation=0;
  const eligible=()=>canOfferNotifications({installed:installedApp(),supported:pushSupported(),permission:typeof Notification==='undefined'?'denied':Notification.permission,handled:notificationPromptHandled(userId,householdId),enabled:false});
  async function check(){
   if(inFlight.current)return;
   const current=++generation;
   if(!eligible()){setReady(null);return}
   try{
    const registration=await preparePush(),subscription=await registration.pushManager.getSubscription();
    const status=await pushRequest('status',householdId,{endpoint:subscription?.endpoint||''});
    if(!alive||generation!==current||inFlight.current)return;
    const isEnabled=!!subscription&&!!status.enabled&&Notification.permission==='granted';
    setReady(eligible()&&!isEnabled&&status.publicKey?{registration,publicKey:status.publicKey}:null);
   }catch{if(alive&&generation===current)setReady(null)}
  }
  const media=window.matchMedia('(display-mode: standalone)');
  const refresh=()=>{if(!document.hidden)void check()};
  refresh();media.addEventListener('change',refresh);window.addEventListener('focus',refresh);window.addEventListener('storage',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{alive=false;generation++;media.removeEventListener('change',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('storage',refresh);document.removeEventListener('visibilitychange',refresh)};
 },[active,userId,householdId]);
 if(!active||!ready)return null;
 function dismiss(){finishNotificationPrompt(userId,householdId);setReady(null);setError('')}
 async function enable(){
  if(!ready||inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');
  try{await enableDevicePush(ready.registration,ready.publicKey,householdId,userId);finishNotificationPrompt(userId,householdId);setEnabled(true)}
  catch(e){setError(Notification.permission==='denied'?'Notifications are blocked. You can allow HH in your device’s notification settings, then return to Settings → Notifications.':e instanceof Error?e.message:'Could not enable notifications. Try again, or use Settings → Notifications.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 return <section className="installed-notification-prompt" aria-labelledby="installed-notifications-title"><span className="round-icon sage" aria-hidden="true">{enabled?<Check/>:<Bell/>}</span><div><h2 id="installed-notifications-title">{enabled?'You’re all set.':'HH is on your Home Screen.'}</h2><p>{enabled?'Notifications are enabled on this device. You can send a test from Settings → Notifications.':'Would you like a gentle nudge before family plans and reminders? Enable notifications, then tap Allow if your device asks.'}</p><div className="installed-notification-actions">{enabled?<button type="button" className="button soft" onClick={dismiss}>Done</button>:<><button type="button" className="button soft" disabled={busy} onClick={enable}><Bell size={16}/>{busy?'Enabling…':'Enable notifications'}</button><button type="button" className="text-button" disabled={busy} onClick={dismiss}>Not now</button></>}</div>{!enabled&&<p className="installed-notification-help">You can always change this in Settings → Notifications. Each device needs its own permission.</p>}{error&&<p className="error" role="alert">{error}</p>}</div></section>
}
