import {supabase} from './supabase';
import {groceryCategories} from './groceryStaplesData';

export const mealTypes=['breakfast','lunch','supper','snacks'] as const;
export type MealType=typeof mealTypes[number];
export const mealTypeLabels:Record<MealType,string>={breakfast:'Breakfast',lunch:'Lunch',supper:'Supper',snacks:'Snacks'};
export type MealIngredient={id:string;title:string;category:string;quantity?:number|null;unit?:string|null};
export type MealContentDraft={title:string;instructions:string;source_url:string;ingredients:MealIngredient[]};
export type SavedMeal=MealContentDraft&{id:string;household_id:string;created_at:string;updated_at:string;version:number};
export type MealPlan=SavedMeal&{meal_date:string;meal_type:MealType};
export type MealPlanDraft=MealContentDraft&{meal_date:string;meal_type:MealType};
export type MealIngredientSelection={meal_id:string;version:number;ingredient_ids:string[]};
export class MealConflictError extends Error{
 constructor(message='This meal was changed or removed by someone in your household. Review the latest version before trying again.'){super(message);this.name='MealConflictError'}
}
export class MealCreationConflictError extends Error{
 constructor(){super('This save may already have completed with different details. Close this form and review your meal plan before adding it again.');this.name='MealCreationConflictError'}
}
const fields='id,household_id,title,instructions,source_url,ingredients,created_at,updated_at,version';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Table='household_meal_recipes'|'household_meal_plans';
const tableFields=(table:Table)=>fields+(table==='household_meal_plans'?',meal_date,meal_type':'');
const failure=(error:{message?:string;code?:string})=>{
 if(error.message?.startsWith('Meal plan changed.'))return new MealConflictError('A meal plan changed. Refresh and choose its ingredients again.');
 return Error(error.message||'Could not load or save your meals.');
};
export const sortSavedMeals=(meals:SavedMeal[])=>[...meals].sort((a,b)=>a.title.localeCompare(b.title,'en-CA')||a.id.localeCompare(b.id));
export const sortMealPlans=(plans:MealPlan[])=>[...plans].sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||mealTypes.indexOf(a.meal_type)-mealTypes.indexOf(b.meal_type)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
export function validMealDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function dateRange(from:string,to:string){
 if(!validMealDate(from)||!validMealDate(to)||to<=from||Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z')>366*86400000)throw Error('Choose a meal planning range of up to one year.');
}
function content(draft:MealContentDraft):MealContentDraft{
 if(typeof draft.title!=='string'||!draft.title.trim()||draft.title.trim().length>160)throw Error('Give your meal a title of up to 160 characters.');
 if(typeof draft.instructions!=='string'||draft.instructions.length>10000)throw Error('Keep meal instructions within 10,000 characters.');
 if(typeof draft.source_url!=='string')throw Error('Use a full http or https recipe link, or leave it empty.');
 const source_url=draft.source_url.trim();
 if(source_url){
  let valid=false;
  try{const url=new URL(source_url);valid=['http:','https:'].includes(url.protocol)&&!!url.hostname&&!/[\s\u0000-\u0020\u007f\\]/.test(source_url)&&/^https?:\/\//i.test(source_url)}catch{valid=false}
  if(!valid||source_url.length>2048)throw Error('Use a full http or https recipe link, or leave it empty.');
 }
 if(!Array.isArray(draft.ingredients)||draft.ingredients.length>60)throw Error('Keep each meal to 60 ingredient lines or fewer.');
 const seen=new Set<string>();
 const ingredients=draft.ingredients.map(item=>{
  if(!item||typeof item.id!=='string'||!uuid.test(item.id)||seen.has(item.id))throw Error('Check your ingredient lines and try again.');
  if(typeof item.title!=='string'||!item.title.trim()||item.title.trim().length>160)throw Error('Give each ingredient a name of up to 160 characters.');
  if(!groceryCategories.some(category=>category===item.category))throw Error('Choose a grocery category for each ingredient.');
  if(item.unit!=null&&typeof item.unit!=='string')throw Error('Use a unit of up to 30 characters.');
  const quantity=item.quantity??null,unit=item.unit?.trim()||null;
  if(quantity!==null&&(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<=0||quantity>9999||Math.abs(quantity*1000-Math.round(quantity*1000))>0.000001))throw Error('Use an ingredient quantity above zero and up to 9,999, with up to three decimal places.');
  if(unit&&(quantity===null||unit.length>30))throw Error('Add a quantity and a unit of up to 30 characters.');
  seen.add(item.id);return {id:item.id,title:item.title.trim(),category:item.category,...(quantity!==null?{quantity,...(unit?{unit}:{})}:{})};
 });
 return {title:draft.title.trim(),instructions:draft.instructions,source_url,ingredients};
}
async function loadRows<T extends SavedMeal>(table:Table,hid:string,range?:{from:string;to:string}):Promise<T[]>{
 const all:T[]=[];let after:string|undefined;
 while(true){
  let query=supabase.from(table).select(tableFields(table)).eq('household_id',hid).order('id').limit(200);
  if(range)query=query.gte('meal_date',range.from).lt('meal_date',range.to);
  if(after)query=query.gt('id',after);
  const result=await query;if(result.error)throw failure(result.error);
  if(!Array.isArray(result.data))throw Error('Could not finish loading meals. Please try again.');
  const page=result.data as unknown as T[];all.push(...page);
  if(page.length<200)break;
  const next=page.at(-1)?.id;if(!next||next===after)throw Error('Could not finish loading meals. Please try again.');after=next;
 }
 return all;
}
export async function loadSavedMeals(hid:string):Promise<SavedMeal[]>{return sortSavedMeals(await loadRows('household_meal_recipes',hid))}
export async function loadMealPlans(hid:string,from:string,to:string):Promise<MealPlan[]>{dateRange(from,to);return sortMealPlans(await loadRows<MealPlan>('household_meal_plans',hid,{from,to}))}
async function loadOne<T extends SavedMeal>(table:Table,hid:string,id:string):Promise<T|null>{
 const result=await supabase.from(table).select(tableFields(table)).eq('household_id',hid).eq('id',id).maybeSingle();
 if(result.error)throw failure(result.error);return result.data as unknown as T|null;
}
export function loadSavedMeal(hid:string,id:string){return loadOne<SavedMeal>('household_meal_recipes',hid,id)}
export function loadMealPlan(hid:string,id:string){return loadOne<MealPlan>('household_meal_plans',hid,id)}
async function save<T extends SavedMeal>(table:Table,hid:string,value:MealContentDraft|MealPlanDraft,current?:T|null):Promise<T>{
 const result=current?await supabase.from(table).update(value).eq('household_id',hid).eq('id',current.id).eq('version',current.version).select(tableFields(table)).maybeSingle():await supabase.from(table).insert({household_id:hid,...value}).select(tableFields(table)).single();
 if(result.error)throw failure(result.error);if(!result.data)throw new MealConflictError();return result.data as unknown as T;
}
export async function saveSavedMeal(hid:string,draft:MealContentDraft,current?:SavedMeal|null):Promise<SavedMeal>{return save('household_meal_recipes',hid,content(draft),current)}
export async function saveMealPlan(hid:string,draft:MealPlanDraft,current?:MealPlan|null,requestId?:string):Promise<MealPlan>{
 if(!validMealDate(draft.meal_date))throw Error('Choose a valid meal date.');
 if(!mealTypes.includes(draft.meal_type))throw Error('Choose breakfast, lunch, supper or snacks.');
 const value={...content(draft),meal_date:draft.meal_date,meal_type:draft.meal_type};
 if(current)return save('household_meal_plans',hid,value,current);
 const id=requestId??crypto.randomUUID();
 if(typeof id!=='string'||!uuid.test(id))throw Error('Could not identify this meal save. Close the form and try again.');
 const result=await supabase.from('household_meal_plans').insert({id,household_id:hid,...value}).select(tableFields('household_meal_plans')).single();
 if(result.error?.code==='23505'){
  // An earlier request may have committed even when its response was lost.
  // Read only this household's exact ID; never overwrite or adopt other data.
  const existing=await loadMealPlan(hid,id);
  if(existing&&existing.meal_date===value.meal_date&&existing.meal_type===value.meal_type&&JSON.stringify(content(existing))===JSON.stringify(content(value)))return existing;
  throw new MealCreationConflictError();
 }
 if(result.error)throw failure(result.error);
 if(!result.data)throw Error('Could not confirm this save. Try again to check the same meal.');
 return result.data as unknown as MealPlan;
}
async function remove(table:Table,hid:string,current:SavedMeal):Promise<void>{
 const result=await supabase.from(table).delete().eq('household_id',hid).eq('id',current.id).eq('version',current.version).select('id').maybeSingle();
 if(result.error)throw failure(result.error);if(!result.data)throw new MealConflictError();
}
export function deleteSavedMeal(hid:string,current:SavedMeal){return remove('household_meal_recipes',hid,current)}
export function deleteMealPlan(hid:string,current:MealPlan){return remove('household_meal_plans',hid,current)}
export async function addMealIngredients(hid:string,selections:MealIngredientSelection[]):Promise<{added:number;skipped:number}>{
 if(!Array.isArray(selections)||!selections.length||selections.length>100)throw Error('Choose between 1 and 100 ingredients.');
 let total=0;const meals=new Set<string>();
 const selected=selections.map(selection=>{
  if(!selection||!uuid.test(selection.meal_id)||meals.has(selection.meal_id)||!Number.isInteger(selection.version)||selection.version<1||selection.version>2147483647||!Array.isArray(selection.ingredient_ids)||!selection.ingredient_ids.length||selection.ingredient_ids.length>60)throw Error('Check your selected meal plans.');
  meals.add(selection.meal_id);const ids=selection.ingredient_ids;
  if(ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids).size!==ids.length)throw Error('Check your selected ingredients.');
  total+=ids.length;return {meal_id:selection.meal_id,version:selection.version,ingredient_ids:[...ids]};
 });
 if(total>100)throw Error('Choose no more than 100 ingredients at a time.');
 const result=await supabase.rpc('add_meal_ingredients',{hid,selections:selected});
 if(result.error)throw failure(result.error);
 // The server combines compatible ingredient lines, so the resulting grocery
 // count can be smaller than the selection count, but must remain in range.
 if(!result.data||!Number.isInteger(result.data.added)||!Number.isInteger(result.data.skipped)||result.data.added<0||result.data.skipped<0||result.data.added+result.data.skipped<1||result.data.added+result.data.skipped>total)throw Error('Could not confirm the grocery update. Refresh the shopping list before trying again.');
 return {added:result.data.added,skipped:result.data.skipped};
}

export function ingredientAmount(item:MealIngredient){return item.quantity==null?'':Number(item.quantity).toLocaleString('en-CA',{maximumFractionDigits:3})+(item.unit?' '+item.unit:'')}
export function ingredientShoppingKey(item:{title:string;quantity?:number|null;unit?:string|null}){return JSON.stringify([item.title.trim().toLowerCase().replace(/\s+/g,' '),item.quantity??null,(item.unit||'').trim().toLowerCase()])}
