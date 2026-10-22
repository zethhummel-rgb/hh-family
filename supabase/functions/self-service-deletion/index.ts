import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const ORIGIN='https://zethhummel-rgb.github.io';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const safe=new Set(['Sign in with a confirmed account','Pilot administrator accounts are protected','Household owners must use Delete home and all accounts','Type your email address to confirm','Only the household owner can delete this home','Type the exact household name to confirm','Pilot administrator households are protected','A member owns another household','Unsupported deletion request']);
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==ORIGIN)return json({error:'Invalid request origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!bearer)return json({error:'Sign in again.'},401);
  const {data,error}=await admin.auth.getUser(bearer);
  if(error||!data.user)return json({error:'Sign in again.'},401);
  const raw=await req.text();if(raw.length>2048)return json({error:'Invalid request'},400);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request'},400)}
  if(!body||!['account','household'].includes(body.action)||typeof body.confirmation!=='string'||body.confirmation.length>254)return json({error:'Choose a deletion option and type the confirmation'},400);
  if(body.action==='household'&&(typeof body.householdId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.householdId)))return json({error:'Choose your household'},400);
  const result=await admin.rpc('self_service_deletion',{action:body.action,payload:{actorId:data.user.id,householdId:body.householdId,confirmation:body.confirmation}});
  if(result.error)return json({error:safe.has(result.error.message)?result.error.message:'Deletion could not complete. No partial deletion was saved.'},400);
  return json(result.data);
 }catch{return json({error:'Request could not complete. Sign in again to check your account before retrying.'},500)}
});
