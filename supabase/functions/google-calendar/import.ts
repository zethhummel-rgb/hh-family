import {prepareExternalImport} from './externalImport.ts';
const scopes=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
type Config={clientId:string;clientSecret:string;callback:string;app:string};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
async function service(admin:any,action:string,payload:Record<string,unknown>){
 const r=await admin.rpc('google_import_service',{action,payload});
 if(r.error){
  const message=String(r.error.message||'');
  const safe=['This import expired. Connect Google again','Preview expired. Review the calendar again','Preview changed. Review the calendar again','Current household membership is required','Finish your household calendar transfer before importing','Choose an available calendar other than the HH Google copy','Choose people from this household','Confirm household sharing and reminder choices','An event is not in this preview','Your HH calendar is too large for this import. Choose fewer events'];
  throw Error(safe.includes(message)?message:'The import could not complete. Review your calendar and try again.');
 }return r.data;
}
async function google(access:string,path:string){
 const response=await fetch('https://www.googleapis.com/calendar/v3/'+path,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok){if(response.status===401||response.status===403)throw Error('Google access expired or was not granted. Connect Google again to import.');throw Error('Google could not load this calendar. Please try again.');}
 const raw=await response.text();if(raw.length>12000000)throw Error('This calendar is too large to import safely.');return JSON.parse(raw);
}
function redirect(config:Config,ok:boolean,message='',completion=''){
 const url=new URL(config.app);url.searchParams.set('calendar_import',ok?'ready':'error');if(message)url.searchParams.set('calendar_message',message);if(completion)url.hash=new URLSearchParams({calendar_import_token:completion}).toString();
 return new Response(null,{status:303,headers:{Location:url.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
export async function handleImportCallback(admin:any,url:URL,config:Config){
 let actor:Record<string,unknown>|null=null;
 try{
  const state=url.searchParams.get('state');if(!state||!state.startsWith('hhi_')||state.length>100)return redirect(config,false,'Import permission expired. Please try again.');
  const record=await service(admin,'state_take',{hash:await hash(state)});if(!record)return redirect(config,false,'Import permission expired. Please try again.');
  actor={householdId:record.householdId,userId:record.userId,sessionId:record.id};
  if(url.searchParams.has('error'))throw Error('Google permission was not granted. Your HH calendar is unchanged.');
  const code=url.searchParams.get('code');if(!code||code.length>4096||!config.clientId||!config.clientSecret)throw Error('Google import is not configured.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:record.verifier,redirect_uri:config.callback,grant_type:'authorization_code'}),signal:AbortSignal.timeout(12000)});
  const token=await response.json();
  if(!response.ok||!token.access_token||!Number.isFinite(token.expires_in)||token.expires_in<60)throw Error('Google import permission could not be completed. Please try again.');
  const granted=new Set(String(token.scope||'').split(' '));if(!scopes.every(scope=>granted.has(scope)))throw Error('Allow calendar-list and event read access to choose a calendar for import.');
  const calendars:Array<{id:string;name:string}>=[];let next='';let pages=0;
  do{
   const query=new URLSearchParams({maxResults:'100',minAccessRole:'reader',...(next?{pageToken:next}:{})});
   const result=await google(token.access_token,'users/me/calendarList?'+query);
   for(const item of result.items||[]){if(typeof item.id!=='string'||item.id.length>1024)throw Error('Google returned an invalid calendar.');calendars.push({id:item.id,name:String(item.summaryOverride||item.summary||'Google calendar').slice(0,300)})}
   next=result.nextPageToken||'';if(calendars.length>100||++pages>2)throw Error('This Google account has too many calendars for one import.');
  }while(next);
  // Store only a short-lived access token. Never persist or reuse a refresh token.
  const completion=random();
  await service(admin,'authorized',{...actor,completionHash:await hash(completion),sessionId:record.id,accessToken:token.access_token,expiresIn:Math.min(token.expires_in-30,1800),calendars});
  return redirect(config,true,'',completion);
 }catch(e){if(actor)try{await service(admin,'cancel',actor)}catch{}return redirect(config,false,e instanceof Error?e.message:'Google import could not be completed.');}
}
export async function handleImportAction(admin:any,body:any,userId:string,config:Config){
 const actor={householdId:body.householdId,userId};
 if(body.action==='import_cancel'){await service(admin,'cancel',actor);return {ok:true}}
 if(body.action==='import_complete'){
  if(typeof body.token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(body.token))throw Error('Import confirmation expired. Connect Google again.');
  try{await service(admin,'complete',{...actor,hash:await hash(body.token)})}catch{throw Error('Return to the HH account that started this import, or connect Google again.');}return {ok:true};
 }
 if(body.action==='import_start'){
  if(!config.clientId||!config.clientSecret)throw Error('Google import needs its Google setup before it is available.');
  const state='hhi_'+random(),verifier=random(),challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  await service(admin,'start',{...actor,hash:await hash(state),verifier});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',scope:scopes.join(' '),access_type:'online',prompt:'consent select_account',include_granted_scopes:'false',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();return {url:url.toString()};
 }
 if(body.action==='import_commit'){
  if(typeof body.previewId!=='string'||!/^[a-f0-9-]{36}$/.test(body.previewId)||!Array.isArray(body.sourceKeys)||body.sourceKeys.length<1||body.sourceKeys.length>2000||body.sourceKeys.some((k:unknown)=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k))||!Array.isArray(body.personIds)||body.personIds.length>20||body.personIds.some((id:unknown)=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))||typeof body.reminder30!=='boolean'||(body.unassigned!==undefined&&typeof body.unassigned!=='boolean')||(body.unassigned===true&&body.personIds.length>0)||body.acknowledgeShared!==true)throw Error('Choose events, people and reminders, then confirm sharing with your household.');
  return service(admin,'commit',{...actor,previewId:body.previewId,sourceKeys:body.sourceKeys,personIds:body.personIds,unassigned:body.unassigned===true,reminder30:body.unassigned===true?false:body.reminder30,acknowledgeShared:true});
 }
 const session=await service(admin,'get',actor);
 if(body.action==='import_status')return {configured:!!(config.clientId&&config.clientSecret),ready:!!session,expiresAt:session?.expiresAt,calendars:session?.calendars||[]};
 if(body.action!=='import_preview')throw Error('Unknown calendar import action.');
 if(!session)throw Error('Your Google import session expired. Connect Google again.');
 const calendar=session.calendars.find((c:any)=>c.id===body.calendarId);if(!calendar)throw Error('Choose a calendar from your Google account.');
 const raw:any[]=[];let next='';let pages=0;let bytes=0;
 do{
  const params=new URLSearchParams({maxResults:'250',singleEvents:'false',showDeleted:'true',...(next?{pageToken:next}:{})});
  const page=await google(session.accessToken,'calendars/'+encodeURIComponent(calendar.id)+'/events?'+params);
  raw.push(...(page.items||[]));bytes+=JSON.stringify(page.items||[]).length;next=page.nextPageToken||'';
  if(raw.length>2000||bytes>12000000||++pages>12)throw Error('This calendar is too large for one import. Nothing has been added.');
 }while(next);
 const prepared=await prepareExternalImport(raw,calendar.id);
 const preview=await service(admin,'preview',{...actor,calendarId:calendar.id,entries:prepared.entries});
 return {...preview,calendarName:calendar.name,warnings:prepared.warnings,cancelled:prepared.cancelled};
}
