const placesUrl='https://places.googleapis.com/v1/places:autocomplete';
const addressTypes=['street_address','subpremise'];
type SupabaseService={
 auth:{getUser:(token:string)=>PromiseLike<{data:{user:{id:string;email_confirmed_at?:string}|null};error:unknown}>};
 rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
};
type Config={origin:string;apiKey:string;monthlyLimit:number};
type ProviderResponse={suggestions?:{placePrediction?:{text?:{text?:unknown}}}[]};

export function eventAddressHandler(admin:SupabaseService,config:Config,fetcher:typeof fetch=fetch){
 const headers={
  'Access-Control-Allow-Origin':config.origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'
 };
 const json=(status:string,suggestions:string[]=[],code=200)=>Response.json({status,suggestions},{status:code,headers});
 return async(req:Request)=>{
  if(req.headers.get('origin')!==config.origin)return json('forbidden',[],403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return json('invalid',[],405);
  try{
   const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   if(!bearer)return json('sign_in',[],401);
   const {data,error}=await admin.auth.getUser(bearer);
   if(error||!data.user||!data.user.email_confirmed_at)return json('sign_in',[],401);
   if(!config.apiKey||!config.monthlyLimit)return json('unavailable');
   const raw=await req.text();
   if(raw.length>2048)return json('invalid',[],400);
   let input:unknown;
   try{input=JSON.parse(raw)?.query}catch{return json('invalid',[],400)}
   if(typeof input!=='string')return json('invalid',[],400);
   const query=input.trim();
   if(query.length<3||query.length>300||!/\d/u.test(query)||!/\p{L}/u.test(query)||/[\x00-\x1f\x7f]/u.test(query))return json('invalid',[],400);
   const reservation=await admin.rpc('reserve_event_address_request',{actor:data.user.id,monthly_limit:config.monthlyLimit});
   if(reservation.error)return json('unavailable');
   if(reservation.data==='forbidden')return json('forbidden',[],403);
   if(reservation.data==='paused'||reservation.data==='rate_limited')return json(reservation.data);
   if(reservation.data!=='allowed')return json('unavailable');

   // One provider request per reservation. No automatic retries or Place Details requests.
   const upstream=await fetcher(placesUrl,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{
     'Content-Type':'application/json','X-Goog-Api-Key':config.apiKey,'X-Goog-FieldMask':'suggestions.placePrediction.text.text'
    },
    body:JSON.stringify({input:query,regionCode:'ca',languageCode:'en',includedPrimaryTypes:addressTypes})
   });
   if(!upstream.ok)return json('unavailable');
   const payload:ProviderResponse=await upstream.json();
   if(payload.suggestions!==undefined&&!Array.isArray(payload.suggestions))return json('unavailable');
   const suggestions=(payload.suggestions||[]).flatMap(item=>{
    const address=item?.placePrediction?.text?.text;
    return typeof address==='string'&&address.trim()&&address.length<=300?[address.trim()]:[];
   });
   return json('ok',[...new Set(suggestions)].slice(0,5));
  }catch{return json('unavailable')}
 };
}
