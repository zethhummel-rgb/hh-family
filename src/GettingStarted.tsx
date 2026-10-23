import {useEffect,useId,useState} from 'react';
import {Bell,CalendarPlus,Check,ChevronDown,ChevronRight,Smartphone,X} from 'lucide-react';
import {gettingStartedProgress,saveGettingStarted} from './gettingStarted';
import {installedApp,needsHomeScreen,preparePush,pushRequest,pushSupported} from './push';
import './getting-started.css';

export default function GettingStarted({userId,householdId,active,hasEvent,notificationRevision,expandedByDefault=false,onAddEvent,onInstall,onNotifications}:{
 userId:string;householdId:string;active:boolean;hasEvent:boolean;notificationRevision:number;expandedByDefault?:boolean;
 onAddEvent:()=>void;onInstall:()=>void;onNotifications:()=>void;
}){
 const [progress,setProgress]=useState(()=>gettingStartedProgress(userId,householdId));
 const [installed,setInstalled]=useState(installedApp),[expanded,setExpanded]=useState(()=>expandedByDefault||!installedApp()),[enabled,setEnabled]=useState(false);
 const bodyId=useId(),headingId=useId();
 useEffect(()=>{if(hasEvent&&!progress.eventAdded)setProgress(saveGettingStarted(userId,householdId,{eventAdded:true}))},[hasEvent,progress.eventAdded,userId,householdId]);
 useEffect(()=>{
  if(!active||progress.dismissed)return;
  let alive=true,generation=0;
  async function check(){
   const current=++generation;setInstalled(installedApp());
   if(!pushSupported()||needsHomeScreen()||Notification.permission!=='granted'){setEnabled(false);return}
   try{
    const registration=await preparePush(),subscription=await registration.pushManager.getSubscription();
    const status=subscription?await pushRequest('status',householdId,{endpoint:subscription.endpoint},userId):null;
    if(alive&&generation===current)setEnabled(!!subscription&&!!status?.enabled&&Notification.permission==='granted');
   }catch{if(alive&&generation===current)setEnabled(false)}
  }
  const media=window.matchMedia('(display-mode: standalone)'),refresh=()=>{if(!document.hidden)void check()};
  refresh();media.addEventListener('change',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{alive=false;generation++;media.removeEventListener('change',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)};
 },[active,progress.dismissed,userId,householdId,notificationRevision]);
 if(!active||progress.dismissed)return null;
 const eventDone=hasEvent||progress.eventAdded,complete=Number(eventDone)+Number(installed)+Number(enabled);
 const rows=[
  {title:eventDone?'A family plan is added':'Add a family plan',copy:eventDone?'Your shared calendar is ready to use.':'Start with one real event. Google is optional.',done:eventDone,icon:CalendarPlus,action:onAddEvent},
  {title:installed?'HH is open from its icon':'Add HH to your Home Screen',copy:installed?'Your home is just a tap away.':'See the picture guide, then open the new HH icon.',done:installed,icon:Smartphone,action:onInstall},
  {title:enabled?'Notifications are on':'Choose your notifications',copy:enabled?'Reminders are enabled on this device.':needsHomeScreen()?'Open the HH icon first, then enable reminders.':'Choose whether this device receives reminders.',done:enabled,icon:Bell,action:onNotifications}
 ];
 return <section className="getting-started" aria-labelledby={headingId}>
  <div className="getting-started-header"><button type="button" className="getting-started-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={()=>setExpanded(value=>!value)}><span><span id={headingId} className="getting-started-title">{complete===3?'You’re all set.':'Getting started'}</span><small>{complete} of 3 · Optional, at your pace</small></span><ChevronDown size={18} className={expanded?'expanded':''}/></button><button type="button" className="icon-button" aria-label="Hide getting-started checklist" onClick={()=>setProgress(saveGettingStarted(userId,householdId,{dismissed:true}))}><X size={18}/></button></div>
  <div id={bodyId} hidden={!expanded}><ol>{rows.map(({title,copy,done,icon:Icon,action},index)=><li key={index}><button type="button" className={done?'getting-started-step complete':'getting-started-step'} onClick={action}><span className="getting-started-icon" aria-hidden="true">{done?<Check size={18}/>:<Icon size={18}/>}</span><span className="getting-started-copy"><b>{title}</b><small>{copy}</small></span><ChevronRight size={16} aria-hidden="true"/></button></li>)}</ol><p>Skip any step. Find this again in Settings → Help &amp; tutorials.</p></div>
 </section>;
}
