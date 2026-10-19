import {supabase} from './supabase';
import {googleRequest,type FamilyEvent} from './calendarData';
import {searchParameters,type SearchPeriod} from '../supabase/functions/google-calendar/search';
export type {SearchPeriod};
export type SearchPage={events:FamilyEvent[];nextPageToken:string|null;asOf:string};
export function nativeSearchFilter(query:string){const pattern=JSON.stringify('%'+query.replace(/[\\%_]/g,'\\$&')+'%');return ['title','description','location'].map(field=>field+'.ilike.'+pattern).join(',')}
export async function searchCalendar(householdId:string,connected:boolean,query:string,period:SearchPeriod,pageToken?:string,asOf?:string):Promise<SearchPage>{
 const validated=searchParameters({query,period,pageToken,asOf});
 if(connected)return googleRequest('search',{householdId,query:query.trim(),period,...(pageToken?{pageToken}:{}),asOf:validated.asOf});
 const offset=pageToken?Number(pageToken):0;if(!Number.isInteger(offset)||offset<0)throw Error('Please start the search again.');
 let request=supabase.from('household_events').select('*').eq('household_id',householdId).or(nativeSearchFilter(query.trim())).order('starts_at').order('id').range(offset,offset+50);
 if(period==='upcoming')request=request.gt('ends_at',validated.asOf);
 if(period==='past')request=request.lt('starts_at',validated.asOf);
 const result=await request;if(result.error)throw result.error;return {events:result.data.slice(0,50).map(e=>({...e,source:'home' as const})),nextPageToken:result.data.length>50?String(offset+50):null,asOf:validated.asOf};
}
