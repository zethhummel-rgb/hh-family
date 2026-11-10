import {createClient} from 'npm:@supabase/supabase-js@2.118.0';

const backend=Deno.env.get('SUPABASE_URL')!;
const app=backend==='https://ybizqfghnplcxlmlhvyn.supabase.co'
 ?'https://zethhummel-rgb.github.io/hummel-home/'
 :Deno.env.get('APP_URL')||'https://zethhummel-rgb.github.io/hh-family/';
const origin=new URL(app).origin;
const admin=createClient(backend,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
const invalid='This invitation is invalid, expired or already used. Ask for a new invitation.';
const safe=new Set([invalid,'Too many attempts. Wait an hour before trying this invitation again.']);

// The 256-bit invitation is the capability, not a client-supplied email or user ID.
// No email is sent here. Ordinary Auth email confirmation remains enabled.
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==origin)return reply({error:'Invalid request origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const raw=await req.text();if(raw.length>4096)return reply({error:'This request is too large.'},400);
  let body;try{body=JSON.parse(raw)}catch{return reply({error:invalid},400)}
  if(!body||!['preview','register'].includes(body.action)||!['family','pilot'].includes(body.kind)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return reply({error:invalid},400);
  if(body.action==='register'&&(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>60||typeof body.password!=='string'||!body.password||body.password.length>1024))return reply({error:'Enter your name and password.'},400);
  const lookup=async(attempt:boolean)=>{
   const r=await admin.rpc('invitation_registration',{invite_kind:body.kind,raw_token:body.token,register_attempt:attempt});
   if(r.error)throw Error(safe.has(r.error.message)?r.error.message:'Could not check your invitation. Please try again.');
   if(!r.data?.email)throw Error(invalid);return r.data;
  };
  let record=await lookup(body.action==='register');
  if(body.action==='preview')return reply({email:record.email,householdName:record.householdName,existingAccount:!!record.userId});
  if(!record.userId){
   if(body.password.length<12)return reply({error:'Use at least 12 characters for your new password.'},400);
   const created=await admin.auth.admin.createUser({email:record.email,password:body.password,email_confirm:true,user_metadata:{display_name:body.name.trim()}});
   if(created.error){
    // A concurrent request or a lost response may already have created this email.
    // Never replace that account's password; a normal password sign-in is still required.
    record=await lookup(false);
    if(!record.userId)return reply({error:'Could not create your account. Check your password requirements and try again.'},400);
   }else if(!created.data.user||created.data.user.email?.toLowerCase()!==record.email)return reply({error:'Could not verify account creation. Try again.'},503);
  }
  if(record.userId&&!record.confirmed){
   const current=await admin.auth.admin.getUserById(record.userId);
   if(current.error||current.data.user?.email?.toLowerCase()!==record.email)return reply({error:invalid},400);
   // Possession of the valid invitation replaces the second confirmation email.
   // Preserve an existing account's password, metadata, and all household data.
   if(!current.data.user.email_confirmed_at){
    const updated=await admin.auth.admin.updateUserById(record.userId,{email_confirm:true});
    if(updated.error)return reply({error:'Could not finish email verification. Please try again.'},503);
   }
  }
  return reply({email:record.email,registered:true});
 }catch(e){
  const message=e instanceof Error?e.message:'';
  return reply({error:safe.has(message)||message==='Could not check your invitation. Please try again.'?message:'Could not prepare your account. Please try again.'},message.startsWith('Too many')?429:400);
 }
});
