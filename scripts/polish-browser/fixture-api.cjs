// Serve synthetic API responses on loopback. This also works after WebKit's
// service worker takes control, when Playwright routing no longer sees requests.
const origin='https://ybizqfghnplcxlmlhvyn.supabase.co';
let handler;
exports.setFixtureHandler=fn=>{handler=fn};
exports.serveFixture=async(req,res)=>{
 if(!req.url.startsWith('/__fixture_api/'))return false;
 try{
  let body='';for await(const chunk of req)body+=chunk;
  if(!handler)throw Error('Fixture handler is not registered');
  await handler({request:()=>({url:()=>origin+req.url.slice('/__fixture_api'.length),method:()=>req.method,headers:()=>req.headers,postDataJSON:()=>body?JSON.parse(body):null}),
   fulfill:async({status=200,json,body:raw,headers={}})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(json===undefined?(raw||''):JSON.stringify(json))},
   abort:async()=>{req.socket.destroy()}});
 }catch(error){console.error('Fixture API failure:',error);if(!res.headersSent)res.writeHead(500);res.end(JSON.stringify({message:'Fixture API failed'}))}
 return true;
};
exports.redirectFixtureAPI=()=>{
 const nativeFetch=window.fetch.bind(window);
 window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(url.origin==='https://ybizqfghnplcxlmlhvyn.supabase.co'){
   const target=location.origin+'/__fixture_api'+url.pathname+url.search;
   return nativeFetch(input instanceof Request?new Request(target,input):target,init);
  }
  return nativeFetch(input,init);
 };
};

