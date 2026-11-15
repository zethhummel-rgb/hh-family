import {useEffect} from 'react';
import {isCurrentAuthClient,supabase} from './supabase';

export function useHouseholdLastUse(householdId:string,enabled:boolean){
 useEffect(()=>{
  if(!enabled)return;
  const client=supabase;
  let lastReported=-Infinity;
  function report(){
   if(document.visibilityState!=='visible'||!navigator.onLine||!isCurrentAuthClient(client))return;
   const now=performance.now();
   if(now-lastReported<15000)return;
   lastReported=now;
   // A missed report should never interfere with using the household.
   void Promise.resolve(client.rpc('record_household_use',{target_household:householdId})).catch(()=>{});
  }
  report();
  document.addEventListener('visibilitychange',report);
  document.addEventListener('pointerdown',report,{passive:true});
  document.addEventListener('keydown',report);
  window.addEventListener('pageshow',report);
  window.addEventListener('focus',report);
  window.addEventListener('online',report);
  return()=>{
   document.removeEventListener('visibilitychange',report);
   document.removeEventListener('pointerdown',report);
   document.removeEventListener('keydown',report);
   window.removeEventListener('pageshow',report);
   window.removeEventListener('focus',report);
   window.removeEventListener('online',report);
  };
 },[householdId,enabled]);
}
