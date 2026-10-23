import {createClient} from '@supabase/supabase-js';
import type {AuthError,Session,SupabaseClient} from '@supabase/supabase-js';
import {publicConfig} from './config';
import {createLoginStorage} from './loginStorage';

const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
const loginStorage=createLoginStorage(()=>localStorage,()=>sessionStorage,()=>crypto.randomUUID(),notify);
const client=(storage=loginStorage.options())=>createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,...storage}});
let activeStorageKey=loginStorage.options().storageKey;
export let supabase=client();
export const visitStorage=loginStorage.visit;
export const staySignedIn=()=>loginStorage.remember;
export const loginStorageWarning=()=>loginStorage.warning();
export const subscribeLogin=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};

// Publish a replacement client only after a successful login. A saved login
// for another account in the destination store must not flash into the UI
// while a different person's password is still being checked.
export async function withLoginPersistence<T extends {data:{session:Session|null};error:AuthError|null}>(remember:boolean,request:(client:SupabaseClient)=>Promise<T>):Promise<T>{
 const previous=supabase,current=await previous.auth.getSession();
 if(current.error)throw current.error;
 if(current.data.session)throw Error('You are already signed in. Open HH again to continue.');
 loginStorage.select(remember);
 const storage=loginStorage.options(),candidate=storage.storageKey===activeStorageKey?previous:client(storage);
 try{
  const result=await request(candidate);
  if(result.error)throw result.error;
  if(candidate!==previous){
   if(result.data.session){
    await previous.auth.dispose();await previous.realtime.disconnect();
    supabase=candidate;activeStorageKey=storage.storageKey;
   }else await candidate.auth.dispose();
  }
  notify();return result;
 }catch(error){if(candidate!==previous)await candidate.auth.dispose();throw error}
}
