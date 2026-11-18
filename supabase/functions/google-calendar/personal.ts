const scope='https://www.googleapis.com/auth/calendar.app.created';
const statePattern=/^hhp_[A-Za-z0-9_-]{43}$/;
type Config={clientId:string;clientSecret:string;callback:string;app:string};
type CalendarListEntry={id:string;name:string};
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const hash=async(value:string)=>Array.from(await digest(value)).map(byte=>byte.toString(16).padStart(2,'0')).join('');

async function service(admin:any,action:string,payload:Record<string,unknown>){
 const {data,error}=await admin.rpc('personal_calendar_service',{action,payload});
 if(error){
  const safe=['Your Google copy is updating. Try disconnecting in a moment.','Your household calendar transfer must finish first',
   'Reconnect your existing Google calendar','A Google connection is already being set up','Google connection expired'];
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
 if(body.action==='personal_status')return {...await service(admin,'status',actor),configured};
 if(body.action==='personal_disconnect')return service(admin,'disconnect',actor);
 if(!configured)throw Error('Personal Google Calendar connections are being prepared.');
 if(body.action==='personal_start'){
  const state='hhp_'+random(),verifier=random();
  await service(admin,'state_create',{...actor,hash:await hash(state),verifier});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',scope,access_type:'offline',
   prompt:'consent select_account',include_granted_scopes:'false',state,code_challenge:encode(await digest(verifier)),code_challenge_method:'S256'}).toString();
  return {url:url.href};
 }
 if(body.action!=='personal_complete'||typeof body.state!=='string'||!statePattern.test(body.state)
  ||typeof body.code!=='string'||!body.code||body.code.length>4096)throw Error('Google connection expired. Start again in Settings.');
 const stateHash=await hash(body.state);
 const pending=await service(admin,'state_take',{...actor,hash:stateHash});
 if(!pending)throw Error('Open the HH account that started this connection, or start again in Settings.');
 try{
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code:body.code,code_verifier:pending.verifier,
    redirect_uri:config.callback,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Google could not confirm the connection. Please start again.');
  const token=await response.json();
  if(!token.access_token||!token.refresh_token||!String(token.scope||'').split(' ').includes(scope)){
   throw Error('Allow ongoing calendar access to connect your Google copy.');
  }
  const headers={Authorization:'Bearer '+token.access_token};
  const calendars='https://www.googleapis.com/calendar/v3/calendars';
  const target=pending.calendarId?await fetcher('https://www.googleapis.com/calendar/v3/users/me/calendarList/'+encodeURIComponent(pending.calendarId),{headers,signal:AbortSignal.timeout(8000)}):
   await fetcher(calendars,{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({summary:pending.householdName+' · HH Family',description:'Family plans from HH. Make updates in HH.',timeZone:'America/Toronto'})});
  if(!target.ok)throw Error(pending.calendarId&&[403,404,410].includes(target.status)?
   'Use the Google account that owns this copy. If you deleted it in Google, disconnect it here and connect again.':
   'Google could not open your HH calendar. Please try again.');
  const calendar=await target.json();
  if(typeof calendar.id!=='string'||!calendar.id||calendar.id.length>1024)throw Error('Google did not return a calendar.');
  if(pending.calendarId&&calendar.accessRole!=='owner')throw Error('Use the Google account that owns this copy.');
  return await service(admin,'connection_set',{...actor,hash:stateHash,calendarId:calendar.id,refreshToken:token.refresh_token});
 }finally{
  // A completed connection has already removed its state. Failures release it for re-entry.
  await service(admin,'state_release',{...actor,hash:stateHash}).catch(()=>{});
 }
}

export async function excludePersonalCopies(admin:any,actor:Record<string,unknown>,calendars:CalendarListEntry[]):Promise<CalendarListEntry[]>{
 return service(admin,'filter_import_calendars',{...actor,calendars});
}
