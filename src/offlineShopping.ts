import { accountStorage, activeAccountStorageCurrent, accountSwitchBlocked, currentAccountStorage, supabase } from './supabase';
import { authNamespace } from './config';
import type { ReminderItem } from './taskReminders';
import {validateGrocery, type GroceryDraft} from './groceryData';

export type ShoppingItem = {
  id: string; title: string; done: boolean; version: number; detail: string; category: string;
  quantity?:number|null; unit?:string|null; store?:string|null;
};
type Intent = {done?:boolean; draft?:GroceryDraft; version:number; token:string; create?:boolean};
type Pick = Intent & {attempt?:Intent; conflict?:{server:ShoppingItem|null}};
export type Trip = {
  user: string; home: string; name: string; saved: number; rows: ShoppingItem[];
  picks: Record<string, Pick>; notices: string[];
};
const fields = 'id,title,done,reminder_version,category,grocery_quantity,grocery_unit,grocery_store';
export const tripEvent = 'hh-shopping-update';
export function groceryItems(trip:Trip):ReminderItem[] {
  return trip.rows.map(row => ({
    id:row.id, kind:'grocery', title:row.title, category:row.category, person:'Everyone', due:'', createdAt:'',
    done:Number(trip.picks[row.id]?.done ?? row.done), reminder_version:row.version,
    grocery_quantity:row.quantity, grocery_unit:row.unit, grocery_store:row.store,
    ...trip.picks[row.id]?.draft
  }));
}

// Keep queued rows visible even if a refresh no longer contains them. Their
// pending version is never rebased by a background refresh.
function mergeRows(rows:ShoppingItem[], current:Trip|null):ShoppingItem[] {
  const merged=rows.map(row=>{
    const previous=current?.rows.find(item=>item.id===row.id);
    return previous && previous.version>row.version ? previous : row;
  });
  for(const row of current?.rows||[])if(current?.picks[row.id]&&!merged.some(item=>item.id===row.id))merged.push(row);
  return merged;
}

function slot() {
  const choice = currentAccountStorage();
  const backing = accountStorage.store(choice.remember);
  const key = 'shopping:v2:' + choice.key;
  if (accountSwitchBlocked || !activeAccountStorageCurrent() || backing.failed) return null;
  const raw = backing.getItem(choice.key);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw).user?.id;
    if (typeof user !== 'string' || (choice.userId && choice.userId !== user)) return null;
    return { backing, key, legacyKey:'shopping:v1:'+choice.key, user, lock: authNamespace + key };
  } catch { return null; }
}
export function savedTrip(): Trip | null {
  const current = slot();
  if (!current) return null;
  try {
    const raw = current.backing.getItem(current.key) ?? current.backing.getItem(current.legacyKey);
    const trip = raw ? JSON.parse(raw) as Trip : null;
    return trip?.user === current.user && Array.isArray(trip.rows) && trip.picks ? trip : null;
  } catch { return null; }
}
function notify() { window.dispatchEvent(new Event(tripEvent)); }

async function edit(user: string, update: (trip: Trip | null) => Trip | null) {
  const initial = slot();
  if (!initial || initial.user !== user || !navigator.locks) throw Error('This device could not save the shopping list.');
  await navigator.locks.request(initial.lock, () => {
    const current = slot();
    if (!current || current.user !== user || current.key !== initial.key) throw Error('Your sign-in changed.');
    const next = update(savedTrip());
    if (next) current.backing.setItem(current.key, JSON.stringify(next));
    else current.backing.removeItem(current.key);
    if (current.backing.failed) throw Error('This device could not save your changes. Check available browser storage.');
    current.backing.removeItem(current.legacyKey);
  });
  notify();
}

type RawItem = {id:string; title:string; done:number|boolean; reminder_version?:number; category:string;
  grocery_quantity?:number|null; grocery_unit?:string|null; grocery_store?:string|null};
