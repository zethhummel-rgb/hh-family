import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CalendarDays,Check,ChevronRight,FileText,History,ShoppingBasket,UserRound,Utensils,X,ListChecks} from 'lucide-react';
import {activitySummary,changeSummary,type HouseholdChange} from './householdActivityData';
import type {useHouseholdActivity} from './useHouseholdActivity';
import './household-activity.css';

type ActivityState=ReturnType<typeof useHouseholdActivity>;
const icons={grocery:ShoppingBasket,staple:ShoppingBasket,task:ListChecks,event:CalendarDays,note:FileText,meal_plan:Utensils,meal_recipe:Utensils,profile:UserRound};
export function ActivityBanner({state}:{state:ActivityState}){
 if(!state.rows.length)return null;
 return <button type="button" className="household-activity-banner" onClick={state.open} aria-haspopup="dialog" aria-controls="household-updates-dialog" aria-label={`${activitySummary(state.rows)}. View ${state.rows.length} household updates.`}><History size={15} aria-hidden="true"/><span>{activitySummary(state.rows)}</span><small aria-hidden="true">{state.rows.length>99?'99+':state.rows.length}</small><ChevronRight size={15} aria-hidden="true"/></button>;
}
const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function ActivityDialog({state,onOpen}:{state:ActivityState;onOpen:(change:HouseholdChange)=>Promise<void>}){
 const rows=state.view!;
 const dialog=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),errorNotice=useRef<HTMLParagraphElement>(null),mounted=useRef(false),opening=useRef(false),restoreFocus=useRef(true),reading=useRef(false),readComplete=useRef(false);
 const markSeen=useRef(state.markSeen),close=useRef(state.close);markSeen.current=state.markSeen;close.current=state.close;
 const [readError,setReadError]=useState(''),[read,setRead]=useState(false),[marking,setMarking]=useState(false),[busy,setBusy]=useState<string|null>(null),[openError,setOpenError]=useState('');
 async function seen(){
  if(reading.current||readComplete.current)return;reading.current=true;setMarking(true);setReadError('');
  try{await markSeen.current(rows);readComplete.current=true;if(mounted.current)setRead(true)}catch(error){if(mounted.current)setReadError((error as Error).message||'Could not clear these updates. Try again.')}finally{reading.current=false;if(mounted.current)setMarking(false)}
 }
 useEffect(()=>{
  mounted.current=true;const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';heading.current?.focus();
  // A banner impression is not a view. Acknowledge just this displayed snapshot
  // after the popup paints, keeping it readable until it is closed.
  const frame=requestAnimationFrame(()=>{if(!document.hidden)void seen()});
  const visible=()=>{if(!document.hidden&&!reading.current)void seen()};
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();if(!opening.current)close.current()}
   if(event.key==='Tab'){
    const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[]).filter(node=>node.getClientRects().length),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===heading.current||!dialog.current?.contains(document.activeElement))){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===heading.current)){event.preventDefault();first?.focus()}
   }
  };
  document.addEventListener('keydown',keys);document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;cancelAnimationFrame(frame);document.removeEventListener('keydown',keys);document.removeEventListener('visibilitychange',visible);document.body.style.overflow=overflow;requestAnimationFrame(()=>{if(!restoreFocus.current||document.querySelector('[role="dialog"]'))return;const targets=[previous,...document.querySelectorAll<HTMLElement>('.home-today-card button,.mobile-nav button')];const target=targets.find(node=>node?.isConnected&&node.getClientRects().length&&!node.closest('[inert]'));target?.focus()})};
 },[]);
 useEffect(()=>{if(openError||readError)errorNotice.current?.focus()},[openError,readError]);
 async function open(change:HouseholdChange){
  if(opening.current)return;opening.current=true;restoreFocus.current=false;setBusy(change.id);setOpenError('');
  try{await onOpen(change)}catch(error){restoreFocus.current=true;if(mounted.current)setOpenError((error as Error).message||'Could not open this update. Try again.')}finally{opening.current=false;if(mounted.current)setBusy(null)}
 }
 return <div className="activity-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!opening.current)state.close()}}><section ref={dialog} id="household-updates-dialog" className="activity-dialog" role="dialog" aria-modal="true" aria-labelledby="household-updates-title">
  <header><div><span className="eyebrow">YOUR HOME, IN THE LOOP</span><h2 id="household-updates-title" ref={heading} tabIndex={-1}>What changed</h2></div><button type="button" className="icon-button" disabled={busy!==null} aria-label="Close household updates" onClick={state.close}><X size={21}/></button></header>
  <p className="activity-intro">Updates from your family. Tap one to open it.</p>
  <div className="activity-changes">{rows.map(change=>{const Icon=icons[change.entity_kind];return <button type="button" className="activity-change" key={change.id} disabled={busy!==null} onClick={()=>void open(change)} aria-label={`${changeSummary(change)}: ${change.title}`}><span className="activity-change-icon"><Icon size={18}/></span><span className="activity-change-copy"><span>{changeSummary(change)}</span><b>{change.title}</b><small>{dateLabel(change.created_at)}{change.entity_date&&<> · For {new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(change.entity_date+'T12:00:00Z'))}</>}{change.action==='removed'&&' · Removed'}</small></span><ArrowUpRight size={16} aria-hidden="true"/></button>})}</div>
  {(readError||openError)&&<p ref={errorNotice} className="activity-error" tabIndex={-1} role="alert">{openError||readError}{readError&&<button type="button" className="text-button" disabled={marking} onClick={()=>void seen()}>Try clearing again</button>}</p>}
  <footer><p role="status">{busy?'Opening update…':marking?'Marking these updates as seen…':read?<><Check size={14}/>You’re caught up. These updates are cleared for you.</>:readError?'These updates will stay unread until they can be cleared.':'These updates clear after you view this list.'}</p><button type="button" className="text-button" disabled={busy!==null} onClick={state.close}>Done<Check size={15}/></button></footer>
 </section></div>;
}
