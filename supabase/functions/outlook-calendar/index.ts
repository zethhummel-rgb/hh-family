import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createGraph,graphId,OutlookProblem} from './graph.ts';
import {syncEvents} from './sync.ts';

const project='https://ybizqfghnplcxlmlhvyn.supabase.co';
const testSite='https://zethhummel-rgb.github.io/hummel-home/';
const origin=new URL(testSite).origin;
const endpoint=project+'/functions/v1/outlook-calendar';
const callback=endpoint+'/callback';
const microsoft='https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const scope='https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.ReadWrite offline_access';
const clientId=Deno.env.get('TEST_OUTLOOK_CLIENT_ID');
const clientSecret=Deno.env.get('TEST_OUTLOOK_CLIENT_SECRET');
const tester=Deno.env.get('TEST_OUTLOOK_TEST_EMAIL')?.trim().toLowerCase();
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin=Deno.env.get('SUPABASE_URL')===project&&serviceKey?
 createClient(project,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const secretPattern=/^[A-Za-z0-9_-]{43}$/;
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=+$/,'').replaceAll('+','-').replaceAll('/','_');
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const hex=async(value:string)=>Array.from(await digest(value),byte=>byte.toString(16).padStart(2,'0')).join('');
type Tokens={access_token:string;refresh_token?:string};

async function sameSecret(sent:string,expected:unknown) {
 if(typeof expected!=='string'||sent.length>1024)return false;
 const [a,b]=await Promise.all([digest(sent),digest(expected)]);
 return a.reduce((diff,byte,index)=>diff|(byte^b[index]),0)===0;
}

async function tokens(params:Record<string,string>):Promise<Tokens> {
 const response=await fetch(microsoft+'token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
  body:new URLSearchParams({client_id:clientId!,client_secret:clientSecret!,scope,...params})});
 const data=await response.json();
 if(!response.ok||typeof data.access_token!=='string') {
  if(data.error==='invalid_grant')throw new OutlookProblem('reconnect','Microsoft sign-in expired. Connect Outlook again.');
  throw new OutlookProblem('retry','Microsoft sign-in is temporarily unavailable.');
 }
 return data;
}

function returnToSettings(request:Request) {
 const received=new URL(request.url);
 const state=received.searchParams.get('state')||'',code=received.searchParams.get('code')||'';
 const ok=secretPattern.test(state)&&code.length>0&&code.length<=4096&&!received.searchParams.has('error');
 const target=new URL(testSite);
 target.searchParams.set('outlook_calendar',ok?'return':'denied');
 if(ok)target.hash=new URLSearchParams({outlook_state:state,outlook_code:code}).toString();
 return new Response(null,{status:303,headers:{...headers,Location:target.href}});
}

