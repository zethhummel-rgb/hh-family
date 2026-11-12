import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {sendGmail} from '../invitation-email/smtp.ts';
import {validMailAddress} from '../invitation-email/message.ts';
import {pilotAnswers,pilotRequestMessage,pilotRequestRecipient} from './message.ts';

const backend=Deno.env.get('SUPABASE_URL')||'';
const test=backend==='https://ybizqfghnplcxlmlhvyn.supabase.co';
const origin='https://zethhummel-rgb.github.io';
const from=Deno.env.get('HH_EMAIL_FROM')||pilotRequestRecipient;
const password=(Deno.env.get('HH_EMAIL_APP_PASSWORD')||'').replaceAll(' ','');
const configured=(test||backend==='https://njpdqiwrwgoothkstoql.supabase.co')&&validMailAddress(from)&&password.length===16;
const admin=createClient(backend,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const invalid='Enter your name, a valid email address, and both answers.';
const uncertain='Delivery could not be confirmed. Your answers are still here. You can email HH directly if you need to follow up.';

async function readForm(request:Request):Promise<Record<string,unknown>|null>{
 const reader=request.body?.getReader();
 if(!reader)return null;
 const decoder=new TextDecoder();
 let bytes=0,body='';
 try{
  for(;;){
   const chunk=await reader.read();
   if(chunk.done)break;
   bytes+=chunk.value.length;
   if(bytes>8192){await reader.cancel();return null}
   body+=decoder.decode(chunk.value,{stream:true});
  }
  const value=JSON.parse(body+decoder.decode());
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null}
 finally{reader.releaseLock()}
}

async function digest(value:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(request:Request)=>{
 if(request.headers.get('origin')!==origin)return json({error:'Invalid request origin.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method==='GET')return json({configured,preview:test&&!configured});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 const input=await readForm(request);
 if(!input||input.website)return json({error:invalid},400);
 const answers=pilotAnswers(input);
 if(!answers)return json({error:invalid},400);
 if(test&&!configured)return json({preview:true});
 if(!configured)return json({error:'The form is temporarily unavailable. Your answers are still here, or you can email HH directly.'},503);

 const id=answers.requestId;
 let claimed=false;
 try{
  const [emailHash,contentHash]=await Promise.all([digest(answers.email),digest(JSON.stringify(answers))]);
  const claim=await admin.rpc('pilot_request_mail_service',{action:'claim',payload:{id,emailHash,contentHash}});
  if(claim.error)throw Error('Could not claim invitation request');
  if(claim.data==='sent')return json({sent:true});
  if(claim.data==='limited')return json({error:'Too many requests right now. Please wait and try again.'},429);
  if(claim.data==='sending')return json({error:'Your request is still being processed. Please check again shortly.'},409);
  if(claim.data==='uncertain')return json({error:uncertain},409);
  if(claim.data!=='claimed')return json({error:'Could not verify this request. Reload the page or email HH directly.'},409);
  claimed=true;
  await sendGmail({from,to:pilotRequestRecipient,replyTo:answers.email,password,deliveryId:id,...pilotRequestMessage(answers,test)});
  try{await admin.rpc('pilot_request_mail_service',{action:'finish',payload:{id,status:'sent'}})}catch{}
  return json({sent:true});
 }catch{
  if(claimed)try{await admin.rpc('pilot_request_mail_service',{action:'finish',payload:{id,status:'uncertain'}})}catch{}
  return json({error:claimed?uncertain:'Could not send your request. Your answers are still here. Please try again.'},502);
 }
});
