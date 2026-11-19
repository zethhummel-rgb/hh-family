const placesUrl='https://places.googleapis.com/v1/places:autocomplete';
const addressTypes=['street_address','subpremise'];
type SupabaseService={
 auth:{getUser:(token:string)=>PromiseLike<{data:{user:{id:string;email_confirmed_at?:string}|null};error:unknown}>};
 rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
};
type Config={origin:string;apiKey:string;monthlyLimit:number};
type TextValue={text?:unknown};
type Prediction={placeId?:unknown;text?:TextValue;structuredFormat?:{mainText?:TextValue;secondaryText?:TextValue}};
type ProviderResponse={suggestions?:{placePrediction?:Prediction}[]};
type Venue={placeId:string;name:string;address:string};
const text=(value:unknown)=>(typeof value==='string'&&value.length<=300?value.trim():'');
const validPlaceId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,300}$/.test(value);
const nameWords=(value:string)=>value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]+/gu)||[];

export function eventAddressHandler(admin:SupabaseService,config:Config,fetcher:typeof fetch=fetch){
 const headers={
  'Access-Control-Allow-Origin':config.origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'
 };
 const json=(status:string,suggestions:string[]=[],code=200,venues?:Venue[])=>Response.json(
  {status,suggestions,...(venues?{venues}:{})},{status:code,headers}
 );
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
   let input:{query?:unknown;placeId?:unknown;streetOnly?:unknown}|null;
   try{input=JSON.parse(raw)}catch{return json('invalid',[],400)}
   const placeId=input?.placeId;
   const savedPlace=placeId!==undefined;
   const query=typeof input?.query==='string'?input.query.trim():'';
   if(savedPlace?!validPlaceId(placeId):query.length<3||query.length>300||!/\p{L}/u.test(query)||/[\x00-\x1f\x7f]/u.test(query))return json('invalid',[],400);
   const venueSearch=input?.streetOnly!==true&&!/^#?\s*\d/u.test(query);
   const actor=data.user.id;
   // Name lookups for saved places use the Pro SKU and share the existing
   // counter. Keep them under its own free allowance without raising either cap.
   const reserve=(limit=config.monthlyLimit)=>admin.rpc('reserve_event_address_request',{actor,monthly_limit:limit});
   const reservation=await reserve(savedPlace?Math.min(config.monthlyLimit,4500):config.monthlyLimit);
   if(reservation.error)return json('unavailable');
   if(reservation.data==='forbidden')return json('forbidden',[],403);
   if(reservation.data==='paused'||reservation.data==='rate_limited')return json(reservation.data);
   if(reservation.data!=='allowed')return json('unavailable');

   const apiHeaders={'X-Goog-Api-Key':config.apiKey};
   const details=(id:string,fields:string)=>fetcher('https://places.googleapis.com/v1/places/'+encodeURIComponent(id),{
    redirect:'error',signal:AbortSignal.timeout(2500),headers:{...apiHeaders,'X-Goog-FieldMask':fields}
   });
   if(validPlaceId(placeId)){
    const resolved=await details(placeId,'displayName,formattedAddress');
    if(!resolved.ok)return json('unavailable');
    const place=await resolved.json();
    const name=text(place.displayName?.text),address=text(place.formattedAddress);
    return name&&address?json('ok',[],200,[{placeId,name,address}]):json('unavailable');
   }
   const upstream=await fetcher(placesUrl,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{
     ...apiHeaders,'Content-Type':'application/json','X-Goog-FieldMask':venueSearch?
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat':'suggestions.placePrediction.text.text'
    },
    body:JSON.stringify({input:query,regionCode:'ca',languageCode:'en',...(venueSearch?{includedRegionCodes:['ca']}:{includedPrimaryTypes:addressTypes})})
   });
   if(!upstream.ok)return json('unavailable');
   const payload:ProviderResponse=await upstream.json();
   if(payload.suggestions!==undefined&&!Array.isArray(payload.suggestions))return json('unavailable');
   if(venueSearch){
    const queryWords=nameWords(query);
    const matches=(payload.suggestions||[]).flatMap(item=>{
     const place=item?.placePrediction;
     const name=text(place?.structuredFormat?.mainText?.text),address=text(place?.structuredFormat?.secondaryText?.text);
     if(!name||!address||!validPlaceId(place?.placeId))return [];
     const words=nameWords(name);
     const rank=queryWords.every(word=>words.includes(word))?words.length:Number.MAX_SAFE_INTEGER;
     return [{name,address,placeId:place.placeId,rank}];
    }).sort((first,second)=>first.rank-second.rank).slice(0,5);
    const top=matches[0];
    // Autocomplete can omit the street number for a venue. Only complete the
    // best match, and reserve a second slot before sending the detail request.
    if(top&&!/^\d+\p{L}?\s+\p{L}/u.test(top.address)){
     try{
      const detailSlot=await reserve();
      if(!detailSlot.error&&detailSlot.data==='allowed'){
       const resolved=await details(top.placeId,'formattedAddress');
       if(resolved.ok)top.address=text((await resolved.json()).formattedAddress)||top.address;
      }
     }catch{/* The autocomplete result is still available. */}
    }
    const venues=[...new Map(matches.map(({name,address,placeId})=>[placeId,{name,address,placeId}])).values()];
    return json('ok',[],200,venues);
   }
   const suggestions=(payload.suggestions||[]).map(item=>text(item?.placePrediction?.text?.text)).filter(Boolean);
   return json('ok',[...new Set(suggestions)].slice(0,5));
  }catch{return json('unavailable')}
 };
}
