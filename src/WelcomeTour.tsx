import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Bell,BookOpen,CalendarDays,Check,House,ListChecks,Mail,Plus,RefreshCw,ShoppingCart,Smartphone,Users,X} from 'lucide-react';
import './welcome-tour.css';

const steps=[
 {title:'Your home starts here.',icon:House,copy:'A quick look around HH. Your family shares plans, groceries and reminders, with a separate login for each person.'},
 {title:'Bring the family in.',icon:Users,copy:'Two clear ways to add people in settings, under Family profiles.'},
 {title:'A calendar for everyone.',icon:CalendarDays,copy:'Tap Calendar along the bottom, then Add event. Choose the people involved and set a reminder if you need one.'},
 {title:'Less to keep in your head.',icon:ListChecks,copy:'Use Groceries for the shared shopping list. To Do is for tasks and reminders, including things that repeat.'},
 {title:'Keep HH close.',icon:Smartphone,copy:'On iPhone, open HH in Safari. Tap Share, then Add to Home Screen. Open the new icon to use HH like an app.'}
];
export default function WelcomeTour({initials,owner,onFinish}:{initials:string;owner:boolean;onFinish:()=>void}){
 const [index,setIndex]=useState(0),dialog=useRef<HTMLElement>(null),next=useRef<HTMLButtonElement>(null);
 const step=steps[index],Icon=step.icon,last=index===steps.length-1;
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';next.current?.focus();
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();onFinish();return}
   if(e.key!=='Tab')return;
   const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')||[]),first=controls[0],last=controls.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[onFinish]);
 return <div className="welcome-backdrop"><section className="welcome-tour" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-copy">
  <div className="welcome-top"><span><BookOpen size={15}/>A LITTLE LOOK AROUND</span><button type="button" className="icon-button" aria-label="Close welcome tour" onClick={onFinish}><X size={19}/></button></div>
  <div className="welcome-picture" aria-hidden="true">
   {index===0?<><div className="welcome-mini-header"><span><img src="./icon.svg" alt=""/>HH</span><span><RefreshCw size={18}/><b className="welcome-initials">{initials||'YOU'}</b></span></div><div className="welcome-pointer">Your settings are here <ArrowUpRight size={23}/></div><div className="welcome-mini-note"><House size={30}/><span>A little more together.</span></div></>:
    index===1?<div className="welcome-family-options"><div><Mail size={22}/><span>With email<small>Invite them to their own login</small></span></div><div><Users size={22}/><span>Without email<small>Add a child or family profile</small></span></div></div>:
    index===2?<div className="welcome-mini-calendar"><div><CalendarDays size={19}/><span>Family calendar</span><span className="welcome-mini-add"><Plus size={14}/>Add event</span></div><div className="welcome-mini-week">{['M','T','W','T','F','S','S'].map((day,i)=><span key={i}>{day}<b className={i===2?'welcome-mini-date':''}>{12+i}</b></span>)}</div><div className="welcome-mini-event"><i/>Family plans<small>Everyone</small></div></div>:
    index===3?<div className="welcome-family-options"><div><ShoppingCart size={23}/><span>Groceries<small>Milk, fruit, the essentials…</small></span><Check size={17}/></div><div><ListChecks size={23}/><span>To Do &amp; Reminders<small>One-off tasks or repeating reminders</small></span></div></div>:
    <div className="welcome-app-icon"><img src="./icon.svg" alt=""/><span>HH</span><small>Your home, one tap away.</small></div>}
  </div>
  <div className="welcome-content"><span className="welcome-step" role="status" aria-live="polite">{index+1} of {steps.length}</span><div className="welcome-heading"><Icon size={23}/><h2 id="welcome-title">{step.title}</h2></div><p id="welcome-copy">{step.copy}</p>
   <p className="welcome-detail">{index===0?'Tap your initials in the top right corner for settings, your colour and notifications.':index===1?(owner?'Invite by email sends an invitation. Children & members without email creates a profile you can tag in plans.':'Your household owner can invite people by email or add profiles for children and members without email.'):index===2?(owner?'The Google connection controls are below the calendar. Connecting creates a dedicated family calendar; your other calendars stay separate.':'Your household owner connects Google once. Everyone in your home can then use the shared family calendar here.'):index===3?'Tap an event to see its details, then Edit to change it. Tap a reminder to edit it; tick it when it’s done.':'From the installed icon, tap your initials to enable notifications on this device. The Tutorials tab has the full guides whenever you need them.'}</p>
  </div>
  <div className="welcome-footer"><div className="welcome-progress" aria-label="Walkthrough progress">{steps.map((s,i)=><button type="button" key={s.title} className={i===index?'current':''} aria-label={`Show slide ${i+1}: ${s.title}`} aria-current={i===index?'step':undefined} onClick={()=>setIndex(i)}><span/></button>)}</div><div className="welcome-controls"><button type="button" className="text-button" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ArrowLeft size={16}/>Back</button><button type="button" className="button primary" ref={next} onClick={()=>last?onFinish():setIndex(i=>i+1)}>{last?'Let’s go':'Next'}{last?<Check size={17}/>:<ArrowRight size={17}/>}</button></div><button type="button" className="welcome-skip" onClick={onFinish}>Skip for now · Reopen in Tutorials</button></div>
 </section></div>;
}
