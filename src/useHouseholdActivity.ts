import {useCallback,useEffect,useRef,useState} from 'react';
import {loadHouseholdActivity,markHouseholdActivitySeen,type HouseholdChange} from './householdActivityData';

type State={scope:string;rows:HouseholdChange[];error:string};
const message=(error:unknown)=>error instanceof Error?error.message:(error as {message?:string})?.message||'Could not refresh your household updates.';
export function useHouseholdActivity(householdId:string,userId:string){
 const scope=householdId+':'+userId,current=useRef(scope),mounted=useRef(false),generation=useRef(0),acknowledged=useRef(new Set<string>());current.current=scope;
 const [state,setState]=useState<State>({scope,rows:[],error:''}),[view,setView]=useState<{scope:string;rows:HouseholdChange[]}|null>(null);
 const refresh=useCallback(async()=>{
  const request=++generation.current;
  try{const rows=await loadHouseholdActivity(householdId,userId);if(mounted.current&&current.current===scope&&generation.current===request)setState({scope,rows:rows.filter(row=>!acknowledged.current.has(row.id)),error:''})}
  catch(error){if(mounted.current&&current.current===scope&&generation.current===request)setState(old=>old.scope===scope?{...old,error:message(error)}:{scope,rows:[],error:message(error)})}
 },[householdId,userId,scope]);
 useEffect(()=>{
  mounted.current=true;acknowledged.current=new Set();setState({scope,rows:[],error:''});setView(null);void refresh();
  const reload=()=>{if(!document.hidden)void refresh()};
  const timer=setInterval(reload,30000);window.addEventListener('focus',reload);window.addEventListener('online',reload);document.addEventListener('visibilitychange',reload);
  return()=>{mounted.current=false;generation.current++;clearInterval(timer);window.removeEventListener('focus',reload);window.removeEventListener('online',reload);document.removeEventListener('visibilitychange',reload)};
 },[scope,refresh]);
 const markSeen=useCallback(async(rows:HouseholdChange[])=>{
  await markHouseholdActivitySeen(householdId,userId,rows);
  if(!mounted.current||current.current!==scope)return;
  for(const row of rows)acknowledged.current.add(row.id);
  setState(old=>old.scope===scope?{...old,rows:old.rows.filter(row=>!acknowledged.current.has(row.id))}:old);
 },[householdId,userId,scope]);
 const currentState=state.scope===scope?state:{scope,rows:[],error:''};
 return {...currentState,view:view?.scope===scope?view.rows:null,refresh,markSeen,open:()=>{if(currentState.rows.length)setView({scope,rows:currentState.rows.slice()})},close:()=>setView(null)};
}
