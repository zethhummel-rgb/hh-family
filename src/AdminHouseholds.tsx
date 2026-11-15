import {useEffect,useState} from 'react';
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
export default function AdminHouseholds(){
 const [homes,setHomes]=useState<Home[]>([]),[selected,setSelected]=useState<Home|null>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [usage,setUsage]=useState<Map<string,Usage>|null>(null);
 async function load(){
  setLoading(true);setError('');
  try{
   const [list,timestamps]=await Promise.all([request('list'),loadUsage()]);
   setHomes(list);setUsage(timestamps);
  }catch(e){setError((e as Error).message)}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 return <section className="admin-households"><h3>Manage pilot households</h3><p className="settings-page-description">Admin only. Deleting a household permanently removes its HH calendar, lists, reminders, profiles and all members’ login accounts. It frees its pilot place. Calendars already created in Google remain in Google.</p>
  <button type="button" className="text-button" disabled={busy||loading} onClick={()=>void load()}>Refresh households</button>
  {loading?<p>Loading households…</p>:homes.map(home=><div className="admin-household-row" key={home.id}><span><strong>{home.name}</strong><small>{home.memberCount} {home.memberCount===1?'account':'accounts'}{home.protected?' · Your admin household':''}</small><LastHouseholdUse usage={usage?.get(home.id)} unavailable={!usage}/></span><button type="button" className="text-button" disabled={busy||home.protected} onClick={()=>{setSelected(home);setConfirmation('');setError('');setNotice('')}}>Delete household</button></div>)}
  {selected&&<form className="admin-household-confirm" onSubmit={async e=>{e.preventDefault();if(busy||confirmation!==selected.name)return;setBusy(true);setError('');try{await request('delete',selected.id,confirmation);setNotice(`Deleted ${selected.name} and its members’ accounts.`);setSelected(null);setConfirmation('');await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}><h4>Delete {selected.name}?</h4><p>This permanently deletes this entire household and all its members’ accounts. It cannot be undone. No deletion email will be sent.</p><label>Type the household name to confirm<input autoComplete="off" maxLength={80} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label><div className="admin-household-actions"><button className="button danger" disabled={busy||confirmation!==selected.name}>{busy?'Deleting…':'Permanently delete household'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setSelected(null);setConfirmation('')}}>Cancel</button></div></form>}
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>
}
