import {publicConfig} from './config';
import {supabase} from './supabase';
import type {GuestEvent,Reply} from '../supabase/functions/event-guests/event';

export type Guest = {id:string;email:string;reply:Reply|null;delivery:'sending'|'sent'|'unknown'|'preview'};
export type GuestInvitation = {event:GuestEvent;sender:string;message:string;reply:Reply|null};
export type GuestDelivery = {delivery:Guest['delivery'];preview?:Record<Reply,string>};
export type GuestCalendarStatus = {state:'view';eventId:string;date:string} |
 {state:'add'|'sign-in'|'wrong-account'|'no-household'|'unavailable'};
export const replyStatus = {yes:'Yes',maybe:'Maybe',no:'No'};
const endpoint=publicConfig.url+'/functions/v1/event-guests';

async function request<T>(body:object,bearer?:string):Promise<T>{
 const headers:Record<string,string>={apikey:publicConfig.key,'Content-Type':'application/json'};
 if(bearer)headers.Authorization='Bearer '+bearer;
 const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer'});
 const data=await response.json().catch(()=>null);
 if(!response.ok||data===null)throw Error(data?.error||'Could not connect to HH. Try again.');
 return data;
}

export async function hostGuestRequest<T>(action:string,eventId:string,occurrence:string,fields:object={}){
 const {data}=await supabase.auth.getSession();
 if(!data.session)throw Error('Sign in to manage event invitations.');
 return request<T>({action,eventId,occurrence,...fields},data.session.access_token);
}

export function publicGuestRequest(action:'preview'|'respond',token:string,reply?:Reply){
 return request<GuestInvitation>({action,token,reply});
}

export async function guestHHCalendar(token:string,add=false):Promise<GuestCalendarStatus>{
 const {data}=await supabase.auth.getSession();
 if(!data.session)return {state:'sign-in'};
 return request<GuestCalendarStatus>({action:add?'add-hh':'hh-status',token},data.session.access_token);
}

export function guestSignInLink(token:string,reply:Reply|null){
 const url=new URL('.',location.href);
 url.searchParams.set('event-sign-in','1');
 url.hash=new URLSearchParams({'event-return':token,...(reply?{reply}:{})}).toString();
 return url.href;
}

export function returnToGuestInvitation(){
 const current=new URL(location.href);
 if(!current.searchParams.has('event-sign-in'))return;
 const fragment=new URLSearchParams(current.hash.slice(1)),token=fragment.get('event-return');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return;
 fragment.delete('event-return');fragment.set('event-invite',token);
 const destination=new URL('.',current);
 destination.hash=fragment.toString();
 location.replace(destination.href);
}
