import {useEffect,useRef} from 'react';
import {Mail,ArrowRight} from 'lucide-react';

export default function SignupConfirmation({email,joining,onSignIn}:{email:string;joining:boolean;onSignIn:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus()},[]);
 return <div className="signup-confirmation">
  <span className="round-icon sage"><Mail/></span>
  <h2 ref={heading} tabIndex={-1}>Check your email.</h2>
  <p>A confirmation email is on its way to <strong>{email}</strong>.</p>
  <ol>
   <li>Open the email from HH and tap the confirmation link.</li>
   <li>{joining?'Then follow the steps to join your household.':'Then follow the steps to create your home.'} Sign in if asked.</li>
  </ol>
  <p className="setup-note">You can close this page now. The link in your email will bring you back to HH to continue.</p>
  <p className="field-help">Can’t find it? Give it a few minutes and check Spam or Junk. If you’re joining a household and the invitation isn’t shown after confirming, open your original invitation email again.</p>
  <button type="button" className="button soft wide" onClick={onSignIn}>Back to sign in<ArrowRight size={17}/></button>
 </div>
}
