import {useEffect,useRef,useState} from 'react';
import {Mail,ArrowRight} from 'lucide-react';
import {supabase} from './supabase';
import ChoiceDialog from './ChoiceDialog';

export default function SignupConfirmation({email,joining,invited=false,redirectTo,onSignIn,onChangeEmail}:{email:string;joining:boolean;invited?:boolean;redirectTo:string;onSignIn:()=>void;onChangeEmail:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null),pending=useRef(false);
 const [showReminder,setShowReminder]=useState(true);
 const [cooldown,setCooldown]=useState(60),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(!showReminder)heading.current?.focus();const timer=setInterval(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearInterval(timer)},[]);
 async function resend(){if(pending.current||cooldown>0)return;pending.current=true;setBusy(true);setError('');setNotice('');try{const {error}=await supabase.auth.resend({type:'signup',email,options:{emailRedirectTo:redirectTo}});if(error)throw error;setNotice('Confirmation email requested. Check your inbox and Spam or Junk.');setCooldown(60)}catch(e){setError((e as Error).message||'Could not resend. Please try again.');setCooldown(60)}finally{pending.current=false;setBusy(false)}}
 return <><div className="signup-confirmation" inert={showReminder}>
  <span className="round-icon sage"><Mail/></span>
  <h2 ref={heading} tabIndex={-1}>Check your email.</h2>
  <p>A confirmation email is on its way to <strong>{email}</strong>.</p>
  {invited&&<p className="field-help">This is a new email, separate from your invitation.</p>}
  <ol>
   <li>Open the email from HH and tap the confirmation link.</li>
   <li>{joining?'Then follow the steps to join your household.':invited?'Then follow the steps to create your home.':'Then open your household invitation to continue.'} Sign in if asked.</li>
  </ol>
  <p className="setup-note">You can close this page now. The link in your email will bring you back to HH to continue.</p>
  <p className="field-help">Can’t find it? Give it a few minutes and check Spam or Junk. If you’re joining a household and the invitation isn’t shown after confirming, open your original invitation email again.</p>
  {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <div className="signup-recovery-actions"><button type="button" className="button primary wide" disabled={busy||cooldown>0} onClick={()=>void resend()}>{busy?'Sending…':cooldown?`Resend email in ${cooldown}s`:'Resend confirmation email'}</button><button type="button" className="button soft wide" disabled={busy} onClick={onChangeEmail}>Use a different email</button><button type="button" className="text-button" disabled={busy} onClick={onSignIn}>Back to sign in<ArrowRight size={17}/></button></div>
 </div>{showReminder&&<ChoiceDialog title="Check your email again" onCancel={()=>{setShowReminder(false);requestAnimationFrame(()=>heading.current?.focus())}} actions={[{label:'Got it',primary:true,run:()=>{setShowReminder(false);requestAnimationFrame(()=>heading.current?.focus())}}]}><p>Check <strong>{email}</strong> for an email from HH and tap the link to confirm your account.</p><p>This is a new confirmation email, separate from your household invitation. Check Spam or Junk if you do not see it.</p></ChoiceDialog>}</>
}
