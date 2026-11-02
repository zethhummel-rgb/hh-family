import {supabase} from './supabase';
import {transitionActive} from './data';
import {groceryCategories} from './groceryStaplesData';
import type {ReminderItem} from './taskReminders';

export type GroceryDraft={title:string;category:string;grocery_quantity:number|null;grocery_unit:string|null;grocery_store:string|null};
export type GroceryGrouping='department'|'store';
export function groceryGroups(items:ReminderItem[],mode:GroceryGrouping){
 const open=items.filter(item=>item.kind==='grocery'&&!item.done);
 if(mode==='department')return groceryCategories.map(category=>({key:category,title:category,items:open.filter(item=>(groceryCategories.some(value=>value===item.category)?item.category:'Other')===category)})).filter(group=>group.items.length);
 const groups=new Map<string,{key:string;title:string;items:ReminderItem[]}>();
 for(const item of open){
  const store=item.grocery_store?.trim()||'',key=store.toLowerCase();
  if(!groups.has(key))groups.set(key,{key,title:store||'No store set',items:[]});
  groups.get(key)!.items.push(item);
 }
 return [...groups.values()].sort((a,b)=>!a.key?1:!b.key?-1:a.title.localeCompare(b.title,'en-CA')).map(group=>({...group,items:[...group.items].sort((a,b)=>groceryCategories.findIndex(value=>value===a.category)-groceryCategories.findIndex(value=>value===b.category)||a.title.localeCompare(b.title,'en-CA'))}));
}
export function groceryDetails(item:Pick<ReminderItem,'grocery_quantity'|'grocery_unit'|'grocery_store'>){
 const quantity=item.grocery_quantity==null?'':Number(item.grocery_quantity).toLocaleString('en-CA',{maximumFractionDigits:3})+(item.grocery_unit?' '+item.grocery_unit:'');
 return [quantity,item.grocery_store].filter(Boolean).join(' · ');
}
export function groceryMatches(item:ReminderItem,query:string,store:string){
 const key=(item.grocery_store||'').trim().toLowerCase();
 return (store==='all'||store==='none'&&!key||store==='store:'+key)&&[item.title,item.grocery_store||''].some(value=>value.toLowerCase().includes(query.trim().toLowerCase()));
}
export function validateGrocery(draft:GroceryDraft):GroceryDraft{
 const title=draft.title.trim(),unit=draft.grocery_unit?.trim()||null,store=draft.grocery_store?.trim()||null,q=draft.grocery_quantity;
 if(!title||title.length>160)throw Error('Enter an item name of up to 160 characters.');
 if(!groceryCategories.some(category=>category===draft.category))throw Error('Choose a grocery category.');
 if(q!==null&&(!Number.isFinite(q)||q<=0||q>9999||Math.abs(q*1000-Math.round(q*1000))>0.000001))throw Error('Use a quantity above zero and up to 9,999, with up to three decimal places.');
 if(unit&&(q===null||unit.length>30))throw Error('Add a quantity and a unit of up to 30 characters, or leave the unit empty.');
 if(store&&store.length>80)throw Error('Keep the store name within 80 characters.');
 return {title,category:draft.category,grocery_quantity:q,grocery_unit:unit,grocery_store:store};
}
export async function saveGrocery(hid:string,draft:GroceryDraft,current:ReminderItem|null,requestId:string,addBack=false){
 const value=validateGrocery(draft);
 if(await transitionActive(hid))throw Error('Finish your household transfer before changing grocery details. Your existing shopping list remains available.');
 const result=current?await supabase.from('household_items').update({...value,...(addBack?{done:false}:{})}).eq('household_id',hid).eq('kind','grocery').eq('id',current.id).eq('reminder_version',current.reminder_version||1).select('id').maybeSingle():await supabase.from('household_items').insert({...value,id:requestId,household_id:hid,kind:'grocery',person:'Everyone'}).select('id').single();
 if(result.error)throw Error(result.error.message||'Could not save this grocery item.');
 if(!result.data)throw Error('This item changed or was removed by someone in your household. Close this form and refresh before editing again.');
}
