import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {sendGmail} from '../invitation-email/smtp.ts';
import {validMailAddress} from '../invitation-email/message.ts';
import {guestEvent,isReply} from './event.ts';
import {eventGuestMessage} from './message.ts';

const backend=Deno.env.get('SUPABASE_URL')!;
const test=backend==='https://ybizqfghnplcxlmlhvyn.supabase.co';
const app=test?'https://zethhummel-rgb.github.io/hummel-home/':'https://zethhummel-rgb.github.io/hh-family/';
const live=backend==='https://njpdqiwrwgoothkstoql.supabase.co';
const origin=new URL(app).origin;
const from=Deno.env.get('HH_EMAIL_FROM')||'hummelhomeapp@gmail.com';
const password=(Deno.env.get('HH_EMAIL_APP_PASSWORD')||'').replaceAll(' ','');
const admin=createClient(backend,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
const unavailable=()=>json({error:'This event invitation is unavailable or has expired.'},404);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern=/^[a-f0-9]{64}$/;
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async(token:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
const changed='The event changed. Reopen it before inviting guests.';
const safeErrors=new Set([changed,'The event changed. Open the invitation again.','That address already has an invitation for this event.','Invitation limit reached. Try again tomorrow.']);

async function service(action:string,payload:Record<string,unknown>){
 const {data,error}=await admin.rpc('event_guest_service',{action,payload});
 if(error)throw Error(safeErrors.has(error.message)?error.message:'Could not update event invitations. Please try again.');
 return data;
}

Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==origin)return json({error:'Invalid request origin.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!test&&!live)return json({error:'Event invitations are unavailable.'},503);
 const raw=await req.text();
 if(raw.length>4096)return json({error:'This request is too large.'},400);
 let body;
 try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(!body||typeof body!=='object')return json({error:'Invalid request.'},400);
 try{
  if(body.action==='preview'||body.action==='respond'){
   if(typeof body.token!=='string'||!tokenPattern.test(body.token))return unavailable();
   const tokenHash=await hash(body.token);
   const record=await service('preview',{hash:tokenHash});
   const event=record&&guestEvent(record.event,record.occurrence);
   if(!event||Date.parse(event.endsAt)<=Date.now())return unavailable();
   let reply=record.reply;
   if(body.action==='respond'){
    if(!isReply(body.reply))return json({error:'Choose Yes, Maybe, or No.'},400);
    const updated=await service('respond',{hash:tokenHash,reply:body.reply,version:record.event.version});
    if(!updated)return unavailable();
    reply=updated.reply;
   }
   return json({event,sender:record.sender,message:record.message,reply});
  }

  const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const user=bearer?await admin.auth.getUser(bearer):null;
  if(!user?.data.user?.email_confirmed_at||user.error)return json({error:'Sign in to manage event invitations.'},401);
  const {action,eventId,occurrence=''}=body;
  if(typeof eventId!=='string'||!uuid.test(eventId)||typeof occurrence!=='string'||(occurrence&&!/^\d{4}-\d{2}-\d{2}$/.test(occurrence)))return unavailable();
  const target={actorId:user.data.user.id,eventId,occurrence};
  if(action==='list'||action==='revoke'){
   if(action==='revoke'&&(typeof body.id!=='string'||!uuid.test(body.id)))return unavailable();
   const data=await service(action,{...target,id:body.id});
   return data?json(data):unavailable();
  }
  if(action!=='send')return json({error:'Invalid request.'},400);
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  const message=typeof body.message==='string'?body.message.trim():'';
  if(!validMailAddress(email)||Array.from(message).length>500)return json({error:'Enter a valid email address and a note of up to 500 characters.'},400);
  if(live&&(!validMailAddress(from)||password.length!==16))return json({error:'Event invitation email is unavailable. Please try again later.'},503);
  const record=await service('event',target);
  const event=record&&guestEvent(record.event,occurrence);
  if(!event||Date.parse(event.endsAt)<=Date.now())return unavailable();
  if(body.version!==record.event.version)return json({error:changed},409);
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await hash(token);
  const claim=await service('claim',{...target,email,message,hash:tokenHash,version:record.event.version});
  if(!claim)return unavailable();
  const mail=eventGuestMessage(app,token,claim.sender,event,message);
  let delivery=test?'preview':'sent';
  if(live){
   try{await sendGmail({from,to:email,password,deliveryId:claim.id,...mail})}
   catch{delivery='unknown'}
  }
  // Never encourage an automatic resend after the mail server may have accepted it.
  try{await service('finish',{hash:tokenHash,delivery})}catch{}
  return json({delivery,...(test?{preview:mail.links}:{})});
 }catch(error){return json({error:error instanceof Error&&safeErrors.has(error.message)?error.message:'Could not complete this request. Please try again.'},400)}
});
