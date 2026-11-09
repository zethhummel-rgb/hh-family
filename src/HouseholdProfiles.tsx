import {useTutorialPractice} from './InteractiveTutorial';
import {useRegisteredDraft} from './draftGroup';
import {useUnsavedChanges} from './useUnsavedChanges';
import {useEffect,useState,useRef} from 'react';
import {Plus,Pencil,Check} from 'lucide-react';
import {supabase} from './supabase';
import type {HouseholdPerson,Member} from './data';
export default function HouseholdProfiles({people,members,householdId,onSaved,addRequest,onBusyChange,onDraftChange}:{onDraftChange?:(draft:boolean)=>void;onBusyChange?:(busy:boolean)=>void;addRequest?:number;people:HouseholdPerson[];members:Member[];householdId:string;onSaved:()=>unknown}){
 const tutorial=useTutorialPractice();
 const [editing,setEditing]=useState<HouseholdPerson|null>(null),[adding,setAdding]=useState(false),[name,setName]=useState(''),[color,setColor]=useState('#E78725'),[linked,setLinked]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const nameInput=useRef<HTMLInputElement>(null),pending=useRef(false);
 const dirty=(adding||!!editing)&&(name!==(editing?.display_name||'')||color!==(editing?.calendar_color||'#E78725')||linked!==(editing?.linked_user_id||''));
 function discard(){setEditing(null);setAdding(false);setName('');setError('')}
 const guard=useUnsavedChanges(dirty,busy,discard,save);
 useRegisteredDraft({dirty,busy,save,discard});
 useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange]);
 useEffect(()=>{onDraftChange?.((adding||!!editing)&&!!name.trim())},[adding,editing,name,onDraftChange]);
 // Each tile press starts a new profile, or focuses the draft already being edited.
 useEffect(()=>{if(!addRequest)return;if(!adding&&!editing){setAdding(true);setName('');setColor('#E78725');setLinked('');setError('');setNotice('')}else nameInput.current?.focus()},[addRequest]);
 useEffect(()=>{if(adding||editing)nameInput.current?.focus()},[adding,editing]);
 async function save(){if(tutorial.intercept('family'))return false;if(pending.current)return false;if(!name.trim()){setError('Enter a family member’s name.');nameInput.current?.focus();return false}pending.current=true;setBusy(true);setError('');try{const r=editing?await supabase.from('household_people').update({display_name:name.trim(),calendar_color:color,linked_user_id:linked||null}).eq('household_id',householdId).eq('id',editing.id).select('id').single():await supabase.rpc('add_household_person',{person_name:name.trim(),person_color:color});if(r.error)throw r.error;await onSaved();setAdding(false);setEditing(null);setNotice('Family profile saved.');return true}catch(e){setError((e as Error).message);return false}finally{pending.current=false;setBusy(false)}}
 return <section className="household-profiles">{guard.confirmation}<h4>Children &amp; members without email</h4><p>Add a profile for anyone who doesn’t have an email address or need their own login. You can tag them in events and reminders.</p>{people.map(p=><div className="profile-row" key={p.id}><i className="person-dot" style={{backgroundColor:p.calendar_color}}/><span>{p.display_name}<small>{p.linked_user_id?'Linked to a family account':'No login needed'}</small></span><button type="button" className="text-button" disabled={busy} onClick={()=>guard.requestClose(()=>{setEditing(p);setAdding(false);setName(p.display_name);setColor(p.calendar_color);setLinked(p.linked_user_id||'');setError('');setNotice('')})}><Pencil size={14}/>Edit</button></div>)}{!adding&&!editing?(addRequest===undefined?<button className="text-button" type="button" onClick={()=>{setAdding(true);setName('');setColor('#E78725');setLinked('');setNotice('')}}><Plus size={15}/>Add family profile</button>:null):<form className="profile-editor" onSubmit={e=>{e.preventDefault();void save()}}><label>Name<input ref={nameInput} disabled={busy} required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="Family member’s name"/></label><label className="custom-color">Calendar colour<input type="color" disabled={busy} value={color} onChange={e=>setColor(e.target.value)}/></label>{editing&&<label>Link to an account<select disabled={busy} value={linked} onChange={e=>setLinked(e.target.value)}><option value="">No login yet</option>{members.map(m=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select><small>When they get an account, linking keeps their existing event tags.</small></label>}<div className="profile-editor-actions"><button className="button soft" disabled={busy||!name.trim()}><Check size={15}/>{busy?'Saving…':'Save profile'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>guard.requestClose()}>Cancel</button></div></form>}{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="field-help" role="status">{notice}</p>}</section>
}

export function HouseholdNameSettings({householdName,householdId,onSaved}:{householdName:string;householdId:string;onSaved:()=>unknown}){
 const [saved,setSaved]=useState(householdName),pending=useRef(false);
 const [home,setHome]=useState(householdName),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{setHome(householdName);setSaved(householdName)},[householdName]);
 useRegisteredDraft({dirty:home!==saved,busy,save:saveHome,discard:()=>{setHome(saved);setError('')}});
 async function saveHome(){if(pending.current)return false;if(!home.trim()){setError('Enter a household name.');return false}pending.current=true;setBusy(true);setError('');try{const r=await supabase.from('households').update({name:home.trim()}).eq('id',householdId).select('id').single();if(r.error)throw r.error;await onSaved();setSaved(home.trim());setNotice('Household name saved.');return true}catch(e){setError((e as Error).message);return false}finally{pending.current=false;setBusy(false)}}
 return <section className="household-name-settings"><form onSubmit={e=>{e.preventDefault();void saveHome()}}><label>Household name<input disabled={busy} required maxLength={80} value={home} onChange={e=>setHome(e.target.value)}/></label><button className="button soft" disabled={busy||!home.trim()||home===householdName}>Save household name</button></form>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="field-help" role="status">{notice}</p>}</section>;
}
