import type {createLoginStorage} from './loginStorage';

export const SWITCH_ACCOUNTS=[
 {email:'zethhummel@gmail.com',label:'Family account',id:'family'},
 {email:'hummelhomeapp@gmail.com',label:'HH admin',id:'admin'}
] as const;
export type SwitchEmail=typeof SWITCH_ACCOUNTS[number]['email'];
export type AccountReference={email:SwitchEmail;userId:string;key:string;remember:boolean};
type Choice={key:string;remember:boolean;email?:SwitchEmail;userId?:string};
type LoginStorage=ReturnType<typeof createLoginStorage>;
const registryKey='hh:account-links:v1',choiceKey='hh:active-account:v1',defaultKey='hh:default-account:v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function switchEmail(value:string):SwitchEmail|null{return SWITCH_ACCOUNTS.find(account=>account.email===value.trim().toLowerCase())?.email||null}
const parse=(value:string|null):unknown=>{try{return value?JSON.parse(value):null}catch{return null}};

// Only references live here. The SDK remains the sole owner of session tokens
// at each canonical auth key, including refreshes from other tabs.
export function createAccountSwitchStorage(login:LoginStorage,newGeneration=()=>crypto.randomUUID(),namespace=''){
 function store(remember:boolean){return login.storageFor(remember)}
 function keyFor(email:SwitchEmail,remember:boolean){const id=SWITCH_ACCOUNTS.find(account=>account.email===email)!.id;return remember?namespace+'hh:account-auth:v1:'+id:login.optionsFor(false).storageKey+':account:'+id}
 function normalLoginKey(remember:boolean){return remember?namespace+'hh:other-auth:v1':login.optionsFor(false).storageKey+':other'}
 function entryKey(remember:boolean){return remember?namespace+'hh:account-entry:v1':login.optionsFor(false).storageKey+':entry'}
 function validKey(key:unknown,remember:boolean){return typeof key==='string'&&(key===login.optionsFor(remember).storageKey||key===normalLoginKey(remember)||key===entryKey(remember)||SWITCH_ACCOUNTS.some(account=>key===keyFor(account.email,remember)))}
 function validChoice(value:unknown):Choice|null{
  if(!value||typeof value!=='object')return null;
  const item=value as Partial<Choice>;
  if(typeof item.remember!=='boolean'||!validKey(item.key,item.remember))return null;
  if(item.email===undefined&&item.userId===undefined)return {key:item.key!,remember:item.remember};
  if(!item.email||switchEmail(item.email)!==item.email||typeof item.userId!=='string'||!uuid.test(item.userId))return null;
  const remember=item.remember;
  if(item.key===entryKey(remember)||SWITCH_ACCOUNTS.some(account=>account.email!==item.email&&item.key===keyFor(account.email,remember)))return null;
  return {key:item.key!,remember:item.remember,email:item.email,userId:item.userId};
 }
 function options(choice:Choice){
  // A new target does not have a verified user ID until password sign-in.
  // Storage access is bounded by key here; references are validated on record.
  if(!validChoice({key:choice.key,remember:choice.remember}))throw Error('Invalid account storage');
  const underlying=store(choice.remember);
  const generationKey='hh:auth-generation:v1:'+choice.key,generation=underlying.getItem(generationKey);
  // A revocation in any tab retires every adapter that captured the old
  // generation. In-flight SDK refreshes cannot restore or erase a newer login.
  const current=(key:string)=>(key===choice.key||key.startsWith(choice.key+'-'))&&underlying.getItem(generationKey)===generation;
  return {storageKey:choice.key,storage:{isCurrent:()=>underlying.getItem(generationKey)===generation,getItem:(key:string)=>current(key)?underlying.getItem(key):null,setItem:(key:string,value:string)=>{if(current(key))underlying.setItem(key,value)},removeItem:(key:string)=>{if(current(key))underlying.removeItem(key)}}};
 }
 function base():Choice{const value=login.options();return {key:value.storageKey,remember:login.remember}}
 function readRegistry(remember:boolean):Partial<Record<SwitchEmail,AccountReference>>{
  const value=parse(store(remember).getItem(registryKey)),result:Partial<Record<SwitchEmail,AccountReference>>={};
  if(!value||typeof value!=='object')return result;
  for(const account of SWITCH_ACCOUNTS){const ref=validChoice((value as Record<string,unknown>)[account.email]);if(ref?.email===account.email&&ref.userId&&ref.remember===remember)result[account.email]=ref as AccountReference;}
  return result;
 }
 function writeRegistry(remember:boolean,registry:Partial<Record<SwitchEmail,AccountReference>>){store(remember).setItem(registryKey,JSON.stringify(registry))}
 function record(ref:AccountReference){if(!validChoice(ref))throw Error('Invalid account reference');const registry=readRegistry(ref.remember);registry[ref.email]=ref;writeRegistry(ref.remember,registry)}
 function removeReference(email:SwitchEmail,remember:boolean){const registry=readRegistry(remember);delete registry[email];writeRegistry(remember,registry)}
 function hasToken(ref:AccountReference){return !!store(ref.remember).getItem(ref.key)}
 function storedIdentityMatches(ref:AccountReference){const value=parse(store(ref.remember).getItem(ref.key)) as {user?:{id?:string;email?:string}}|null;return value?.user?.id===ref.userId&&value.user.email?.toLowerCase()===ref.email}
 function assertDurable(remember:boolean){if(login.visit.failed||store(remember).failed)throw Error('Your browser cannot save account switching. Keep using this account, or allow storage for HH and try again.')}
 function activate(ref:AccountReference){
  assertDurable(ref.remember);
  const backing=store(ref.remember),beforeRegistry=backing.getItem(registryKey),beforeChoice=login.visit.getItem(choiceKey),beforeDefault=ref.remember?store(true).getItem(defaultKey):null;
  const restore=(target:ReturnType<typeof store>,key:string,value:string|null)=>value===null?target.removeItem(key):target.setItem(key,value);
  try{
   record(ref);assertDurable(ref.remember);
   if(ref.remember){store(true).setItem(defaultKey,JSON.stringify(ref));assertDurable(ref.remember)}
   // The tab pointer is the commit and is written last. Failed preceding
   // metadata writes never select the destination in the current tab.
   login.visit.setItem(choiceKey,JSON.stringify(ref));assertDurable(ref.remember);
  }catch(error){
   restore(backing,registryKey,beforeRegistry);restore(login.visit,choiceKey,beforeChoice);
   if(ref.remember)restore(store(true),defaultKey,beforeDefault);
   throw error;
  }
 }
 function initial(blockSelection:boolean){
  const fallback=base();
  const tab=validChoice(parse(login.visit.getItem(choiceKey)));
  const saved=fallback.remember?validChoice(parse(store(true).getItem(defaultKey))):null;
  const selected=!blockSelection&&(tab||saved);
  const choice=selected&&selected.remember===fallback.remember?selected:fallback;
  // Pin every tab, including legacy base sessions: changing the cold-start
  // default in another tab must not silently change this tab on reload.
  if(!blockSelection)login.visit.setItem(choiceKey,JSON.stringify(choice));
  return choice;
 }
 function pinChoice(choice:Choice){if(!validChoice(choice))throw Error('Invalid account storage');login.visit.setItem(choiceKey,JSON.stringify(choice));if(choice.remember)store(true).setItem(defaultKey,JSON.stringify(choice));return choice}
 function pinBase(){return pinChoice(base())}
 function clearSelection(){login.visit.removeItem(choiceKey);store(true).removeItem(defaultKey)}
 function blockAndRemove(ref:Pick<AccountReference,'key'|'remember'>){
  if(!validKey(ref.key,ref.remember))throw Error('Invalid account storage');
  const backing=store(ref.remember);backing.setItem('hh:auth-generation:v1:'+ref.key,newGeneration());
  backing.removeItem('shopping:v1:'+ref.key);
  backing.removeItem('shopping:v2:'+ref.key);
  backing.removeItem(ref.key);backing.removeItem(ref.key+'-user');backing.removeItem(ref.key+'-code-verifier');
 }
 return {base,options,keyFor,normalLoginKey,entryKey,record,readRegistry,removeReference,hasToken,storedIdentityMatches,assertDurable,activate,initial,pinBase,pinChoice,clearSelection,blockAndRemove,store};
}
