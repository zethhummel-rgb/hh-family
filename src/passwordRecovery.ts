import type {SupabaseClient} from '@supabase/supabase-js';

type RecoveryAuth=Pick<SupabaseClient['auth'],'resetPasswordForEmail'|'verifyOtp'|'updateUser'|'signOut'>;
export const recoveryClientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'hh-password-recovery'}};
export function recoveryEmail(value:string){
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw Error('Enter a valid email address.');
 return email;
}
// This controller receives a separate, memory-only auth client. A recovery code
// must never replace the household session or put its tokens in browser storage.
export function createPasswordRecovery(auth:RecoveryAuth,redirectTo:string){
 let verifiedEmail='',busy=false;
 async function clear(){verifiedEmail='';try{await auth.signOut({scope:'local'})}catch{/* Best-effort cleanup of this isolated recovery session. */}}
 async function exclusive<T>(operation:()=>Promise<T>){
  if(busy)throw Error('Please wait for the current request.');
  busy=true;try{return await operation()}finally{busy=false}
 }
 return {
  clear,
  request:(value:string)=>exclusive(async()=>{
   const email=recoveryEmail(value);await clear();
   const {error}=await auth.resetPasswordForEmail(email,{redirectTo});
   if(error)throw Error(error.status===429?'Please wait before requesting another code.':'Could not send a reset email. Please try again shortly.');
   return email;
  }),
  complete:(value:string,token:string,password:string,confirmation:string)=>exclusive(async()=>{
   const email=recoveryEmail(value);
   if(!/^\d{6,10}$/.test(token))throw Error('Enter the code from your reset email.');
   if(password.length<12||password.length>128)throw Error('Use a password between 12 and 128 characters.');
   if(password!==confirmation)throw Error('Passwords do not match.');
   if(verifiedEmail!==email){
    await clear();
    const {data,error}=await auth.verifyOtp({email,token,type:'recovery'});
    if(error||!data.session||!data.user||data.user.email?.toLowerCase()!==email||data.session.user.id!==data.user.id){
     await clear();throw Error('That code is incorrect or has expired. Request a new code and use the newest email.');
    }
    verifiedEmail=email;
   }
   const {error}=await auth.updateUser({password});
   // A rejected password can be corrected without reusing the consumed code.
   if(error){
    if(error.status===401||error.status===403){await clear();throw Error('Your reset session expired. Request a new code.');}
    throw Error(error.code==='same_password'?'Choose a password different from your current password.':'Could not save that password. Try a different password, or request a new code.');
   }
   await clear();
  })
 };
}