function shoppingItem(item: RawItem): ShoppingItem {
  const amount = item.grocery_quantity == null ? '' : [item.grocery_quantity,item.grocery_unit].filter(Boolean).join(' ');
  return { id:item.id, title:item.title, done:!!item.done, version:item.reminder_version || 1,
    category:item.category, detail:[amount,item.grocery_store].filter(Boolean).join(' · '),
    quantity:item.grocery_quantity, unit:item.grocery_unit, store:item.grocery_store };
}
export async function saveGroceries(user:string, home:string, name:string, items:ReminderItem[]) {
  const rows = items.filter(item => item.kind === 'grocery').map(shoppingItem);
  await edit(user, old => {
    const same = old?.home === home ? old : null;
    const merged = mergeRows(rows,same);
    return { user, home, name, rows:merged, saved:Date.now(), picks:same?.picks || {}, notices:same?.notices || [] };
  });
}
export async function pickItem(trip:Trip, id:string, done:boolean) {
  await edit(trip.user, current => {
    const row = current?.rows.find(item => item.id === id);
    if (!current || current.home !== trip.home || !row) throw Error('This item is no longer on your list.');
    current.picks[id] = {...current.picks[id], done, version:current.picks[id]?.version ?? row.version, token:crypto.randomUUID() };
    return current;
  });
}
export async function queueGrocery(trip:Trip,draft:GroceryDraft,item:ReminderItem|null,requestId:string,addBack=false) {
  const value=validateGrocery(draft),id=item?.id||requestId;
  await edit(trip.user,current=>{
    if(!current||current.home!==trip.home)throw Error('Open your grocery list again before saving.');
    const row=current.rows.find(row=>row.id===id),pending=current.picks[id];
    if(item&&!row)throw Error('This item is no longer on your list.');
    if(!item&&row)throw Error('This item is already saved. Close the editor to view it.');
    if(!row)current.rows.push(shoppingItem({id,...value,done:false,reminder_version:1}));
    current.picks[id]={...pending,draft:value,version:pending?.version??item?.reminder_version??1,
      token:crypto.randomUUID(),create:pending?.create||!item,
      ...(!item||addBack?{done:false}:{})};
    return current;
  });
}
export async function resolveGrocery(trip:Trip,id:string,keep:boolean) {
  await edit(trip.user,current=>{
    if(!current||current.home!==trip.home)return current;
    const pending=current.picks[id],conflict=pending?.conflict;
    if(!conflict)return current;
    const local=current.rows.find(row=>row.id===id);
    delete current.picks[id];
    current.rows=current.rows.filter(row=>row.id!==id);
    if(conflict.server)current.rows.push(conflict.server);
    if(keep&&local){
      const nextId=conflict.server?id:crypto.randomUUID();
      if(!conflict.server)current.rows.push({...local,id:nextId});
      current.picks[nextId]={draft:pending.draft,done:pending.done,
        version:conflict.server?.version||1,create:!conflict.server,token:crypto.randomUUID()};
    }
    return current;
  });
}
export async function clearNotices(trip:Trip) {
  await edit(trip.user, current => current?.home === trip.home ? {...current, notices:[]} : current);
}
export function forgetShopping() {
  const choice = currentAccountStorage();
  accountStorage.store(choice.remember).removeItem('shopping:v1:' + choice.key);
  accountStorage.store(choice.remember).removeItem('shopping:v2:' + choice.key);
  notify();
}
let prepared:Promise<void> | undefined;
export function prepareShoppingShell() {
  if (!navigator.locks || !('serviceWorker' in navigator)) return Promise.reject(Error('Offline shopping is unavailable in this browser.'));
  const base = new URL('.',location.href);
  if (!prepared) prepared = (async () => {
    const registration = await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});
    await new Promise<void>((resolve,reject) => {
      let port:MessagePort | undefined;
      const probe = () => {
        if (!registration.active) return;
        port?.close();
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = event => {if(event.data===true)finish();};
        registration.active.postMessage('shopping-shell-ready',[channel.port2]);
      };
      const timer = setTimeout(()=>finish(Error('The offline list could not be prepared.')),15000);
      const interval = setInterval(probe,500);
      function finish(error?:Error) {port?.close();clearTimeout(timer);clearInterval(interval);error?reject(error):resolve();}
      probe();
    });
  })().catch(error => {prepared=undefined;throw error;});
  return prepared;
}

