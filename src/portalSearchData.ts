import {supabase} from './supabase';
import type {ActivityKind} from './householdActivityData';
import type {ReminderItem} from './taskReminders';

export type SearchPage='Home'|'Calendar'|'Groceries'|'Reminders'|'Meals'|'Notes'|'Household'|'Week'|'Settings';
export const searchPages:Record<SearchPage,string>={Home:'Home',Calendar:'Calendar',Groceries:'Groceries',Reminders:'To Do & Reminders',Meals:'Meal planner',Notes:'Family notes',Household:'Household',Week:'Week ahead',Settings:'Settings & help'};
export type PortalResult={id:string;kind:ActivityKind|'member'|'page';page:SearchPage;title:string;detail:string;text:string;peopleIds?:string[]};
type Row=Record<string,unknown>;
type Source={table:string;fields:string;page:SearchPage;kind:PortalResult['kind'];key?:string};
const sources:Source[]=[
  {table:'household_items',fields:'id,household_id,kind,title,category,person,due,done,grocery_quantity,grocery_unit,grocery_store',page:'Groceries',kind:'grocery'},
  {table:'household_grocery_staples',fields:'id,household_id,title,category',page:'Groceries',kind:'staple'},
  {table:'household_events',fields:'id,household_id,title,description,location,person,person_ids,starts_at,start_date,recurrence,exceptions',page:'Calendar',kind:'event'},
  {table:'household_notes',fields:'id,household_id,title,body',page:'Notes',kind:'note'},
  {table:'household_meal_plans',fields:'id,household_id,title,instructions,ingredients,meal_date,meal_type',page:'Meals',kind:'meal_plan'},
  {table:'household_meal_recipes',fields:'id,household_id,title,instructions,ingredients',page:'Meals',kind:'meal_recipe'},
  {table:'household_people',fields:'id,household_id,display_name',page:'Household',kind:'profile'},
  {table:'household_members',fields:'user_id,household_id,display_name',page:'Household',kind:'member',key:'user_id'}
];
const str=(value:unknown)=>typeof value==='string'?value:'';
const join=(parts:unknown[])=>parts.map(value=>typeof value==='number'?String(value):str(value)).filter(Boolean).join(' · ');
const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
function result(row:Row,source:Source):PortalResult {
  const kind=source.table==='household_items'?(row.kind==='task'?'task':'grocery'):source.kind;
  const page=kind==='task'?'Reminders':source.page;
  const title=str(row.title)||str(row.display_name)||'Untitled';
  const ingredients=Array.isArray(row.ingredients)?row.ingredients.map(i=>str(i?.title)).join(' '):'';
  const exceptions=row.exceptions&&typeof row.exceptions==='object'?Object.values(row.exceptions).map(e=>e&&typeof e==='object'?join([(e as Row).title,(e as Row).description,(e as Row).location]):'').join(' '):'';
  const date=str(row.start_date)||str(row.starts_at).slice(0,10);
  const detail=kind==='grocery'?join([row.category,row.grocery_quantity,row.grocery_unit,row.grocery_store,row.done?'Picked up':'On the list']):
    kind==='task'?join([row.person,row.due,row.done?'Completed':'To do']):
    kind==='staple'?join(['Staple',row.category]):kind==='event'?join([date,row.location,Array.isArray(row.recurrence)&&row.recurrence.length?'Repeating event':'']):
    kind==='meal_plan'?join([row.meal_date,row.meal_type]):kind==='meal_recipe'?'Saved meal':kind==='note'?'Note':'Family profile';
  return {id:str(row[source.key||'id']),kind,page,title,detail,
    peopleIds:Array.isArray(row.person_ids)?row.person_ids.filter(id=>typeof id==='string'):undefined,
    text:join([title,detail,row.person,row.body,row.description,row.instructions,ingredients,exceptions])};
}
export function localGroceryResults(items:ReminderItem[]):PortalResult[] {
  return items.filter(item=>item.kind==='grocery').map(item=>result(item as unknown as Row,sources[0]));
}
// Read only the selected household under the caller's existing RLS permissions.
// Search text stays local: no query syntax is built from user-entered text.
export async function loadPortalIndex(householdId:string,signal:AbortSignal) {
  const client=supabase;
  const sections=await Promise.allSettled(sources.map(async source=>{
    const rows:PortalResult[]=[];let after:string|undefined;
    for(let page=0;page<50;page++){
      let query=client.from(source.table).select(source.fields).eq('household_id',householdId)
        .order(source.key||'id').limit(200).abortSignal(signal);
      if(after)query=query.gt(source.key||'id',after);
      const response=await query;
      if(response.error)throw response.error;
      if(!Array.isArray(response.data))throw Error('Search could not finish loading.');
      const data=response.data as unknown as Row[];
      rows.push(...data.filter(row=>row.household_id===householdId).map(row=>result(row,source)));
      if(data.length<200)return rows;
      const next=str(data.at(-1)?.[source.key||'id']);
      if(!next||next===after)throw Error('Search could not finish loading.');
      after=next;
    }
    throw Error('Too many items to load.');
  }));
  if(signal.aborted||client!==supabase)throw Error('Search cancelled.');
  const rows:PortalResult[]=[],unavailable=new Set<SearchPage>();
  sections.forEach((section,index)=>{
    if(section.status==='fulfilled')rows.push(...section.value);
    else {unavailable.add(sources[index].page);if(sources[index].table==='household_items')unavailable.add('Reminders');}
  });
  const people=new Map(rows.filter(row=>row.kind==='profile'||row.kind==='member').map(row=>[row.id,row.title]));
  for(const row of rows)if(row.peopleIds?.length)row.text+=' '+row.peopleIds.map(id=>people.get(id)||'').join(' ');
  return {rows,unavailable:[...unavailable]};
}
export function searchPortal(rows:PortalResult[],query:string) {
  const terms=fold(query.trim()).split(/\s+/).filter(Boolean);
  if(!terms.length)return [];
  return rows.filter(row=>terms.every(term=>fold(row.text).includes(term)))
    .sort((a,b)=>Number(fold(b.title).startsWith(fold(query.trim())))-Number(fold(a.title).startsWith(fold(query.trim())))||a.title.localeCompare(b.title));
}
export function portalPages():PortalResult[] {
  return [...(Object.keys(searchPages) as SearchPage[]).map(page=>({id:page,kind:'page' as const,page,title:searchPages[page],detail:'Open page',text:searchPages[page]})),
    ...[{id:'feedback',title:'Send Feedback',text:'Send Feedback new feature suggestion'},{id:'help',title:'Help & getting started',text:'Help getting started install HH'},{id:'notifications',title:'Notifications',text:'Notification preferences push reminders'}]
      .map(row=>({...row,kind:'page' as const,page:'Settings' as const,detail:'Open settings page'}))];
}
