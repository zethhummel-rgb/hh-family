import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const ORIGIN='https://zethhummel-rgb.github.io';
const backendUrl=Deno.env.get('SUPABASE_URL')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const appAddress=backendUrl==='https://njpdqiwrwgoothkstoql.supabase.co'?'https://app.hhfamily.ca':'';
const safe=new Set(['Admin access required','Unsupported admin request','Household no longer exists','Your admin household cannot be deleted','Type the exact household name to confirm','A pilot admin household cannot be deleted','A member owns another household']);
Deno.serve(async(req:Request)=>{
 const requestOrigin=req.headers.get('origin');
 const fromAppAddress=Boolean(appAddress&&requestOrigin===appAddress);
 const allowed=requestOrigin===ORIGIN||fromAppAddress;
 const headers={...(allowed&&requestOrigin?{'Access-Control-Allow-Origin':requestOrigin}:{}),'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
 if(!allowed)return json({error:'Invalid request origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!bearer)return json({error:'Sign in again.'},401);
  const caller=createClient(backendUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
  const {data,error}=await caller.auth.getUser(bearer);
  if(error||!data.user)return json({error:'Sign in again.'},401);
  if(!data.user.email_confirmed_at)return json({error:'Admin access required'},403);
  const raw=await req.text();if(raw.length>2048)return json({error:'Invalid request'},400);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request'},400)}
  if(!body||!['list','delete'].includes(body.action))return json({error:'Unsupported admin request'},400);
  if(body.action==='delete'&&(typeof body.householdId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.householdId)||typeof body.confirmation!=='string'||body.confirmation.length>80))return json({error:'Choose a household and type its name'},400);
  const result=await caller.rpc('admin_households',{action:body.action,payload:{householdId:body.householdId,confirmation:body.confirmation}});
  if(result.error?.code==='42501')return json({error:'Admin access required'},403);
  if(result.error)return json({error:safe.has(result.error.message)?result.error.message:'Deletion could not complete. No partial household deletion was saved.'},400);
  return json(result.data);
 }catch{return json({error:'Request could not complete. Refresh the household list before retrying.'},500)}
});
