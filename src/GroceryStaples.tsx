import {useTutorialPractice} from './InteractiveTutorial';
import {useRegisteredDraft} from './draftGroup';
import {useUnsavedChanges} from './useUnsavedChanges';
import type {ReactNode} from 'react';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,Pencil,Plus,ShoppingBasket,Star,Trash2} from 'lucide-react';
import {addGroceryStaples,deleteGroceryStaple,groceryCategories,loadGroceryStaples,normalizeGroceryTitle,saveGroceryStaple,type GroceryStaple} from './groceryStaplesData';
import './grocery-staples.css';

type Grocery={id:string;title:string;category:string;done:number|boolean};
type Props={tools?:ReactNode;disabled?:boolean;openItemId?:string;householdId:string;groceries:Grocery[];itemsLoading:boolean;itemsError:string;onListChanged:()=>Promise<void>};
const errorMessage=(error:unknown)=>error instanceof Error?error.message:(error as {message?:string})?.message||'Please try again.';

export default function GroceryStaples({tools,disabled=false,openItemId,householdId,groceries,itemsLoading,itemsError,onListChanged}:Props){
 const tutorial=useTutorialPractice();
 const [open,setOpen]=useState(false),[staples,setStaples]=useState<GroceryStaple[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
 const [editor,setEditor]=useState<{item:GroceryStaple|null}|null>(null),[title,setTitle]=useState(''),[category,setCategory]=useState('Other'),[removeConfirm,setRemoveConfirm]=useState(false);
 const revealedItem=useRef<string|undefined>(undefined);
 const dirty=!!editor&&(title!==(editor.item?.title||'')||category!==(editor.item?.category||'Other'));
 const guard=useUnsavedChanges(dirty,busy,closeEditor,save);
 useRegisteredDraft({dirty,busy,save,discard:closeEditor});

 const pending=useRef(false),mounted=useRef(false),generation=useRef(0),titleInput=useRef<HTMLInputElement>(null),newButton=useRef<HTMLButtonElement>(null),editorTrigger=useRef<HTMLElement|null>(null);
 const load=useCallback(async()=>{
  const request=++generation.current;setLoading(true);
  try{const rows=await loadGroceryStaples(householdId);if(mounted.current&&request===generation.current){setStaples(rows);setLoaded(true);setLoadError('')}}
  catch(error){if(mounted.current&&request===generation.current)setLoadError(errorMessage(error))}
  finally{if(mounted.current&&request===generation.current)setLoading(false)}
 },[householdId]);
 useEffect(()=>{mounted.current=true;void load();const refresh=()=>{if(!document.hidden&&!pending.current)void load()};window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{mounted.current=false;generation.current++;window.removeEventListener('focus',refresh);clearInterval(timer)}},[load]);
 useEffect(()=>{if(editor)titleInput.current?.focus()},[editor]);
 useEffect(()=>{if(openItemId)setOpen(true)},[openItemId]);
 useEffect(()=>{if(!openItemId||revealedItem.current===openItemId||!open||loading)return;const frame=requestAnimationFrame(()=>{const node=document.getElementById('staple-'+openItemId);if(node){revealedItem.current=openItemId;node.focus({preventScroll:true});node.scrollIntoView({block:'center',behavior:'smooth'})}});return()=>cancelAnimationFrame(frame)},[openItemId,open,loading]);
 const openNames=useMemo(()=>new Set(groceries.filter(item=>!item.done).map(item=>normalizeGroceryTitle(item.title))),[groceries]);
 useEffect(()=>{setSelected(old=>{const next=old.filter(id=>staples.some(item=>item.id===id&&!openNames.has(normalizeGroceryTitle(item.title))));return next.length===old.length?old:next})},[staples,openNames]);
 const eligible=staples.filter(item=>!openNames.has(normalizeGroceryTitle(item.title)));
 const selectedAvailable=selected.filter(id=>eligible.some(item=>item.id===id));
 const suggestions=useMemo(()=>{
  const saved=new Set(staples.map(item=>normalizeGroceryTitle(item.title))),unique=new Map<string,Grocery>();
  for(const item of groceries){const key=normalizeGroceryTitle(item.title);if(key&&!saved.has(key)&&!unique.has(key))unique.set(key,item)}
  return [...unique.values()].sort((a,b)=>a.title.localeCompare(b.title));
 },[staples,groceries]);
 const canUseList=!itemsLoading&&!itemsError,canUseStaples=loaded&&!loadError;
 function beginEdit(item:GroceryStaple|null,trigger:HTMLElement){guard.requestClose(()=>{editorTrigger.current=trigger;setEditor({item});setTitle(item?.title||'');setCategory(item?.category||'Other');setRemoveConfirm(false);setActionError('');setNotice('')})}
 function closeEditor(){setEditor(null);setRemoveConfirm(false);setActionError('');requestAnimationFrame(()=>{const target=editorTrigger.current;((target?.isConnected?target:null)||newButton.current)?.focus()})}
 async function perform(operation:()=>Promise<void>){
  if(pending.current)return false;pending.current=true;setBusy(true);setActionError('');setNotice('');
  try{await operation();return true}catch(error){if(mounted.current)setActionError(errorMessage(error));return false}
  finally{pending.current=false;if(mounted.current)setBusy(false)}
 }
 async function save(){if(tutorial.intercept('staple'))return false;if(!title.trim()){setActionError('Enter an item name.');titleInput.current?.focus();return false}return perform(async()=>{
  const item=await saveGroceryStaple(householdId,{title,category},editor?.item?.id);
  if(!mounted.current)return;setStaples(old=>[...old.filter(row=>row.id!==item.id),item].sort((a,b)=>a.title.localeCompare(b.title)));setNotice(editor?.item?'Staple updated.':'Saved to your household staples.');closeEditor();void load();
 })}
 async function remove(){if(!editor?.item)return;const item=editor.item;await perform(async()=>{
  await deleteGroceryStaple(householdId,item.id);if(!mounted.current)return;setStaples(old=>old.filter(row=>row.id!==item.id));setSelected(old=>old.filter(id=>id!==item.id));setNotice('Removed from staples. Your shopping list is unchanged.');closeEditor();void load();
 })}
 async function add(){const ids=selectedAvailable.slice(0,100);if(!ids.length||!canUseList||!canUseStaples)return;await perform(async()=>{
  const result=await addGroceryStaples(householdId,ids);if(!mounted.current)return;setSelected([]);setNotice(result.added?`${result.added===1?'1 item':result.added+' items'} added to your shopping list.${result.skipped?' Already-listed items were skipped.':''}`:'These items are already on your shopping list.');await onListChanged();
 })}
 function toggle(id:string){setSelected(old=>old.includes(id)?old.filter(value=>value!==id):old.length<100?[...old,id]:old)}
 return <section className={'grocery-staples'+(open?' is-open':'')} aria-label="Grocery staples">{guard.confirmation}
  <div className="staples-header"><button type="button" disabled={disabled} className="staples-toggle" aria-expanded={open} aria-controls="staples-content" onClick={()=>guard.requestClose(()=>{closeEditor();setOpen(value=>!value)})}><span className="staples-symbol"><Star size={19}/></span><span><b>Staples</b><small>{loaded&&!loadError?staples.length:''}</small></span><ChevronDown size={18}/></button>{tools}</div>
  {open&&<div className="staples-content" id="staples-content" inert={disabled}>
   <p className="staples-intro">Keep the things you buy often here. Choose what you need, then add it to the shared shopping list.</p>
   {loadError&&<div className="staples-error" role="alert"><p>We couldn’t load your staples. {loadError}</p><button type="button" className="text-button" disabled={loading||busy} onClick={()=>void load()}>Try again</button></div>}
   {!loaded&&loading&&<p className="quiet" role="status">Loading your staples…</p>}
   {notice&&<p className="staples-notice" role="status"><Check size={16}/><span>{notice}</span></p>}
   {actionError&&<p className="staples-error" role="alert">{actionError}</p>}
   {canUseStaples&&!editor&&<>
    <div className="staples-tools"><span>{staples.length?'Choose for this shop':'Your usuals, all together.'}</span><button type="button" className="text-button" ref={newButton} disabled={busy} onClick={event=>beginEdit(null,event.currentTarget)}><Plus size={16}/>New staple</button></div>
    {!staples.length&&<div className="staples-empty"><ShoppingBasket size={24}/><p>Milk, bread, coffee… save your first staple and it’ll be ready whenever you need it.</p></div>}
    {!!staples.length&&<>
     {!canUseList&&<p className="staples-list-help" role="status">{itemsError?'Your shopping list could not be refreshed. Try the list’s refresh above before adding staples.':'Checking your shopping list…'}</p>}
     <div className="staples-rows">{staples.map(item=>{const onList=canUseList&&openNames.has(normalizeGroceryTitle(item.title));return <div id={'staple-'+item.id} tabIndex={-1} className={'staple-row'+(onList?' on-list':'')+(openItemId===item.id?' activity-destination':'')} key={item.id}><label className="staple-choice"><input type="checkbox" checked={onList||selectedAvailable.includes(item.id)} disabled={busy||onList||!canUseList||(!selectedAvailable.includes(item.id)&&selectedAvailable.length>=100)} onChange={()=>toggle(item.id)} aria-label={item.title+', add to shopping list'}/><span><b>{item.title}</b><small>{item.category}</small></span></label>{onList&&<span className="staple-on-list"><Check size={12}/>On list</span>}<button type="button" className="icon-button staple-edit" disabled={busy} aria-label={'Edit staple '+item.title} onClick={event=>beginEdit(item,event.currentTarget)}><Pencil size={16}/></button></div>})}</div>
     <div className="staples-add-actions"><button type="button" className="text-button" disabled={busy||!canUseList||!eligible.length} onClick={()=>setSelected(selectedAvailable.length?[]:eligible.slice(0,100).map(item=>item.id))}>{selectedAvailable.length?'Clear selection':'Select available'}</button><button type="button" className="button primary" disabled={busy||!canUseList||!selectedAvailable.length} onClick={()=>void add()}><Plus size={16}/>{busy?'Adding…':selectedAvailable.length?`Add ${selectedAvailable.length} to list`:'Add to list'}</button></div>
     {selectedAvailable.length>=100&&<p className="staples-list-help">Add up to 100 staples at a time.</p>}
     <p className="staples-footnote">Picking an item up won’t remove it from your staples.</p>
    </>}
   </>}
   {editor&&<form className="staple-editor" onSubmit={event=>{event.preventDefault();void save()}} aria-labelledby="staple-editor-title">
    <h3 id="staple-editor-title">{editor.item?'Edit staple':'Save a staple'}</h3>
    {!editor.item&&suggestions.length>0&&canUseList&&<label>Use an item from your list<select defaultValue="" disabled={busy} onChange={event=>{const item=suggestions.find(row=>row.id===event.target.value);if(item){setTitle(item.title);setCategory(item.category);titleInput.current?.focus()}}}><option value="">Choose an item (optional)</option>{suggestions.map(item=><option value={item.id} key={item.id}>{item.title}{item.done?' · picked up':''}</option>)}</select></label>}
    <label>Item name<input ref={titleInput} required maxLength={160} value={title} disabled={busy} onChange={event=>setTitle(event.target.value)} placeholder="e.g. Milk, 2 litres" autoComplete="off"/></label>
    <label>Category<select data-tour="staple-category" value={category} disabled={busy} onChange={event=>setCategory(event.target.value)}>{groceryCategories.map(value=><option key={value}>{value}</option>)}</select></label>
    <p className="staples-list-help">Shared with your household. Saving a staple doesn’t add it to today’s shopping list.</p>
    <div className="staple-editor-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>guard.requestClose()}>Cancel</button><button type="submit" className="button primary" disabled={busy||!normalizeGroceryTitle(title)}>{busy?'Saving…':editor.item?'Save changes':'Save staple'}</button></div>
    {editor.item&&<div className="staple-remove">{removeConfirm?<><p>Remove “{editor.item.title}” from staples? Items already on your shopping list will stay there.</p><div><button type="button" className="text-button" disabled={busy} onClick={()=>setRemoveConfirm(false)}>Keep staple</button><button type="button" className="text-button" disabled={busy} onClick={()=>void remove()}><Trash2 size={15}/>Remove staple</button></div></>:<button type="button" className="text-button" disabled={busy} onClick={()=>setRemoveConfirm(true)}><Trash2 size={15}/>Remove from staples</button>}</div>}
   </form>}
  </div>}
 </section>;
}
