import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,BookOpen,CalendarDays,Check,House,ListChecks,Mail,Palette,Plus,RefreshCw,ShoppingCart,Smartphone,Users,X} from 'lucide-react';
import PaletteSettings from './PaletteSettings';
import './welcome-tour.css';

const ownerSteps=[
 {scene:'home',title:'Your home starts here.',icon:House,copy:'A quick look around HH. Your family shares plans, groceries and reminders, with a separate login for each person.',detail:'Home starts with Today & coming up, including today’s meals. Your next 7 days are just below. Tap More along the bottom for Meal planner and Family notes. Tap your initials for Settings: Your profile, Appearance, Notifications and Help & tutorials.'},
 {scene:'family',title:'Bring the family in.',icon:Users,copy:'Open Settings → Your household → Family profiles for two clear ways to add people.',detail:'Invite by email sends an invitation. Add without email creates a profile you can tag in plans.'},
 {scene:'calendar',title:'A calendar for everyone.',icon:CalendarDays,copy:'Tap Calendar along the bottom, then Add event. Choose the people involved and set a reminder if you need one.',detail:'Your shared calendar, repeats and reminders work right here. Settings → Calendar lets you import selected Google plans once. Your owner can also enable an optional Google copy. Make changes here in HH.'},
 {scene:'lists',title:'Less to keep in your head.',icon:ListChecks,copy:'Share your shopping list in Groceries, with optional quantities and stores. To Do keeps tasks and reminders, including things that repeat.',detail:'In Groceries, Staples saves your usual items for next time. More → Family notes keeps useful information together; pin important notes so they’re easy to find. Tap a reminder to edit it; tick it when it’s done.'},
 {scene:'install',title:'Keep HH close.',icon:Smartphone,copy:'On iPhone, open HH in Safari. Tap Share, then Add to Home Screen. Open the new icon to use HH like an app. After the tour, Home’s Getting started checklist helps with your first plan, installation and notifications.',detail:'The checklist is optional. Hide it anytime and reopen it in Settings → Help & tutorials. From the installed icon, Home also offers to enable reminders on this device. For the full guides or this tour again, open Settings → Help & tutorials.'}
];
const memberSteps=[
 {scene:'home',title:'You’re part of the home.',icon:House,copy:'Your own login opens your family’s shared calendar, groceries and to-dos. The home is ready for you to use.',detail:'Home starts with Today & coming up, including today’s meals. Your next 7 days are just below. Tap More along the bottom for Meal planner and Family notes. Tap your initials for Settings, then Your profile for your calendar colour or Appearance for your look.'},
 {scene:'calendar',title:'Share the family plans.',icon:CalendarDays,copy:'Tap Calendar, then Add event. Pick the people involved, or choose Everyone. Tap an event to see its details.',detail:'Use Edit to change a plan. Settings → Calendar lets you import selected Google plans once. Everyone in your home can see imported plans. Your owner handles the optional Google copy.'},
 {scene:'lists',title:'Lists you share.',icon:ListChecks,copy:'Add what you need to Groceries. Use To Do for tasks and reminders. Your family sees the same lists.',detail:'Staples saves your usual groceries for another trip. More → Family notes holds useful information everyone can read and edit. Pin important notes, or search to find one again.'},
 {scene:'appearance',title:'A look that feels like you.',icon:Palette,copy:'Pick a colour palette to see HH change. Or keep this look and tap Next.',detail:'Change it anytime in Settings → Appearance. Your calendar colour is separate, under Your profile.'},
 {scene:'install',title:'Keep HH close.',icon:Smartphone,copy:'Home’s Getting started checklist has picture guides for adding HH to your Home Screen. Open the new icon, then choose whether to enable notifications.',detail:'Each phone needs its own permission. Skip any step, and find this tour again in Settings → Help & tutorials.'}
];
export default function WelcomeTour({initials,owner,paletteId,paletteMessage,onPaletteChange,onFinish,onInteractive}:{initials:string;owner:boolean;paletteId:string;paletteMessage:string;onPaletteChange:(id:string)=>void;onFinish:()=>void;onInteractive?:()=>void}){
 const steps=owner?ownerSteps:memberSteps;
 const [index,setIndex]=useState(0),dialog=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const step=steps[index],Icon=step.icon,last=index===steps.length-1;
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();onFinish();return}
   if(e.key!=='Tab')return;
   const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')||[]),first=controls[0],last=controls.at(-1);
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===heading.current)){e.preventDefault();first?.focus()}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[onFinish]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});dialog.current?.scrollTo({top:0})},[index]);
 return <div className="welcome-backdrop"><section className="welcome-tour" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-copy">
  <div className="welcome-top"><span><BookOpen size={15}/>A LITTLE LOOK AROUND</span><button type="button" className="icon-button" aria-label="Close welcome tour" onClick={onFinish}><X size={19}/></button></div>
  {step.scene!=='appearance'&&<div className="welcome-picture" aria-hidden="true">
   {step.scene==='home'?<><div className="welcome-mini-header"><span><img src="./icon.svg" alt=""/>HH</span><span><RefreshCw size={18}/><b className="welcome-initials">{initials||'YOU'}</b></span></div><div className="welcome-pointer">Your settings are here <ArrowUpRight size={23}/></div><div className="welcome-mini-note"><House size={30}/><span>A little more together.</span></div></>:
    step.scene==='family'?<div className="welcome-family-options"><div><Mail size={22}/><span>With email<small>Invite them to their own login</small></span></div><div><Users size={22}/><span>Without email<small>Add a child or family profile</small></span></div></div>:
    step.scene==='calendar'?<div className="welcome-mini-calendar"><div><CalendarDays size={19}/><span>Family calendar</span><span className="welcome-mini-add"><Plus size={14}/>Add event</span></div><div className="welcome-mini-week">{['M','T','W','T','F','S','S'].map((day,i)=><span key={i}>{day}<b className={i===2?'welcome-mini-date':''}>{12+i}</b></span>)}</div><div className="welcome-mini-event"><i/>Family plans<small>Everyone</small></div></div>:
    step.scene==='lists'?<div className="welcome-family-options"><div><ShoppingCart size={23}/><span>Groceries<small>Milk, fruit, the essentials…</small></span><Check size={17}/></div><div><ListChecks size={23}/><span>To Do &amp; Reminders<small>One-off tasks or repeating reminders</small></span></div></div>:
    <div className="welcome-app-icon"><img src="./icon.svg" alt=""/><span>HH</span><small>Your home, one tap away.</small></div>}
  </div>}
  <div className="welcome-content"><span className="welcome-step" role="status" aria-live="polite">{index+1} of {steps.length}</span><div className="welcome-heading"><Icon size={23}/><h2 ref={heading} tabIndex={-1} id="welcome-title">{step.title}</h2></div><p id="welcome-copy">{step.copy}</p>
   {step.scene==='appearance'&&<PaletteSettings value={paletteId} onChange={onPaletteChange} message={paletteMessage}/>}
   <p className="welcome-detail">{step.detail}</p>
  </div>
  <div className="welcome-footer"><div className="welcome-progress" aria-label="Walkthrough progress">{steps.map((s,i)=><button type="button" key={s.title} className={i===index?'current':''} aria-label={`Show slide ${i+1}: ${s.title}`} aria-current={i===index?'step':undefined} onClick={()=>setIndex(i)}><span/></button>)}</div><div className="welcome-controls"><button type="button" className="text-button" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ArrowLeft size={16}/>Back</button><button type="button" className="button primary" onClick={()=>last?onFinish():setIndex(i=>i+1)}>{last?'Let’s go':'Next'}{last?<Check size={17}/>:<ArrowRight size={17}/>}</button></div>{onInteractive&&<button type="button" className="button soft wide" onClick={onInteractive}>Try an interactive tutorial<BookOpen size={16}/></button>}<button type="button" className="welcome-skip" onClick={onFinish}>Skip for now · Find this in settings</button></div>
 </section></div>;
}
