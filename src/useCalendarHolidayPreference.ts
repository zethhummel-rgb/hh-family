import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';

const preferenceKey='hh_show_calendar_holidays';

export function useCalendarHolidayPreference(){
 const [showHolidays,setShowHolidays]=useState(true);
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const write=useRef(false);
 const revision=useRef(0);
 const client=supabase;

 useEffect(()=>{
  let active=true;
  async function load(){
   if(write.current||!navigator.onLine)return;
   const started=++revision.current;
   try{
    const {data,error}=await client.auth.getUser();
    if(active&&started===revision.current&&!error&&data.user){
     setShowHolidays(data.user.user_metadata[preferenceKey]!==false);
    }
   }catch{
    // Keep the last known value when the connection is unavailable.
   }finally{
    if(active&&started===revision.current)setLoading(false);
   }
  }
  if(navigator.onLine)void load();
  else setLoading(false);
  window.addEventListener('focus',load);
  window.addEventListener('online',load);
  return()=>{
   active=false;
   window.removeEventListener('focus',load);
   window.removeEventListener('online',load);
  };
 },[client]);

 async function chooseShowHolidays(show:boolean){
  if(write.current||loading)return;
  write.current=true;
  revision.current++;
  setSaving(true);
  setError('');
  try{
   const {data,error}=await client.auth.updateUser({data:{[preferenceKey]:show}});
   if(error||data.user?.user_metadata[preferenceKey]!==show)throw Error('Holiday preference not saved');
   setShowHolidays(show);
  }catch{
   setError('Couldn’t save your holiday setting. Try again when you’re online.');
  }finally{
   write.current=false;
   setSaving(false);
  }
 }

 return {showHolidays,chooseShowHolidays,busy:loading||saving,error};
}
