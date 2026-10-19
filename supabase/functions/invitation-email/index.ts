import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {invitationMessage,validMailAddress,type InviteKind} from './message.ts';
import {sendGmail} from './smtp.ts';
const APP=Deno.env.get('APP_URL')||'https://zethhummel-rgb.github.io/hh-family/';
const ORIGIN=new URL(APP).origin,FROM=Deno.env.get('HH_EMAIL_FROM')||'hummelhomeapp@gmail.com';
const PASSWORD=(Deno.env.get('HH_EMAIL_APP_PASSWORD')||'').replaceAll(' ','');
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
const safeErrors=new Set(['Sign in with a confirmed account to send invitations','Choose a valid invitation','This invitation is unavailable, expired, or not yours to send','Invitation email limit reached. Share the link or try again later','This address has received several invitations. Share the link or try again later','Email sending is busy. Share the link or try again later']);
async function service(action:string,payload:Record<string,unknown>){const r=await admin.rpc('invitation_mail_service',{action,payload});if(r.error)throw Error(safeErrors.has(r.error.message)?r.error.message:'Invitation email storage is unavailable. Share the link or try again later.');return r.data}
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==ORIGIN)return json({error:'Invalid request origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let actorId='',claimId='';
 try{
  const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!bearer)return json({error:'Sign in again to send an invitation.'},401);
  const user=await admin.auth.getUser(bearer);if(user.error||!user.data.user)return json({error:'Sign in again to send an invitation.'},401);actorId=user.data.user.id;
  const raw=await req.text();if(raw.length>2048)return json({error:'Choose a valid invitation'},400);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Choose a valid invitation'},400)}
  const configured=validMailAddress(FROM)&&PASSWORD.length===16;
  if(body?.action==='status')return json({configured});
  if(body?.action!=='send'||!['family','pilot'].includes(body.kind)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return json({error:'Choose a valid invitation'},400);
  if(!configured)return json({error:'Automatic email delivery isn’t available yet. Your invitation link is ready to copy and share.',setupRequired:true},503);
  const record=await service('claim',{actorId,kind:body.kind,token:body.token});
  if(record.status==='sent')return json({sent:true,alreadySent:true});
  if(record.status==='sending')return json({error:'This invitation is already being sent. Please wait before trying again.'},409);
  if(record.status==='cooldown')return json({error:'Wait one minute before retrying this invitation, or copy the link.'},429);
  if(record.status!=='claimed'||typeof record.claimId!=='string')throw Error('Invitation email storage is unavailable. Share the link or try again later.');
  claimId=record.claimId;
  const message=invitationMessage({kind:body.kind as InviteKind,token:body.token,email:record.email,deliveryId:record.deliveryId,senderName:record.senderName,householdName:record.householdName,expiresAt:record.expiresAt},APP);
  await sendGmail({from:FROM,to:record.email,password:PASSWORD,deliveryId:record.deliveryId,...message});
  try{await service('finish',{actorId,claimId,status:'sent'})}catch{/* Gmail accepted the email. Do not invite an automatic resend. */}
  return json({sent:true});
 }catch(error){
  if(claimId)try{await service('finish',{actorId,claimId,status:'failed'})}catch{}
  const message=error instanceof Error&&safeErrors.has(error.message)?error.message:'Email delivery could not be confirmed. Your invitation link is ready to copy; wait a minute before retrying.';
  return json({error:message},400);
 }
});
