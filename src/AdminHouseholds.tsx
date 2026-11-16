import {Fragment,useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from './supabase';
type Home={id:string;name:string;memberCount:number;protected:boolean};
type Usage={household_id:string;last_used_at:string|null;last_sign_in_at:string|null};
const useTime=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'});
function LastHouseholdUse({usage,unavailable}:{usage?:Usage;unavailable:boolean}){
 if(unavailable)return <small>Last use unavailable</small>;
 const value=usage?.last_used_at||usage?.last_sign_in_at;
 if(!value||!Number.isFinite(Date.parse(value)))return <small>No use recorded yet</small>;
 return <small>{usage?.last_used_at?'Last used':'Last sign-in'}: <time dateTime={value}>{useTime.format(new Date(value))} ET</time></small>;
}
async function loadUsage(){
 try{
  const {data,error}=await supabase.rpc('admin_household_usage');
  if(error||!Array.isArray(data))return null;
  return new Map((data as Usage[]).map(row=>[row.household_id,row]));
 }catch{return null}
}
async function request(action:string,householdId?:string,confirmation?:string){
 const {data,error}=await supabase.functions.invoke('admin-households',{body:{action,householdId,confirmation}});
 if(error){let message='Could not complete the request. Refresh the list before retrying.';try{const result=await error.context?.json();if(result?.error)message=result.error}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);return data;
}
function comparableName(name:string){
 return name.normalize('NFC').trim().replace(/[‘’]/g,"'");
}
export default function AdminHouseholds(){
 const [homes,setHomes]=useState<Home[]>([]),[selected,setSelected]=useState<Home|null>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[listError,setListError]=useState(''),[deleteError,setDeleteError]=useState(''),[notice,setNotice]=useState('');
 const [usage,setUsage]=useState<Map<string,Usage>|null>(null);
 const deleteButton=useRef<HTMLButtonElement>(null);
 const confirmHeading=useRef<HTMLHeadingElement>(null);
 const confirmForm=useRef<HTMLFormElement>(null);
 const status=useRef<HTMLParagraphElement>(null);
 const matchesName=selected!==null&&comparableName(confirmation)===comparableName(selected.name);
 async function load(){
  setLoading(true);setListError('');
  try{
   const [list,timestamps]=await Promise.all([request('list'),loadUsage()]);
   setHomes(list);setUsage(timestamps);
  }catch(e){setListError((e as Error).message)}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>{
  if(!selected)return;
  confirmHeading.current?.focus({preventScroll:true});
  confirmForm.current?.scrollIntoView({block:'nearest'});
 },[selected]);
 useEffect(()=>{
  if(notice){
   status.current?.focus({preventScroll:true});
   status.current?.scrollIntoView({block:'nearest'});
  }
 },[notice]);
 function cancelDelete(){
  setSelected(null);setConfirmation('');setDeleteError('');
  deleteButton.current?.focus();
 }
 async function deleteHousehold(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||!selected||!matchesName)return;
  setBusy(true);setDeleteError('');
  try{
   // The server checks the exact stored name. Mobile keyboards may change apostrophes in the input.
   await request('delete',selected.id,selected.name);
   setHomes(current=>current.filter(home=>home.id!==selected.id));
   setNotice(`Deleted ${selected.name} and its members’ accounts.`);
   setSelected(null);setConfirmation('');await load();
  }catch(e){setDeleteError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="admin-households"><h3>Manage pilot households</h3><p className="settings-page-description">Admin only. Deleting a household permanently removes its HH calendar, lists, reminders, profiles and all members’ login accounts. It frees its pilot place. Calendars already created in Google remain in Google.</p>
  <button type="button" className="text-button" disabled={busy||loading||selected!==null} onClick={()=>void load()}>Refresh households</button>
  {listError&&<p className="error" role="alert">{listError}</p>}
  {notice&&<p ref={status} role="status" tabIndex={-1}>{notice}</p>}
  {loading?<p>Loading households…</p>:homes.map(home=>{
   const isSelected=selected?.id===home.id;
   return <Fragment key={home.id}>
    <div className="admin-household-row">
     <span><strong>{home.name}</strong><small>{home.memberCount} {home.memberCount===1?'account':'accounts'}{home.protected?' · Your admin household':''}</small><LastHouseholdUse usage={usage?.get(home.id)} unavailable={!usage}/></span>
     <button type="button" className="text-button" disabled={busy||home.protected} aria-expanded={isSelected} aria-controls={isSelected?'admin-household-confirm':undefined} onClick={e=>{
      if(isSelected){cancelDelete();return}
      deleteButton.current=e.currentTarget;setSelected(home);setConfirmation('');setDeleteError('');setNotice('');
     }}>Delete household</button>
    </div>
    {isSelected&&<form id="admin-household-confirm" ref={confirmForm} className="admin-household-confirm" aria-labelledby="admin-household-confirm-title" onSubmit={deleteHousehold}>
     <h4 id="admin-household-confirm-title" ref={confirmHeading} tabIndex={-1}>Delete {home.name}?</h4>
     <p>This permanently deletes this entire household and all its members’ accounts. It cannot be undone. No deletion email will be sent.</p>
     <label>Type the household name to confirm<input autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={80} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
     {deleteError&&<p className="error" role="alert">{deleteError}</p>}
     <div className="admin-household-actions">
      <button className="button danger" disabled={busy||!matchesName}>{busy?'Deleting…':'Permanently delete household'}</button>
      <button type="button" className="text-button" disabled={busy} onClick={cancelDelete}>Cancel</button>
     </div>
    </form>}
   </Fragment>
  })}
 </section>
}
