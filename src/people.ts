import type {Member,HouseholdPerson} from './data';
import type {FamilyEvent} from './calendarData';
export type PersonProfile={id:string;name:string;color:string;aliases?:string[]};
export const COLOR_CHOICES=[{name:'Rose',value:'#C46B8C'},{name:'Blue',value:'#467EB6'},{name:'Orange',value:'#E78725'},{name:'Green',value:'#57947C'},{name:'Lavender',value:'#9273BC'},{name:'Teal',value:'#328C94'},{name:'Red',value:'#C65757'},{name:'Gold',value:'#B18B35'}];
export const safeColor=(color?:string|null)=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)?color:null;
const normalized=(s:string)=>s.trim().toLowerCase();
export function defaultColor(name:string,id=name){let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return COLOR_CHOICES[h%COLOR_CHOICES.length].value}
export function familyProfiles(members:Member[],people:HouseholdPerson[]=[]):PersonProfile[]{
 const profiles:PersonProfile[]=members.map(m=>({id:m.user_id,name:m.display_name,color:safeColor(m.calendar_color)||defaultColor(m.display_name,m.user_id),aliases:people.filter(p=>p.linked_user_id===m.user_id).map(p=>p.id)}));
 for(const p of people)if(!p.linked_user_id||!profiles.some(m=>m.id===p.linked_user_id))profiles.push({id:p.id,name:p.display_name,color:safeColor(p.calendar_color)||defaultColor(p.display_name,p.id)});
 return profiles;
}
export function isEveryone(event:Pick<FamilyEvent,'person'|'person_ids'>){return Array.isArray(event.person_ids)?event.person_ids.length===0:normalized(event.person)==='everyone'}
export function eventPeople(event:Pick<FamilyEvent,'person'|'person_ids'>,profiles:PersonProfile[]):PersonProfile[]{
 if(isEveryone(event))return profiles;
 if(Array.isArray(event.person_ids))return Array.from(new Map(event.person_ids.map(id=>{const p=profiles.find(p=>p.id===id||p.aliases?.includes(id));return[p?.id||id,p||{id,name:'Family member',color:'#8B7881'}] as const})).values());
 const label=normalized(event.person);const exact=profiles.filter(p=>normalized(p.name)===label);const first=profiles.filter(p=>normalized(p.name).split(/\s+/)[0]===label);
 return exact.length?exact:first.length===1?first:[{id:'legacy:'+event.person,name:event.person,color:defaultColor(event.person)}];
}
export function selectedPeople(event:FamilyEvent|null,profiles:PersonProfile[]){return !event||isEveryone(event)?[]:eventPeople(event,profiles).filter(p=>profiles.some(person=>person.id===p.id)).map(p=>p.id)}
export function matchesPerson(event:Pick<FamilyEvent,'person'|'person_ids'>,personId:string,profiles:PersonProfile[]){return personId==='all'||isEveryone(event)||eventPeople(event,profiles).some(p=>p.id===personId||p.aliases?.includes(personId))}
export function personLabel(ids:string[],profiles:PersonProfile[]){if(!ids.length)return 'Everyone';const text=profiles.filter(p=>ids.includes(p.id)).map(p=>p.name).join(', ');return text.length<=60?text:'Family members'}
