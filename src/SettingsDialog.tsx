import {DraftScope,useDraftGroup} from './draftGroup';
import ProfileName from './ProfileName';
import {useUnsavedChanges,useModalScrollLock} from './useUnsavedChanges';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,BookOpen,CalendarDays,Check,ChevronLeft,ChevronRight,House,LogOut,MailPlus,MessageSquare,Palette,UserRound,Users} from 'lucide-react';
import type {Member,HouseholdPerson} from './data';
import FamilySettings,{MyCalendarColor} from './FamilySettings';
import PaletteSettings from './PaletteSettings';
import NotificationSettings from './NotificationSettings';
import PilotInvites from './PilotInvites';
import AdminHouseholds from './AdminHouseholds';
import DeletionSettings from './DeletionSettings';
import Tutorials from './Tutorials';
import {PALETTES} from './palettes';
import {supabase,staySignedIn} from './supabase';
import AccountSwitcher from './AccountSwitcher';
import {accountSwitchEligible,hasSavedSwitchAccount} from './accountSwitch';
import {stopDevicePush} from './push';
import GoogleCalendarImport from './GoogleCalendarImport';
import {familyProfiles} from './people';
import Feedback from './Feedback';
import './settings.css';

type Page='main'|'profile'|'appearance'|'notifications'|'household'|'calendar'|'help'|'pilot'|'admin'|'googleImport'|'accounts'|'feedback';
const titles:Record<Page,string>={main:'Settings',profile:'Your profile',appearance:'Appearance',notifications:'Notifications',household:'Your household',calendar:'Calendar',help:'Help & tutorials',pilot:'Pilot invitations',admin:'Manage households',googleImport:'Import Google calendar',accounts:'Switch account',feedback:'Send Feedback'};
type Props={
 onInteractiveStart?:(id:string)=>void;
 initialPage?:'main'|'help'|'notifications'|'googleImport'|'household'|'feedback';importError?:string;onCalendarImported:()=>unknown;initialGuide?:'install';onGettingStarted:()=>void;
 name:string;email:string;userId:string;householdId:string;householdName:string;owner:boolean;members:Member[];people:HouseholdPerson[];
 paletteId:string;paletteMessage:string;onPaletteChange:(id:string)=>void;onColorSaved:(color:string)=>void;onHouseholdSaved:()=>unknown;
 calendarConnected:boolean;calendarLegacy:boolean;calendarTransition?:boolean;calendarCopyMessage:string;calendarConfigured:boolean;onOpenCalendar:()=>void;onConnectGoogle:()=>void;onWelcome:()=>void;onClose:()=>void;onSignOut:()=>unknown;
};
function Row({icon,title,detail,onClick}:{icon:ReactNode;title:string;detail?:string;onClick:()=>void}){
 return <button type="button" className="settings-row" data-tour={title==='Your profile'?'settings-profile':title==='Your household'?'settings-household':undefined} onClick={onClick}><span className="settings-row-icon" aria-hidden="true">{icon}</span><span className="settings-row-copy"><b>{title}</b>{detail&&<small>{detail}</small>}</span><ChevronRight size={17} aria-hidden="true"/></button>;
}
export default function SettingsDialog(props:Props){return <DraftScope><SettingsDialogBody {...props}/></DraftScope>}
function SettingsDialogBody(props:Props){
 const drafts=useDraftGroup()!;useModalScrollLock();
 const {initialPage='main',onInteractiveStart,importError,onCalendarImported,initialGuide,onGettingStarted,name,email,userId,householdId,householdName,owner,members,people,paletteId,paletteMessage,onPaletteChange,onColorSaved,onHouseholdSaved,calendarConnected,calendarLegacy,calendarTransition=false,calendarCopyMessage,calendarConfigured,onOpenCalendar,onConnectGoogle,onWelcome,onClose,onSignOut}=props;
 const [history,setHistory]=useState<Page[]>(()=>initialPage==='main'?['main']:initialPage==='googleImport'?['main','calendar','googleImport']:['main',initialPage]),[visited,setVisited]=useState<Page[]>(()=>initialPage==='main'?['main']:initialPage==='googleImport'?['main','calendar','googleImport']:['main',initialPage]),[host,setHost]=useState(false),[leaving,setLeaving]=useState(false),[error,setError]=useState('');
 const [profileDirty,setProfileDirty]=useState(false);
 const [feedbackDirty,setFeedbackDirty]=useState(false),[draftRevision,setDraftRevision]=useState(0);
 const guard=useUnsavedChanges(feedbackDirty||profileDirty||drafts.dirty,leaving||drafts.busy,onClose,drafts.saveAll);
 const clearDrafts=useCallback(()=>{drafts.discardAll();setFeedbackDirty(false);setProfileDirty(false);setDraftRevision(v=>v+1)},[feedbackDirty,profileDirty,drafts.discardAll]);
 const closeSettings=()=>guard.requestClose(()=>{clearDrafts();onClose()});
 const page=history.at(-1)!,dialog=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),content=useRef<HTMLDivElement>(null);
 const pageRef=useRef(page),closeRef=useRef(onClose),leavingRef=useRef(leaving);pageRef.current=page;closeRef.current=closeSettings;leavingRef.current=leaving;
 const initials=name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
 const member=members.find(m=>m.user_id===userId),palette=PALETTES.find(p=>p.id===paletteId)||PALETTES[0];
 const peopleCount=members.length+people.filter(p=>!p.linked_user_id).length;
 const canSwitchAccounts=accountSwitchEligible(email);
 const [pairedAccount,setPairedAccount]=useState(()=>canSwitchAccounts&&hasSavedSwitchAccount(userId,email));
 function open(next:Page){if(leaving||drafts.busy)return;guard.requestClose(()=>{clearDrafts();setVisited(old=>old.includes(next)?old:[...old,next]);setHistory(old=>old.at(-1)===next?old:[...old,next])})}
 function back(){guard.requestClose(()=>{clearDrafts();setHistory(old=>old.length>1?old.slice(0,-1):old)})}
 const backRef=useRef(back);backRef.current=back;
 useEffect(()=>{let active=true;supabase.rpc('pilot_status').then(({data})=>{if(active)setHost(!!data?.is_host)});return()=>{active=false}},[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();if(leavingRef.current)return;if(pageRef.current==='main')closeRef.current();else backRef.current();return}
   if(e.key!=='Tab')return;
   const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')||[]).filter(node=>node.getClientRects().length>0);
   const first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===heading.current)){e.preventDefault();first?.focus()}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus({preventScroll:true})};
 },[]);
 useEffect(()=>{content.current?.scrollTo({top:0});heading.current?.focus();if(page==='help'&&initialGuide==='install'){const timer=setTimeout(()=>content.current?.querySelector('[data-install-guide]')?.scrollIntoView({block:'start'}),0);return()=>clearTimeout(timer)}},[page,initialGuide]);
 const screen=(id:Page,children:ReactNode)=>visited.includes(id)?<div key={id+draftRevision} className={'settings-page settings-page-'+id} hidden={page!==id} inert={page!==id}>{children}</div>:null;
 return <div className="settings-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!leaving)closeSettings()}}><section className="settings-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <header className="settings-toolbar"><div>{page==='main'?<img src="./icon.svg" alt="HH"/>:<button type="button" className="settings-back" disabled={leaving||drafts.busy} onClick={back} aria-label={`Back to ${titles[history.at(-2)||'main']}`}><ChevronLeft size={21}/>Back</button>}</div><h2 ref={heading} tabIndex={-1} id="settings-title">{titles[page]}</h2><button type="button" className="settings-toolbar-done" disabled={leaving||drafts.busy} onClick={closeSettings}>Done</button></header>
  <div className="settings-content" ref={content} inert={leaving||drafts.busy} aria-busy={leaving||drafts.busy}>
   {screen('main',<>
    <p className="settings-intro">A little more at home.</p>
    <button type="button" data-tour={canSwitchAccounts?undefined:'settings-profile'} className="settings-account-card" onClick={()=>open(canSwitchAccounts?'accounts':'profile')}><span className="settings-person-avatar">{initials}</span><span><b>{name}</b><small>{email}</small><em>{canSwitchAccounts?'Switch account · Your profile':'Your profile & calendar colour'}</em></span><ChevronRight size={18}/></button>
    <section className="settings-group" aria-labelledby="settings-personal"><h3 id="settings-personal">Personal</h3><div className="settings-group-rows">{canSwitchAccounts&&<Row icon={<UserRound size={19}/>} title="Your profile" detail="Your calendar colour" onClick={()=>open('profile')}/>}<Row icon={<Palette size={19}/>} title="Appearance" detail={palette.name} onClick={()=>open('appearance')}/><Row icon={<Bell size={19}/>} title="Notifications" detail="Reminders on this device" onClick={()=>open('notifications')}/></div></section>
    <section className="settings-group" aria-labelledby="settings-home"><h3 id="settings-home">Your home</h3><div className="settings-group-rows"><Row icon={<Users size={19}/>} title="Your household" detail={`${householdName} · ${peopleCount} ${peopleCount===1?'person':'people'}`} onClick={()=>open('household')}/><Row icon={<CalendarDays size={19}/>} title="Calendar" detail={calendarTransition?'Moving from Hummel Home':calendarLegacy?'Google transfer pending':calendarConnected?'HH calendar · Google copy':'Your shared family calendar'} onClick={()=>open('calendar')}/>{host&&<Row icon={<MailPlus size={19}/>} title="Pilot invitations" detail="Invite a separate household" onClick={()=>open('pilot')}/>}</div></section>
    {host&&email.toLowerCase()==='hummelhomeapp@gmail.com'&&<section className="settings-group"><h3>Admin</h3><div className="settings-group-rows"><Row icon={<Users size={19}/>} title="Manage households" detail="Review and delete pilot households" onClick={()=>open('admin')}/></div></section>}<section className="settings-group" aria-labelledby="settings-help"><h3 id="settings-help">A helping hand</h3><div className="settings-group-rows"><Row icon={<BookOpen size={19}/>} title="Help & tutorials" detail="Phone guides & the quick tour" onClick={()=>open('help')}/><Row icon={<MessageSquare size={19}/>} title="Send Feedback" detail="Share a comment or suggest a new feature" onClick={()=>open('feedback')}/></div></section>
    <div className="settings-account-footer"><small>Signed in as {email}</small><button type="button" disabled={leaving} onClick={async()=>{if(leavingRef.current)return;leavingRef.current=true;setLeaving(true);setError('');try{try{await stopDevicePush(householdId)}catch{}const result=await onSignOut();if(result&&typeof result==='object'&&'error' in result&&result.error)throw result.error}catch(e){setError((e as {message?:string}).message||'Could not sign out. Please try again.');leavingRef.current=false;setLeaving(false)}}}><LogOut size={15}/>{leaving?'Signing out…':pairedAccount?'Sign out of both accounts':'Sign out'}</button>{pairedAccount&&<small>{staySignedIn()?'Removes both saved sign-ins from this device.':'Removes both sign-ins from this tab.'}</small>}</div>
    {error&&<p className="error" role="alert">{error}</p>}
    <button type="button" className="button primary wide settings-finish" disabled={leaving||drafts.busy} onClick={closeSettings}>Done<Check size={17}/></button>
   </>)}
   {canSwitchAccounts&&page==='accounts'&&<AccountSwitcher key={userId} userId={userId} email={email} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}} onProfile={()=>open('profile')} onSavedState={setPairedAccount}/>}
   {screen('profile',<><div className="settings-page-intro"><UserRound size={25}/><p>Your own account, with one shared home.</p></div><dl className="settings-profile-details"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email</dt><dd>{email}</dd></div><div><dt>Role</dt><dd>{owner?'Household owner':'Family member'}</dd></div></dl><ProfileName name={name} userId={userId} householdId={householdId} onSaved={onHouseholdSaved} onDirty={setProfileDirty} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}}/><div className="settings-detail-card"><MyCalendarColor member={member} householdId={householdId} userId={userId} onSaved={onColorSaved}/></div>{owner?<p className="settings-caption">To delete your account and entire home, open <button type="button" className="text-button" onClick={()=>open('household')}>Your household</button>.</p>:<DeletionSettings owner={false} email={email} householdId={householdId} householdName={householdName} protectedAccount={host} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}}/>}</>)}
   {screen('appearance',<><p className="settings-page-description">Choose a look for HH. Your selection saves automatically on this device.</p><div className="settings-detail-card"><PaletteSettings value={paletteId} onChange={onPaletteChange} message={paletteMessage}/></div></>)}
   {screen('feedback',<Feedback onDirty={setFeedbackDirty} key={userId+householdId} userId={userId} householdId={householdId} email={email} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}}/>)}
   {screen('notifications',<div className="settings-detail-card"><NotificationSettings householdId={householdId} userId={userId}/></div>)}
   {screen('household',<><div className="settings-page-intro"><House size={25}/><p>{owner?'Manage your home and the people who share it.':'The people sharing your home. Your household owner manages invitations and profiles.'}</p></div><div className="settings-detail-card"><FamilySettings householdName={householdName} people={people} onHouseholdSaved={onHouseholdSaved} owner={owner} members={members} householdId={householdId}/></div>{owner&&<DeletionSettings owner email={email} householdId={householdId} householdName={householdName} protectedAccount={host} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}}/>}</>)}
   {screen('calendar',<><div className="settings-page-intro"><CalendarDays size={25}/><p>One family calendar, shared across your household.</p></div><div className="settings-detail-card settings-calendar-card"><h3>{calendarTransition?'Moving your family to HH':calendarLegacy?'Existing Google calendar':'Google copy (optional)'}</h3><span className="settings-connection"><i className={calendarConnected?'connected':''}/>{calendarTransition?'Both apps share the same plans':calendarLegacy?'Existing calendar active':calendarConnected?'Google copy enabled':'Google copy off'}</span><p>{calendarTransition?'Your calendar and lists stay shared with the original Hummel Home until everyone has moved. Your original app keeps working.':calendarLegacy?'Your existing Google calendar keeps working until its plans have been preserved and verified in HH.':'HH saves your plans and sends reminders. Google can show a copy. Make changes in HH; edits in Google do not change your HH calendar.'}</p>{calendarCopyMessage&&<p className="calendar-copy-note" role="status">{calendarCopyMessage}</p>}{!calendarTransition&&(owner?<button type="button" className="button soft wide" disabled={!calendarConfigured} onClick={onConnectGoogle}>{calendarConnected?'Reconnect Google':'Connect Google'}</button>:<p className="settings-caption">Your household owner manages the Google connection.</p>)}{!calendarTransition&&!calendarConfigured&&<p className="settings-caption">Google connection is being prepared. You can keep using your calendar in HH.</p>}</div><button type="button" className="settings-row settings-standalone-row" onClick={onOpenCalendar}><span className="settings-row-icon"><CalendarDays size={19}/></span><span className="settings-row-copy"><b>Open family calendar</b><small>See and manage your plans</small></span><ChevronRight size={17}/></button><button type="button" className="settings-row settings-standalone-row" disabled={calendarLegacy||calendarTransition} onClick={()=>open('googleImport')}><span className="settings-row-icon"><CalendarDays size={19}/></span><span className="settings-row-copy"><b>Import a Google calendar</b><small>{calendarLegacy||calendarTransition?'Available when your existing calendar transfer finishes':'Choose plans to copy into HH once'}</small></span><ChevronRight size={17}/></button><button type="button" className="text-button settings-inline-help" onClick={()=>open('help')}><BookOpen size={16}/>Google setup &amp; import guides</button></>)}
   {page==='googleImport'&&<GoogleCalendarImport householdId={householdId} householdName={householdName} userId={userId} profiles={familyProfiles(members,people)} googleCopyEnabled={calendarConnected} initialError={importError} onBusy={busy=>{leavingRef.current=busy;setLeaving(busy)}} onImported={onCalendarImported} onOpenCalendar={onOpenCalendar}/>}
   {screen('help',<Tutorials initialGuide={initialGuide} onGettingStarted={onGettingStarted} owner={owner} onWelcome={onWelcome} onInteractive={onInteractiveStart} onSettings={target=>open(target)} onCalendar={onOpenCalendar}/>)}
   {host&&email.toLowerCase()==='hummelhomeapp@gmail.com'&&screen('admin',<AdminHouseholds/>)}
   {host&&screen('pilot',<div className="settings-detail-card"><PilotInvites/></div>)}
  </div>
 {guard.confirmation}</section></div>;
}
