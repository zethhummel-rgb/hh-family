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
export const guestId='55555555-5555-4555-8555-555555555555',guestHome='66666666-6666-4666-8666-666666666666';
const users={host,outsider,guest:guestId};

export async function fixture({test=true,sendError=false}={}){
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;'+
  'create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);'+
  "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 for(const file of ['schema.sql','calendar.sql','native-calendar-repeats.sql'])await db.exec(read('database/'+file));
 await db.exec("alter table public.household_events add column reminder_30_enabled boolean default true;create function private.native_calendar_writable(hid uuid) returns boolean language sql stable as $$select private.is_member(hid)$$;");
 const migrations=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url));
 for(const suffix of ['_event_guest_rsvp.sql','_event_guest_hh_calendar.sql']){
  const migration=migrations.find(name=>name.endsWith(suffix));
  await db.exec(read('supabase/migrations/'+migration));
 }
 await db.query("insert into auth.users values ($1,'host@example.invalid',now()),($2,'outsider@example.invalid',now()),($3,'guest@example.invalid',now())",[host,outsider,guestId]);
 await db.query("insert into public.households(id,name,owner_id) values ($1,'Example Home',$2)",[home,host]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values ($1,$2,'Alex & Sam','owner')",[home,host]);
 await db.query("insert into public.households(id,name,owner_id) values ($1,'Guest Home',$2)",[guestHome,guestId]);
 await db.query("insert into public.household_members(household_id,user_id,display_name,role) values ($1,$2,'Guest','owner')",[guestHome,guestId]);
 await db.query("insert into public.household_events(id,household_id,title,description,location,starts_at,ends_at) values ($1,$2,'Family dinner','Private note','Front porch','2090-11-18T23:00:00Z','2090-11-19T01:00:00Z')",[eventId,home]);
 const master=(await db.query('select * from public.household_events')).rows[0];
 const env={
  SUPABASE_URL:test?'https://ybizqfghnplcxlmlhvyn.supabase.co':'https://njpdqiwrwgoothkstoql.supabase.co',
  HH_EMAIL_APP_PASSWORD:'abcdefghijklmnop',SUPABASE_ANON_KEY:'test-key'
 };
 let handler;
 const sent=[];
 compile('supabase/functions/event-guests/index.ts',{
  'npm:@supabase/supabase-js@2.118.0':{createClient:(_url,_key,options)=>({
   auth:{getUser:async token=>({data:{user:users[token]?{id:users[token],email_confirmed_at:'2026-11-01'}:null},error:null})},
   rpc:async(name,args)=>{
    try{
     if(name==='event_guest_hh_calendar'){
      const result=await db.transaction(async tx=>{
       await tx.exec('set local role authenticated');
       await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[options.global.headers.Authorization.slice(7)]]);
       return tx.query('select public.event_guest_hh_calendar($1,$2,$3) as result',[args.action,args.capability,args.shared_event]);
      });
      return {data:result.rows[0].result,error:null};
     }
     return {data:(await db.query('select public.event_guest_service($1,$2) as result',[args.action,args.payload])).rows[0].result,error:null};
    }
    catch(error){return {data:null,error}}
   }
  })},
  '../invitation-email/smtp.ts':{sendGmail:async mail=>{sent.push(mail);if(sendError)throw Error('Synthetic mail error');}},
  '../invitation-email/message.ts':invitations,'./event.ts':eventHelpers,'./message.ts':message,'../google-calendar/native.ts':native
 },{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}}});
 function request(body,{auth='',origin='https://zethhummel-rgb.github.io',method='POST'}={}){
  return handler(new Request(env.SUPABASE_URL+'/functions/v1/event-guests',{
   method,headers:{Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})
  }));
 }
 return {db,master,request,sent};
}
