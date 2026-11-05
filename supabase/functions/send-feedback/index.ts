import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {sendGmail} from '../invitation-email/smtp.ts';
import {validMailAddress} from '../invitation-email/message.ts';
import {feedbackMessage,feedbackRecipient,feedbackLimit,validFeedbackArea} from './message.ts';
const URL=Deno.env.get('SUPABASE_URL')||'';
const isTest=URL==='https://ybizqfghnplcxlmlhvyn.supabase.co';
const supported=isTest||URL==='https://njpdqiwrwgoothkstoql.supabase.co';
const ORIGIN='https://zethhummel-rgb.github.io';
const FROM=Deno.env.get('HH_EMAIL_FROM')||feedbackRecipient;
const PASSWORD=(Deno.env.get('HH_EMAIL_APP_PASSWORD')||'').replaceAll(' ','');
const configured=supported&&validMailAddress(FROM)&&PASSWORD.length===16;
const admin=createClient(URL,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==ORIGIN)return json({error:'Invalid request origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method==='GET')return json({configured});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let claim:{id:string;actorId:string}|null=null;
 try{
  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return json({error:'Sign in again to send your feedback.'},401);
  const result=await admin.auth.getUser(token),user=result.data.user;
  if(result.error||!user||!user.email_confirmed_at)return json({error:'Sign in with a confirmed account to send your feedback.'},401);
  const raw=await req.text();if(raw.length>32000)return json({error:'Your feedback is too long.'},400);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Please check your feedback and try again.'},400)}
  if(!body||!uuid(body.requestId)||!uuid(body.householdId)||!validFeedbackArea(body.area)||typeof body.message!=='string'||!body.message.trim()||body.message.trim().length>feedbackLimit||body.message.includes('\0'))return json({error:'Choose an HH area and enter a comment of up to 5,000 characters.'},400);
  if(!configured)return json({error:'Feedback email is not connected yet. Your comment has not been sent; please keep it and try again later.'},503);
  const claimed=await admin.rpc('feedback_mail_service',{action:'claim',payload:{actorId:user.id,id:body.requestId,householdId:body.householdId,area:body.area,message:body.message.trim()}});
  if(claimed.error)return json({error:'Could not submit feedback for this household. Please sign in again.'},403);
  const row=claimed.data;
  if(row.status==='sent')return json({sent:true,alreadySent:true});
  if(row.status==='limited')return json({error:'Please wait before sending more feedback. Limit: 5 messages per hour.'},429);
  if(row.status==='pending')return json({error:'This submission is already being processed or its delivery could not be confirmed. Please do not resend the same comment yet.'},409);
  if(row.status!=='claimed')throw Error('Unexpected claim');
  claim={id:body.requestId,actorId:user.id};
  await sendGmail({from:FROM,to:feedbackRecipient,replyTo:row.email,password:PASSWORD,deliveryId:row.id,...feedbackMessage(row,isTest)});
  // SMTP has accepted the message. A database failure must not encourage a duplicate email.
  try{await admin.rpc('feedback_mail_service',{action:'finish',payload:{...claim,status:'sent'}})}catch{}
  return json({sent:true});
 }catch{
  if(claim)try{await admin.rpc('feedback_mail_service',{action:'finish',payload:{...claim,status:'uncertain'}})}catch{}
  return json({error:'Email delivery could not be confirmed. Your comment is still here. Please do not resend the same comment yet.'},502);
 }
});
