const scope='https://www.googleapis.com/auth/calendar.app.created';
const existingScopes=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events'];
const statePattern=/^hhp_[A-Za-z0-9_-]{43}$/;
type Config={clientId:string;clientSecret:string;callback:string;app:string;test?:boolean};
type CalendarListEntry={id:string;name:string};
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const hash=async(value:string)=>Array.from(await digest(value)).map(byte=>byte.toString(16).padStart(2,'0')).join('');

async function service(admin:any,action:string,payload:Record<string,unknown>,name='personal_calendar_service'){
 const {data,error}=await admin.rpc(name,{action,payload});
 if(error){
  const safe=['Your Google copy is updating. Try disconnecting in a moment.','Your household calendar transfer must finish first',
   'Reconnect your existing Google calendar','A Google connection is already being set up','Google connection expired',
   'Disconnect your current Google copy before linking a different calendar.','Reconnect the existing Google calendar.',
   'Choose a writable Google calendar from the list.','Confirm sharing this Google calendar with your household.'];
  throw Error(safe.includes(error.message)?error.message:'Could not update your Google connection. Please try again.');
 }
 return data;
}

export function personalCalendarCallback(url:URL,app:string){
 const redirect=new URL(app),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
 redirect.searchParams.set('personal_calendar',statePattern.test(state)&&code.length>0&&code.length<=4096?'return':'denied');
 if(redirect.searchParams.get('personal_calendar')==='return'){
  // The signed-in HH account redeems the code. The fragment stays out of Pages requests.
  redirect.hash=new URLSearchParams({personal_calendar_state:state,personal_calendar_code:code}).toString();
 }
 return new Response(null,{status:303,headers:{Location:redirect.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export async function handlePersonalCalendar(admin:any,body:any,userId:string,config:Config,fetcher:typeof fetch=fetch){
 const actor={householdId:body.householdId,userId};
 const configured=Boolean(config.clientId&&config.clientSecret);
 const existing=(action:string,payload:Record<string,unknown>={})=>service(admin,action,{...actor,...payload},'test_google_existing_calendar');
 if(body.action==='personal_status'){
  const status=await service(admin,'status',actor);
  return {...status,configured,...(config.test&&status.available?await existing('options'):{})};
 }
 if(body.action==='personal_disconnect')return service(admin,'disconnect',actor);
 if(!configured)throw Error('Personal Google Calendar connections are being prepared.');
 if(config.test&&body.action==='personal_existing_cancel')return existing('cancel');
 if(config.test&&body.action==='personal_existing_connect'){
  if(typeof body.calendarId!=='string'||!body.calendarId||body.calendarId.length>1024||body.acknowledgeShared!==true)
   throw Error('Choose a Google calendar and confirm sharing it with your household.');
  return existing('connect',{calendarId:body.calendarId,acknowledgeShared:true});
 }
 if(body.action==='personal_start'||(config.test&&['personal_existing_start','personal_two_way_copy_start'].includes(body.action))){
  const state='hhp_'+random(),verifier=random();
  const parameters={hash:await hash(state),verifier},useExisting=body.action==='personal_existing_start';
  if(config.test)await existing(useExisting?'start':body.action==='personal_two_way_copy_start'?'start_two_way_copy':'start_copy',parameters);
  else await service(admin,'state_create',{...actor,...parameters});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',
   scope:useExisting?existingScopes.join(' '):scope,access_type:'offline',
   prompt:'consent select_account',include_granted_scopes:'false',state,code_challenge:encode(await digest(verifier)),code_challenge_method:'S256'}).toString();
  return {url:url.href};
 }
 if(body.action!=='personal_complete'||typeof body.state!=='string'||!statePattern.test(body.state)
  ||typeof body.code!=='string'||!body.code||body.code.length>4096)throw Error('Google connection expired. Start again in Settings.');
 const stateHash=await hash(body.state);
 const pending=config.test?await existing('take',{hash:stateHash}):await service(admin,'state_take',{...actor,hash:stateHash});
 if(!pending)throw Error('Open the HH account that started this connection, or start again in Settings.');
 let keepSelection=false;
 try{
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code:body.code,code_verifier:pending.verifier,
    redirect_uri:config.callback,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Google could not confirm the connection. Please start again.');
  const token=await response.json();
  const granted=new Set(String(token.scope||'').split(' '));
  const required=pending.existingSource?existingScopes:[scope];
  if(!token.access_token||!token.refresh_token||!required.every(requiredScope=>granted.has(requiredScope))){
   throw Error(pending.existingSource?'Allow calendar listing and editing in Google to keep an existing calendar in sync.':
    'Allow ongoing calendar access to connect your Google copy.');
  }
  const headers={Authorization:'Bearer '+token.access_token};
  if(pending.existingSource){
   const choices:CalendarListEntry[]=[];
   let page='';
   do{
    const query=new URLSearchParams({minAccessRole:'writer',maxResults:'100',...(page?{pageToken:page}:{})});
    const result=await fetcher('https://www.googleapis.com/calendar/v3/users/me/calendarList?'+query,
     {headers,signal:AbortSignal.timeout(8000)});
    if(!result.ok)throw Error('Google could not list your writable calendars. Please try again.');
    const data=await result.json();
    for(const item of data.items||[]){
     if(item.accessRole!=='owner'&&item.accessRole!=='writer')continue;
     if(typeof item.id==='string'&&item.id&&item.id.length<=1024)
      choices.push({id:item.id,name:String(item.summaryOverride||item.summary||'Google Calendar').slice(0,200)});
    }
    page=data.nextPageToken||'';
    if(choices.length>250)throw Error('This account has too many calendars for the TEST connection.');
   }while(page);
   const staged=await existing('stage',{hash:stateHash,refreshToken:token.refresh_token,choices});
   keepSelection=true;
   return {choices:staged};
  }
  const calendars='https://www.googleapis.com/calendar/v3/calendars';
  const target=pending.calendarId?await fetcher('https://www.googleapis.com/calendar/v3/users/me/calendarList/'+encodeURIComponent(pending.calendarId),{headers,signal:AbortSignal.timeout(8000)}):
   await fetcher(calendars,{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({summary:pending.householdName+' · HH Family',description:config.test?'Family plans from HH.':'Family plans from HH. Make updates in HH.',timeZone:'America/Toronto'})});
  if(!target.ok)throw Error(pending.calendarId&&[403,404,410].includes(target.status)?
   'Use the Google account that owns this copy. If you deleted it in Google, disconnect it here and connect again.':
   'Google could not open your HH calendar. Please try again.');
  const calendar=await target.json();
  if(typeof calendar.id!=='string'||!calendar.id||calendar.id.length>1024)throw Error('Google did not return a calendar.');
  if(pending.calendarId&&calendar.accessRole!=='owner')throw Error('Use the Google account that owns this copy.');
  const connection={hash:stateHash,calendarId:calendar.id,refreshToken:token.refresh_token};
  return await (config.test?existing('connect_copy',connection):service(admin,'connection_set',{...actor,...connection}));
 }finally{
  // A completed connection has already removed its state. Failures release it for re-entry.
  if(!keepSelection)await service(admin,'state_release',{...actor,hash:stateHash}).catch(()=>{});
 }
}

export async function excludePersonalCopies(admin:any,actor:Record<string,unknown>,calendars:CalendarListEntry[]):Promise<CalendarListEntry[]>{
 return service(admin,'filter_import_calendars',{...actor,calendars});
}
