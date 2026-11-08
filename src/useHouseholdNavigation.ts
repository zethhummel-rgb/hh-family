import {useCallback,useEffect,useRef,useState} from 'react';
import {entryNavigation,isHouseholdTab,isCalendarView,type CalendarView,loadNavigation,saveNavigation,type HouseholdNavigation} from './householdNavigation';

export function useHouseholdNavigation(userId:string,householdId:string,groceryReady:boolean,blocked:boolean){
 const [view,setView]=useState(()=>entryNavigation(loadNavigation(userId,householdId),new URLSearchParams(location.search)));
 const current=useRef(view),pendingScroll=useRef(view.tab==='Groceries'),blockedRef=useRef(blocked);
 blockedRef.current=blocked;
 const persist=useCallback(()=>saveNavigation(userId,householdId,current.current),[userId,householdId]);
 const capture=useCallback(()=>{
  if(current.current.tab==='Groceries'&&!pendingScroll.current&&!blockedRef.current)current.current={...current.current,grocery:{...current.current.grocery,scrollY:window.scrollY}};
  persist();
 },[persist]);
 const update=useCallback((next:HouseholdNavigation)=>{current.current=next;persist();setView(next)},[persist]);
 const setTab=useCallback((tab:string,resetScroll=false)=>{
  if(!isHouseholdTab(tab)||tab===current.current.tab&&!resetScroll)return;
  capture();pendingScroll.current=tab==='Groceries'&&!resetScroll;
  update({...current.current,tab,...(resetScroll?{grocery:{...current.current.grocery,scrollY:0}}:{})});
 },[capture,update]);
 const setCalendarView=useCallback((calendarView:CalendarView)=>{if(isCalendarView(calendarView))update({...current.current,calendarView})},[update]);
 const setQuery=useCallback((search:string)=>{pendingScroll.current=false;update({...current.current,grocery:{...current.current.grocery,search:search.slice(0,160)}})},[update]);
 const setStoreFilter=useCallback((store:string)=>{pendingScroll.current=false;update({...current.current,grocery:{...current.current.grocery,store}})},[update]);

 useEffect(()=>{
  persist();
  const previous=history.scrollRestoration;history.scrollRestoration='manual';
  let timer:ReturnType<typeof setTimeout>|undefined;
  const scroll=()=>{if(!pendingScroll.current&&current.current.tab==='Groceries'){clearTimeout(timer);timer=setTimeout(capture,100)}};
  const flush=()=>{clearTimeout(timer);capture()};
  const visibility=()=>{if(document.hidden)flush()};
  // If the person starts scrolling while the list loads, respect their movement.
  const interaction=(event:Event)=>{
   if(event instanceof KeyboardEvent&&(!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)||event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable]')))return;
   if(current.current.tab==='Groceries'&&!blockedRef.current)pendingScroll.current=false;
  };
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('pagehide',flush);
  window.addEventListener('wheel',interaction,{passive:true});window.addEventListener('touchstart',interaction,{passive:true});window.addEventListener('keydown',interaction);
  document.addEventListener('visibilitychange',visibility);
  return()=>{clearTimeout(timer);history.scrollRestoration=previous;window.removeEventListener('scroll',scroll);window.removeEventListener('pagehide',flush);window.removeEventListener('wheel',interaction);window.removeEventListener('touchstart',interaction);window.removeEventListener('keydown',interaction);document.removeEventListener('visibilitychange',visibility)};
 },[capture,persist]);
 useEffect(()=>{
  if(view.tab!=='Groceries'||!groceryReady||blocked||!pendingScroll.current)return;
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   if(!pendingScroll.current)return;
   window.scrollTo({top:current.current.grocery.scrollY,behavior:'instant'});
   pendingScroll.current=false;capture();
  })});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)};
 },[view.tab,groceryReady,blocked,capture]);
 return {tab:view.tab,calendarView:view.calendarView,setCalendarView,query:view.grocery.search,storeFilter:view.grocery.store,setTab,setQuery,setStoreFilter,capture};
}
