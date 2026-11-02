import QuantityFields from './QuantityFields';
import {useEffect,useRef,useState} from 'react';
import {Check,ShoppingCart,X} from 'lucide-react';
import {groceryCategories} from './groceryStaplesData';
import {saveGrocery} from './groceryData';
import type {ReminderItem} from './taskReminders';
import './grocery-details.css';

export default function GroceryEditor({householdId,item,stores,opener,onClose,onSaved}:{householdId:string;item:ReminderItem|null;stores:string[];opener:HTMLElement|null;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [title,setTitle]=useState(item?.title||''),[category,setCategory]=useState(item?.category||'Produce'),[quantity,setQuantity]=useState(item?.grocery_quantity==null?'':String(item.grocery_quantity)),[unit,setUnit]=useState(item?.grocery_unit||''),[store,setStore]=useState(item?.grocery_store||''),[addBack,setAddBack]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const modal=useRef<HTMLElement>(null),pending=useRef(false),requestId=useRef(crypto.randomUUID()),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  modal.current?.querySelector('input')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending.current)close.current();if(event.key==='Tab'){const fields=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')||[]);if(event.shiftKey&&document.activeElement===fields[0]){event.preventDefault();fields.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===fields.at(-1)){event.preventDefault();fields[0]?.focus()}}};
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(opener?.isConnected)opener.focus()};
 },[opener]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{await saveGrocery(householdId,{title,category,grocery_quantity:quantity===''?null:Number(quantity),grocery_unit:quantity===''?null:unit||null,grocery_store:store||null},item,requestId.current,addBack);await onSaved();onClose()}catch(error){setError((error as Error).message||'Could not save this grocery item.')}finally{pending.current=false;setBusy(false)}
 }

 return <div className="modal-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><section className="modal grocery-editor" role="dialog" aria-modal="true" aria-labelledby="grocery-editor-title" ref={modal}>
  <button type="button" className="modal-close icon-button" aria-label="Close grocery editor" disabled={busy} onClick={onClose}><X/></button><span className="round-icon sage"><ShoppingCart/></span><h2 id="grocery-editor-title">{item?'Edit grocery item.':'What do we need?'}</h2><p className="modal-intro">Shared with your household.</p>
  <form onSubmit={submit}><fieldset disabled={busy} className="grocery-fields">
   <label>Item<input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} placeholder="e.g. Kidney beans"/></label>
   <label>Category<select aria-label="Category" value={category} onChange={event=>setCategory(event.target.value)}>{groceryCategories.map(value=><option key={value}>{value}</option>)}</select></label>
   <QuantityFields quantity={quantity} unit={unit} onQuantity={value=>{setQuantity(value);if(!value)setUnit('')}} onUnit={setUnit}/>

   <label>Store (optional)<input value={store} maxLength={80} onChange={event=>setStore(event.target.value)} placeholder="e.g. Costco" list="grocery-store-options"/></label><datalist id="grocery-store-options">{stores.map(value=><option key={value} value={value}/>)}</datalist>
   {item?.done?<label className="grocery-reuse"><input type="checkbox" checked={addBack} onChange={event=>setAddBack(event.target.checked)}/>Add back to the shopping list</label>:<p className="field-help">Leave quantity and store empty whenever you don’t need them.</p>}
   {error&&<p className="error" role="alert">{error}</p>}<button className="button primary wide" disabled={busy||!title.trim()}>{busy?'Saving…':item?'Save changes':'Add item'}<Check size={17}/></button>
  </fieldset></form>
 </section></div>;
}
