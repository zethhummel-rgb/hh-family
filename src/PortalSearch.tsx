import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,ChevronDown,Search,X} from 'lucide-react';
import {loadPortalIndex,localGroceryResults,portalPages,searchPages,searchPortal,type PortalResult,type SearchPage} from './portalSearchData';
import type {ReminderItem} from './taskReminders';
import './portal-search.css';

export default function PortalSearch({householdId,groceries,online,opener,onClose,onOpen}:{
  householdId:string;groceries:ReminderItem[];online:boolean;opener:HTMLElement|null;
  onClose:()=>void;onOpen:(result:PortalResult)=>Promise<void>;
}) {
  const [query,setQuery]=useState(''),[rows,setRows]=useState<PortalResult[]>([]),[unavailable,setUnavailable]=useState<SearchPage[]>([]);
  const [loading,setLoading]=useState(online),[error,setError]=useState(''),[opening,setOpening]=useState(false),[revision,setRevision]=useState(0);
  const modal=useRef<HTMLElement>(null),close=useRef(onClose),busy=useRef(false),alive=useRef(true);close.current=onClose;
  useEffect(()=>{
    const viewport=window.visualViewport;
    const fit=()=>{if(modal.current){modal.current.style.maxHeight=Math.max(140,(viewport?.height||window.innerHeight)-28)+'px';}};
    fit();viewport?.addEventListener('resize',fit);window.addEventListener('resize',fit);
    return()=>{viewport?.removeEventListener('resize',fit);window.removeEventListener('resize',fit);};
  },[]);
  useEffect(()=>{
    alive.current=true;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';modal.current?.querySelector('input')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busy.current){event.preventDefault();close.current();}
      if(event.key==='Tab'){
        const fields=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,summary')||[]).filter(node=>node.getClientRects().length);
        const first=fields[0],last=fields.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);return()=>{alive.current=false;document.body.style.overflow=overflow;document.removeEventListener('keydown',key);if(opener?.isConnected&&!opener.closest('[inert]'))opener.focus();};
  },[opener]);
  useEffect(()=>{
    setRows([]);setUnavailable([]);setError('');setLoading(online);
    if(!online)return;
    const controller=new AbortController();let current=true;
    const timeout=setTimeout(()=>controller.abort(),20000);
    loadPortalIndex(householdId,controller.signal).then(value=>{if(current){setRows(value.rows);setUnavailable(value.unavailable);}})
      .catch(()=>{if(current)setError('Search could not finish loading. Please retry.');})
      .finally(()=>{clearTimeout(timeout);if(current)setLoading(false);});
    return()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[householdId,online,revision]);
  const all=useMemo(()=>{
    const local=localGroceryResults(groceries),ids=new Set(local.map(row=>row.id));
    return [...(online?rows.filter(row=>row.kind!=='grocery'||!ids.has(row.id)):[]),...local,...(online?portalPages():[])];
  },[rows,groceries,online]);
  const matches=searchPortal(all,query);
  async function open(result:PortalResult){
    if(busy.current)return;busy.current=true;setOpening(true);setError('');
    try{await onOpen(result);}catch(error){if(alive.current)setError(error instanceof Error?error.message:'Could not open this result.');}
    finally{busy.current=false;if(alive.current)setOpening(false);}
  }
  return <div className="portal-search-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!opening)onClose();}}>
    <section className="portal-search-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-search-title" ref={modal}>
      <div className="portal-search-heading"><h2 id="portal-search-title">Search HH</h2><button type="button" data-tour="search-close" aria-label="Close portal search" disabled={opening} onClick={onClose}><X size={20}/></button></div>
      <label className="portal-search-input"><Search size={19}/><input type="search" aria-label="Search all HH" placeholder="What are you looking for?" maxLength={160} value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <div className="portal-search-results" aria-busy={loading||opening}>
        {!online&&<p className="portal-search-help" role="status">Searching your saved grocery list. Reopen search once connected to search all pages.</p>}
        {loading&&<p className="portal-search-help" role="status">Loading your household search…</p>}
        {(error||unavailable.length>0)&&<div className="portal-search-help" role="alert"><p>{error||'Some results are unavailable: '+unavailable.map(page=>searchPages[page]).join(', ')+'.'}</p>{online&&<button className="text-button" disabled={loading||opening} onClick={()=>setRevision(value=>value+1)}>Retry search</button>}</div>}
        {!query.trim()?<p className="portal-search-help">Search items, plans, notes, meals, or people. Results are grouped by page.</p>:<>
          <p className="portal-search-count" role="status">{matches.length} {matches.length===1?'match':'matches'}{loading?' so far':''} · Choose a page below</p>
          {!matches.length&&!loading&&!error&&<p className="portal-search-help">No matches. Try another word.</p>}
          {(Object.keys(searchPages) as SearchPage[]).map(page=>{const items=matches.filter(row=>row.page===page);return items.length?<SearchGroup key={page} page={page} items={items} disabled={opening} onOpen={open}/>:null;})}
        </>}
      </div>
    </section>
  </div>;
}
function SearchGroup({page,items,disabled,onOpen}:{page:SearchPage;items:PortalResult[];disabled:boolean;onOpen:(item:PortalResult)=>Promise<void>}) {
  const [limit,setLimit]=useState(30);
  return <details className="portal-search-group"><summary><span>{searchPages[page]}</span><b>{items.length}</b><ChevronDown size={18}/></summary>
    {items.slice(0,limit).map(item=><button className="portal-search-result" type="button" key={item.kind+':'+item.id} disabled={disabled} onClick={()=>void onOpen(item)}><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowUpRight size={17}/></button>)}
    {items.length>limit&&<button type="button" className="text-button portal-search-more" onClick={()=>setLimit(value=>value+30)}>Show more results</button>}
  </details>;
}
