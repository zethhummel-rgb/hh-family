import type {Session,SupabaseClient} from '@supabase/supabase-js';

const signInAgain=()=>new Error('Sign in again to open the calendar');

export async function authenticatedCalendarRequest(client:Pick<SupabaseClient,'auth'|'functions'>,body:Record<string,unknown>){
 const initial=await client.auth.getSession();
 if(initial.error||!initial.data.session)throw signInAgain();
 const session=initial.data.session;
 const invoke=(s:Session)=>client.functions.invoke('google-calendar',{body,headers:{Authorization:'Bearer '+s.access_token}});
 let response=await invoke(session);
 // The calendar handler rejects 401s before any event or connection is changed.
 // Refresh once for a stale login; never replay a network or calendar error.
 if(response.error?.context?.status===401){
  const current=await client.auth.getSession();
  if(current.error||current.data.session?.user.id!==session.user.id)throw signInAgain();
  let renewed=current.data.session;
  if(renewed.access_token===session.access_token){
   const refreshed=await client.auth.refreshSession();
   if(refreshed.error||refreshed.data.session?.user.id!==session.user.id)throw signInAgain();
   renewed=refreshed.data.session;
  }
  response=await invoke(renewed);
 }
 return response;
}
