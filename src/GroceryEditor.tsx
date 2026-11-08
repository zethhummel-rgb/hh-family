import InputCardHandle,{submitInputCard} from './InputCardHandle';
import {useUnsavedChanges,useModalScrollLock} from './useUnsavedChanges';
import QuantityFields from './QuantityFields';
import ChoiceDialog from './ChoiceDialog';
import {matchingGroceries,groceryNameKey} from './groceryDuplicates';
import {useEffect,useRef,useState} from 'react';
import {Check,X} from 'lucide-react';
import {groceryCategories} from './groceryStaplesData';
import {saveGrocery,validateGrocery,groceryDetails,type GroceryDraft} from './groceryData';
import type {ReminderItem} from './taskReminders';
import './grocery-details.css';

export default function GroceryEditor({householdId,item,stores,groceries,opener,onClose,onSaved,onSave}:{groceries:ReminderItem[];householdId:string;item:ReminderItem|null;stores:string[];opener:HTMLElement|null;onClose:()=>void;onSaved:()=>Promise<void>;onSave?:(draft:GroceryDraft,item:ReminderItem|null,id:string,addBack:boolean)=>Promise<void>}){
 const [title,setTitle]=useState(item?.title||''),[category,setCategory]=useState(item?.category||'Produce'),[quantity,setQuantity]=useState(item?.grocery_quantity==null?'':String(item.grocery_quantity)),[unit,setUnit]=useState(item?.grocery_unit||''),[store,setStore]=useState(item?.grocery_store||''),[addBack,setAddBack]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [duplicates,setDuplicates]=useState<ReminderItem[]|null>(null);
 const snapshot=JSON.stringify([title,category,quantity,unit,store,addBack]);const baseline=useRef(snapshot);const guard=useUnsavedChanges(snapshot!==baseline.current,busy,onClose);useModalScrollLock();
 const modal=useRef<HTMLElement>(null),pending=useRef(false),requestId=useRef(crypto.randomUUID()),close=useRef(onClose);close.current=guard.requestClose;
 useEffect(()=>{
  modal.current?.querySelector('input')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending.current)close.current();if(event.key==='Tab'){const fields=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')||[]);if(event.shiftKey&&document.activeElement===fields[0]){event.preventDefault();fields.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===fields.at(-1)){event.preventDefault();fields[0]?.focus()}}};
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(opener?.isConnected)opener.focus({preventScroll:true})};
 },[opener]);
 async function save(allowDuplicate=false){
  if(pending.current)return;setError('');
  const draft={title,category,grocery_quantity:quantity===''?null:Number(quantity),grocery_unit:quantity===''?null:unit||null,grocery_store:store||null};
  try{validateGrocery(draft)}catch(e){setError((e as Error).message);return}
  const adding=!item||addBack||groceryNameKey(item.title)!==groceryNameKey(title);
  const matches=adding?matchingGroceries(groceries,title,[item?.id||'',requestId.current]):[];
  if(!allowDuplicate&&matches.length){setDuplicates(matches);return}
  setDuplicates(null);pending.current=true;setBusy(true);
  try{if(onSave)await onSave(draft,item,requestId.current,addBack);else await saveGrocery(householdId,draft,item,requestId.current,addBack);await onSaved();onClose()}catch(error){setError((error as Error).message||'Could not save this grocery item.')}finally{pending.current=false;setBusy(false)}
 }
 function submit(event:React.FormEvent){event.preventDefault();void save()}


 return <div className="modal-backdrop quick-form-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!busy)guard.requestClose()}}><section className="modal grocery-editor quick-form" role="dialog" aria-modal="true" aria-labelledby="grocery-editor-title" ref={modal}>
  <InputCardHandle modal={modal} dirty={snapshot!==baseline.current} busy={busy} onClose={onClose} onSave={()=>submitInputCard(modal.current)}/><header className="quick-form-heading"><button type="button" className="modal-close icon-button" aria-label="Close grocery editor" disabled={busy} onClick={()=>guard.requestClose()}><X/></button><h2 id="grocery-editor-title">{item?'Edit grocery item':'Add grocery item'}</h2></header>
  <form onSubmit={submit}><fieldset disabled={busy} className="grocery-fields">
   <label>Item<input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} placeholder="e.g. Kidney beans"/></label>
   <QuantityFields quantity={quantity} unit={unit} onQuantity={value=>{setQuantity(value);if(!value)setUnit('')}} onUnit={setUnit}/>

   <div className="quick-form-pair"><label>Category<select aria-label="Category" value={category} onChange={event=>setCategory(event.target.value)}>{groceryCategories.map(value=><option key={value}>{value}</option>)}</select></label><label>Store (optional)<input value={store} maxLength={80} onChange={event=>setStore(event.target.value)} placeholder="e.g. Costco" list="grocery-store-options"/></label></div><datalist id="grocery-store-options">{stores.map(value=><option key={value} value={value}/>)}</datalist>
   {item?.done?<label className="grocery-reuse"><input type="checkbox" checked={addBack} onChange={event=>setAddBack(event.target.checked)}/>Add back to the shopping list</label>:<p className="field-help">Quantity, unit and store are optional.</p>}
   {error&&<p className="error" role="alert">{error}</p>}<div className="quick-form-footer"><button className="button primary wide" disabled={busy||!title.trim()}>{busy?'Saving…':item?'Save changes':'Add item'}<Check size={17}/></button></div>
  </fieldset></form>
 {guard.confirmation}{duplicates&&<ChoiceDialog title="Already on your grocery list" onCancel={()=>setDuplicates(null)} actions={[{label:item?'Save anyway':'Keep both',primary:true,run:()=>void save(true)},{label:item?'Discard this change':'Discard new item',run:onClose},{label:'Back to editing',run:()=>setDuplicates(null)}]}><p>{title.trim()} is already on your list. Keep another entry or discard this {item?'change':'new item'}?</p><ul>{duplicates.map(existing=><li key={existing.id}>{existing.title}{groceryDetails(existing)?' — '+groceryDetails(existing):''}</li>)}</ul><p>Your existing items will stay as they are.</p></ChoiceDialog>}</section></div>;
}