// Versions are checked on the write itself. An ambiguous retry can observe the
// desired value, but cannot recreate a deleted row or overwrite a later edit.
export async function syncTrip(trip:Trip) {
  const initial = slot();
  if (!initial || initial.user !== trip.user || !navigator.onLine) return;
  const client = supabase;
  const valid = () => client === supabase && slot()?.user === trip.user && savedTrip()?.home === trip.home;
  const signal = () => AbortSignal.timeout(10000);
  return navigator.locks.request(initial.lock + ':sync', {ifAvailable:true}, async lock => {
    if (!lock || !valid()) return;
    const {data:auth,error:authError} = await client.auth.getSession();
    if (authError || auth.session?.user.id !== trip.user || !valid()) throw Error('Reconnect and sign in to sync your changes.');
    const membership = await client.from('household_members').select('household_id')
      .eq('user_id',trip.user).eq('household_id',trip.home).abortSignal(signal()).maybeSingle();
    if (membership.error) throw membership.error;
    if (!valid()) return;
    if (!membership.data) { forgetShopping(); return; }
    const transition = await client.rpc('household_transition_active',{hid:trip.home}).abortSignal(signal());
    if (transition.error) throw transition.error;
    if (transition.data) throw Error('Finish your household transfer before syncing purchases.');
    for (const id of Object.keys(savedTrip()?.picks || {})) {
      if (!valid() || !navigator.onLine) return;
      let pick:Intent|undefined, retry=false;
      // Persist the exact attempted payload before sending. Later local edits
      // cannot change the meaning of a retry after a lost acknowledgement.
      await edit(trip.user,current=>{
        const pending=current?.home===trip.home?current.picks[id]:null;
        if(!pending||pending.conflict)return current;
        retry=!!pending.attempt;
        if(!pending.attempt)pending.attempt={done:pending.done,draft:pending.draft,
          version:pending.version,create:pending.create,token:pending.token};
        pick=pending.attempt;
        return current;
      });
      if(!pick||!valid())continue;
      const attempt=pick;
      const payload={...attempt.draft,...(attempt.done===undefined?{}:{done:attempt.done})};
      // An uncertain insert is only read back. If it vanished, ask before adding
      // it anew; retrying an insert could resurrect an item someone removed.
      const result = attempt.create ? retry ? {data:null,error:null} :
        await client.from('household_items').insert({...payload,id,household_id:trip.home,kind:'grocery',person:'Everyone'})
          .select(fields).abortSignal(signal()).maybeSingle() :
        await client.from('household_items').update(payload)
          .eq('household_id',trip.home).eq('kind','grocery').eq('id',id).eq('reminder_version',attempt.version)
          .select(fields).abortSignal(signal()).maybeSingle();
      if (result.error) throw result.error;
      let server = result.data;
      if (!server) {
        const latest = await client.from('household_items').select(fields)
          .eq('household_id',trip.home).eq('kind','grocery').eq('id',id).abortSignal(signal()).maybeSingle();
        if (latest.error) throw latest.error;
        server = latest.data;
      }
      if (!valid()) return;
      await edit(trip.user, current => {
        if (!current || current.home !== trip.home) return current;
        const pending = current.picks[id];
        const name = current.rows.find(item => item.id === id)?.title || 'Grocery item';
        const matches=server&&Object.entries(payload).every(([key,value])=>
          key==='done'?!!server.done===value:((server as Record<string,unknown>)[key]??null)===(value??null));
        // A checkmark acknowledgement proves nothing about item details. If a
        // new draft was saved while that acknowledgement was lost, review it
        // before rebasing it onto details another device may have changed.
        const uncertainDraft=!result.data&&pending?.draft&&!attempt.draft&&pending.token!==attempt.token;
        if (!server || (!matches && !result.data) || uncertainDraft) {
          if(pending?.draft){pending.conflict={server:server?shoppingItem(server):null};delete pending.attempt;}
          else{
            current.notices.push(server ? name + ' changed on another device. Review it before checking it again.' : name + ' was removed from the shared list.');
            delete current.picks[id];
          }
        } else if (pending?.token === attempt.token) delete current.picks[id];
        else if (pending) {pending.version=server.reminder_version;pending.create=false;delete pending.attempt;}
        if (server) current.rows = current.rows.map(row => row.id === id ? shoppingItem(server) : row);
        else if(!current.picks[id]) current.rows = current.rows.filter(row => row.id !== id);
        return current;
      });
    }
    if (!valid()) return;
    const fresh = await client.from('household_items').select(fields).eq('household_id',trip.home)
      .eq('kind','grocery').order('created_at').abortSignal(signal());
    if (fresh.error) throw fresh.error;
    if (!valid()) return;
    await edit(trip.user, current => current?.home === trip.home ?
      {...current, rows:mergeRows(fresh.data.map(shoppingItem),current), saved:Date.now()} : current);
    return true;
  });
}
