import PasswordField from './PasswordField';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeftRight,ArrowRight,Check,House,ShieldCheck,UserRound} from 'lucide-react';
import {accountSwitchEligible,getAccountSwitchOptions,switchAccount} from './accountSwitch';
import {staySignedIn} from './supabase';
import './account-switcher.css';

type Options=Awaited<ReturnType<typeof getAccountSwitchOptions>>;
type Props={userId:string;email:string;onBusy:(busy:boolean)=>void;onProfile:()=>void;onSavedState?:(saved:boolean)=>void};
export default function AccountSwitcher({userId,email,onBusy,onProfile,onSavedState}:Props){
 const [options,setOptions]=useState<Options|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[passwordOpen,setPasswordOpen]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),pending=useRef(false),generation=useRef(0),passwordInput=useRef<HTMLInputElement>(null),otherAccount=useRef<HTMLButtonElement>(null),notice=useRef<HTMLParagraphElement>(null),busyCallback=useRef(onBusy),savedCallback=useRef(onSavedState);
 busyCallback.current=onBusy;savedCallback.current=onSavedState;
 async function load(){
  const request=++generation.current;setLoading(true);setLoadError('');
  try{const next=await getAccountSwitchOptions(userId);if(mounted.current&&request===generation.current){setOptions(next);savedCallback.current?.(next.other.saved)}}
  catch(e){if(mounted.current&&request===generation.current)setLoadError(e instanceof Error?e.message:'Could not check your saved sign-ins. Please try again.')}
  finally{if(mounted.current&&request===generation.current)setLoading(false)}
 }
 useEffect(()=>{mounted.current=true;if(accountSwitchEligible(email))void load();return()=>{mounted.current=false;generation.current++;if(passwordInput.current)passwordInput.current.value='';busyCallback.current(false)}},[userId,email]);
 useEffect(()=>{if(passwordOpen)passwordInput.current?.focus()},[passwordOpen]);
 useEffect(()=>{if(error)notice.current?.focus()},[error]);
 if(!accountSwitchEligible(email))return null;
 const remembered=options?.remembered??staySignedIn();
 async function choose(secret?:string){
  if(pending.current||!options)return;pending.current=true;setBusy(true);busyCallback.current(true);setError('');setPassword('');
  try{
   await switchAccount({expectedUserId:userId,targetEmail:options.other.email,...(secret===undefined?{}:{password:secret})});
   // The verified destination opens in a fresh page. Keep the screen locked
   // until navigation completes so no second switch can race it.
  }catch(e){
   if(!mounted.current)return;
   const needsPassword=!!(e&&typeof e==='object'&&'needsPassword' in e&&e.needsPassword);
   if(needsPassword){setPasswordOpen(true);setOptions(current=>current?{...current,other:{...current.other,saved:false}}:current);savedCallback.current?.(false)}
   setError(e instanceof Error?e.message:'Could not switch accounts. Please try again.');pending.current=false;setBusy(false);busyCallback.current(false);
  }finally{secret=undefined}
 }
 function askForPassword(){setError('');setPassword('');setPasswordOpen(true)}
 return <section className="account-switcher" aria-label="Switch between your accounts">
  <div className="settings-page-intro"><ArrowLeftRight size={24}/><p>Choose the account to open. Your family and HH admin each keep their own home and settings.</p></div>
  {loading?<p className="account-switch-loading" role="status">Checking your saved sign-ins…</p>:loadError?<div className="account-switch-load-error" role="alert"><p>{loadError}</p><button type="button" className="text-button" onClick={()=>void load()}>Try again</button></div>:options&&<>
   <div className="account-switch-list">
    <div className="account-switch-card is-current"><span className="account-switch-icon">{options.current.label==='HH admin'?<ShieldCheck size={22}/>:<House size={22}/>}</span><span className="account-switch-copy"><b>{options.current.label}</b><small>{options.current.email}</small><em><Check size={13}/>Current account</em></span></div>
    <button ref={otherAccount} type="button" className="account-switch-card" disabled={busy||passwordOpen} onClick={()=>options.other.saved?void choose():askForPassword()} aria-label={`${options.other.saved?'Switch to':'Sign in to'} ${options.other.label}`}><span className="account-switch-icon">{options.other.label==='HH admin'?<ShieldCheck size={22}/>:<House size={22}/>}</span><span className="account-switch-copy"><b>{options.other.label}</b><small>{options.other.email}</small><em>{busy?'Opening account…':options.other.saved?'Switch account':'Sign in once'}</em></span><ArrowRight size={18}/></button>
   </div>
   {passwordOpen&&<form className="account-switch-form" onSubmit={event=>{event.preventDefault();void choose(password)}}>
    <h3>Sign in to {options.other.label}</h3><p>Enter this account’s password once to add it here. You’ll stay in your current account if sign-in fails.</p>
    <label>Email address<input type="email" name="username" autoComplete="username" readOnly value={options.other.email} tabIndex={-1}/></label>
    <label>Password<input ref={passwordInput} type="password" name="password" autoComplete="current-password" required disabled={busy} value={password} onChange={event=>setPassword(event.target.value)}/></label>
    <div className="account-switch-actions"><button type="submit" className="button primary" disabled={busy||!password}>{busy?'Opening account…':'Sign in and switch'}<ArrowRight size={16}/></button><button type="button" className="text-button" disabled={busy} onClick={()=>{setPassword('');setPasswordOpen(false);setError('');requestAnimationFrame(()=>otherAccount.current?.focus())}}>Cancel</button></div>
   </form>}
   {error&&<p ref={notice} className="account-switch-error" role="alert" tabIndex={-1}>{error}</p>}
   {busy&&<p className="account-switch-status" role="status">Opening {options.other.label}…</p>}
  </>}
  <p className="account-switch-note">{remembered?'With Stay signed in enabled, both sign-ins can stay available when you reopen HH on this device.':'These sign-ins are kept only for this tab’s browsing session.'} A saved sign-in may occasionally need its password again. Notifications stay with the account you enabled them for.</p>
  <button type="button" className="settings-row settings-standalone-row" disabled={busy} onClick={onProfile}><span className="settings-row-icon"><UserRound size={19}/></span><span className="settings-row-copy"><b>Your profile &amp; calendar colour</b><small>Change the colour for your current account</small></span><ArrowRight size={17}/></button>
 </section>;
}
