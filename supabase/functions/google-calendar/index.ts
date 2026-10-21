import {reminderMinutes,readReminder} from './reminders.ts';
import {encodePersonIds,decodePersonIds} from './tags.ts';
import {searchParameters} from './search.ts';
import {validateRecurrence} from './recurrence.ts';
import {importNativeExceptions} from './nativeImport.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const APP=Deno.env.get('APP_URL')||'https://zethhummel-rgb.github.io/hh-family/';
const ORIGIN=new URL(APP).origin;
const PROJECT=Deno.env.get('SUPABASE_URL')!;
const ID=Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')||'';
const SECRET=Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')||'';
const CALLBACK=PROJECT+'/functions/v1/google-calendar/callback';
const admin=createClient(PROJECT,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
async function service(action:string,payload:Record<string,unknown>){const r=await admin.rpc('calendar_service',{action,payload});if(r.error)throw Error('Calendar connection storage is unavailable.');return r.data;}
async function google(access:string,path:string,method='GET',body?:unknown,etag?:string){
 const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined});
 if(r.status===204)return null;
 const data=await r.json();
 if(!r.ok){if(r.status===412)throw Error('This event changed in Google Calendar. Refresh and try again.');if(r.status===409)throw Error('This event may already have been saved. Refresh the calendar before trying again.');if(r.status===401||r.status===403)throw Error('Google Calendar permission is unavailable. The household owner needs to reconnect Google.');throw Error('Google Calendar could not complete this request. Please refresh before retrying a change.');}
 return data;
}
async function accessToken(connection:any){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:ID,client_secret:SECRET,refresh_token:connection.refreshToken,grant_type:'refresh_token'})});
 const d=await r.json();if(!r.ok||!d.access_token)throw Error('Google connection needs renewing. The household owner can reconnect Google.');return d.access_token as string;
}
function toGoogle(e:any){
 if(e?.reminder_30_enabled!==undefined&&typeof e.reminder_30_enabled!=='boolean')throw Error('Choose whether the 30-minute notification is on.');
 if(!e||typeof e!=='object')throw Error('Check the event details.');
 if(typeof e.title!=='string'||!e.title.trim()||e.title.length>160||typeof e.description!=='string'||e.description.length>4000||typeof e.location!=='string'||e.location.length>300||typeof e.person!=='string'||!e.person||e.person.length>60)throw Error('Check the event name, notes, location, and person.');
 if(!e.starts_at||!e.ends_at||!Number.isFinite(Date.parse(e.starts_at))||!Number.isFinite(Date.parse(e.ends_at))||new Date(e.ends_at)<=new Date(e.starts_at))throw Error('The end time must be after the start time.');
 if(typeof e.all_day!=='boolean')throw Error('Invalid event type.');
 if(e.all_day&&(!/^\d{4}-\d{2}-\d{2}$/.test(e.start_date)||!/^\d{4}-\d{2}-\d{2}$/.test(e.end_date)||e.end_date<=e.start_date))throw Error('Check the all-day event dates.');
 return {summary:e.title.trim(),description:e.description,location:e.location,start:e.all_day?{date:e.start_date}:{dateTime:e.starts_at,timeZone:'America/Toronto'},end:e.all_day?{date:e.end_date}:{dateTime:e.ends_at,timeZone:'America/Toronto'},extendedProperties:{shared:{hummel_person:e.person,...(e.reminder_30_enabled!==undefined?{hummel_reminder_30:e.reminder_30_enabled?'on':'off'}:{}),...(e.reminder_minutes!==undefined?{hummel_reminder:String(reminderMinutes(e.reminder_minutes)??'')} : {}),...(e.person_ids!=null?{hummel_people:encodePersonIds(e.person_ids)}:{})}},...(e.recurrence!==undefined?{recurrence:validateRecurrence(e.recurrence,e.all_day?e.start_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.starts_at)),e.all_day)}:{})};
}
function fromGoogle(e:any){const all_day=!!e.start?.date;return {id:e.id,title:e.summary||'(Untitled event)',description:e.description||'',location:e.location||'',person:e.extendedProperties?.shared?.hummel_person||'Everyone',person_ids:decodePersonIds(e.extendedProperties?.shared?.hummel_people),reminder_minutes:readReminder(e.extendedProperties?.shared?.hummel_reminder),reminder_30_enabled:e.extendedProperties?.shared?.hummel_reminder_30!=='off',starts_at:e.start?.dateTime||e.start?.date+'T00:00:00Z',ends_at:e.end?.dateTime||e.end?.date+'T00:00:00Z',all_day,start_date:e.start?.date||null,end_date:e.end?.date||null,etag:e.etag,source:'google',recurring:!!(e.recurringEventId||e.recurrence?.length),series_id:e.recurringEventId||null,recurrence:e.recurrence||undefined};}
const redirect=(ok:boolean,message='')=>{const u=new URL(APP);u.searchParams.set('calendar_connection',ok?'connected':'error');if(message)u.searchParams.set('calendar_message',message.slice(0,200));return Response.redirect(u,303)};
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url);
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method==='GET'&&url.pathname.endsWith('/callback')){
  try{
   const state=url.searchParams.get('state');if(!state||state.length>200)return redirect(false,'Google connection expired. Please try connecting again.');
   const record=await service('state_take',{hash:await hash(state)});if(!record)return redirect(false,'Google connection expired. Please try connecting again.');
   if(url.searchParams.has('error'))return redirect(false,'Google Calendar permission was not granted.');
   const code=url.searchParams.get('code');if(!code||!ID||!SECRET)return redirect(false,'Google connection is not configured yet.');
   const member=await admin.from('households').select('owner_id,name').eq('id',record.household_id).single();if(member.error||member.data.owner_id!==record.user_id)return redirect(false,'Only the current household owner can connect Google.');
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:ID,client_secret:SECRET,code,code_verifier:record.verifier,redirect_uri:CALLBACK,grant_type:'authorization_code'})});
   const tokens=await response.json();if(!response.ok||!tokens.access_token||!tokens.refresh_token)return redirect(false,'Google did not grant an ongoing connection. Please reconnect and allow calendar access.');
   const old=await service('connection_get',{householdId:record.household_id});let calendar;
   if(old){try{calendar=await google(tokens.access_token,'calendars/'+encodeURIComponent(old.calendarId))}catch{return redirect(false,'Reconnect using the Google account that owns your existing family calendar.');}}
   if(!calendar)calendar=await google(tokens.access_token,'calendars','POST',{summary:member.data.name+' · Family',description:'Family plans shared through HH.',timeZone:'America/Toronto'});
   await service('connection_set',{householdId:record.household_id,userId:record.user_id,calendarId:calendar.id,refreshToken:tokens.refresh_token});
   if(old?.migrationComplete){await service('migration_done',{householdId:record.household_id});return redirect(true);}
   // Existing native events are copied only as part of this explicit Connect action.
   const native=await admin.from('household_events').select('*').eq('household_id',record.household_id).limit(1001);if(native.error||native.data.length>1000)return redirect(false,'Google connected. Existing event import needs attention; your HH events are preserved.');
   for(const e of native.data){const eventId='home'+e.id.replaceAll('-','');let exists=false;try{const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar.id)+'/events/'+eventId,{headers:{Authorization:'Bearer '+tokens.access_token}});exists=r.ok;if(!r.ok&&r.status!==404)throw Error('Import check failed')}catch{return redirect(false,'Google connected, but the existing event import could not finish. Reconnect to retry safely.');}
    if(!exists)await google(tokens.access_token,'calendars/'+encodeURIComponent(calendar.id)+'/events','POST',{...toGoogle(e),id:eventId});
    if(e.recurrence?.length)await importNativeExceptions(e,'calendars/'+encodeURIComponent(calendar.id)+'/events/'+eventId,(path,method,body)=>google(tokens.access_token,path,method,body),toGoogle);
   }
   await service('migration_done',{householdId:record.household_id});return redirect(true);
  }catch{return redirect(false,'Google Calendar could not finish connecting. Your existing household events are preserved.');}
 }
 if(req.method!=='POST')return json({error:'Not found'},404);
 if(req.headers.get('origin')!==ORIGIN)return json({error:'Invalid request origin'},403);
 try{
  const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!bearer)return json({error:'Sign in first'},401);
  const auth=await admin.auth.getUser(bearer);if(auth.error||!auth.data.user)return json({error:'Sign in again to open the calendar'},401);
  const b=await req.json();if(typeof b.householdId!=='string'||!/^[a-f0-9-]{36}$/.test(b.householdId))return json({error:'Invalid household'},400);
  const membership=await admin.from('household_members').select('role').eq('household_id',b.householdId).eq('user_id',auth.data.user.id).maybeSingle();if(membership.error||!membership.data)return json({error:'This household is not available to your account'},403);
  const connection=await service('connection_get',{householdId:b.householdId});
  if(b.action==='status')return json({configured:!!(ID&&SECRET),connected:!!connection&&connection.migrationComplete,setupRequired:!(ID&&SECRET),importIncomplete:!!connection&&!connection.migrationComplete});
  if(b.action==='start'){
   if(membership.data.role!=='owner')return json({error:'Only the household owner can connect Google'},403);
   if(!ID||!SECRET)return json({error:'Google connection needs its one-time Google Cloud setup. Your HH calendar already works and saves family events.'},409);
   const state=random(),verifier=random(),challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   await service('state_create',{hash:await hash(state),verifier,userId:auth.data.user.id,householdId:b.householdId});
   const googleUrl=new URL('https://accounts.google.com/o/oauth2/v2/auth');googleUrl.search=new URLSearchParams({client_id:ID,redirect_uri:CALLBACK,response_type:'code',scope:'https://www.googleapis.com/auth/calendar.app.created',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();return json({url:googleUrl.toString()});
  }
  if(!ID||!SECRET||!connection?.migrationComplete)return json({error:'Google is not connected. Your HH calendar is still available.'},409);
  const access=await accessToken(connection),base='calendars/'+encodeURIComponent(connection.calendarId)+'/events';
  if(b.action==='search'){
   const {params,asOf}=searchParameters(b);const result=await google(access,base+'?'+params);
   return json({events:(result.items||[]).filter((e:any)=>e.status!=='cancelled').map(fromGoogle),nextPageToken:result.nextPageToken||null,asOf});
  }
  if(b.action==='events'){
   const from=Date.parse(b.from),to=Date.parse(b.to);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>1000*60*60*24*120)return json({error:'Choose a calendar range up to 120 days'},400);
   const events=[];let pageToken='';do{const params=new URLSearchParams({timeMin:new Date(from).toISOString(),timeMax:new Date(to).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'250',timeZone:'America/Toronto',...(pageToken?{pageToken}:{})});const d=await google(access,base+'?'+params);events.push(...(d.items||[]).filter((e:any)=>e.status!=='cancelled').map(fromGoogle));pageToken=d.nextPageToken||'';if(events.length>2000)throw Error('Too many events to display. Choose a smaller range.')}while(pageToken);return json({events});
  }
  if(b.action==='series'){
   if(typeof b.id!=='string'||b.id.length>1200||!/^[a-zA-Z0-9_]+$/.test(b.id))return json({error:'Choose a valid event'},400);
   const occurrence=await google(access,base+'/'+encodeURIComponent(b.id));const master=occurrence.recurringEventId?await google(access,base+'/'+encodeURIComponent(occurrence.recurringEventId)):occurrence;
   if(!master.recurrence?.length)return json({error:'This event is no longer part of a repeating series. Refresh the calendar.'},409);
   return json({event:fromGoogle(master)});
  }
  if(!['create','update','delete'].includes(b.action))return json({error:'Unknown calendar action'},400);
  if(b.action==='create'){if(typeof b.requestId!=='string'||!/^[a-f0-9]{32}$/.test(b.requestId))return json({error:'Invalid event request'},400);const event=await google(access,base,'POST',{...toGoogle(b.event),id:'home'+b.requestId});return json({event:fromGoogle(event)});}
  if(typeof b.id!=='string'||b.id.length>1200||!/^[a-zA-Z0-9_]+$/.test(b.id)||typeof b.etag!=='string'||b.etag.length>300)return json({error:'Refresh this event before changing it'},400);
  if(b.action==='delete'){await google(access,base+'/'+encodeURIComponent(b.id),'DELETE',undefined,b.etag);return json({ok:true});}
  const current=await google(access,base+'/'+encodeURIComponent(b.id));
  if(current.recurringEventId&&b.event?.recurrence!==undefined)return json({error:'Choose the whole series to change how this event repeats.'},400);
  const draft=toGoogle(b.event);const event=await google(access,base+'/'+encodeURIComponent(b.id),'PATCH',{...draft,extendedProperties:{...current.extendedProperties,shared:{...current.extendedProperties?.shared,...draft.extendedProperties.shared,...(b.event.person_ids===undefined&&current.extendedProperties?.shared?.hummel_person!==b.event.person?{hummel_people:''}:{})}}},b.etag);return json({event:fromGoogle(event)});
 }catch(e){return json({error:e instanceof Error?e.message:'Calendar request failed'},400);}
});