Deno.serve(async request=>{
 if(!admin)return reply({error:'Not found.'},404);
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path.endsWith('/outlook-calendar/callback'))return returnToSettings(request);
 const requestOrigin=request.headers.get('origin');
 if(requestOrigin&&requestOrigin!==origin)return reply({error:'Not found.'},404);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST'||!path.endsWith('/outlook-calendar'))return reply({error:'Not found.'},404);
 let body:Record<string,unknown>;
 try{
  const input=await request.text();
  if(input.length>8000)return reply({error:'Invalid request.'},400);
  body=JSON.parse(input);
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid request.'},400);
 }catch{return reply({error:'Invalid request.'},400)}
 const {action,householdId}=body;
 if(!uuid(householdId))return reply({error:'Choose a TEST household.'},400);
 const cron=action==='scheduled';
 let userId:unknown;
 if(cron) {
  if(!clientId||!clientSecret||!tester)return reply({error:'Outlook sync is unavailable.'},404);
  const supplied=request.headers.get('x-hummel-cron')||'';
  if(requestOrigin||!supplied)return reply({error:'Not authorized.'},403);
  const result=await admin.rpc('push_service',{action:'secrets',payload:{}});
  if(!await sameSecret(supplied,result.data?.cronSecret))return reply({error:'Not authorized.'},403);
  userId=body.userId;
  if(!uuid(userId))return reply({error:'Invalid request.'},400);
  const actor=await admin.auth.admin.getUserById(userId);
  if(actor.data.user?.email?.toLowerCase()!==tester||!actor.data.user?.email_confirmed_at)return reply({error:'Not authorized.'},403);
 }else {
  const session=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if(!session)return reply({error:'Sign in to connect Outlook.'},401);
  const actor=await admin.auth.getUser(session);
  if(actor.error||!actor.data.user)return reply({error:'Sign in to connect Outlook.'},401);
  if(!clientId||!clientSecret||!tester||actor.data.user.email?.toLowerCase()!==tester||!actor.data.user.email_confirmed_at)
   return action==='status'?reply({available:false}):reply({error:'Outlook sync is unavailable for this account.'},403);
  userId=actor.data.user.id;
 }
 const membership=await admin.from('household_members').select('user_id').eq('household_id',householdId).eq('user_id',userId).maybeSingle();
 if(membership.error||!membership.data)return reply({error:'This TEST household is unavailable.'},403);
 const db=async(action:string,payload:Record<string,unknown>={})=>{
  const result=await admin.rpc('outlook_calendar',{action,payload:{...payload,householdId,userId}});
  if(result.error) {
   const message=result.error.message;
   const visible=['Choose a calendar from the list.','Reconnect the same Outlook calendar for this trial.',
    'This Outlook calendar is already linked to a TEST account.','Calendar sync is running. Try again in a moment.'];
   throw new OutlookProblem('retry',visible.includes(message)?message:'The TEST calendar could not finish this request.');
  }
  return result.data;
 };
 try{
  switch(action) {
   case 'status':
    return reply({available:true,...await db('status')});
   case 'authorize': {
    const state=random(),verifier=random();
    await db('authorize',{stateHash:await hex(state),verifier});
    const authorize=new URL(microsoft+'authorize');
    authorize.search=new URLSearchParams({client_id:clientId!,response_type:'code',redirect_uri:callback,response_mode:'query',
     scope,state,code_challenge:encode(await digest(verifier)),code_challenge_method:'S256',prompt:'select_account',login_hint:tester!}).toString();
    return reply({url:authorize.href});
   }
   case 'complete': {
    const {state,code}=body;
    if(typeof state!=='string'||!secretPattern.test(state)||typeof code!=='string'||!code||code.length>4096)
     return reply({error:'Microsoft sign-in expired. Connect Outlook again.'},400);
    const verifier=await db('claim',{stateHash:await hex(state)});
    if(typeof verifier!=='string')return reply({error:'Microsoft sign-in expired. Connect Outlook again.'},400);
    const token=await tokens({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:verifier});
    const graph=createGraph(token.access_token,Date.now()+20000);
    const identity=await graph.identity();
    if(!identity||!graphId(identity.id)||![identity.mail,identity.userPrincipalName].some(value=>value?.toLowerCase()===tester))
     return reply({error:'Choose the Microsoft account that matches your HH TEST email.'},403);
    if(!token.refresh_token)return reply({error:'Microsoft did not allow background sync. Connect Outlook again.'},400);
    const calendars=await graph.calendars();
    if(!calendars.length)return reply({error:'There are no writable Outlook calendars on this account.'},400);
    await db('choose',{microsoftId:identity.id,refreshToken:token.refresh_token,calendars});
    return reply({calendars});
   }
   case 'connect':
    if(!graphId(body.calendarId))return reply({error:'Choose a calendar from the list.'},400);
    await db('connect',{calendarId:body.calendarId});
    return reply({ok:true});
   case 'disconnect':
   case 'cancel_picker':
    await db(action);
    return reply({ok:true});
   case 'sync':
   case 'scheduled': {
    const lease=await db('lease',{automatic:cron});
    if(!lease)return reply({skipped:true});
    const work=(action:string,payload:Record<string,unknown>={})=>db(action,{...payload,lease:lease.lease});
    let problem:'retry'|'reconnect'|'review'|null=null;
    try{
     const deadline=Date.now()+44000;
     const token=await tokens({grant_type:'refresh_token',refresh_token:lease.refreshToken});
     if(token.refresh_token&&token.refresh_token!==lease.refreshToken)await work('token',{refreshToken:token.refresh_token});
     problem=await syncEvents(createGraph(token.access_token,deadline),work,lease.calendarId,lease.since,lease.initial);
    }catch(error){problem=error instanceof OutlookProblem?error.issue:'retry'}
    await work('finish',{problem});
    return reply({problem});
   }
   default:return reply({error:'Unknown Outlook request.'},400);
  }
 }catch(error){
  return reply({error:error instanceof OutlookProblem?error.message:'Outlook could not complete the TEST request.'},409);
 }
});
