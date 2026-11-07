import {supabase} from './supabase';
import type {FamilyEvent} from './calendarData';
import type {FamilyNote} from './familyNotesData';
import type {MealPlan,SavedMeal} from './mealPlannerData';
import type {ReminderItem} from './taskReminders';

export type ActivityKind='grocery'|'task'|'event'|'note'|'meal_plan'|'meal_recipe'|'staple'|'profile';
export type HouseholdChange={id:string;household_id:string;recipient_id:string;actor_id:string|null;actor_name:string;entity_kind:ActivityKind;entity_id:string;action:'added'|'updated'|'completed'|'reopened'|'removed';title:string;entity_date:string|null;created_at:string};
const fields='id,household_id,recipient_id,actor_id,actor_name,entity_kind,entity_id,action,title,entity_date,created_at';
const nouns:Record<ActivityKind,string>={grocery:'a grocery item',task:'a to-do',event:'an event',note:'a family note',meal_plan:'a meal plan',meal_recipe:'a saved meal',staple:'a grocery staple',profile:'a family profile'};
export function changeSummary(change:HouseholdChange){return `${change.actor_name} ${change.action} ${nouns[change.entity_kind]}`}
export function activitySummary(changes:HouseholdChange[]){
 if(!changes.length)return '';
 if(changes.length===1)return changeSummary(changes[0]);
 const actors=new Set(changes.map(change=>change.actor_id||change.actor_name));
 return actors.size===1?`${changes[0].actor_name} made multiple changes`:'Your family made multiple changes';
}
const error=(value:{message?:string})=>Error(value.message||'Could not load your household updates.');
export async function loadHouseholdActivity(hid:string,userId:string):Promise<HouseholdChange[]>{
 const changes:HouseholdChange[]=[];let after:string|undefined;
 for(let page=0;page<50;page++){
  let query=supabase.from('household_activity').select(fields).eq('household_id',hid).eq('recipient_id',userId).order('id').limit(200);
  if(after)query=query.gt('id',after);
  const result=await query;if(result.error)throw error(result.error);
  if(!Array.isArray(result.data))throw Error('Could not finish loading updates. Please try again.');
  const rows=result.data as HouseholdChange[];changes.push(...rows);
  if(rows.length<200)return changes.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  const next=rows.at(-1)?.id;if(!next||next===after)break;after=next;
 }
 throw Error('There are too many updates to load. Please contact HH support.');
}
export async function markHouseholdActivitySeen(hid:string,userId:string,changes:HouseholdChange[]):Promise<void>{
 const ids=[...new Set(changes.filter(change=>change.household_id===hid&&change.recipient_id===userId).map(change=>change.id))];
 // Never clear by time, a maximum ID, or an entire household. In-flight/newly
 // committed changes and every other recipient's unread list must survive.
 for(let offset=0;offset<ids.length;offset+=100){
  const result=await supabase.from('household_activity').delete().eq('household_id',hid).eq('recipient_id',userId).in('id',ids.slice(offset,offset+100));
  if(result.error)throw error(result.error);
 }
}
export type ActivityTarget=
 |{kind:'event';value:FamilyEvent}
 |{kind:'note';value:FamilyNote}
 |{kind:'meal_plan';value:MealPlan}
 |{kind:'meal_recipe';value:SavedMeal}
 |{kind:'grocery'|'task';value:ReminderItem}
 |{kind:'staple'|'profile';value:{id:string}};
export async function loadActivityTarget(hid:string,change:Pick<HouseholdChange,'household_id'|'entity_kind'|'entity_id'|'action'>):Promise<ActivityTarget|null>{
 if(change.household_id!==hid)throw Error('This update belongs to a different home.');
 if(change.action==='removed')return null;
 const tables:Record<ActivityKind,string>={grocery:'household_items',task:'household_items',event:'household_events',note:'household_notes',meal_plan:'household_meal_plans',meal_recipe:'household_meal_recipes',staple:'household_grocery_staples',profile:'household_people'};
 let query=supabase.from(tables[change.entity_kind]).select('*').eq('household_id',hid).eq('id',change.entity_id);
 if(change.entity_kind==='grocery'||change.entity_kind==='task')query=query.eq('kind',change.entity_kind);
 const result=await query.maybeSingle();if(result.error)throw error(result.error);if(!result.data)return null;
 const value=result.data;
 if(change.entity_kind==='event')return {kind:'event',value:{...value,source:'home',recurring:!!value.recurrence?.length} as FamilyEvent};
 if(change.entity_kind==='task'||change.entity_kind==='grocery')return {kind:change.entity_kind,value:{...value,done:value.done?1:0,due:value.due||'',createdAt:value.created_at} as ReminderItem};
 return {kind:change.entity_kind,value} as ActivityTarget;
}
