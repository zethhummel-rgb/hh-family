import {supabase} from './supabase';
export const pushSupported=()=>typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
export const needsHomeScreen=()=>(/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)&&!matchMedia('(display-mode: standalone)').matches&&!(navigator as Navigator&{standalone?:boolean}).standalone;
export async function pushRequest(action:string,householdId:string,payload:Record<string,unknown>={}){
 const initial=await supabase.auth.getSession();if(!initial.data.session)throw Error('Sign in again to manage reminders.');
 const userId=initial.data.session.user.id;
 const invoke=(token:string)=>supabase.functions.invoke('event-reminders',{body:{action,householdId,...payload},headers:{Authorization:'Bearer '+token}});
 let response=await invoke(initial.data.session.access_token);
 if(response.error?.context?.status===401){const current=await supabase.auth.getSession();if(current.data.session?.user.id!==userId)throw Error('Sign in again to manage reminders.');const fresh=await supabase.auth.refreshSession();if(fresh.data.session?.user.id!==userId)throw Error('Sign in again to manage reminders.');response=await invoke(fresh.data.session.access_token)}
 if(response.error){let message='Could not update notifications. Please try again.';try{message=(await response.error.context?.json())?.error||message}catch{}throw Error(message)}
 return response.data as {enabled?:boolean;publicKey?:string;sent?:boolean};
}
export async function preparePush(){
 const base=new URL('.',location.href);await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});
 return navigator.serviceWorker.ready;
}
export function applicationKey(key:string){return Uint8Array.from(atob(key.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))}
export async function stopDevicePush(householdId:string){
 if(!pushSupported())return;
 const registration=await navigator.serviceWorker.getRegistration(new URL('.',location.href).href),subscription=await registration?.pushManager.getSubscription();
 if(!subscription)return;
 // Stop the browser first, even if the network is unavailable during sign-out.
 const endpoint=subscription.endpoint;await subscription.unsubscribe();await pushRequest('unsubscribe',householdId,{endpoint});
}
