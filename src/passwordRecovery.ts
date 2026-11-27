import type {SupabaseClient} from '@supabase/supabase-js';

type RecoveryAuth=Pick<SupabaseClient['auth'],'resetPasswordForEmail'|'verifyOtp'|'updateUser'|'signOut'>&{
 mfa:Pick<SupabaseClient['auth']['mfa'],'listFactors'|'challengeAndVerify'>;
};
type Authenticator={id:string;name?:string};
type AuthenticatorCode={factorId:string;code:string};
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
 let authenticators:Authenticator[]=[];
 async function clear(){verifiedEmail='';authenticators=[];try{await auth.signOut({scope:'local'})}catch{/* Best-effort cleanup of this isolated recovery session. */}}
 async function expired():Promise<never>{
  await clear();
  throw Error('Your reset session expired. Request a new code.');
 }
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
  complete:(value:string,token:string,password:string,confirmation:string,authenticator?:AuthenticatorCode)=>exclusive(async()=>{
   const email=recoveryEmail(value);
   if(!/^\d{6,10}$/.test(token))throw Error('Enter the code from your reset email.');
   if(password.length<6||password.length>128)throw Error('Use a password between 6 and 128 characters.');
   if(password!==confirmation)throw Error('Passwords do not match.');
   if(verifiedEmail!==email){
    if(authenticator)return expired();
    await clear();
    const {data,error}=await auth.verifyOtp({email,token,type:'recovery'});
    if(error||!data.session||!data.user||data.user.email?.toLowerCase()!==email||data.session.user.id!==data.user.id){
     await clear();throw Error('That code is incorrect or has expired. Request a new code and use the newest email.');
    }
    verifiedEmail=email;
   }
   if(authenticators.length){
    if(!authenticator)return authenticators;
    if(!authenticators.some(factor=>factor.id===authenticator.factorId)||!/^\d{6}$/.test(authenticator.code)){
     throw Error('Enter the six-digit code from your authenticator app.');
    }
    const {error}=await auth.mfa.challengeAndVerify({factorId:authenticator.factorId,code:authenticator.code});
    if(error){
     if(error.code==='session_not_found'||error.code==='session_expired'||error.code==='bad_jwt')return expired();
     throw Error(error.status===429?'Too many attempts. Wait a moment before trying again.':'That authenticator code could not be verified. Try a fresh code from your app.');
    }
    authenticators=[];
   }
   const {error}=await auth.updateUser({password});
   // A rejected password can be corrected without reusing the consumed code.
   if(error){
    const requiresAuthenticator=error.code==='insufficient_aal';
    const permissionDenied=error.status===401||error.status===403;
    if(requiresAuthenticator||(!error.code&&permissionDenied)){
     // Some browser responses do not expose the Auth API version header, so
     // the SDK may omit the error code. Only offer an enrolled factor if the
     // recovery session can still load the verified account from Auth.
     const factors=await auth.mfa.listFactors();
     if(factors.error){
      if(requiresAuthenticator&&factors.error.status!==401&&factors.error.status!==403)throw Error('Could not load your authenticator. Try again.');
      return expired();
     }
     authenticators=factors.data.totp.map(factor=>({id:factor.id,name:factor.friendly_name}));
     if(authenticators.length)return authenticators;
     if(requiresAuthenticator)throw Error('This account requires an additional security check. Contact HH support for help resetting your password.');
    }
    if(permissionDenied)return expired();
    throw Error(error.code==='same_password'?'Choose a password different from your current password.':'Could not save that password. Try a different password, or request a new code.');
   }
   await clear();
  })
 };
}
