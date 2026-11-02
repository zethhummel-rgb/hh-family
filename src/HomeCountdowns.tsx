import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronRight,Hourglass} from 'lucide-react';
import {dayKey,type FamilyEvent} from './calendarData';
import {countdownLabel,loadCurrentCountdown,selectEventCountdowns,type EventCountdown} from './eventCountdowns';
import './event-countdowns.css';

type Props={householdId:string;masters:FamilyEvent[];today:string;error:string;onRefresh:()=>Promise<void>;onView:(event:FamilyEvent)=>void};
export default function HomeCountdowns({householdId,masters,today,error,onRefresh,onView}:Props){
 const [opening,setOpening]=useState<string|null>(null),[notice,setNotice]=useState(''),[openError,setOpenError]=useState('');
 const mounted=useRef(false),pending=useRef(false),scope=useRef(householdId),alert=useRef<HTMLParagraphElement>(null);scope.current=householdId;
 useEffect(()=>{mounted.current=true;setNotice('');setOpenError('');return()=>{mounted.current=false}},[householdId]);
 const selection=useMemo(()=>{try{return {rows:selectEventCountdowns(masters,today),error:''}}catch(error){return {rows:[],error:(error as Error).message||'Could not load countdowns.'}}},[masters,today]);
 useEffect(()=>{if(openError)alert.current?.focus()},[openError]);
 async function open(countdown:EventCountdown){
  if(pending.current)return;pending.current=true;setOpening(countdown.masterId);setOpenError('');setNotice('');
  try{
   const current=await loadCurrentCountdown(householdId,countdown.masterId,dayKey(new Date()));
   if(!mounted.current||scope.current!==householdId)return;
   if(current)onView(current.event);
   else{setNotice('This countdown is no longer active.');void onRefresh()}
  }catch(error){if(mounted.current&&scope.current===householdId)setOpenError((error as Error).message||'Could not open this countdown. Try again.')}
  finally{pending.current=false;if(mounted.current&&scope.current===householdId)setOpening(null)}
 }
 if(!selection.rows.length&&!selection.error)return null;
 return <section className="home-countdowns" aria-label="Family countdowns">
  {selection.rows.map(countdown=><button type="button" key={countdown.masterId} className="countdown-line" aria-disabled={opening!==null} aria-busy={opening===countdown.masterId} onClick={event=>{event.currentTarget.focus();void open(countdown)}} aria-label={`Countdown to ${countdown.event.title}: ${countdownLabel(countdown.days)}. Open event details.`}><Hourglass size={13} aria-hidden="true"/><span>Countdown to {countdown.event.title}</span><time dateTime={countdown.date}>{opening===countdown.masterId?'Opening…':countdownLabel(countdown.days)}</time><ChevronRight size={13} aria-hidden="true"/></button>)}
  {(selection.error||error||openError)&&<p className="countdown-notice" role="alert" ref={alert} tabIndex={-1}>{openError||'Countdowns couldn’t refresh. '+(selection.error||error)}{!openError&&<button type="button" className="text-button" onClick={()=>void onRefresh()}>Try again</button>}</p>}
  {notice&&<p className="countdown-notice" role="status">{notice}</p>}
 </section>;
}
