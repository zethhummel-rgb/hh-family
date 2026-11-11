import {publicConfig} from './config';
import {supabase} from './supabase';
import type {GuestEvent,Reply} from '../supabase/functions/event-guests/event';

export type Guest = {id:string;email:string;reply:Reply|null;delivery:'sending'|'sent'|'unknown'|'preview'};
export type GuestInvitation = {event:GuestEvent;sender:string;message:string;reply:Reply|null};
export type GuestDelivery = {delivery:Guest['delivery'];preview?:Record<Reply,string>};
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
