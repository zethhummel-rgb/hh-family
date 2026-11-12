import {useRef,useState} from 'react';
import ChoiceDialog from './ChoiceDialog';
import {useRegisteredDraft} from './draftGroup';
import {useTutorialPractice} from './InteractiveTutorial';
import {supabase} from './supabase';

export default function RemoveFamilyPerson({householdId,id,name,kind,onRemoved,disabled=false}:{
 householdId:string;
 id:string;
 name:string;
 kind:'member'|'profile';
 onRemoved:()=>unknown;
 disabled?:boolean;
}){
 const tutorial=useTutorialPractice();
 const [confirming,setConfirming]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const pending=useRef(false);
 useRegisteredDraft({dirty:false,busy,save:async()=>false,discard:()=>{}});

 async function remove(){
  if(pending.current||tutorial.active)return;
  pending.current=true;
  setConfirming(false);
  setBusy(true);
  setError('');
  try{
   const {error}=await supabase.rpc('remove_family_person',{
    target_household:householdId,target_kind:kind,target_id:id
   });
   if(error)throw error;
   await onRemoved();
  }catch(e){
   setError((e as {message?:string}).message||'Could not remove this person. Try again.');
  }finally{
   pending.current=false;
   setBusy(false);
  }
 }

 if(tutorial.active)return null;
 return <>
  <button type="button" className="text-button" disabled={disabled||busy}
   aria-label={`Remove ${name}`} onClick={()=>{setError('');setConfirming(true)}}>
   {busy?'Removing…':'Remove'}
  </button>
  {error&&<p className="error" role="alert">{error}</p>}
  {confirming&&<ChoiceDialog title={`Remove ${name}?`} onCancel={()=>setConfirming(false)}
   actions={[{label:'Keep',primary:true,run:()=>setConfirming(false)},{label:'Remove',run:()=>void remove()}]}>
   {kind==='member'
    ?<p>{name} will lose access to this household and need a new invitation to return. Their HH login and the household’s shared plans and lists will stay.</p>
    :<p>This removes {name}’s family profile from your household. Shared events and lists will stay.</p>}
  </ChoiceDialog>}
 </>;
}
