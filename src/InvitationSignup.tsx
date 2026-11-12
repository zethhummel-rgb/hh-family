import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {ArrowRight,Heart} from 'lucide-react';
import {supabase,withLoginPersistence} from './supabase';
import PasswordField from './PasswordField';
type Kind='family'|'pilot';
type Invitation={email:string;householdName?:string;existingAccount:boolean;token:string;kind:Kind};
async function invitationRequest(body:Record<string,string>){
 const {data,error}=await supabase.functions.invoke('invitation-registration',{body});
 if(error){let message='Could not check your invitation. Please try again.';try{message=(await error.context?.json())?.error||message}catch{}throw Error(message)}
 if(!data?.email)throw Error('Could not check your invitation. Please try again.');return data;
}
export default function InvitationSignup({family,pilot,onInvitation,onSignIn,onAuthenticated,remember,onRemember}:{family:string;pilot:string;onInvitation:(kind:Kind,token:string)=>void;onSignIn:(email?:string)=>void;onAuthenticated:(session:Session,name:string,lastName:string)=>void;remember:boolean;onRemember:(value:boolean)=>void}){
 const kind:Kind=family?'family':'pilot',token=family||pilot;
 const [manualKind,setManualKind]=useState<Kind>('family'),[info,setInfo]=useState<Invitation|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[step,setStep]=useState<'credentials'|'name'>('credentials'),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef(false);
 useEffect(()=>{
  let live=true;setInfo(null);setError('');setPassword('');setConfirm('');setFirstName('');setLastName('');setStep('credentials');
  if(!token){setChecking(false);return}
  if(!/^[a-f0-9]{64}$/.test(token)){setChecking(false);setError('Enter the complete invitation code from your email.');return}
  setChecking(true);
  invitationRequest({action:'preview',kind,token}).then(data=>{if(live)setInfo({...data,kind,token})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setChecking(false)});
  return()=>{live=false};
 },[kind,token,revision]);
 const current=info?.token===token&&info.kind===kind?info:null;
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(pending.current)return;setError('');
  if(!current){setError('Open your invitation link, or enter its complete code before continuing.');return}
  if(step==='credentials'){
   const values=new FormData(e.currentTarget);
   const enteredPassword=String(values.get('password')||'');
   const enteredConfirm=String(values.get('confirm-password')||'');
   setPassword(enteredPassword);setConfirm(enteredConfirm);
   if(!current.existingAccount&&enteredPassword!==enteredConfirm){setError('Passwords do not match.');return}
   setStep('name');return;
  }
  const name=[firstName.trim(),lastName.trim()].filter(Boolean).join(' ');
  if(!firstName.trim()||!lastName.trim()||name.length>60){setError('Enter your first and last name, using no more than 60 characters in total.');return}
  pending.current=true;setBusy(true);
  try{
   const prepared=await invitationRequest({action:'register',kind,token,name:name.trim(),password});
   const {data,error}=await withLoginPersistence(remember,client=>client.auth.signInWithPassword({email:prepared.email,password}),prepared.email);
   if(error)throw Error('Your invitation is ready. Sign in with this email’s existing password. If you forgot it, use Forgot password on the sign-in page.');
   if(!data.session)throw Error('Could not finish signing in. Please try again.');
   setPassword('');setConfirm('');onAuthenticated(data.session,name,lastName.trim());
  }catch(e){setError((e as Error).message||'Could not continue. Please try again.')}finally{pending.current=false;setBusy(false)}
 }
 return <><span className="round-icon sage"><Heart/></span><h2>{step==='name'?'What’s your name?':'Accept your invitation.'}</h2>
  <form onSubmit={submit} autoComplete="on">
   {!token&&<div className="setup-note"><b>HH is invitation-only during the pilot.</b><p>Open the invitation link you received, or enter its code below.</p></div>}
   {!current&&<><label>Invitation type<select disabled={busy} value={token?kind:manualKind} onChange={e=>{setManualKind(e.target.value as Kind);onInvitation(e.target.value as Kind,'')}}><option value="family">Join an existing household</option><option value="pilot">Start an invited new household</option></select></label><label>Invitation code<input autoComplete="off" disabled={busy} value={token} onChange={e=>onInvitation(token?kind:manualKind,e.target.value.trim())}/></label></>}
   {checking&&<p role="status">Checking your invitation…</p>}
   {current&&<><div className="setup-note" style={{overflowWrap:'anywhere'}}>{current.householdName?`You’re invited to join ${current.householdName}.`:'You’re invited to create your own private home.'} This invitation is for <strong>{current.email}</strong>.</div>
    <label>Email address<input type="email" name="username" value={current.email} readOnly autoComplete="username"/></label>
    <details className="picked"><summary>Your invitation code</summary><label>Invitation code<input value={token} readOnly autoComplete="off"/></label><p className="field-help">Filled in from your invitation. It stops working after you join or create your household.</p></details>
    {step==='credentials'&&<>{current.existingAccount&&<p className="field-help">You already started an account with this email. Use your existing password; your invitation handles email verification.</p>}
    <PasswordField name="password" label="Password" required minLength={current.existingAccount?1:12} autoComplete={current.existingAccount?'current-password':'new-password'} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} help={current.existingAccount?undefined:'Use at least 12 characters.'}/>
    {!current.existingAccount&&<PasswordField name="confirm-password" label="Confirm password" required minLength={12} autoComplete="new-password" value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/>}
    <div className="login-persistence"><label><input type="checkbox" checked={remember} disabled={busy} onChange={e=>onRemember(e.target.checked)}/><span>Stay signed in on this device</span></label><p>{remember?'Use this on your own device. HH will remember your login when you reopen it.':'Your login will last for this tab’s browsing session.'}</p></div></>}
    {step==='name'&&<><p>Tell us your name so your family knows it’s you.</p><label>First name<input name="given-name" required maxLength={60} autoComplete="given-name" value={firstName} disabled={busy} onChange={e=>setFirstName(e.target.value)}/></label><label>Last name<input name="family-name" required maxLength={60} autoComplete="family-name" value={lastName} disabled={busy} onChange={e=>setLastName(e.target.value)}/></label><button type="button" className="text-button" disabled={busy} onClick={()=>{setStep('credentials');setError('')}}>Back</button></>}
   </>}
   <button className="button primary wide" disabled={busy||checking||!!token&&!current}>{busy?'One moment…':!current?'Create my account':step==='credentials'?'Continue':current.existingAccount?'Continue to household':'Create my account'}<ArrowRight size={17}/></button>
  </form>
  {error&&<div className="error" role="alert">{error}{!current&&token&&<button type="button" onClick={()=>setRevision(value=>value+1)}>Check invitation again</button>}</div>}
  <div className="auth-switch">Already have an account?<button type="button" disabled={busy} onClick={()=>onSignIn(current?.email)}>Sign in</button></div>
 </>;
}
