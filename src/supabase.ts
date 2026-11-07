import {createClient} from '@supabase/supabase-js';
import type {AuthError,Session,SupabaseClient} from '@supabase/supabase-js';
import {publicConfig,authNamespace} from './config';
import {createLoginStorage} from './loginStorage';
import {createAccountSwitchStorage,switchEmail,type AccountReference} from './accountSwitchStorage';

const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
let localSignOutWarning='';
const loginStorage=createLoginStorage(()=>localStorage,()=>sessionStorage,()=>crypto.randomUUID(),notify,authNamespace);
export const accountStorage=createAccountSwitchStorage(loginStorage,()=>crypto.randomUUID(),authNamespace);
const authUrl=new URL(location.href),authFragment=new URLSearchParams(authUrl.hash.slice(1));
export const recoveryEntry=authUrl.searchParams.has('code')||authUrl.searchParams.get('type')==='recovery'||authFragment.get('type')==='recovery';
export const accountAuthReturn=authUrl.searchParams.has('code')||authFragment.has('access_token')||authFragment.has('refresh_token')||authFragment.get('type')==='recovery';
export const accountSwitchBlocked=authUrl.searchParams.has('reset')||accountAuthReturn;
let activeChoice=accountStorage.initial(accountAuthReturn);
let activeOptions=accountStorage.options(activeChoice);
const client=(storage=activeOptions,detectSessionInUrl=true,autoRefreshToken=true)=>createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken,detectSessionInUrl,...storage}});
let activeStorageKey=activeChoice.key;
export let supabase=recoveryEntry?createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:true,storageKey:'hh-recovery-entry:v1'}}):client();
const recoveryClient=recoveryEntry?supabase:null;
export const isRecoveryEntryClient=()=>supabase===recoveryClient;
export const currentAccountStorage=()=>activeChoice;
export const createAccountClient=(reference:Pick<AccountReference,'key'|'remember'>)=>client(accountStorage.options({key:reference.key,remember:reference.remember}),false,false);
export const isCurrentAuthClient=(candidate:SupabaseClient)=>candidate===supabase&&(isRecoveryEntryClient()||activeOptions.storage.isCurrent());
export const activeAccountStorageCurrent=()=>isCurrentAuthClient(supabase);
export const visitStorage=loginStorage.visit;
export const staySignedIn=()=>loginStorage.remember;
export const loginStorageWarning=()=>localSignOutWarning||loginStorage.warning();
export function showLocalSignOutWarning(){
 localSignOutWarning='Signed out on this page, but your browser could not remove the saved sign-ins. Clear HH site data before leaving this device.';
 notify();
 // The generation has already been retired. Prompt the existing auth-resume
 // listener to clear its React session immediately, even when remote logout
 // timed out and therefore never emitted SIGNED_OUT.
 window.dispatchEvent(new Event('storage'));
}
export const subscribeLogin=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};

// Publish a replacement client only after a successful login. A saved login
// for another account in the destination store must not flash into the UI
// while a different person's password is still being checked.
export async function withLoginPersistence<T extends {data:{session:Session|null};error:AuthError|null}>(remember:boolean,request:(client:SupabaseClient)=>Promise<T>,expectedEmail=''):Promise<T>{
 const previous=supabase,current=await previous.auth.getSession();
 if(current.error)throw current.error;
 if(current.data.session)throw Error('You are already signed in. Open HH again to continue.');
 loginStorage.select(remember);
 const email=switchEmail(expectedEmail),registry=accountStorage.readRegistry(remember),base=accountStorage.base();
 const reserved=(key:string)=>Object.values(registry).some(ref=>!!ref&&ref.key===key&&accountStorage.storedIdentityMatches(ref));
 let key=base.key;
 if(email){const known=registry[email];key=known&&(!accountStorage.hasToken(known)||accountStorage.storedIdentityMatches(known))?known.key:accountStorage.keyFor(email,remember);}
 else if(reserved(key)){key=accountStorage.normalLoginKey(remember);if(reserved(key))throw Error('Sign out of your saved accounts before using a different login on this device.');}
 const choice={key,remember},storage=accountStorage.options(choice),candidate=storage.storageKey===activeStorageKey&&activeOptions.storage.isCurrent()?previous:client(storage);
 try{
  const result=await request(candidate);
  if(result.error)throw result.error;
  if(result.data.session&&email){
   const verified=result.data.session.user;
   if(verified.email?.toLowerCase()!==email||!verified.email_confirmed_at)throw Error('This sign-in could not be verified. Please try again.');
   accountStorage.record({key,remember,email,userId:verified.id});
  }
  if(candidate!==previous){
   if(result.data.session){
    await previous.auth.dispose();await previous.realtime.disconnect();
    supabase=candidate;activeStorageKey=storage.storageKey;activeOptions=storage;
   }else await candidate.auth.dispose();
  }
  if(result.data.session){activeChoice=accountStorage.pinChoice(email?{...choice,email,userId:result.data.session.user.id}:choice);localSignOutWarning='';}
  notify();return result;
 }catch(error){if(candidate!==previous)await candidate.auth.dispose();throw error}
}
