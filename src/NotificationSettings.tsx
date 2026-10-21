import {useEffect,useState} from 'react';
import {Bell,BellOff,Check} from 'lucide-react';
import {applicationKey,needsHomeScreen,preparePush,pushRequest,pushSupported} from './push';
export default function NotificationSettings({householdId}:{householdId:string}){
 const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null),[publicKey,setPublicKey]=useState(''),[enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const homeScreen=needsHomeScreen(),supported=pushSupported();
 const denied=typeof Notification!=='undefined'&&Notification.permission==='denied';
 useEffect(()=>{let active=true;
  if(!supported||homeScreen){setLoading(false);return}
  (async()=>{try{const r=await preparePush(),s=await r.pushManager.getSubscription(),status=await pushRequest('status',householdId,{endpoint:s?.endpoint||''});if(active){setRegistration(r);setPublicKey(status.publicKey||'');setEnabled(!!status.enabled&&Notification.permission==='granted')}}catch(e){if(active)setError(e instanceof Error?e.message:'Could not load notifications.')}finally{if(active)setLoading(false)}})();
  return()=>{active=false};
 },[householdId,supported,homeScreen]);
 async function enable(){
  if(!registration||!publicKey)return;setBusy(true);setError('');setNotice('');
  try{
   // Called directly from the tap, with the registration and key prepared in advance.
   const s=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(publicKey)});
   await pushRequest('subscribe',householdId,{subscription:s.toJSON()});setEnabled(true);setNotice('Reminders are enabled on this device.');
  }catch(e){setError(Notification.permission==='denied'?'Notifications are blocked. Allow HH in your device’s notification settings, then reopen the app.':e instanceof Error?e.message:'Could not enable notifications.')}finally{setBusy(false)}
 }
 async function disable(){setBusy(true);setError('');setNotice('');try{const s=await registration?.pushManager.getSubscription();if(s){await s.unsubscribe();await pushRequest('unsubscribe',householdId,{endpoint:s.endpoint})}setEnabled(false);setNotice('Reminders are off on this device.')}catch(e){setError(e instanceof Error?e.message:'Could not turn off reminders.')}finally{setBusy(false)}}
 return <section className="notification-settings"><div className="notification-heading"><Bell size={19}/><h3>Notifications</h3></div><p>A gentle nudge, even when HH is closed. Each person enables their own devices.</p>{homeScreen?<p className="setup-note">On your iPhone or iPad, open HH in Safari, tap Share → Add to Home Screen. Open it from the new icon, then enable notifications here.</p>:!supported?<p className="field-help">This browser doesn’t support push notifications. Open HH in a current supported browser.</p>:<>{enabled?<><span className="notification-state"><Check size={14}/>Enabled on this device</span><div className="notification-actions"><button type="button" className="button soft" disabled={busy} onClick={async()=>{setBusy(true);setError('');setNotice('');try{const s=await registration?.pushManager.getSubscription();if(!s)throw Error('Enable notifications again on this device.');await pushRequest('test',householdId,{endpoint:s.endpoint});setNotice('Test sent. Check your notifications.')}catch(e){setError(e instanceof Error?e.message:'Could not send test.')}finally{setBusy(false)}}}>Send a test</button><button type="button" className="text-button" disabled={busy} onClick={disable}><BellOff size={14}/>Turn off</button></div></>:<button type="button" className="button soft" disabled={loading||busy||denied||!registration||!publicKey} onClick={enable}><Bell size={16}/>{loading?'Getting ready…':busy?'Enabling…':'Enable notifications'}</button>}{denied&&!enabled&&<p className="field-help">Allow HH in your device’s notification settings, then reopen the app.</p>}</>}<p className="field-help">Calendar events notify 30 minutes before by default. Edit an event to turn its 30-minute notification off or add another reminder, or set a notification time in To Do & Reminders. Tagged people receive it; Reminders for family members without a login go to the household.</p>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="field-help">{notice}</p>}</section>
}
