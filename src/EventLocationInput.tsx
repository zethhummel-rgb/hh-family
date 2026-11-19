import {MapPin} from 'lucide-react';
import {useEffect,useId,useState} from 'react';
import {isCurrentAuthClient,supabase} from './supabase';

type Venue={name:string;address:string};
type Suggestion={kind:'address';address:string}|({kind:'venue'}&Venue);
type LookupState={query:string;status:'ok'|'paused'|'rate_limited'|'unavailable';suggestions:Suggestion[]};
type Props={formId:string;value:string;disabled:boolean;suggest:boolean;onChange:(value:string)=>void};
function venueResult(value:unknown):value is Venue{
 if(!value||typeof value!=='object')return false;
 const venue=value as Record<string,unknown>;
 return typeof venue.name==='string'&&venue.name.length>0&&venue.name.length<=300&&
  typeof venue.address==='string'&&venue.address.length>0&&venue.address.length<=300;
}

export default function EventLocationInput({formId,value,disabled,suggest,onChange}:Props){
 const listId=useId();
 const [focused,setFocused]=useState(false),[edited,setEdited]=useState('');
 const [result,setResult]=useState<LookupState|null>(null),[active,setActive]=useState(-1);
 const [selection,setSelection]=useState<{query:string;venue:Venue}|null>(null);
 const [paused,setPaused]=useState(false);
 const query=value.trim();
 const canSuggest=suggest&&!disabled&&focused&&query===edited&&query.length>=3&&/\p{L}/u.test(query);
 const suggestions=canSuggest&&result?.query===query?result.suggestions:[];
 const expanded=suggestions.length>0;

 useEffect(()=>{
  if(!canSuggest||paused)return;
  const abort=new AbortController();
  let current=true;
  const timer=setTimeout(async()=>{
   const client=supabase;
   try{
    const {data,error}=await client.functions.invoke('event-addresses',{body:{query},signal:abort.signal});
    if(!current||!isCurrentAuthClient(client))return;
    if(error||!data||!['ok','paused','rate_limited','unavailable'].includes(data.status)){
     setResult({query,status:'unavailable',suggestions:[]});return;
    }
    if(data.status==='paused')setPaused(true);
    const suggestions:Suggestion[]=Array.isArray(data.venues)?
     data.venues.filter(venueResult).slice(0,5).map((venue:Venue)=>({kind:'venue',name:venue.name,address:venue.address})):
     Array.isArray(data.suggestions)?data.suggestions.filter((address:unknown):address is string=>typeof address==='string'&&address.length<=300)
      .slice(0,5).map((address:string)=>({kind:'address',address})):[];
    setResult({query,status:data.status,suggestions});
   }catch{
    if(current)setResult({query,status:'unavailable',suggestions:[]});
   }
  },400);
  return()=>{current=false;clearTimeout(timer);abort.abort()};
 },[canSuggest,paused,query]);

 function closeSuggestions(){
  setResult(null);
  setEdited('');
  setActive(-1);
 }
 function choose(suggestion:Suggestion){
  closeSuggestions();
  if(suggestion.kind==='venue'){
   setSelection({query,venue:suggestion});
   onChange(query);
  }else{
   setSelection(null);
   onChange(suggestion.address);
  }
 }

 return <div className="event-location">
  <label className="event-location-input">
   <MapPin size={17} aria-hidden="true"/>
   <input form={formId} aria-label="Location (optional)" disabled={disabled} maxLength={300} value={value}
    autoComplete="off" placeholder="Add location" role={suggest?'combobox':undefined} aria-autocomplete={suggest?'list':undefined}
    aria-expanded={suggest?expanded:undefined} aria-controls={expanded?listId:undefined}
    aria-activedescendant={expanded&&active>=0?listId+'-'+active:undefined}
    onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);closeSuggestions()}}
    onChange={event=>{onChange(event.target.value);setEdited(event.target.value.trim());setResult(null);setActive(-1);setSelection(null)}}
    onKeyDown={event=>{
     if(!expanded||event.nativeEvent.isComposing)return;
     if(event.key==='Escape'){
      event.preventDefault();event.stopPropagation();closeSuggestions();
     }else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      setActive(index=>event.key==='ArrowDown'?(index+1)%suggestions.length:(index<=0?suggestions.length-1:index-1));
     }else if(event.key==='Enter'){
      event.preventDefault();if(active>=0)choose(suggestions[active]);
     }
    }}/>
  </label>
  {expanded&&<div className="event-address-options">
   <ul id={listId} role="listbox" aria-label="Suggested locations">
    {suggestions.map((suggestion,index)=><li key={suggestion.kind==='venue'?suggestion.name+' '+suggestion.address:suggestion.address}
     id={listId+'-'+index} role="option" aria-selected={index===active}
     onPointerDown={event=>event.preventDefault()} onClick={()=>choose(suggestion)}>
     {suggestion.kind==='venue'?<span className="event-venue-label"><strong>{suggestion.name}</strong><span>{suggestion.address}</span></span>:suggestion.address}
    </li>)}
   </ul>
   <p translate="no">Google Maps</p>
  </div>}
  {selection?.query===query&&<div className="event-address-options event-venue-preview" role="status">
   <span className="event-venue-label"><strong>{selection.venue.name}</strong><span>{selection.venue.address}</span></span>
   <p translate="no">Google Maps</p>
  </div>}
  {paused&&focused&&<p className="field-help event-address-help" role="status">Address suggestions are paused until next month. You can type the location.</p>}
  {!paused&&canSuggest&&result?.query===query&&result.status==='rate_limited'&&<p className="field-help event-address-help" role="status">Try suggestions again in a moment, or type the location.</p>}
 </div>;
}
