import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=ts.transpileModule(read('supabase/functions/event-addresses/handler.ts'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText;
const {eventAddressHandler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const db=new PGlite();
const member='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const origin='https://zethhummel-rgb.github.io';
const sql=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0]||{})[0];
await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;grant usage on schema private to service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.household_members(user_id uuid primary key references auth.users(id) on delete cascade);`);
for(const actor of [member,other,outsider])await db.query('insert into auth.users values($1)',[actor]);
for(const actor of [member,other])await db.query('insert into public.household_members values($1)',[actor]);
await db.exec(read('supabase/migrations/20261118235745_event_address_quota.sql'));
for(const role of ['anon','authenticated']){
 assert.equal(await sql("select has_function_privilege($1,'public.reserve_event_address_request(uuid,integer)','execute')",[role]),false);
 assert.equal(await sql("select has_table_privilege($1,'private.event_address_monthly_usage','select')",[role]),false);
}
const reserve=(actor,limit)=>sql('select public.reserve_event_address_request($1,$2)',[actor,limit]);
let providerCalls=0;
let providerFailure=false;
const tokens={'member':member,'other':other,'outsider':outsider};
const admin={
 auth:{getUser:async token=>({data:{user:tokens[token]?{id:tokens[token],email_confirmed_at:'2026-01-01'}:null},error:null})},
 rpc:async(name,{actor,monthly_limit})=>{
  assert.equal(name,'reserve_event_address_request');
  return {data:await reserve(actor,monthly_limit),error:null};
 }
};
const google=async(url,request)=>{
 providerCalls++;
 assert.equal(url,'https://places.googleapis.com/v1/places:autocomplete');
 assert.equal(request.headers['X-Goog-Api-Key'],'fixture-api-key');
 assert.equal(request.headers['X-Goog-FieldMask'],'suggestions.placePrediction.text.text');
 const body=JSON.parse(request.body);
 assert.equal(body.input,'12 Main');
 assert.equal(body.regionCode,'ca');
 assert.deepEqual(body.includedPrimaryTypes,['street_address','subpremise']);
 assert.deepEqual(Object.keys(body),['input','regionCode','languageCode','includedPrimaryTypes']);
 if(providerFailure)return Response.json({error:'Private provider detail'},{status:503});
 const candidate={placePrediction:{text:{text:'12 Main Street, Example City, ON, Canada'}}};
 return Response.json({suggestions:[candidate,{queryPrediction:{text:{text:'not a street address'}}},candidate]});
};
const handler=eventAddressHandler(admin,{origin,apiKey:'fixture-api-key',monthlyLimit:3},google);
const call=(token,fields={query:' 12 Main '},extra={})=>handler(new Request('https://fixture.invalid/event-addresses',{
 method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},
 body:JSON.stringify(fields)
}));
assert.equal((await call()).status,401);
assert.equal((await call('expired')).status,401);
assert.equal((await call('outsider',{query:'12 Main',actor:member})).status,403);
assert.equal((await call('member',undefined,{origin:'https://untrusted.invalid'})).status,403);
assert.equal((await call('member',{query:'123'})).status,400);
assert.equal(providerCalls,0);
const first=await call('member',{query:' 12 Main ',monthly_limit:8500,actor:other});
assert.equal(first.headers.get('Cache-Control'),'no-store');
assert.deepEqual(await first.json(),{status:'ok',suggestions:['12 Main Street, Example City, ON, Canada']});
providerFailure=true;
assert.deepEqual(await (await call('member')).json(),{status:'unavailable',suggestions:[]});
assert.equal(providerCalls,2,'A failed provider request still counts and is never retried');
providerFailure=false;
const finalSlots=await Promise.all([call('member'),call('other'),call('member')].map(request=>request.then(result=>result.json())));
assert.equal(finalSlots.filter(result=>result.status==='ok').length,1);
assert.equal(finalSlots.filter(result=>result.status==='paused').length,2);
assert.equal(providerCalls,3,'No fourth provider request can leave the server after the cutoff');
const month=await sql("select billing_month::text from private.event_address_monthly_usage");
await db.query("update private.event_address_monthly_usage set billing_month=($1::date-interval '1 month')::date",[month]);
assert.equal(await reserve(other,3),'allowed','Previous billing month does not consume the new month');
const usage=await sql("select requests from private.event_address_monthly_usage where billing_month=$1",[month]);
await db.query("update private.event_address_member_limit set minute=date_trunc('minute',statement_timestamp()),requests=18 where user_id=$1",[member]);
assert.equal(await reserve(member,3),'rate_limited');
assert.equal(await sql("select requests from private.event_address_monthly_usage where billing_month=$1",[month]),usage);
await db.exec('delete from public.household_members where user_id=\''+other+'\'');
assert.equal(await reserve(other,3),'forbidden');
await db.close();
let venueProviderCalls=0,venueSlots=2;
const lookupVenue=eventAddressHandler({
 ...admin,
 rpc:async(name,{actor,monthly_limit})=>{
  assert.equal(name,'reserve_event_address_request');assert.equal(actor,member);assert.equal(monthly_limit,50);
  return {data:venueSlots-->0?'allowed':'paused',error:null};
 }
},{origin,apiKey:'fixture-api-key',monthlyLimit:50},async(url,request)=>{
 venueProviderCalls++;
 if(url.endsWith('/places:autocomplete')){
  assert.deepEqual(JSON.parse(request.body),{input:'Cornwall Hospital',regionCode:'ca',languageCode:'en',includedRegionCodes:['ca']});
  const suggestion=(placeId,name,address)=>({placePrediction:{placeId,structuredFormat:{
   mainText:{text:name},secondaryText:{text:address}
  }}});
  return Response.json({suggestions:[
   suggestion('department-fixture','Cornwall Hospital Outpatient Health Department','14 Main Street, Example City, ON'),
   suggestion('venue-fixture','Cornwall Community Hospital','Main Street, Example City, ON')
  ]});
 }
 assert.equal(url,'https://places.googleapis.com/v1/places/venue-fixture');
 assert.equal(request.headers['X-Goog-FieldMask'],'formattedAddress');
 return Response.json({formattedAddress:'12 Main Street, Example City, ON, Canada'});
});
const venueCall=()=>lookupVenue(new Request('https://fixture.invalid/event-addresses',{
 method:'POST',headers:{origin,authorization:'Bearer member','content-type':'application/json'},body:JSON.stringify({query:'Cornwall Hospital'})
}));
const department={name:'Cornwall Hospital Outpatient Health Department',address:'14 Main Street, Example City, ON'};
assert.deepEqual(await (await venueCall()).json(),{status:'ok',suggestions:[],venues:[
 {name:'Cornwall Community Hospital',address:'12 Main Street, Example City, ON, Canada'},department
]});
assert.equal(venueProviderCalls,2);
venueSlots=1;
assert.deepEqual(await (await venueCall()).json(),{status:'ok',suggestions:[],venues:[
 {name:'Cornwall Community Hospital',address:'Main Street, Example City, ON'},department
]});
assert.equal(venueProviderCalls,3,'Venue details cannot make a Google request past the shared cutoff');
console.log('Event location checks passed: membership, monthly cutoff, numbered addresses, venue names, and separately reserved venue detail lookups. Google was simulated.');
