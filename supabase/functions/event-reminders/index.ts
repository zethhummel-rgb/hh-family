import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
import {validSubscription,isDue,recipients,deliveryKey,notificationPayload,calendarReminders,recurrenceWorkBudget,type ReminderEvent} from './logic.ts';
import {expandNativeEvents,type NativeEvent} from '../google-calendar/native.ts';
const APP=Deno.env.get('APP_URL')||'https://zethhummel-rgb.github.io/hh-family/',ORIGIN=new URL(APP).origin;
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
async function service(action:string,payload:Record<string,unknown>={}){const r=action==='claim'?await admin.rpc('calendar_reminder_claim',{payload}):await admin.rpc('push_service',{action,payload});if(r.error)throw Error('Notification storage is unavailable.');return r.data;}
async function calendar(householdId:string){const r=await admin.rpc('calendar_service',{action:'connection_get',payload:{householdId}});if(r.error)throw Error('Calendar connection unavailable');return r.data;}
async function publicKey(){return await service('config')||await service('config',{keys:webpush.generateVAPIDKeys()})}
async function send(device:any,payload:any,keys:any){
 const subscription=validSubscription(device.subscription);
 const request=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{TTL:300,urgency:'high',contentEncoding:'aes128gcm',vapidDetails:{subject:APP,publicKey:keys.publicKey,privateKey:keys.privateKey}});
 const response=await fetch(request.endpoint,{method:'POST',headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(8000)});
 await response.body?.cancel();
 if(response.status===404||response.status===410){await service('retire',{deviceId:device.id});return 'expired'}
 if(!response.ok)throw Error('Push service unavailable');return 'sent';
}
async function googleEvents(connection:any,now:number,deadline:number):Promise<ReminderEvent[]>{
 const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')||'',refresh_token:connection.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(8000)});
 const data=await token.json();if(!token.ok||!data.access_token)throw Error('Calendar reconnect required');
 const events:ReminderEvent[]=[];let pageToken='',pages=0;
 do{
  if(++pages>9||Date.now()>deadline)throw Error('Reminder calendar work budget exceeded');
  const params=new URLSearchParams({timeMin:new Date(now-86400000).toISOString(),timeMax:new Date(now+8*86400000).toISOString(),singleEvents:'true',orderBy:'startTime',timeZone:'America/Toronto',maxResults:'250',...(pageToken?{pageToken}:{})});
  const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(connection.calendarId)+'/events?'+params,{headers:{Authorization:'Bearer '+data.access_token},signal:AbortSignal.timeout(8000)});const body=await r.json();if(!r.ok)throw Error('Calendar read failed');
  for(const e of body.items||[]){if(e.status==='cancelled')continue;const shared=e.extendedProperties?.shared||{};let person_ids;try{person_ids=JSON.parse(shared.hummel_people);if(!Array.isArray(person_ids)||person_ids.some((id:unknown)=>typeof id!=='string'))person_ids=undefined}catch{}
   const raw=shared.hummel_reminder;const reminder_minutes=typeof raw==='string'&&/^\d{1,5}$/.test(raw)?Number(raw):null;
   events.push({id:e.id,title:e.summary||'Family event',location:e.location,person:shared.hummel_person||'Everyone',person_ids,reminder_minutes,reminder_30_enabled:shared.hummel_reminder_30!=='off',starts_at:e.start?.dateTime||'',all_day:!!e.start?.date,start_date:e.start?.date||null});
  }
  pageToken=body.nextPageToken||'';if(events.length>2000)throw Error('Reminder calendar too large');
 }while(pageToken);
 return events;
}
async function dispatch(keys:any,householdId:string){
 if(!await service('lock_household',{householdId}))return {busy:true};
 const report={households:0,sent:0,failed:0,limited:false},deadline=Date.now()+20000;
 try{
   try{
    const devices=await service('devices',{householdId});
    const membership=await admin.from('household_members').select('user_id,display_name').eq('household_id',householdId);if(membership.error)throw Error('Membership unavailable');
    const profiles=await admin.from('household_people').select('id,display_name,linked_user_id').eq('household_id',householdId);if(profiles.error)throw Error('Family profiles unavailable');
    const familyMembers=membership.data||[],familyPeople=profiles.data||[];
    async function deliver(events:ReminderEvent[]){
    for(const event of events.filter(e=>isDue(e,Date.now()))){
     const users=recipients(event,familyMembers,familyPeople),key=deliveryKey(event);
     for(const device of devices.filter((d:any)=>users.includes(d.user_id))){
      if(Date.now()>deadline)throw Error('Reminder calendar work budget exceeded');
      if(!await service('claim',{deviceId:device.id,userId:device.user_id,key}))continue;
      try{const state=await send(device,notificationPayload(event),keys);if(state==='sent')report.sent++;await service('finish',{deviceId:device.id,key,state})}catch{report.failed++}
     }
    }
    }
    const now=Date.now();
    // Household reminders stay independent of the Google connection.
    try{
     const tasks=await admin.from('household_items').select('id,title,person,remind_at').eq('household_id',householdId).eq('kind','task').eq('done',false).gte('remind_at',new Date(now-5*60000).toISOString()).lte('remind_at',new Date(now).toISOString()).limit(2001);
     if(tasks.error||tasks.data.length>2000)throw Error('Reminder read failed');
     await deliver(tasks.data.map((t:any)=>({id:'task:'+t.id,task_id:t.id,title:t.title,person:t.person,starts_at:t.remind_at,all_day:false,reminder_minutes:0})));
    }catch{report.failed++}
    const source=await admin.rpc('calendar_copy_service',{action:'status',payload:{householdId}});if(source.error)throw Error('Calendar source unavailable');
    const connection=source.data?.nativeReady===false?await calendar(householdId):null;let events:ReminderEvent[];
    if(connection){
     if(!connection.migrationComplete)return report;
     const owner=await admin.from('households').select('owner_id').eq('id',householdId).single();if(owner.error||owner.data.owner_id!==connection.userId)return report;
     events=await googleEvents(connection,now,deadline);
    }else{
     // Process small pages rather than holding every household master/exception in memory.
     const work=recurrenceWorkBudget();let complete=false;
     for(let offset=0;offset<10000;offset+=25){
      if(Date.now()>deadline)throw Error('Reminder recurrence work budget exceeded');
      const r=await admin.from('household_events').select('*').eq('household_id',householdId).order('id').range(offset,offset+24);
      if(r.error)throw Error('Calendar read failed');
      const page:NativeEvent[]=r.data;
      let expanded:NativeEvent[];work.resume();
      try{expanded=expandNativeEvents(page,new Date(now-86400000).toISOString(),new Date(now+8*86400000).toISOString(),work)}finally{work.pause()}
      await deliver(calendarReminders(expanded));
      if(page.length<25){complete=true;break}
     }
     if(!complete)throw Error('Reminder calendar too large');
     report.households++;return report;
    }
    report.households++;
    await deliver(calendarReminders(events));
   }catch(e){report.failed++;report.limited=/Reminder .*work budget exceeded/.test((e as Error)?.message||'')}
  return report;
 }finally{await service('unlock_household',{householdId,...report})}
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return json({error:'Not found'},404);
 try{
  const cron=req.headers.get('x-hummel-cron');
  if(cron){
   const secrets=await service('secrets');
   // Compare digests to keep the scheduler credential out of timing comparisons and logs.
   const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
   const [a,b]=await Promise.all([digest(cron),digest(secrets.cronSecret||'')]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
   if(!secrets.cronSecret||diff)return json({error:'Unauthorized'},401);
   if(!secrets.keys){await publicKey();secrets.keys=(await service('secrets')).keys}
   const raw=await req.text();if(raw.length>1024)return json({error:'Invalid dispatch request'},400);
   const body=JSON.parse(raw);
   if(body.action!=='dispatch'||typeof body.householdId!=='string'||!/^[a-f0-9-]{36}$/.test(body.householdId))return json({error:'A household dispatch job is required'},400);
   return json(await dispatch(secrets.keys,body.householdId));
  }
  if(req.headers.get('origin')!==ORIGIN)return json({error:'Invalid request origin'},403);
  const token=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)return json({error:'Sign in first'},401);
  const auth=await admin.auth.getUser(token);if(auth.error||!auth.data.user)return json({error:'Sign in again to enable reminders'},401);
  const raw=await req.text();if(raw.length>16000)return json({error:'Request too large'},400);const body=JSON.parse(raw);
  if(typeof body.householdId!=='string'||!/^[a-f0-9-]{36}$/.test(body.householdId))return json({error:'Invalid household'},400);
  const member=await admin.from('household_members').select('user_id').eq('household_id',body.householdId).eq('user_id',auth.data.user.id).maybeSingle();if(member.error||!member.data)return json({error:'Household membership required'},403);
  const payload={householdId:body.householdId,userId:auth.data.user.id,endpoint:typeof body.endpoint==='string'?body.endpoint.slice(0,4096):''};
  if(body.action==='status')return json({publicKey:await publicKey(),...await service('status',payload)});
  if(body.action==='subscribe'){const subscription=validSubscription(body.subscription);return json(await service('subscribe',{...payload,endpoint:subscription.endpoint,subscription}))}
  if(body.action==='unsubscribe')return json(await service('unsubscribe',payload));
  if(body.action==='test'){
   const device=await service('test',payload);if(!device)return json({error:'Enable this device first, or wait a minute before another test.'},429);
   const {keys}=await service('secrets');const state=await send(device,{title:'HH',body:'Your reminders are ready. A little help keeping everyone on the same page.',tag:'hummel-test'},keys);
   if(state!=='sent')return json({error:'This device subscription expired. Enable notifications again.'},410);return json({sent:true});
  }
  return json({error:'Unknown notification action'},400);
 }catch{return json({error:'Notifications could not complete this request. Please try again.'},400)}
});
