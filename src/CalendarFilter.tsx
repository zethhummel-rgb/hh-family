import {useEffect,useId,useRef,useState} from 'react';
import {Check,SlidersHorizontal,X} from 'lucide-react';
import type {PersonProfile} from './people';

export default function CalendarFilter({profiles,value,onChange}:{profiles:PersonProfile[];value:string;onChange:(id:string)=>void}){
 const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const name=value==='all'?'Everyone':profiles.find(person=>person.id===value)?.name||'Selected person';
 useEffect(()=>{
  if(!open)return;close.current?.focus();
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[open]);
 function choose(next:string){onChange(next);setOpen(false);trigger.current?.focus()}
 return <div className="calendar-filter-control" ref={root} onBlurCapture={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}>
  <button type="button" className={'calendar-action calendar-filter-trigger'+(value!=='all'?' has-filter':'')} ref={trigger} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" aria-describedby={id+'-summary'} title={'Showing: '+name} onClick={()=>setOpen(current=>!current)}><SlidersHorizontal size={16}/><span>Filter</span>{value!=='all'&&<i aria-hidden="true"/>}</button>
  <span className="calendar-filter-accessible" id={id+'-summary'}>Showing: {name}</span>
  {open&&<div className="calendar-filter-panel" id={id} role="dialog" aria-label="Filter calendar"><header><strong>Show events for</strong><button type="button" className="icon-button" ref={close} aria-label="Close calendar filter" onClick={()=>{setOpen(false);trigger.current?.focus()}}><X size={18}/></button></header><div className="calendar-filter-options" role="group" aria-label="Family members"><button type="button" aria-pressed={value==='all'} onClick={()=>choose('all')}><span>Everyone</span>{value==='all'&&<Check size={16}/>}</button>{profiles.map(person=><button type="button" key={person.id} aria-pressed={value===person.id} onClick={()=>choose(person.id)}><i style={{backgroundColor:person.color}} aria-hidden="true"/><span>{person.name}</span>{value===person.id&&<Check size={16}/>}</button>)}</div></div>}
 </div>;
}
