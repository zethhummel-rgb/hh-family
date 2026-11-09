import {useTutorialPractice} from './InteractiveTutorial';
import InvitationDelivery from './InvitationDelivery';
import ChoiceDialog from './ChoiceDialog';
import {useRegisteredDraft} from './draftGroup';
import {useUnsavedChanges} from './useUnsavedChanges';
import {createEmailInvitation,deliverInvitation,reissueFamilyInvitation,normalInvitationEmail,emailSuggestion,type EmailInvitation,type ReissueAttempt} from './invitationEmail';
import HouseholdProfiles,{HouseholdNameSettings} from './HouseholdProfiles';
import {COLOR_CHOICES,defaultColor,safeColor} from './people';
import {useEffect,useState,useRef,useId} from 'react';
import {supabase} from './supabase';
import type {Member,HouseholdPerson} from './data';
import {Mail,Users,ChevronRight,X} from 'lucide-react';
type Invite={id:string;email:string;expires_at:string;used_at:string|null};
export default function FamilySettings({owner,members,householdId,householdName,people,onHouseholdSaved}:{householdName:string;people:HouseholdPerson[];onHouseholdSaved:()=>unknown;owner:boolean;members:Member[];householdId:string}){
 const tutorial=useTutorialPractice();
 const [inviteOpen,setInviteOpen]=useState(false),[addProfileRequest,setAddProfileRequest]=useState(0),[correcting,setCorrecting]=useState<Invite|null>(null);
 const emailInput=useRef<HTMLInputElement>(null),invitePanelId=useId(),pending=useRef(false),attempt=useRef<ReissueAttempt|null>(null);
 const [email,setEmail]=useState(''),[delivery,setDelivery]=useState<EmailInvitation|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[invites,setInvites]=useState<Invite[]>([]),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{email:string;source:Invite|null}|null>(null),[cancelling,setCancelling]=useState<Invite|null>(null);
 const dirty=inviteOpen&&email!==(correcting?.email||'');
 function discard(){setEmail('');setCorrecting(null);setInviteOpen(false);setError('')}
 const guard=useUnsavedChanges(dirty,busy,discard,()=>{prepare();return false});
 useRegisteredDraft({dirty,busy,save:async()=>{prepare();return false},discard});
 useEffect(()=>{if(inviteOpen)emailInput.current?.focus()},[inviteOpen,correcting?.id]);
 async function load(){if(!owner)return;const r=await supabase.from('household_invites').select('id,email,expires_at,used_at').eq('household_id',householdId).order('created_at',{ascending:false});if(r.error)setError('Could not refresh invitations. Please try again.');else setInvites(r.data)}
 useEffect(()=>{void load()},[householdId,owner]);
 function prepare(){
  if(pending.current||!emailInput.current?.reportValidity())return;
  try{setReview({email:normalInvitationEmail(email),source:correcting});setError('')}catch(e){setError((e as Error).message)}
 }
 function edit(source:Invite|null){guard.requestClose(()=>{setCorrecting(source);setEmail(source?.email||'');setInviteOpen(true);setError('');setNotice('')})}
 async function send(){
  if(tutorial.intercept('invitation'))return;
  if(pending.current||!review)return;pending.current=true;setBusy(true);setError('');setNotice('');const selected=review;setReview(null);
  try{
   let result:EmailInvitation;
   if(selected.source){
    const identity=JSON.stringify([selected.source.id,selected.source.email,selected.email]);
    if(attempt.current?.identity!==identity){const bytes=crypto.getRandomValues(new Uint8Array(32));attempt.current={identity,id:crypto.randomUUID(),token:Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('')}}
    result=await reissueFamilyInvitation(selected.source,selected.email,attempt.current);
   }else result=await createEmailInvitation('family',selected.email);
   setDelivery(result);setEmail('');setCorrecting(null);setInviteOpen(false);attempt.current=null;await load();
  }catch(e){setError((e as Error).message||'Could not create this invitation. Your address is still here.');await load()}
  finally{pending.current=false;setBusy(false)}
 }
 async function cancel(){
  if(pending.current||!cancelling)return;pending.current=true;setBusy(true);setError('');const target=cancelling;setCancelling(null);
  try{const r=await supabase.from('household_invites').delete().eq('id',target.id).eq('household_id',householdId).eq('email',target.email).is('used_at',null).select('id').maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error('This invitation changed. Refresh the list before trying again.');setDelivery(null);setNotice('Invitation cancelled. Its link can no longer be used.');await load()}catch(e){setError((e as Error).message||'Could not cancel the invitation.')}finally{pending.current=false;setBusy(false)}
 }
 const suggestion=emailSuggestion(email),active=invites.filter(i=>!i.used_at&&new Date(i.expires_at)>new Date());
 return <div className="family-settings">{guard.confirmation}
 {!owner&&<p className="settings-page-description">Home: {householdName}</p>}
 {owner&&<HouseholdNameSettings householdName={householdName} householdId={householdId} onSaved={onHouseholdSaved}/>}
 <section className="family-profile-settings"><h3>Family profiles</h3>
 {owner&&<div className="family-add-options" role="group" aria-label="Add a family member">
 <button type="button" disabled={busy} aria-label="Invite a family member by email" aria-expanded={inviteOpen} aria-controls={invitePanelId} onClick={()=>edit(null)}><Mail size={22}/><span><b>Invite by email</b><small>Their own login to your household</small></span><ChevronRight size={17}/></button>
 <button type="button" disabled={busy} aria-label="Add a family member without email" onClick={()=>setAddProfileRequest(n=>n+1)}><Users size={22}/><span><b>Add without email</b><small>A profile for a child or family member</small></span><ChevronRight size={17}/></button></div>}
 <section className="email-family-members"><h4>Members with an email address</h4><p>{owner?'Invite another person to join this household with their own account.':'Each person here has their own account.'}</p>
 <div className="member-list">{members.map(m=><div key={m.user_id}><span className="member-avatar" style={{borderColor:safeColor(m.calendar_color)||defaultColor(m.display_name,m.user_id)}}>{m.display_name.slice(0,1)}</span><span>{m.display_name}</span><small>{m.role==='owner'?'Household owner':'Family member'}</small></div>)}</div>
 {owner&&<>
 {inviteOpen&&<form className="email-invitation-form" id={invitePanelId} onSubmit={e=>{e.preventDefault();prepare()}}>
 <div className="family-form-heading"><h4>{correcting?'Correct invitation address':'Invite by email'}</h4><button type="button" className="icon-button" aria-label="Close email invitation" disabled={busy} onClick={()=>guard.requestClose()}><X size={16}/></button></div>
 <label>Their email address<input ref={emailInput} type="email" required maxLength={254} autoComplete="email" disabled={busy} placeholder="Their email address" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 {suggestion&&<p className="field-help">Check the email spelling. Did you mean <button type="button" className="text-button" onClick={()=>setEmail(suggestion)}>{suggestion}</button>?</p>}
 <button type="submit" className="button soft wide" disabled={busy||!email.trim()}><Mail size={16}/>Review invitation</button>
 <p className="field-help invitation-help">Review the address before sending. The invitation works once, expires in seven days and requires this confirmed email address.</p></form>}
 {delivery&&<InvitationDelivery invitation={delivery} busy={busy} onRetry={async()=>{if(pending.current)return;pending.current=true;setBusy(true);try{setDelivery(await deliverInvitation(delivery))}finally{pending.current=false;setBusy(false)}}}/>}
 {active.length>0&&<div className="pending-invites"><h4>Pending invitations</h4><p>Waiting for the person to join. Email acceptance does not confirm inbox delivery.</p>
 {active.map(i=><div className="pending-invite-row" key={i.id}><span>{i.email}<small>Expires {new Date(i.expires_at).toLocaleDateString()}</small></span><div className="pending-invite-actions">
 <button type="button" disabled={busy} aria-label={'Correct address for '+i.email} onClick={()=>edit(i)}>Correct address</button>
 <button type="button" disabled={busy} aria-label={'Resend invitation to '+i.email} onClick={()=>guard.requestClose(()=>{discard();setReview({email:i.email,source:i})})}>Resend</button>
 <button type="button" disabled={busy} aria-label={'Cancel invitation for '+i.email} onClick={()=>guard.requestClose(()=>{discard();setCancelling(i)})}>Cancel invitation</button>
 </div></div>)}</div>}</>}
 </section>
 {owner?<HouseholdProfiles addRequest={addProfileRequest} people={people} members={members} householdId={householdId} onSaved={onHouseholdSaved}/>:<section className="household-profiles"><h4>Children &amp; members without email</h4>{people.length?people.map(p=><div className="profile-row" key={p.id}><i className="person-dot" style={{backgroundColor:p.calendar_color}}/><span>{p.display_name}<small>{p.linked_user_id?'Linked to a family account':'No login needed'}</small></span></div>):<p>No profiles have been added yet.</p>}</section>}
 </section>
 {error&&<div role="alert" className="error">{error}</div>}{notice&&<p role="status" className="field-help">{notice}</p>}
 {review&&<ChoiceDialog title="Review invitation" onCancel={()=>setReview(null)} actions={[{label:review.source?'Send new invitation':'Send invitation',tutorial:'invitation-send',primary:true,run:()=>void send()},{label:'Keep editing',run:()=>setReview(null)}]}>
 <p>Invite this person to <strong>{householdName}</strong>:</p><p className="invitation-recipient">{review.email}</p>{review.source&&<p>This creates a fresh seven-day invitation. The previous invitation link will stop working.</p>}<p>Check the address before sending.</p></ChoiceDialog>}
 {cancelling&&<ChoiceDialog title="Cancel invitation?" onCancel={()=>setCancelling(null)} actions={[{label:'Keep invitation',primary:true,run:()=>setCancelling(null)},{label:'Cancel invitation',run:()=>void cancel()}]}><p>Cancel the invitation for <strong>{cancelling.email}</strong>? Its link will stop working.</p></ChoiceDialog>}
 </div>;
}


