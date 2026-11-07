import {useCallback,useEffect,useRef,useState} from 'react';
import {savedTrip,saveGroceries,syncTrip,pickItem,prepareShoppingShell,tripEvent,clearNotices,groceryItems,queueGrocery,resolveGrocery} from './offlineShopping';
import {groceryDetails,type GroceryDraft} from './groceryData';
import type {ReminderItem} from './taskReminders';
import './offline-groceries.css';

export function useOfflineGroceries(user:string,home:string,name:string,items:ReminderItem[],ready:boolean,onConnected?:()=>void) {
  const read = () => {const value=savedTrip();return value?.user===user&&value.home===home?value:null;};
  const [trip,setTrip]=useState(read);
  const [online,setOnline]=useState(navigator.onLine);
  const [available,setAvailable]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [problem,setProblem]=useState('');
  const running=useRef(false);
  const alive=useRef(false);
  const connected=useRef(onConnected);connected.current=onConnected;
  const sync=useCallback(async()=>{
    const current=savedTrip();
    if(running.current||!navigator.onLine||current?.user!==user||current.home!==home)return;
    running.current=true;setSyncing(true);
    try {
      const verified=await syncTrip(current);
      if(alive.current){setProblem('');if(verified)connected.current?.();}
    } catch {if(alive.current)setProblem('Could not sync yet. Your changes are saved on this device. Reconnect and retry.');}
    finally{running.current=false;if(alive.current)setSyncing(false);}
  },[user,home]);
  useEffect(()=>{
    alive.current=true;
    const update=()=>setTrip(read());
    const wake=()=>{update();setOnline(navigator.onLine);if(!document.hidden)void sync();};
    window.addEventListener(tripEvent,update);window.addEventListener('storage',update);
    window.addEventListener('online',wake);window.addEventListener('offline',wake);
    document.addEventListener('visibilitychange',wake);
    const timer=setInterval(()=>{if(!document.hidden)void sync();},15000);
    wake();
    return()=>{alive.current=false;clearInterval(timer);window.removeEventListener(tripEvent,update);
      window.removeEventListener('storage',update);window.removeEventListener('online',wake);
      window.removeEventListener('offline',wake);document.removeEventListener('visibilitychange',wake);};
  },[user,home,sync]);
  useEffect(()=>{
    if(!ready)return;
    let current=true;
    Promise.all([saveGroceries(user,home,name,items),prepareShoppingShell()]).then(()=>{
      if(current){setAvailable(true);setProblem('');}
    }).catch(()=>{if(current){setAvailable(false);setProblem('This browser could not save the list for offline use.');}});
    return()=>{current=false;};
  },[user,home,name,items,ready]);
  async function toggle(item:ReminderItem) {
    const current=read();
    if(!current)throw Error('Connect and open Groceries before shopping offline.');
    await pickItem(current,item.id,!item.done);
    void sync();
  }
  async function dismiss() {if(trip)await clearNotices(trip);}
  async function save(draft:GroceryDraft,item:ReminderItem|null,id:string,addBack:boolean) {
    const current=read();if(!current)throw Error('Connect and open Groceries before saving offline.');
    await queueGrocery(current,draft,item,id,addBack);void sync();
  }
  async function resolve(id:string,keep:boolean) {if(trip){await resolveGrocery(trip,id,keep);void sync();}}
  return {trip,items:trip?groceryItems(trip):null,online,available,syncing,problem,toggle,dismiss,sync,save,resolve,
    pending:Object.keys(trip?.picks||{}).length};
}
export function GroceryConnection({state}:{state:ReturnType<typeof useOfflineGroceries>}) {
  const [error,setError]=useState('');
  return <>
    {(error||(state.online&&state.problem))&&<p className="grocery-connection" role="alert">{error||state.problem}</p>}
    {Object.entries(state.trip?.picks||{}).filter(([,pick])=>pick.conflict).map(([id,pick])=>{
      const shared=pick.conflict!.server;
      return <div className="grocery-connection" role="status" key={id}>
        <p><b>{pick.draft?.title||'Grocery item'}</b>: {shared?'This item changed on another device. Choose what to keep.':'This item is no longer shared, or its addition could not be confirmed.'}</p>
        <p>Your saved edit: {pick.draft?.title} · {pick.draft?.category} {pick.draft&&groceryDetails(pick.draft)}{pick.done===undefined?'':pick.done?' · Picked up':' · On list'}</p>
        {shared&&<p>Shared version: {shared.title} · {shared.category} {shared.detail} · {shared.done?'Picked up':'On list'}</p>}
        <div className="grocery-conflict-actions">
          <button className="text-button" onClick={()=>void state.resolve(id,true).catch(()=>setError('Could not save your choice.'))}>{shared?'Keep my changes':'Add as new item'}</button>
          <button className="text-button" onClick={()=>void state.resolve(id,false).catch(()=>setError('Could not save your choice.'))}>{shared?'Use shared version':'Discard saved change'}</button>
        </div>
      </div>;
    })}
    {!!state.trip?.notices.length&&<div className="grocery-connection" role="status">
      {state.trip.notices.map((notice,i)=><p key={i}>{notice}</p>)}
      <button className="text-button" onClick={()=>void state.dismiss().catch(()=>setError('Could not dismiss this notice.'))}>Dismiss</button>
    </div>}
  </>;
}
