import {useEffect,useRef,useState} from 'react';
import {SlidersHorizontal,X} from 'lucide-react';
import type {GroceryGrouping} from './groceryData';
import './grocery-tools.css';

export default function GroceryTools({grouping,onGrouping,store,onStore,stores}:{
  grouping:GroceryGrouping;onGrouping:(value:GroceryGrouping)=>void;
  store:string;onStore:(value:string)=>void;stores:string[];
}) {
  const [panel,setPanel]=useState<'filters'|null>(null);
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null);
  function close(){setPanel(null);trigger.current?.focus();}
  useEffect(()=>{
    if(!panel)return;
    // Leave focus on the trigger; focusing a select here opens iOS's picker.
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setPanel(null);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setPanel(null);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[panel]);
  function toggle(value:'filters',button:HTMLButtonElement){trigger.current=button;setPanel(old=>old===value?null:value);}
  const active=store!=='all'||grouping!=='department';
  return <div className="grocery-tools" ref={root} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setPanel(null);}}>
    <button type="button" className={'grocery-tool-button'+(active?' is-active':'')} aria-expanded={panel==='filters'} aria-controls="grocery-filter-panel" onClick={event=>toggle('filters',event.currentTarget)}><SlidersHorizontal size={18}/>Filters{active&&<span className="grocery-tool-dot"/>}</button>
    {panel==='filters'&&<div className="grocery-tool-panel" id="grocery-filter-panel" role="region" aria-label="Grocery filters">
      <div className="grocery-tool-heading"><b>Filters</b><button type="button" aria-label="Close filters" onClick={close}><X size={18}/></button></div>
      <label>Group by<select aria-label="Group groceries by" value={grouping} onChange={event=>onGrouping(event.target.value as GroceryGrouping)}><option value="department">Category</option><option value="store">Store</option></select></label>
      <label>Store<select aria-label="Filter groceries by store" value={store} onChange={event=>onStore(event.target.value)}><option value="all">All stores</option><option value="none">No store set</option>{stores.map(value=><option key={value.toLowerCase()} value={'store:'+value.toLowerCase()}>{value}</option>)}</select></label>
      {active&&<button type="button" className="text-button" onClick={()=>{onGrouping('department');onStore('all');}}>Reset filters</button>}
    </div>}
  </div>;
}
