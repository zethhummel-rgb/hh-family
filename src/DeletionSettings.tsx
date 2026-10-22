import {useRef,useState} from 'react';
import {supabase} from './supabase';
type Props={owner:boolean;email:string;householdId:string;householdName:string;protectedAccount:boolean;onBusy:(busy:boolean)=>void};
export default function DeletionSettings({owner,email,householdId,householdName,protectedAccount,onBusy}:Props){
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 const matches=owner?confirmation===householdName:confirmation.trim().toLowerCase()===email.toLowerCase();
 return <section className="self-deletion"><h3>{owner?'Delete your home':'Delete your account'}</h3>
  {protectedAccount?<p>Your pilot administrator account and household are protected from self-service deletion.</p>:<>
   <p>{owner?'As the household owner, you can permanently delete this home, all its HH data, and every member’s login account, including your own.':'You can permanently delete your login account and leave this household. Shared plans, lists and family profiles remain for the other members.'}</p>
   {!open?<button type="button" className="text-button" onClick={()=>{setOpen(true);setConfirmation('');setError('')}}>{owner?'Delete home and all accounts':'Delete my account'}</button>:<form onSubmit={async e=>{
    e.preventDefault();if(inFlight.current||!matches)return;inFlight.current=true;setBusy(true);onBusy(true);setError('');
    try{
     const {data,error:invokeError}=await supabase.functions.invoke('self-service-deletion',{body:{action:owner?'household':'account',householdId,confirmation}});
     if(invokeError){let message='Could not complete deletion. Sign in again to check before retrying.';try{const result=await invokeError.context?.json();if(result?.error)message=result.error}catch{}throw Error(message)}
     if(!data?.deleted)throw Error(data?.error||'Deletion could not be confirmed.');
     await supabase.auth.signOut({scope:'local'});
     location.replace(location.pathname);
    }catch(e){setError((e as Error).message);inFlight.current=false;setBusy(false);onBusy(false)}
   }}><p className="deletion-warning">{owner?'This deletes every member’s account and the household’s calendar records, groceries, to-dos, reminders and profiles. Everyone will lose access.':'You will lose access to this household and will need a new account and invitation to return.'} This cannot be undone through HH. No deletion email will be sent.</p>
    {owner&&<p>Any calendar or events already stored in Google remain there. HH removes its stored connection. Provider logs and backup copies follow their retention processes.</p>}
    <label>{owner?'Type the exact household name':'Type your email address'}<strong className="deletion-confirm-value">{owner?householdName:email}</strong><input autoComplete="off" maxLength={owner?80:254} disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
    <div className="admin-household-actions"><button className="button danger" disabled={busy||!matches}>{busy?'Deleting…':owner?'Permanently delete home and accounts':'Permanently delete my account'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setOpen(false);setConfirmation('');setError('')}}>Cancel</button></div>
   </form>}
  </>}{error&&<p className="error" role="alert">{error}</p>}
 </section>
}
