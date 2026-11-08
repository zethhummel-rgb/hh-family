import './googleImportReturn';
import {savedTrip,forgetShopping,tripEvent} from './offlineShopping';
import {accountSwitchBlocked} from './supabase';
import PublicLinks from './PublicLinks';
import SignupConfirmation from './SignupConfirmation';
import {householdName as formatHouseholdName} from './householdName';
import PasswordReset from './PasswordReset';
import {queueWelcome} from './welcomeTour';
import {queueFamilySetup} from './familySetup';
import React,{useEffect,useState,useRef,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {House,Heart,ArrowRight,LogOut,Mail,KeyRound} from 'lucide-react';
import {supabase,withLoginPersistence,staySignedIn,subscribeLogin,loginStorageWarning,visitStorage,recoveryEntry,activeAccountStorageCurrent} from './supabase';
import Household from './Household';
import {verifySelectedAccount,signOutAccounts,finishRecoveryEntry} from './accountSwitch';
import type {Member} from './data';
import './style.css';
import './polish.css';
import './calendar-agenda.css';
import './event-editor.css';
import {backendConfigured,testEnvironment} from './config';
import Setup from './Setup';
import {initialAuthMode,invitationFrom,invitationRedirect,PILOT_INVITE_KEY,FAMILY_INVITE_KEY} from './pilot';
function Brand(){return <div className="auth-brand"><img src="./icon.svg" alt=""/><span>HH</span></div>}
async function leaveDevice(){await signOutAccounts()}
function AppRouter(){
 const [cached,setCached]=useState(()=>!accountSwitchBlocked&&!location.search&&!location.hash&&!!savedTrip()&&
   (!navigator.onLine||document.documentElement.hasAttribute('data-offline')));
 const [,setRevision]=useState(0);
 useEffect(()=>{
   const read=()=>{setRevision(value=>value+1);if(!savedTrip())setCached(false)};
   window.addEventListener('storage',read);window.addEventListener(tripEvent,read);
   return()=>{window.removeEventListener('storage',read);window.removeEventListener(tripEvent,read)};
 },[]);
 const trip=cached?savedTrip():null;
 return trip?<Household key={trip.user+trip.home} userId={trip.user} householdId={trip.home} name="Shopper"
   email="" members={[]} owner={false} offlineOnly onOfflineConnected={()=>setCached(false)} onSignOut={leaveDevice}/>:<App/>;
}
function App(){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[leaving,setLeaving]=useState(false);
 useEffect(()=>{let current=true;setReady(false);setError('');verifySelectedAccount().then(()=>{if(current)setReady(true)}).catch(e=>{if(current)setError((e as Error).message||'Could not verify your saved sign-in. Please try again.')});return()=>{current=false}},[attempt]);
 if(ready)return <HouseholdApp/>;
 return <div className="auth-layout"><div className="auth-art"><Brand/></div><main className="auth-main"><section className="auth-card"><div className="auth-mobile"><Brand/></div><h2>{error?'Let’s check your sign-in.':'Opening your account…'}</h2>{error?<><p role="alert">{error}</p><button type="button" className="button primary wide" disabled={leaving} onClick={()=>setAttempt(value=>value+1)}>Try again</button><button type="button" className="text-button auth-secondary-action" disabled={leaving} onClick={async()=>{setLeaving(true);try{await leaveDevice()}catch(e){setError((e as Error).message||'Could not clear the saved sign-ins.');setLeaving(false)}}}>{leaving?'Signing out…':'Sign out of saved accounts on this device'}</button></>:<p role="status">Getting your household ready.</p>}</section></main></div>;
}
function HouseholdApp(){
 const authClient=useSyncExternalStore(subscribeLogin,()=>supabase),storageWarning=useSyncExternalStore(subscribeLogin,loginStorageWarning);
 const [remember,setRemember]=useState(staySignedIn);
 const initial=useRef(invitationFrom(new URLSearchParams(location.search),visitStorage.getItem(PILOT_INVITE_KEY)||'',visitStorage.getItem(FAMILY_INVITE_KEY)||''));
 const [signupInviteKind,setSignupInviteKind]=useState('family');
 const [confirmationEmail,setConfirmationEmail]=useState(''),[pilot,setPilot]=useState(initial.current.pilot),[host,setHost]=useState(false);
 const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[members,setMembers]=useState<Member[]>([]),[self,setSelf]=useState<Member|null>(null),[mode,setMode]=useState(()=>recoveryEntry?'recover':initialAuthMode(new URLSearchParams(location.search),initial.current)),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[name,setName]=useState(''),[homeName,setHomeName]=useState(''),[invite,setInvite]=useState(initial.current.family);
 useEffect(()=>{if(invite)visitStorage.setItem(FAMILY_INVITE_KEY,invite);else visitStorage.removeItem(FAMILY_INVITE_KEY);if(pilot)visitStorage.setItem(PILOT_INVITE_KEY,pilot);else visitStorage.removeItem(PILOT_INVITE_KEY)},[invite,pilot]);
 useEffect(()=>{setHost(false);if(!session||recoveryEntry)return;let live=true;supabase.rpc('pilot_status').then(({data})=>{if(live)setHost(!!data?.is_host)});return()=>{live=false}},[session?.user.id]);
 const membershipGeneration=useRef(0),authPending=useRef(false),activeSessionUser=useRef<string|undefined>(undefined);
 const verifiedMembership=useRef<{client:typeof supabase;userId:string;householdId:string}|null>(null);
 async function membership(s:Session|null){
  const client=supabase,generation=++membershipGeneration.current;
  // Supabase emits SIGNED_IN again when a tab wakes. Keep the same verified
  // household mounted while checking membership, so its working screen stays.
  const keepHome=!!s&&!recoveryEntry&&verifiedMembership.current?.client===client&&verifiedMembership.current.userId===s.user.id;
  if(!keepHome){verifiedMembership.current=null;setReady(false);setSelf(null);setMembers([])}
  if(s)setError('');
  if(recoveryEntry||!s){setHost(false);setReady(true);return}
  const current=()=>generation===membershipGeneration.current&&client===supabase&&activeSessionUser.current===s.user.id&&activeAccountStorageCurrent();
  try{
   const {data,error}=await client.from('household_members').select('*').eq('user_id',s.user.id).maybeSingle();
   if(!current())return;if(error)throw error;
   if(!data){forgetShopping();verifiedMembership.current=null;setSelf(null);setMembers([]);return}
   if(savedTrip()&&savedTrip()?.home!==data.household_id)forgetShopping();
   if(data.user_id!==s.user.id)throw Error('Could not verify your household membership.');
   if(verifiedMembership.current&&verifiedMembership.current.householdId!==data.household_id){verifiedMembership.current=null;setReady(false);setSelf(null);setMembers([])}
   const result=await client.from('household_members').select('*').eq('household_id',data.household_id).order('joined_at');
   if(!current())return;if(result.error)throw result.error;
   const currentSelf=result.data?.find(member=>member.user_id===s.user.id&&member.household_id===data.household_id);
   if(!currentSelf){verifiedMembership.current=null;setSelf(null);setMembers([]);return}
   verifiedMembership.current={client,userId:s.user.id,householdId:data.household_id};setSelf(currentSelf);setMembers(result.data||[]);
  }catch(e){if(current()){if(keepHome&&typeof navigator!=='undefined'&&navigator.onLine===false&&(e as {status?:number}).status!==401&&(e as {status?:number}).status!==403)return;verifiedMembership.current=null;setSelf(null);setMembers([]);setError(e instanceof Error?e.message:(e as {message?:string}).message||'Could not load your household.')}}
  finally{if(current())setReady(true)}
 }
 useEffect(()=>{
  let alive=true,revision=0,identityRevision=0,reading=false,currentUser:string|undefined;
  function receiveSession(next:Session|null,forceClear=false){
   const changed=currentUser!==next?.user.id;
   if(changed||forceClear){++identityRevision;++membershipGeneration.current;verifiedMembership.current=null;setSelf(null);setMembers([]);setReady(false)}
   currentUser=next?.user.id;activeSessionUser.current=currentUser;setSession(next);return changed;
  }
  async function restore(initial=false){
   if(reading)return;reading=true;const started=revision;
   try{
    const {data,error}=await authClient.auth.getSession();
    if(!alive||started!==revision||authClient!==supabase)return;
    if(!activeAccountStorageCurrent()){receiveSession(null,true);void membership(null);return}
    if(error){if(initial){setError(error.message);setReady(true)}return}
    const changed=receiveSession(data.session);if(initial||changed)void membership(data.session);
   }catch{if(alive&&initial&&started===revision){setError('Could not restore your login. Please try again.');setReady(true)}}
   finally{reading=false}
  }
  const {data}=authClient.auth.onAuthStateChange((event,s)=>{
   if(!alive||authClient!==supabase)return;++revision;if(!activeAccountStorageCurrent()){receiveSession(null,true);void membership(null);return}receiveSession(s,event==='PASSWORD_RECOVERY');
   if(event==='PASSWORD_RECOVERY')setMode('recover');
   if(event!=='TOKEN_REFRESHED'||!verifiedMembership.current){const identity=identityRevision;setTimeout(()=>{if(alive&&identity===identityRevision&&currentUser===s?.user.id&&authClient===supabase)void membership(s)},0);}
  });
  void restore(true);
  const resume=()=>{if(!activeAccountStorageCurrent()){++revision;receiveSession(null,true);void membership(null);return}if(!document.hidden)void restore()};
  window.addEventListener('pageshow',resume);window.addEventListener('focus',resume);window.addEventListener('online',resume);window.addEventListener('storage',resume);
  return()=>{alive=false;membershipGeneration.current++;data.subscription.unsubscribe();window.removeEventListener('pageshow',resume);window.removeEventListener('focus',resume);window.removeEventListener('online',resume);window.removeEventListener('storage',resume)};
 },[authClient]);
 async function auth(e:React.FormEvent){e.preventDefault();if(authPending.current)return;authPending.current=true;setBusy(true);setError('');setMessage('');try{
 if(mode==='forgot'){const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;setMessage('If that account exists, a password reset email is on its way.');}
 else if(mode==='recover'){if(password!==confirm)throw Error('Passwords do not match.');const {error}=await supabase.auth.updateUser({password});if(error)throw error;setPassword('');setConfirm('');if(recoveryEntry){await finishRecoveryEntry();return}setMode('login');setMessage('Your password is updated.');history.replaceState(null,'',location.pathname);}
 else if(mode==='signup'){if(!invite&&!pilot)throw Error('Open your invitation link, or enter its code before creating an account.');if(password!==confirm)throw Error('Passwords do not match.');const redirect=invitationRedirect(location.origin+location.pathname,pilot,invite);const {data,error}=await withLoginPersistence(remember,client=>client.auth.signUp({email,password,options:{data:{display_name:name.trim()},emailRedirectTo:redirect}}),email);if(error)throw error;setPassword('');setConfirm('');if(!data.session)setConfirmationEmail(email.trim());}
 else {const {error}=await withLoginPersistence(remember,client=>client.auth.signInWithPassword({email,password}),email);if(error)throw error;setPassword('');setConfirm('');}
 }catch(e){setError(e instanceof Error?e.message:(e as {message?:string}).message||'Something went wrong. Please try again.')}finally{authPending.current=false;setBusy(false)}}
 async function onboard(join:boolean){setBusy(true);setError('');try{const display=name.trim()||session?.user.user_metadata.display_name||'';if(!display)throw Error('Enter your name.');const {data:createdHome,error}=await supabase.rpc(join?'accept_household_invite':pilot?'create_pilot_household':'create_household',join?{invite_token:invite.trim(),member_name:display}:{household_name:formatHouseholdName(homeName),member_name:display,...(pilot?{pilot_token:pilot.trim()}:{})});if(error)throw error;if(typeof createdHome==='string'&&session){if(!join)queueFamilySetup(session.user.id,createdHome);queueWelcome(session.user.id,createdHome);}visitStorage.removeItem(FAMILY_INVITE_KEY);visitStorage.removeItem(PILOT_INVITE_KEY);setInvite('');setPilot('');history.replaceState(null,'',location.pathname);await membership(session);}catch(e){setError(e instanceof Error?e.message:(e as {message?:string}).message||'Could not open your household.')}finally{setBusy(false)}}
 if(mode==='reset')return <div className="auth-layout"><div className="auth-art"><Brand/></div><main className="auth-main"><div className="auth-mobile"><Brand/></div><div className="auth-card"><PasswordReset initialEmail={email} onClose={()=>{setMode('login');setError('');setMessage('');setPassword('');setConfirm('');const url=new URL(location.href),fromResetLink=url.searchParams.has('reset');url.searchParams.delete('reset');if(fromResetLink)location.replace(url.pathname+url.search);else history.replaceState(null,'',url.pathname+url.search)}}/><div className="auth-footnote">Your own login. Your family’s private space.<PublicLinks/></div></div></main></div>;
 if(ready&&session&&self&&self.user_id===session.user.id&&verifiedMembership.current?.client===authClient&&mode!=='recover')return <>{storageWarning&&<p className="login-storage-notice" role="status">{storageWarning}</p>}<Household key={self.household_id+session.user.id} userId={session.user.id} email={session.user.email||''} name={self.display_name} householdId={self.household_id} members={members} owner={self.role==='owner'} onSignOut={leaveDevice} /></>;
 return <div className="auth-layout"><div className="auth-art"><Brand/><div><span className="eyebrow">A LITTLE MORE TOGETHER.</span><h1>Less keeping track.<br/>More being home.</h1><p>Family plans, shared groceries, and the little things that make a house a home.</p><div className="auth-illustration"><House size={120} strokeWidth={1}/><Heart size={33}/></div></div><small>Made for your everyday.</small></div><main className="auth-main"><div className="auth-mobile"><Brand/></div><section className="auth-card">{!ready?<><h2>Getting things ready…</h2><p>Opening your household.</p></>:!session&&confirmationEmail?<SignupConfirmation invited={!!(invite||pilot)} email={confirmationEmail} joining={!!invite} redirectTo={invitationRedirect(location.origin+location.pathname,pilot,invite)} onChangeEmail={()=>{setConfirmationEmail('');setMode('signup');setPassword('');setConfirm('');setError('');setMessage('')}} onSignIn={()=>{setConfirmationEmail('');setMode('login');setError('');setMessage('')}}/>:!session||mode==='recover'?<><span className="round-icon sage">{mode==='forgot'||mode==='recover'?<KeyRound/>:<Heart/>}</span><h2>{mode==='signup'?'Create your account.':mode==='forgot'?'Forgot your password?':mode==='recover'?'A fresh start.':'Welcome home.'}</h2><p>{mode==='signup'?(invite?'Confirm your email, then join your family’s home.':pilot?'Confirm your email, then create your private home.':'Your own account. One shared household.'):mode==='forgot'?'We’ll email you a link to reset it.':mode==='recover'?'Choose a new password for your account.':'Sign in to your family’s everyday.'}</p>{(invite||pilot)&&<div className="setup-note">{invite?'You’re invited to join a household.':'You’re invited to create your own private household.'} Use the email address the invitation was created for.</div>}
 <form onSubmit={auth}>{mode==='signup'&&!initial.current.family&&!initial.current.pilot&&<div className="setup-note signup-pilot-note"><b>HH is invitation-only during the pilot.</b><p>Open the invitation link you received, or enter its code below.</p><label>Invitation type<select value={signupInviteKind} onChange={e=>{setSignupInviteKind(e.target.value);setInvite('');setPilot('')}}><option value="family">Join an existing household</option><option value="home">Start an invited new household</option></select></label><label>Invitation code<input required autoComplete="off" value={signupInviteKind==='family'?invite:pilot} onChange={e=>signupInviteKind==='family'?setInvite(e.target.value.trim()):setPilot(e.target.value.trim())}/></label></div>}{mode==='signup'&&<label>Your name<input required maxLength={60} autoComplete="given-name" value={name} onChange={e=>setName(e.target.value)}/></label>}{mode!=='recover'&&<label>Email address<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>}{mode!=='forgot'&&<label>Password<input type="password" required minLength={mode==='login'?1:12} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/>{mode!=='login'&&<small>Use at least 12 characters.</small>}</label>}{(mode==='signup'||mode==='recover')&&<label>Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}{(mode==='login'||mode==='signup')&&<div className="login-persistence"><label><input type="checkbox" checked={remember} disabled={busy} aria-describedby="login-persistence-help" onChange={e=>setRemember(e.target.checked)}/><span>Stay signed in on this device</span></label><p id="login-persistence-help">{remember?'Use this on your own device. HH will remember your login when you reopen it.':'Your login will last for this tab’s browsing session.'}</p></div>}{mode==='login'&&<button type="button" className="text-button" onClick={()=>{setMode('reset');setError('');setMessage('');setPassword('');setConfirm('')}}>Forgot password?</button>}<button className="button primary wide" disabled={busy}>{busy?'One moment…':mode==='signup'?'Create my account':mode==='forgot'?'Send reset link':mode==='recover'?'Save new password':'Sign in'}<ArrowRight size={17}/></button></form><div className="auth-switch">{mode==='signup'?'Already have an account?':mode==='login'?'New to HH?':''}<button onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');setMessage('');setPassword('');setConfirm('')}}>{mode==='login'?'Create account':mode==='signup'?'Sign in':'Back to sign in'}</button></div></>:<><span className="round-icon sage"><House/></span><h2>{invite?'Join your family.':pilot||host?'Make a home of your own.':'An invitation opens the door.'}</h2><p>Signed in as {session.user.email}</p><label>Your name<input maxLength={60} value={name||session.user.user_metadata.display_name||''} onChange={e=>setName(e.target.value)}/></label>{invite?<><p className="field-help">Your invitation is ready. Join to share your family’s calendar, groceries and to-dos.</p><details className="picked"><summary>Use a different invitation code</summary><label>Invitation code<input value={invite} onChange={e=>setInvite(e.target.value)}/></label></details><button className="button primary wide" disabled={busy} onClick={()=>onboard(true)}>Join household<ArrowRight size={17}/></button><button className="text-button auth-secondary-action" onClick={()=>{setInvite('');visitStorage.removeItem(FAMILY_INVITE_KEY);history.replaceState(null,'',location.pathname)}}>Create a different household instead</button></>:<>{pilot||host?<><label>Household name<span className="household-name-entry"><span aria-hidden="true">The</span><input required maxLength={80} aria-label="Family or household name" aria-describedby="household-name-help" placeholder="Hummel, Miller…" value={homeName} onChange={e=>setHomeName(e.target.value)}/></span></label><p id="household-name-help" className="field-help">Type your name after “The”, for example The Hummel or The Miller family.</p><p className="field-help">Next, we’ll help you invite your family, add profiles without email and choose your colour palette.</p><button className="button primary wide" disabled={busy||!homeName.trim()} onClick={()=>onboard(false)}>Create my household<ArrowRight size={17}/></button></>:<><p className="setup-note">HH is invitation-only while we try it with a few families. Open your invitation link, or paste your new-household code below.</p><label>New-household invitation code<input value={pilot} onChange={e=>setPilot(e.target.value.trim())} autoComplete="off"/></label></>}<details className="picked"><summary>Have an invitation code?</summary><label>Paste your code<input onChange={e=>setInvite(e.target.value)} value={invite}/></label></details></>}<button className="text-button auth-secondary-action" onClick={async()=>{setBusy(true);setError('');try{await leaveDevice()}catch(e){setError((e as Error).message||'Could not sign out.');setBusy(false)}}} disabled={busy}><LogOut size={15}/>Sign out</button></>}{storageWarning&&<p className="login-storage-notice" role="status">{storageWarning}</p>}{error&&<div className="error" role="alert">{error}{session&&!self&&<button onClick={()=>membership(session)}>Retry</button>}</div>}{message&&<div className="success-message" role="status"><Mail size={17}/>{message}</div>}<div className="auth-footnote">Your own login. Your family’s private space.<PublicLinks/></div></section></main></div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{testEnvironment&&<aside className="test-environment-banner"><strong>HH TEST APP</strong><span>Fictional household · Separate from live HH</span><a href="./test-guide.html" target="_blank" rel="noreferrer">Testing guide</a></aside>}{backendConfigured?<AppRouter/>:<Setup/>}</React.StrictMode>);
