import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
function compile(path,imports={},globals={}){
 const exports={};
 const source=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name]},URL,URLSearchParams,Request,Response,TextEncoder,crypto,...globals},{filename:path});
 return exports;
}

const recurrence=compile('supabase/functions/google-calendar/recurrence.ts');
const native=compile('supabase/functions/google-calendar/native.ts',{'./recurrence.ts':recurrence});
const eventHelpers=compile('supabase/functions/event-guests/event.ts',{'../google-calendar/native.ts':native});
const message=compile('supabase/functions/event-guests/message.ts',{'./event.ts':eventHelpers});
const invitations=compile('supabase/functions/invitation-email/message.ts');
const {calendarFile,googleCalendarLink}=compile('src/guestCalendar.ts');
export {calendarFile,googleCalendarLink,eventHelpers};
export const home='11111111-1111-4111-8111-111111111111',host='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333',eventId='44444444-4444-4444-8444-444444444444';

export async function fixture({test=true,sendError=false}={}){
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;'+
  'create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);'+
  'create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;');
 for(const file of ['schema.sql','calendar.sql','native-calendar-repeats.sql'])await db.exec(read('database/'+file));
 const migration=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_event_guest_rsvp.sql'));
 await db.exec(read('supabase/migrations/'+migration));
 await db.query("insert into auth.users values ($1,'host@example.invalid',now()),($2,'outsider@example.invalid',now())",[host,outsider]);
 await db.query("insert into public.households(id,name,owner_id) values ($1,'Example Home',$2)",[home,host]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values ($1,$2,'Alex & Sam','owner')",[home,host]);
 await db.query("insert into public.household_events(id,household_id,title,description,location,starts_at,ends_at) values ($1,$2,'Family dinner','Private note','Front porch','2090-11-18T23:00:00Z','2090-11-19T01:00:00Z')",[eventId,home]);
 const master=(await db.query('select * from public.household_events')).rows[0];
 const env={
  SUPABASE_URL:test?'https://ybizqfghnplcxlmlhvyn.supabase.co':'https://njpdqiwrwgoothkstoql.supabase.co',
  HH_EMAIL_APP_PASSWORD:'abcdefghijklmnop'
 };
 let handler;
 const sent=[];
 compile('supabase/functions/event-guests/index.ts',{
  'npm:@supabase/supabase-js@2.118.0':{createClient:()=>({
   auth:{getUser:async token=>({data:{user:token==='host'||token==='outsider'?{id:token==='host'?host:outsider,email_confirmed_at:'2026-11-01'}:null},error:null})},
   rpc:async(name,args)=>{
    try{return {data:(await db.query('select public.event_guest_service($1,$2) as result',[args.action,args.payload])).rows[0].result,error:null}}
    catch(error){return {data:null,error}}
   }
  })},
  '../invitation-email/smtp.ts':{sendGmail:async mail=>{sent.push(mail);if(sendError)throw Error('Synthetic mail error');}},
  '../invitation-email/message.ts':invitations,'./event.ts':eventHelpers,'./message.ts':message
 },{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}}});
 function request(body,{auth='',origin='https://zethhummel-rgb.github.io',method='POST'}={}){
  return handler(new Request(env.SUPABASE_URL+'/functions/v1/event-guests',{
   method,headers:{Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})
  }));
 }
 return {db,master,request,sent};
}
