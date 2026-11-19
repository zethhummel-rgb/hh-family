import {useEffect,useRef,useState} from 'react';
import {isCurrentAuthClient,supabase} from './supabase';

export type Venue={placeId:string;name:string;address:string};

export function venueResult(value:unknown):value is Venue{
 if(!value||typeof value!=='object')return false;
 const venue=value as Record<string,unknown>;
 return typeof venue.placeId==='string'&&/^[A-Za-z0-9_-]{1,300}$/.test(venue.placeId)&&
  typeof venue.name==='string'&&venue.name.length>0&&venue.name.length<=300&&
  typeof venue.address==='string'&&venue.address.length>0&&venue.address.length<=300;
}

// Coalesce concurrent views of the same place. Google display data stays in the
// mounted view only. The event stores the Place ID and the user's own text.
const pendingByClient=new WeakMap<typeof supabase,Map<string,Promise<Venue|null>>>();
export function useSavedVenue(placeId:string|null,enabled=true){
 const [resolved,setResolved]=useState<Venue|null>(null);
 useEffect(()=>{
  if(!placeId||!enabled)return;
  let active=true;
  const client=supabase;
  let pending=pendingByClient.get(client);
  if(!pending){pending=new Map();pendingByClient.set(client,pending)}
  let request=pending.get(placeId);
  if(!request){
   const requests=pending;
   request=client.functions.invoke('event-addresses',{body:{placeId}}).then(({data,error})=>{
    const venue=data?.venues?.[0];
    return !error&&venueResult(venue)&&venue.placeId===placeId?venue:null;
   }).catch(()=>null).finally(()=>requests.delete(placeId));
   pending.set(placeId,request);
  }
  request.then(venue=>{if(active&&isCurrentAuthClient(client))setResolved(venue)});
  return()=>{active=false};
 },[placeId,enabled]);
 return resolved?.placeId===placeId?resolved:null;
}

export function VenueAttribution(){return <span className="venue-attribution" translate="no">Google Maps</span>}

export function EventLocationLabel({placeId,text,detailed=false,className}:{placeId?:string|null;text:string;detailed?:boolean;className?:string}){
 const anchor=useRef<HTMLSpanElement>(null);
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!placeId||detailed)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return}
  const target=anchor.current;
  if(!target)return;
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}
  });
  observer.observe(target);
  return()=>observer.disconnect();
 },[placeId,detailed]);
 const venue=useSavedVenue(placeId??null,detailed||visible);
 return <span ref={anchor} className={className}>
  {venue?<span className="saved-venue">{venue.name}{detailed&&<span>{venue.address}</span>}<VenueAttribution/></span>:text}
  {detailed&&placeId&&<a className="venue-map-link" href={'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:text||'Location',query_place_id:placeId})} target="_blank" rel="noreferrer">View on Google Maps</a>}
 </span>;
}
