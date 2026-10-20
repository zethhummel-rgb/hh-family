import {useEffect,useRef,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {ArrowRight,Check,KeyRound,Mail} from 'lucide-react';
import {publicConfig} from './config';
import {createPasswordRecovery,recoveryClientOptions} from './passwordRecovery';

export function makePasswordRecovery(){
 const client=createClient(publicConfig.url,publicConfig.key,recoveryClientOptions);
 return createPasswordRecovery(client.auth,new URL('?reset=1',location.origin+location.pathname).href);
}
export default function PasswordReset({initialEmail='',onClose,makeRecovery=makePasswordRecovery}:{initialEmail?:string;onClose:()=>void;makeRecovery?:typeof makePasswordRecovery}){
 const [recovery]=useState(makeRecovery),[step,setStep]=useState<'request'|'code'|'done'>('request');
 const [email,setEmail]=useState(initialEmail),[code,setCode]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{alive.current=false;clearInterval(timer);void recovery.clear()}},[recovery]);
 const wait=Math.max(0,Math.ceil((resendAt-now)/1000));
 async function run(operation:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{await operation()}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Please try again.')}finally{lock.current=false;if(alive.current)setBusy(false)}
 }
 async function send(){
  const normalized=await recovery.request(email);if(!alive.current)return;
  setEmail(normalized);setCode('');setPassword('');setConfirm('');setStep('code');setResendAt(Date.now()+60000);setNow(Date.now());
  setMessage('If that account exists, a reset code is on its way. Check your inbox and junk folder.');
 }
 async function save(){await recovery.complete(email,code,password,confirm);if(alive.current){setCode('');setPassword('');setConfirm('');setStep('done')}}
 return <section className="password-reset" aria-busy={busy}>
  <span className="round-icon sage">{step==='done'?<Check/>:<KeyRound/>}</span>
  <h2>{step==='done'?'A fresh start.':step==='code'?'Check your email.':'Forgot your password?'}</h2>
  <p>{step==='done'?'Your password is updated. Use your new password next time you sign in.':step==='code'?'Enter the code from your email, then choose a new password. Use only the newest code.':'We’ll email you a code to reset it.'}</p>
  {step!=='done'&&<form onSubmit={e=>{e.preventDefault();void run(step==='request'?send:save)}}>
   <label>Email address<input type="email" autoComplete="email" maxLength={254} required disabled={busy||step==='code'} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   {step==='code'&&<>
    <label>Reset code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required disabled={busy} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,10))}/></label>
    <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/><small>Use at least 12 characters.</small></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   </>}
   <button className="button primary wide" disabled={busy}>{busy?'One moment…':step==='request'?'Send reset code':'Save new password'}<ArrowRight size={17}/></button>
  </form>}
  {step==='code'&&<div className="password-reset-actions">
   <button type="button" className="text-button" disabled={busy||wait>0} onClick={()=>void run(send)}>{wait>0?`Send a new code in ${wait}s`:'Send a new code'}</button>
   <button type="button" className="text-button" disabled={busy} onClick={()=>{void recovery.clear();setStep('request');setCode('');setPassword('');setConfirm('');setError('');setMessage('')}}>Use a different email</button>
  </div>}
  {error&&<div className="error" role="alert">{error}</div>}
  {message&&<div className="success-message" role="status"><Mail size={17}/>{message}</div>}
  <div className="auth-switch"><button type="button" disabled={busy} onClick={onClose}>{step==='done'?'Back to HH':'Back to sign in'}</button></div>
 </section>;
}
