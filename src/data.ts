import type {ReminderDraft,ReminderItem} from './taskReminders';
import {supabase} from './supabase';
export type HouseholdPerson={id:string;household_id:string;display_name:string;calendar_color:string;linked_user_id:string|null};
export type Member={user_id:string;display_name:string;role:string;household_id:string;calendar_color?:string|null};
export async function loadHousehold(id:string){
 const [items,home,members,people]=await Promise.all([supabase.from('household_items').select('*').eq('household_id',id).order('created_at'),supabase.from('households').select('calendar_id,name').eq('id',id).single(),supabase.from('household_members').select('*').eq('household_id',id).order('joined_at'),supabase.from('household_people').select('*').eq('household_id',id).order('created_at')]);
 if(items.error)throw items.error;if(home.error)throw home.error;if(members.error)throw members.error;if(people.error)throw people.error;
 return {items:items.data.map(x=>({...x,due:x.due||'',done:x.done?1:0,createdAt:x.created_at})),calendarId:home.data.calendar_id,householdName:home.data.name,people:people.data as HouseholdPerson[],members:members.data as Member[]};
}
type Change={action:string;id?:string;value?:string;kind?:string;title?:string;category?:string;person?:string;due?:string;done?:boolean;version?:number;reminder?:ReminderDraft;current?:ReminderItem|null};
export async function changeHousehold(id:string,body:unknown){
 const b=body as Change;let result;
 if(b.action==='setting')result=await supabase.from('households').update({calendar_id:b.value?.trim()||''}).eq('id',id).select('id').single();
 else if(b.action==='add')result=await supabase.from('household_items').insert({household_id:id,kind:b.kind,title:b.title?.trim(),category:b.category,person:b.person,due:b.due||null}).select('id').single();
 else if(b.action==='save_reminder'){if(!b.reminder)throw Error('Check your reminder.');const draft={...b.reminder,due:b.reminder.due||null};result=b.current?await supabase.from('household_items').update(draft).eq('household_id',id).eq('kind','task').eq('id',b.current.id).eq('reminder_version',b.current.reminder_version||1).select('id').maybeSingle():await supabase.from('household_items').insert({...draft,kind:'task',household_id:id}).select('id').single();}
 else if(b.action==='toggle'&&b.version!==undefined)result=await supabase.from('household_items').update({done:b.done}).eq('household_id',id).eq('id',b.id!).eq('reminder_version',b.version).select('id').maybeSingle();
 else if(b.action==='toggle')result=await supabase.from('household_items').update({done:b.done}).eq('household_id',id).eq('id',b.id!).select('id').single();
 else if(b.action==='delete')result=await supabase.from('household_items').delete().eq('household_id',id).eq('id',b.id!).select('id').single();
 else throw Error('Unknown change');
 if(result.error)throw result.error;if(!result.data)throw Error('This reminder changed on another device. Refresh before trying again.');
}
