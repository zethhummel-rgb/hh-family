type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const rememberedAuthKey='home-together-auth';
const preferenceKey='hh:stay-signed-in:v1',tabPreferenceKey='hh:login-choice:v1',visitIdKey='hh:login-visit:v1';

// Storage can be blocked or full. Keep the current visit usable and report
// when the browser could not save a login, rather than silently promising it.
export function safeStorage(open:()=>Store,onChange=()=>{}){
 const memory=new Map<string,string|null>();let failed=false;
 const failure=()=>{if(!failed){failed=true;onChange()}};
 return {
  get failed(){return failed},
  getItem(key:string):string|null{
   if(memory.has(key))return memory.get(key)!;
   try{return open().getItem(key)}catch{failure();return null}
  },
  setItem(key:string,value:string){
   try{const store=open();store.setItem(key,value);if(store.getItem(key)!==value)throw Error('Storage unavailable');memory.delete(key)}
   catch{memory.set(key,value);failure()}
  },
  removeItem(key:string){
   memory.set(key,null);
   try{const store=open();store.removeItem(key);if(store.getItem(key)!==null)throw Error('Storage unavailable');memory.delete(key)}catch{failure()}
  }
 };
}

export function createLoginStorage(local:()=>Store,tab:()=>Store,newId:()=>string,onChange=()=>{}){
 const saved=safeStorage(local,onChange),visit=safeStorage(tab,onChange);
 const tabChoice=visit.getItem(tabPreferenceKey);
 let remember=tabChoice?tabChoice==='keep':saved.getItem(preferenceKey)!=='no';
 let visitId=visit.getItem(visitIdKey);
 function options(){
  if(remember)return {storage:saved,storageKey:rememberedAuthKey};
  if(!visitId){visitId=newId();visit.setItem(visitIdKey,visitId)}
  // A separate channel/key keeps a shared-device login out of other tabs.
  return {storage:visit,storageKey:'hh:visit-auth:v1:'+visitId};
 }
 return {
  visit,
  get remember(){return remember},
  options,
  select(value:boolean){
   remember=value;visit.setItem(tabPreferenceKey,value?'keep':'visit');saved.setItem(preferenceKey,value?'yes':'no');
  },
  warning(){return (remember?saved.failed:visit.failed)
   ?remember?'Your browser could not save your login. You can use HH for this visit, but may need to sign in again when you reopen it.':'Your browser could not keep this login for the tab. You can use HH for this visit.': ''}
 };
}
