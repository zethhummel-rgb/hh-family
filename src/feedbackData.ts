import {supabase} from './supabase';
export async function feedbackAvailability():Promise<'email'|'preview'|'unavailable'|null>{
 try{
  const result=await supabase.functions.invoke('send-feedback',{method:'GET'});
  if(result.error||typeof result.data?.configured!=='boolean')return null;
  return result.data.configured?'email':result.data.preview===true?'preview':'unavailable';
 }catch{return null}
}
export async function sendFeedback(body:{requestId:string;householdId:string;area:string;message:string},userId:string){
 const initial=await supabase.auth.getSession();const session=initial.data.session;
 if(initial.error||!session||session.user.id!==userId)throw Error('Sign in again to send your feedback.');
 const invoke=(token:string)=>supabase.functions.invoke('send-feedback',{body,headers:{Authorization:'Bearer '+token}});
 let result=await invoke(session.access_token);
 if(result.error?.context?.status===401){
  const current=await supabase.auth.getSession();if(current.error||current.data.session?.user.id!==userId)throw Error('Sign in again to send your feedback.');
  const fresh=await supabase.auth.refreshSession();if(fresh.error||fresh.data.session?.user.id!==userId)throw Error('Sign in again to send your feedback.');
  result=await invoke(fresh.data.session.access_token);
 }
 if(result.error){let message='Could not confirm delivery. Your comment is still here. Try Send Feedback again to check its status.';try{const data=await result.error.context?.json();if(typeof data?.error==='string')message=data.error}catch{}throw Error(message)}
 if(result.data?.saved===true)return 'saved' as const;
 if(result.data?.sent===true)return 'email' as const;
 throw Error('Could not confirm delivery. Your comment is still here.');
}
