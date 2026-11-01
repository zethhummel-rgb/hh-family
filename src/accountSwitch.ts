import type {Session,SupabaseClient,User} from '@supabase/supabase-js';
import {accountStorage,accountSwitchBlocked,accountAuthReturn,isRecoveryEntryClient,createAccountClient,currentAccountStorage,supabase,visitStorage,subscribeLogin,showLocalSignOutWarning} from './supabase';
import {SWITCH_ACCOUNTS,switchEmail,type SwitchEmail,type AccountReference} from './accountSwitchStorage';
import {FAMILY_INVITE_KEY,PILOT_INVITE_KEY} from './pilot';

export class AccountSwitchError extends Error{
 constructor(message:string,public needsPassword=false,public invalidSelection=false){super(message);this.name='AccountSwitchError'}
}
export const accountSwitchEligible=(email:string)=>!accountSwitchBlocked&&switchEmail(email)!==null;
const label=(email:SwitchEmail)=>SWITCH_ACCOUNTS.find(account=>account.email===email)!.label;
const confirmed=(user:User,email:SwitchEmail,id?:string)=>user.email?.toLowerCase()===email&&!!user.email_confirmed_at&&(!id||user.id===id);
const same=(session:Session|null,ref:AccountReference)=>session?.user.id===ref.userId&&session.user.email?.toLowerCase()===ref.email;
const message=(error:unknown)=>error instanceof Error?error.message:'Could not switch accounts. Please try again.';
let busy=false;
let revocation=0;
// A sign-out in another tab or this tab invalidates a pending activation. A
// freshly authenticated target is never allowed to resurrect a signed-out UI.
let observedClient=supabase;
let revocationSubscription=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')revocation++}).data.subscription;
subscribeLogin(()=>{if(observedClient===supabase)return;++revocation;revocationSubscription.unsubscribe();observedClient=supabase;revocationSubscription=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')revocation++}).data.subscription});
function invalidAuth(error:{status?:number;code?:string}|null){return !!error&&(error.status===400||error.status===401||error.status===403||error.code==='refresh_token_not_found'||error.code==='user_not_found')}
async function source(expectedUserId:string){
 if(accountSwitchBlocked)throw new AccountSwitchError('Finish this sign-in or password reset, then reopen HH before switching accounts.');
 const initial=await supabase.auth.getSession();if(initial.error)throw initial.error;
 const session=initial.data.session,email=session&&switchEmail(session.user.email||'');
 if(!session||session.user.id!==expectedUserId||!email)throw new AccountSwitchError('Your signed-in account changed. Reopen Settings to continue.');
 const verified=await supabase.auth.getUser();if(verified.error)throw verified.error;
 if(!verified.data.user||!confirmed(verified.data.user,email,expectedUserId))throw new AccountSwitchError('This account is not available for switching.');
 const choice=currentAccountStorage();
 const ref:AccountReference={key:choice.key,remember:choice.remember,email,userId:expectedUserId};
 const latest=await supabase.auth.getSession();if(latest.error||!same(latest.data.session,ref))throw new AccountSwitchError('Your signed-in account changed. Reopen Settings to continue.');
 accountStorage.record(ref);return ref;
}
export function hasSavedSwitchAccount(expectedUserId:string,email:string){
 const normalized=switchEmail(email);if(!normalized||accountSwitchBlocked)return false;
 const choice=currentAccountStorage(),registry=accountStorage.readRegistry(choice.remember),current=registry[normalized];
 if(current?.userId!==expectedUserId||current.key!==choice.key)return false;
 const other=SWITCH_ACCOUNTS.find(account=>account.email!==normalized)!,ref=registry[other.email];
 return !!ref&&ref.key!==choice.key&&accountStorage.storedIdentityMatches(ref);
}
export async function getAccountSwitchOptions(expectedUserId:string){
 const current=await source(expectedUserId),other=SWITCH_ACCOUNTS.find(account=>account.email!==current.email)!,ref=accountStorage.readRegistry(current.remember)[other.email];
 return {remembered:current.remember,current:{email:current.email,label:label(current.email)},other:{email:other.email,label:other.label,saved:!!ref&&ref.key!==current.key&&accountStorage.storedIdentityMatches(ref)}};
}
function clearTransientEntry(){visitStorage.removeItem(FAMILY_INVITE_KEY);visitStorage.removeItem(PILOT_INVITE_KEY);visitStorage.removeItem('homeRefreshTab')}
function reload(){clearTransientEntry();location.replace(location.origin+location.pathname)}
export function clearAccountSelection(){const choice=currentAccountStorage(),entry={key:accountStorage.entryKey(choice.remember),remember:choice.remember};accountStorage.clearSelection();accountStorage.blockAndRemove(entry);accountStorage.pinChoice(entry);clearTransientEntry()}
export async function finishRecoveryEntry(){if(!isRecoveryEntryClient())return;try{await Promise.race([supabase.auth.signOut({scope:'local'}),new Promise(resolve=>setTimeout(resolve,3000))])}finally{await supabase.auth.dispose();reload()}}
export async function verifySelectedAccount(){
 const selected=currentAccountStorage();if(accountAuthReturn||!selected.email||!selected.userId)return;
 const ref=selected as AccountReference;
 const session=await supabase.auth.getSession();
 if(session.error){if(invalidAuth(session.error))return;throw new AccountSwitchError('Could not verify your saved account. Check your connection and try again.')}
 if(!session.data.session)return;
 if(!same(session.data.session,ref))throw new AccountSwitchError('The selected account is no longer saved here. Return to sign-in to continue.',false,true);
 const result=await supabase.auth.getUser();
 if(result.error){if(invalidAuth(result.error))throw new AccountSwitchError('This saved sign-in has expired. Return to sign-in to continue.',false,true);throw new AccountSwitchError('Could not verify your saved account. Check your connection and try again.')}
 if(!result.data.user||!confirmed(result.data.user,ref.email,ref.userId))throw new AccountSwitchError('The selected account could not be verified. Return to sign-in to continue.',false,true);
}
export async function switchAccount({expectedUserId,targetEmail,password}:{expectedUserId:string;targetEmail:string;password?:string}){
 if(busy)throw new AccountSwitchError('Please wait for the current account request.');
 busy=true;let candidate:SupabaseClient|undefined,created=false,target:AccountReference|undefined;
 const revision=revocation;
 try{
  const current=await source(expectedUserId),email=switchEmail(targetEmail);
  if(!email||email===current.email)throw new AccountSwitchError('Choose your other HH account.');
  accountStorage.assertDurable(current.remember);
  const registered=accountStorage.readRegistry(current.remember)[email];
  target=registered&&registered.key!==current.key?registered:{email,userId:'',remember:current.remember,key:accountStorage.keyFor(email,current.remember)};
  // Dedicated keys can outlive registry removal; reject another identity before
  // using them, and never let an unverified key replace the source session.
  if(target.key===current.key)throw new AccountSwitchError('The saved account slots overlap. Sign out and sign in again before linking the other account.');
  candidate=createAccountClient(target);
  let session:Session|null=null;
  if(password!==undefined){
   if(!password)throw new AccountSwitchError('Enter the password for this account.',true);
   const result=await candidate.auth.signInWithPassword({email,password});
   if(result.error)throw new AccountSwitchError('Could not sign in to that account. Check the password and try again.',true);
   session=result.data.session;created=!!session;
  }else{
   const result=await candidate.auth.getSession();
   if(result.error){if(invalidAuth(result.error))throw new AccountSwitchError('Sign in to this account once to keep it available here.',true);throw new AccountSwitchError('Could not check your other account. Check your connection and try again.')}
   session=result.data.session;
  }
  if(!session)throw new AccountSwitchError('Sign in to this account once to keep it available here.',true);
  const verified=await candidate.auth.getUser();
  if(verified.error){if(invalidAuth(verified.error))throw new AccountSwitchError('This saved sign-in has expired. Enter the account password to reconnect it.',true);throw new AccountSwitchError('Could not verify your other account. Check your connection and try again.')}
  if(!verified.data.user||!confirmed(verified.data.user,email,created?undefined:target.userId||undefined)||session.user.id!==verified.data.user.id)throw new AccountSwitchError('That sign-in does not match the selected account.',true);
  target={...target,userId:verified.data.user.id};
  // Recheck both canonical stores after all network awaits. Another tab may
  // have signed out, replaced the legacy source key, or changed this target.
  const latestTarget=await candidate.auth.getSession(),latestSource=await supabase.auth.getSession();
  if(latestTarget.error||!same(latestTarget.data.session,target))throw new AccountSwitchError('Your other sign-in changed. Please try again.',true);
  if(revision!==revocation||latestSource.error||!same(latestSource.data.session,current))throw new AccountSwitchError('Your signed-in account changed. Sign in again to continue.');
  accountStorage.activate(target);
  await candidate.auth.dispose();await candidate.realtime.disconnect();candidate=undefined;
  reload();
 }catch(error){
  if(created&&candidate&&target){try{await Promise.race([candidate.auth.signOut({scope:'local'}),new Promise(resolve=>setTimeout(resolve,3000))])}catch{}finally{accountStorage.blockAndRemove(target);accountStorage.removeReference(target.email,target.remember);}}
  throw error instanceof AccountSwitchError?error:new AccountSwitchError(message(error));
 }finally{if(candidate){await candidate.auth.dispose();await candidate.realtime.disconnect()}busy=false}
}

export async function signOutAccounts(){
 if(isRecoveryEntryClient()){await finishRecoveryEntry();return}
 ++revocation;
 const choice=currentAccountStorage(),registry=accountStorage.readRegistry(choice.remember);
 // Ordinary logins must never sign out unrelated saved paired accounts merely
 // because older metadata still references a subsequently reused legacy key.
 const pairActive=Object.values(registry).some(ref=>!!ref&&ref.key===choice.key&&accountStorage.storedIdentityMatches(ref));
 const refs=pairActive?Object.values(registry).filter((ref):ref is AccountReference=>!!ref&&accountStorage.storedIdentityMatches(ref)):[];
 const clients=refs.filter(ref=>ref.key!==choice.key).map(ref=>createAccountClient(ref));
 // Revocation is best effort. Retiring the storage adapters also refuses late
 // refresh writes; a failed persistent removal must keep this realm signed out.
 try{await Promise.race([Promise.allSettled([supabase,...clients].map(client=>client.auth.signOut({scope:'local'}))),new Promise(resolve=>setTimeout(resolve,3000))])}
 finally{
  accountStorage.clearSelection();
  for(const ref of refs){accountStorage.blockAndRemove(ref);accountStorage.removeReference(ref.email,ref.remember)}
  accountStorage.blockAndRemove(choice);
  accountStorage.pinChoice({key:choice.key,remember:choice.remember});
  const cleanupFailed=visitStorage.failed||accountStorage.store(true).failed||accountStorage.store(choice.remember).failed||refs.some(ref=>accountStorage.store(ref.remember).failed);
  if(cleanupFailed)showLocalSignOutWarning();
  await Promise.allSettled([supabase,...clients].map(async client=>{await client.auth.dispose();await client.realtime.disconnect()}));
  if(cleanupFailed)throw new AccountSwitchError('Your browser could not remove the saved sign-ins. Clear HH site data before leaving this device.');
  reload();
 }
}
