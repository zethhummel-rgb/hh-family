import {useCallback,useEffect,useRef,useState} from 'react';
import {deleteFamilyNote,loadFamilyNotes,pinFamilyNote,saveFamilyNote,sortFamilyNotes,type FamilyNote,type FamilyNoteDraft} from './familyNotesData';

type State={householdId:string;notes:FamilyNote[];loaded:boolean;loading:boolean;error:string};
const empty=(householdId:string):State=>({householdId,notes:[],loaded:false,loading:true,error:''});
const message=(error:unknown)=>error instanceof Error?error.message:(error as {message?:string})?.message||'Could not load family notes.';
export function useFamilyNotes(householdId:string){
 const [state,setState]=useState<State>(()=>empty(householdId));
 const current=useRef(householdId),mounted=useRef(false),generation=useRef(0);current.current=householdId;
 const refresh=useCallback(async()=>{
  const request=++generation.current;setState(old=>({...((old.householdId===householdId)?old:empty(householdId)),loading:true}));
  try{const notes=await loadFamilyNotes(householdId);if(mounted.current&&current.current===householdId&&request===generation.current)setState({householdId,notes,loaded:true,loading:false,error:''})}
  catch(error){if(mounted.current&&current.current===householdId&&request===generation.current)setState(old=>({...((old.householdId===householdId)?old:empty(householdId)),loading:false,error:message(error)}))}
 },[householdId]);
 useEffect(()=>{
  mounted.current=true;setState(empty(householdId));void refresh();
  const reload=()=>{if(!document.hidden)void refresh()};
  window.addEventListener('focus',reload);window.addEventListener('online',reload);const timer=setInterval(reload,30000);
  return()=>{mounted.current=false;generation.current++;clearInterval(timer);window.removeEventListener('focus',reload);window.removeEventListener('online',reload)};
 },[householdId,refresh]);
 const accept=useCallback((note:FamilyNote)=>{
  if(!mounted.current||current.current!==householdId)return;
  generation.current++;
  setState(old=>{const previous=old.householdId===householdId?old:empty(householdId),existing=previous.notes.find(item=>item.id===note.id);return {...previous,loading:false,notes:sortFamilyNotes(existing&&existing.version>note.version?previous.notes:[...previous.notes.filter(item=>item.id!==note.id),note])}});
 },[householdId]);
 const save=useCallback(async(draft:FamilyNoteDraft,note?:FamilyNote|null)=>{const saved=await saveFamilyNote(householdId,draft,note);accept(saved);if(mounted.current&&current.current===householdId)void refresh();return saved},[householdId,accept,refresh]);
 const pin=useCallback(async(note:FamilyNote,pinned:boolean)=>{const saved=await pinFamilyNote(householdId,note,pinned);accept(saved);if(mounted.current&&current.current===householdId)void refresh();return saved},[householdId,accept,refresh]);
 const remove=useCallback(async(note:FamilyNote)=>{
  await deleteFamilyNote(householdId,note);
  if(!mounted.current||current.current!==householdId)return;
  generation.current++;setState(old=>old.householdId===householdId?{...old,loading:false,notes:old.notes.filter(item=>item.id!==note.id)}:old);void refresh();
 },[householdId,refresh]);
 const visible=state.householdId===householdId?state:empty(householdId);
 return {...visible,refresh,save,remove,pin};
}
