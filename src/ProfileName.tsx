import {useTutorialPractice} from './InteractiveTutorial';
import {useRegisteredDraft} from './draftGroup';
import {useUnsavedChanges} from './useUnsavedChanges';
import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
export default function ProfileName({name,userId,householdId,onSaved,onDirty,onBusy}:{name:string;userId:string;householdId:string;onSaved:()=>unknown;onDirty:(dirty:boolean)=>void;onBusy:(busy:boolean)=>void}){
 const tutorial=useTutorialPractice();
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(name),[saved,setSaved]=useState(name),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const pending=useRef(false);
 useEffect(()=>{setSaved(name);if(!editing)setDraft(name)},[name]);
 useEffect(()=>{onDirty(editing&&draft.trim()!==saved)},[editing,draft,saved,onDirty]);
 const dirty=editing&&draft.trim()!==saved;
 function discard(){setDraft(saved);setEditing(false);setError('')}
 const guard=useUnsavedChanges(dirty,busy,discard,save);
 useRegisteredDraft({dirty,busy,save,discard});
 async function save(){if(tutorial.intercept('profile'))return false;if(pending.current)return false;pending.current=true;setBusy(true);onBusy(true);setError('');setNotice('');try{const value=draft.trim();if(!value||value.length>60)throw Error('Enter a name between 1 and 60 characters.');const result=await supabase.from('household_members').update({display_name:value}).eq('household_id',householdId).eq('user_id',userId).eq('display_name',saved).select('display_name').maybeSingle();if(result.error)throw result.error;if(!result.data)throw Error('Your profile changed. Close Settings and refresh before trying again.');setSaved(result.data.display_name);setDraft(result.data.display_name);setEditing(false);onDirty(false);setNotice('Your name is saved.');await onSaved();return true}catch(e){setError((e as Error).message||'Could not update your name. Please try again.');return false}finally{pending.current=false;setBusy(false);onBusy(false)}}
 return <div className="profile-name-form">{guard.confirmation}{editing?<form onSubmit={e=>{e.preventDefault();void save()}}><label>Your display name<input value={draft} required maxLength={60} autoComplete="name" disabled={busy} onChange={e=>setDraft(e.target.value)}/></label><button className="button primary" disabled={busy||!draft.trim()||draft.trim()===saved}>{busy?'Saving…':'Save name'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>guard.requestClose()}>Cancel name change</button></form>:<button type="button" className="button soft" onClick={()=>{setDraft(saved);setEditing(true);setNotice('')}}>Edit name</button>}{notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}</div>;
}
