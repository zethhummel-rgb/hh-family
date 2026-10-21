import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Mail,Palette,Plus,Users} from 'lucide-react';
import type {HouseholdPerson,Member} from './data';
import {supabase} from './supabase';
import {createEmailInvitation,deliverInvitation,type EmailInvitation} from './invitationEmail';
import InvitationDelivery from './InvitationDelivery';
import HouseholdProfiles from './HouseholdProfiles';
import PaletteSettings from './PaletteSettings';
import {type FamilySetupStep} from './familySetup';
import './family-setup.css';

type Invite={id:string;email:string};
export default function FamilySetup({householdName,householdId,members,people,initialStep,onStep,onSaved,onFinish,paletteId,onPaletteChange,paletteMessage}:{
 householdName:string;householdId:string;members:Member[];people:HouseholdPerson[];initialStep:FamilySetupStep;
 onStep:(step:FamilySetupStep)=>void;onSaved:()=>unknown;onFinish:()=>void;
 paletteId:string;onPaletteChange:(id:string)=>void;paletteMessage:string;
}){
 const [step,setStep]=useState(initialStep),[email,setEmail]=useState(''),[delivery,setDelivery]=useState<EmailInvitation|null>(null);
 const [invites,setInvites]=useState<Invite[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[profileBusy,setProfileBusy]=useState(false),[addRequest,setAddRequest]=useState(1);
 const [profileDraft,setProfileDraft]=useState(false);
 const pending=useRef(false),dialog=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const blocked=busy||profileBusy,blockedRef=useRef(blocked);blockedRef.current=blocked;
 const closeRef=useRef(onFinish);closeRef.current=onFinish;
 const changeStep=(value:FamilySetupStep)=>{if(blockedRef.current)return;setProfileDraft(false);setStep(value);onStep(value)};
 const advance=()=>{if(blockedRef.current)return;if(step==='email')changeStep('profiles');else if(step==='profiles')changeStep('palette');else onFinish()};
 useEffect(()=>{
  let active=true;
  supabase.from('household_invites').select('id,email').eq('household_id',householdId).is('used_at',null).gt('expires_at',new Date().toISOString()).then(({data,error})=>{
   if(!active)return;if(error)setError(error.message);else setInvites(data||[]);
  });
  return()=>{active=false};
 },[householdId]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();if(!blockedRef.current)closeRef.current();return}
   if(e.key!=='Tab')return;
   const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)')||[]).filter(node=>node.getClientRects().length>0);
   const first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===heading.current)){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===heading.current)){e.preventDefault();first?.focus()}
  };
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[]);
 useEffect(()=>{heading.current?.focus();dialog.current?.scrollTo({top:0})},[step]);
 const profileSaved=useCallback(async()=>{await onSaved()},[onSaved]);
 async function invite(e:React.FormEvent){
  e.preventDefault();if(pending.current)return;
  const recipient=email.trim().toLowerCase();
  if(invites.some(item=>item.email.toLowerCase()===recipient)){setError('An invitation for this email is already waiting in their inbox.');return}
  pending.current=true;setBusy(true);setError('');
  try{const result=await createEmailInvitation('family',recipient);setDelivery(result);setInvites(old=>[...old,{id:result.token,email:result.email}]);setEmail('')}
  catch(e){setError((e as {message?:string}).message||'Could not create the invitation. Please try again.')}
  finally{pending.current=false;setBusy(false)}
 }
 return <div className="family-setup-backdrop"><section ref={dialog} className="family-setup" role="dialog" aria-modal="true" aria-labelledby="family-setup-title" aria-describedby="family-setup-copy">
  <div className="family-setup-top"><img src="./icon.svg" alt=""/><span>MAKE YOURSELF AT HOME</span><span>{step==='email'?'1':step==='profiles'?'2':'3'} of 3</span></div>
  <div className="family-setup-progress" aria-label={`Step ${step==='email'?1:step==='profiles'?2:3} of 3`}><span className="active"/><span className={step!=='email'?'active':''}/><span className={step==='palette'?'active':''}/></div>
  <div className="family-setup-body"><span className="round-icon sage">{step==='email'?<Mail/>:step==='profiles'?<Users/>:<Palette/>}</span>
   <h2 ref={heading} tabIndex={-1} id="family-setup-title">{step==='email'?'Invite people with email.':step==='profiles'?'Add your little ones, too.':'A look that feels like you.'}</h2>
   <p id="family-setup-copy">{step==='email'?`Who else shares ${householdName}? Invite them to join with their own account.`:step==='profiles'?'Add children or other family members without an email address. Their profiles can be tagged in events and reminders.':'Choose a colour palette for HH. Tap one to see it change right away.'}</p>
   {step==='email'?<>
    <form className="family-setup-invite" onSubmit={invite}><label htmlFor="setup-family-email">Family member’s email address</label><input id="setup-family-email" type="email" required maxLength={254} autoComplete="email" placeholder="e.g. partner@email.com" value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/><button className="button soft wide" disabled={busy||!email.trim()}><Mail size={17}/>{busy?'Sending…':'Send invitation'}</button></form>
    <p className="family-setup-note">They’ll receive an email with a link to join your home. You can invite more than one person.</p>
    {members.length>1&&<div className="family-setup-people">{members.filter(m=>m.role!=='owner').map(m=><div key={m.user_id}><Check size={15}/><span>{m.display_name}<small>Already in your household</small></span></div>)}</div>}
    {invites.length>0&&<div className="family-setup-people" aria-label="Invitations created"><h3>Invited to your home</h3>{invites.map(i=><div key={i.id}><Mail size={15}/><span>{i.email}<small>Invitation waiting to be accepted</small></span></div>)}</div>}
    {delivery&&<InvitationDelivery key={delivery.token} invitation={delivery} busy={busy} onRetry={async()=>{if(pending.current)return;pending.current=true;setBusy(true);try{setDelivery(await deliverInvitation(delivery))}finally{pending.current=false;setBusy(false)}}}/>}
    {error&&<p className="error" role="alert">{error}</p>}
   </>:step==='profiles'?<>
    <HouseholdProfiles people={people} members={members} householdId={householdId} onSaved={profileSaved} addRequest={addRequest} onBusyChange={setProfileBusy} onDraftChange={setProfileDraft}/>
    {profileDraft&&<p className="family-setup-note">Save this profile to continue, or skip this step to leave it for later.</p>}
    <button className="text-button family-setup-add" type="button" disabled={blocked} onClick={()=>setAddRequest(n=>n+1)}><Plus size={16}/>Add another profile</button>
   </>:<PaletteSettings value={paletteId} onChange={onPaletteChange} message={paletteMessage}/>}
  </div>
  <div className="family-setup-footer"><p>{step==='palette'?'Your palette is personal to this device. Change it anytime: tap your initials in the top right → Appearance.':'You can always add more later: tap your initials in the top right → Your household → Family profiles.'}</p><div className="family-setup-actions">{step!=='email'&&<button type="button" className="text-button" disabled={blocked} onClick={()=>changeStep(step==='profiles'?'email':'profiles')}><ArrowLeft size={16}/>Back</button>}<button type="button" className="button primary" disabled={blocked||(step==='profiles'&&profileDraft)} onClick={advance}>{step==='email'?'Next: without email':step==='profiles'?'Next: your colours':'Done'}{step==='palette'?<Check size={17}/>:<ArrowRight size={17}/>}</button></div><button type="button" className="family-setup-skip" disabled={blocked} onClick={advance}>{step==='palette'?'Keep this look → Continue':'Skip for now → Next step'}</button></div>
 </section></div>;
}
