import {supabase} from './supabase';

export const groceryCategories=['Produce','Dairy & eggs','Deli','Meat & fish','Bakery','Pantry','Frozen','Household','Other'] as const;
export type GroceryStaple={id:string;household_id:string;title:string;category:string;created_at:string};
export type GroceryStapleDraft={title:string;category:string};
const fields='id,household_id,title,category,created_at';
export function normalizeGroceryTitle(title:string){return title.trim().replace(/\s+/g,' ').toLowerCase()}
function stapleError(error:{code?:string;message?:string}){return Error(error.code==='23505'?'This item is already saved in your household’s staples.':error.message||'Could not save your staples.');}

export async function loadGroceryStaples(hid:string):Promise<GroceryStaple[]>{
 const result=await supabase.from('household_grocery_staples').select(fields).eq('household_id',hid).order('title');
 if(result.error)throw stapleError(result.error);
 return result.data as GroceryStaple[];
}
export async function saveGroceryStaple(hid:string,draft:GroceryStapleDraft,id?:string):Promise<GroceryStaple>{
 const title=draft.title.trim().replace(/\s+/g,' ');
 if(!title||title.length>160)throw Error('Enter an item name of up to 160 characters.');
 if(!groceryCategories.some(category=>category===draft.category))throw Error('Choose a grocery category.');
 const value={title,category:draft.category};
 const result=id?await supabase.from('household_grocery_staples').update(value).eq('household_id',hid).eq('id',id).select(fields).maybeSingle():await supabase.from('household_grocery_staples').insert({household_id:hid,...value}).select(fields).single();
 if(result.error)throw stapleError(result.error);
 if(!result.data)throw Error('This staple changed or was removed. Refresh and try again.');
 return result.data as GroceryStaple;
}
export async function deleteGroceryStaple(hid:string,id:string):Promise<void>{
 const result=await supabase.from('household_grocery_staples').delete().eq('household_id',hid).eq('id',id).select('id').maybeSingle();
 if(result.error)throw stapleError(result.error);
 if(!result.data)throw Error('This staple changed or was removed. Refresh and try again.');
}
export async function addGroceryStaples(hid:string,ids:string[]):Promise<{added:number;skipped:number}>{
 const selected=[...new Set(ids)];
 if(!selected.length||selected.length>100)throw Error('Choose between 1 and 100 staples.');
 const result=await supabase.rpc('add_grocery_staples',{hid,staple_ids:selected});
 if(result.error)throw stapleError(result.error);
 if(!result.data||!Number.isInteger(result.data.added)||!Number.isInteger(result.data.skipped))throw Error('Could not confirm the shopping list update. Refresh before trying again.');
 return {added:result.data.added,skipped:result.data.skipped};
}