export function MyCalendarColor({member,householdId,userId,onSaved}:{member:Member|undefined;householdId:string;userId:string;onSaved:(color:string)=>void}){
 const saved=safeColor(member?.calendar_color)||defaultColor(member?.display_name||'',userId);
 const [color,setColor]=useState(saved),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const colorPending=useRef(false),tutorial=useTutorialPractice();
 useRegisteredDraft({dirty:color.toUpperCase()!==saved.toUpperCase(),busy:saving,save:saveColor,discard:()=>{setColor(saved);setError('')}});
 async function saveColor(){if(tutorial.intercept('colour'))return false;if(colorPending.current)return false;colorPending.current=true;setSaving(true);setError('');setMessage('');try{const r=await supabase.from('household_members').update({calendar_color:color}).eq('household_id',householdId).eq('user_id',userId).select('calendar_color').single();if(r.error)throw r.error;onSaved(r.data.calendar_color);setMessage('Your colour is saved.');return true}catch(e){setError((e as {message?:string}).message||'Could not save your colour.');return false}finally{colorPending.current=false;setSaving(false)}}
 useEffect(()=>{setColor(saved)},[saved]);
 return <section className="my-calendar-color"><h3>Your calendar colour</h3><p>Pick the dot the family will see beside your events.</p><div className="color-swatches" role="group" aria-label="Calendar colour choices">{COLOR_CHOICES.map(choice=><button type="button" key={choice.value} disabled={saving} aria-label={choice.name} aria-pressed={color.toUpperCase()===choice.value} title={choice.name} style={{backgroundColor:choice.value}} onClick={()=>{setColor(choice.value);setMessage('')}}/>)}</div><label className="custom-color">Custom colour<input type="color" disabled={saving} aria-label="Custom calendar colour" value={color} onChange={e=>{setColor(e.target.value.toUpperCase());setMessage('')}}/></label><button type="button" className="button soft" disabled={saving||color.toUpperCase()===saved.toUpperCase()} onClick={()=>void saveColor()}>{saving?'Saving…':'Save my colour'}</button>{message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}</section>
}
