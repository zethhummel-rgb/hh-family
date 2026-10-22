import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,BookOpen,CalendarDays,Check,ChevronLeft,ChevronRight,House,LogOut,MailPlus,Palette,UserRound,Users} from 'lucide-react';
import type {Member,HouseholdPerson} from './data';
import FamilySettings,{MyCalendarColor} from './FamilySettings';
import PaletteSettings from './PaletteSettings';
import NotificationSettings from './NotificationSettings';
import PilotInvites from './PilotInvites';
import AdminHouseholds from './AdminHouseholds';
import Tutorials from './Tutorials';
import {PALETTES} from './palettes';
import {supabase} from './supabase';
import {stopDevicePush} from './push';
import './settings.css';

type Page='main'|'profile'|'appearance'|'notifications'|'household'|'calendar'|'help'|'pilot'|'admin';
const titles:Record<Page,string>={main:'Settings',profile:'Your profile',appearance:'Appearance',notifications:'Notifications',household:'Your household',calendar:'Calendar',help:'Help & tutorials',pilot:'Pilot invitations',admin:'Manage households'};
type Props={
 name:string;email:string;userId:string;householdId:string;householdName:string;owner:boolean;members:Member[];people:HouseholdPerson[];
 paletteId:string;paletteMessage:string;onPaletteChange:(id:string)=>void;onColorSaved:(color:string)=>void;onHouseholdSaved:()=>unknown;
 calendarConnected:boolean;calendarConfigured:boolean;onOpenCalendar:()=>void;onConnectGoogle:()=>void;onWelcome:()=>void;onClose:()=>void;onSignOut:()=>unknown;
};
function Row({icon,title,detail,onClick}:{icon:ReactNode;title:string;detail?:string;onClick:()=>void}){
 return <button type="button" className="settings-row" onClick={onClick}><span className="settings-row-icon" aria-hidden="true">{icon}</span><span className="settings-row-copy"><b>{title}</b>{detail&&<small>{detail}</small>}</span><ChevronRight size={17} aria-hidden="true"/></button>;
}
export default function SettingsDialog(props:Props){
 const {name,email,userId,householdId,householdName,owner,members,people,paletteId,paletteMessage,onPaletteChange,onColorSaved,onHouseholdSaved,calendarConnected,calendarConfigured,onOpenCalendar,onConnectGoogle,onWelcome,onClose,onSignOut}=props;
 const [history,setHistory]=useState<Page[]>(['main']),[visited,setVisited]=useState<Page[]>(['main']),[host,setHost]=useState(false),[leaving,setLeaving]=useState(false),[error,setError]=useState('');
 const page=history.at(-1)!,dialog=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),content=useRef<HTMLDivElement>(null);
 const pageRef=useRef(page),closeRef=useRef(onClose),leavingRef=useRef(leaving);pageRef.current=page;closeRef.current=onClose;leavingRef.current=leaving;
 const initials=name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
 const member=members.find(m=>m.user_id===userId),palette=PALETTES.find(p=>p.id===paletteId)||PALETTES[0];
 const peopleCount=members.length+people.filter(p=>!p.linked_user_id).length;
 function open(next:Page){if(leaving)return;setVisited(old=>old.includes(next)?old:[...old,next]);setHistory(old=>old.at(-1)===next?old:[...old,next])}
 function back(){if(!leaving)setHistory(old=>old.length>1?old.slice(0,-1):old)}
 useEffect(()=>{let active=true;supabase.rpc('pilot_status').then(({data})=>{if(active)setHost(!!data?.is_host)});return()=>{active=false}},[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();if(leavingRef.current)return;if(pageRef.current==='main')closeRef.current();else setHistory(old=>old.slice(0,-1));return}
   if(e.key!=='Tab')return;
   const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary')||[]).filter(node=>node.getClientRects().length>0);
   const first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===heading.current)){e.preventDefault();first?.focus()}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[]);
 useEffect(()=>{content.current?.scrollTo({top:0});heading.current?.focus()},[page]);
 const screen=(id:Page,children:ReactNode)=>visited.includes(id)?<div key={id} className={'settings-page settings-page-'+id} hidden={page!==id} inert={page!==id}>{children}</div>:null;
 return <div className="settings-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!leaving)onClose()}}><section className="settings-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <header className="settings-toolbar"><div>{page==='main'?<img src="./icon.svg" alt="HH"/>:<button type="button" className="settings-back" disabled={leaving} onClick={back} aria-label={`Back to ${titles[history.at(-2)||'main']}`}><ChevronLeft size={21}/>Back</button>}</div><h2 ref={heading} tabIndex={-1} id="settings-title">{titles[page]}</h2><button type="button" className="settings-toolbar-done" disabled={leaving} onClick={onClose}>Done</button></header>
  <div className="settings-content" ref={content}>
   {screen('main',<>
    <p className="settings-intro">A little more at home.</p>
    <button type="button" className="settings-account-card" onClick={()=>open('profile')}><span className="settings-person-avatar">{initials}</span><span><b>{name}</b><small>{email}</small><em>Your profile &amp; calendar colour</em></span><ChevronRight size={18}/></button>
    <section className="settings-group" aria-labelledby="settings-personal"><h3 id="settings-personal">Personal</h3><div className="settings-group-rows"><Row icon={<Palette size={19}/>} title="Appearance" detail={palette.name} onClick={()=>open('appearance')}/><Row icon={<Bell size={19}/>} title="Notifications" detail="Reminders on this device" onClick={()=>open('notifications')}/></div></section>
    <section className="settings-group" aria-labelledby="settings-home"><h3 id="settings-home">Your home</h3><div className="settings-group-rows"><Row icon={<Users size={19}/>} title="Your household" detail={`${householdName} · ${peopleCount} ${peopleCount===1?'person':'people'}`} onClick={()=>open('household')}/><Row icon={<CalendarDays size={19}/>} title="Calendar" detail={calendarConnected?'Google connected':'Your shared family calendar'} onClick={()=>open('calendar')}/>{host&&<Row icon={<MailPlus size={19}/>} title="Pilot invitations" detail="Invite a separate household" onClick={()=>open('pilot')}/>}</div></section>
    {host&&email.toLowerCase()==='hummelhomeapp@gmail.com'&&<section className="settings-group"><h3>Admin</h3><div className="settings-group-rows"><Row icon={<Users size={19}/>} title="Manage households" detail="Review and delete pilot households" onClick={()=>open('admin')}/></div></section>}<section className="settings-group" aria-labelledby="settings-help"><h3 id="settings-help">A helping hand</h3><div className="settings-group-rows"><Row icon={<BookOpen size={19}/>} title="Help & tutorials" detail="Phone guides & the quick tour" onClick={()=>open('help')}/></div></section>
    <div className="settings-account-footer"><small>Signed in as {email}</small><button type="button" disabled={leaving} onClick={async()=>{if(leavingRef.current)return;leavingRef.current=true;setLeaving(true);setError('');try{try{await stopDevicePush(householdId)}catch{}const result=await onSignOut();if(result&&typeof result==='object'&&'error' in result&&result.error)throw result.error}catch(e){setError((e as {message?:string}).message||'Could not sign out. Please try again.');leavingRef.current=false;setLeaving(false)}}}><LogOut size={15}/>{leaving?'Signing out…':'Sign out'}</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <button type="button" className="button primary wide settings-finish" disabled={leaving} onClick={onClose}>Done<Check size={17}/></button>
   </>)}
   {screen('profile',<><div className="settings-page-intro"><UserRound size={25}/><p>Your own account, with one shared home.</p></div><dl className="settings-profile-details"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email</dt><dd>{email}</dd></div><div><dt>Role</dt><dd>{owner?'Household owner':'Family member'}</dd></div></dl><div className="settings-detail-card"><MyCalendarColor member={member} householdId={householdId} userId={userId} onSaved={onColorSaved}/></div></>)}
   {screen('appearance',<><p className="settings-page-description">Choose a look for HH. Your selection saves automatically on this device.</p><div className="settings-detail-card"><PaletteSettings value={paletteId} onChange={onPaletteChange} message={paletteMessage}/></div></>)}
   {screen('notifications',<div className="settings-detail-card"><NotificationSettings householdId={householdId}/></div>)}
   {screen('household',<><div className="settings-page-intro"><House size={25}/><p>{owner?'Manage your home and the people who share it.':'The people sharing your home. Your household owner manages invitations and profiles.'}</p></div><div className="settings-detail-card"><FamilySettings householdName={householdName} people={people} onHouseholdSaved={onHouseholdSaved} owner={owner} members={members} householdId={householdId}/></div></>)}
   {screen('calendar',<><div className="settings-page-intro"><CalendarDays size={25}/><p>One family calendar, shared across your household.</p></div><div className="settings-detail-card settings-calendar-card"><h3>Google Calendar</h3><span className="settings-connection"><i className={calendarConnected?'connected':''}/>{calendarConnected?'Connected to Google':'Not connected to Google'}</span><p>{calendarConnected?'Add and edit plans in HH or in your connected Google family calendar. Changes sync between them.':'Your shared calendar already works in HH. Connect Google to keep family plans in sync there too.'}</p>{owner?<button type="button" className="button soft wide" disabled={!calendarConfigured} onClick={onConnectGoogle}>{calendarConnected?'Reconnect Google':'Connect Google'}</button>:<p className="settings-caption">Your household owner manages the Google connection.</p>}{!calendarConfigured&&<p className="settings-caption">Google connection is being prepared. You can keep using your calendar in HH.</p>}</div><button type="button" className="settings-row settings-standalone-row" onClick={onOpenCalendar}><span className="settings-row-icon"><CalendarDays size={19}/></span><span className="settings-row-copy"><b>Open family calendar</b><small>See and manage your plans</small></span><ChevronRight size={17}/></button><button type="button" className="text-button settings-inline-help" onClick={()=>open('help')}><BookOpen size={16}/>Google setup &amp; import guides</button></>)}
   {screen('help',<Tutorials owner={owner} onWelcome={onWelcome} onSettings={target=>open(target)} onCalendar={onOpenCalendar}/>)}
   {host&&email.toLowerCase()==='hummelhomeapp@gmail.com'&&screen('admin',<AdminHouseholds/>)}
   {host&&screen('pilot',<div className="settings-detail-card"><PilotInvites/></div>)}
  </div>
 </section></div>;
}
