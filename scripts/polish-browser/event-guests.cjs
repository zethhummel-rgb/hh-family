const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

(async()=>{
 const {fixture,home,host,eventId}=await import('../event-guest-fixture.mjs');
 const service=await fixture(),browser=await launchBrowser();
 const start=new Date(Date.now()+60*60*1000).toISOString(),end=new Date(Date.now()+3*60*60*1000).toISOString();
 await service.db.query('update public.household_events set starts_at=$1,ends_at=$2 where id=$3',[start,end,eventId]);
 const event={...service.master,starts_at:start,ends_at:end};
 const user={id:host,email:'host@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
 const member={user_id:host,display_name:'Alex & Sam',role:'owner',household_id:home};
 const exp=Math.floor(Date.now()/1000)+86400;
 const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const session={access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp,sub:host,aud:'authenticated',role:'authenticated',session_id:home}),'fixture'].join('.'),refresh_token:'fixture',expires_in:86400,expires_at:exp,token_type:'bearer',user};
 const dir=path.resolve('dist'),calls=[];
 const server=http.createServer(async(req,res)=>{
  if(await serveFixture(req,res))return;
  const rel=new URL(req.url,'http://localhost').pathname.replace(/^\/hummel-home\//,'')||'index.html';
  const file=path.join(dir,rel);
  if(!file.startsWith(dir)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
  res.setHeader('Content-Security-Policy',"connect-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'");
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/hummel-home/';
 setFixtureHandler(async route=>{
  const req=route.request(),target=new URL(req.url()),table=target.pathname.split('/').pop();
  if(table==='event-guests'){
   const payload=req.postDataJSON(),signedIn=req.headers().authorization==='Bearer '+session.access_token;
   calls.push({action:payload.action,signedIn});
   const reply=await service.request(payload,{auth:signedIn?'host':''});
   return route.fulfill({status:reply.status,json:await reply.json()});
  }
  let data=[];
  if(target.pathname.startsWith('/auth/'))data=user;
  else if(table==='household_members')data=[member];
  else if(table==='households')data={name:'Example Home',calendar_id:''};
  else if(table==='household_events')data=[event];
  else if(table==='household_calendar_source')data='hh';
  else if(table==='google-calendar')data={configured:false,connected:false,nativeReady:true};
  if(req.headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]||null;
  await route.fulfill({json:data});
 });
 async function context(){
  const current=await browser.newContext({viewport:{width:390,height:844}});
  await current.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
  await current.routeWebSocket('**/*',socket=>socket.close());
  await current.addInitScript(redirectFixtureAPI);
  return current;
 }
 const errors=[];
 try{
  const hostContext=await context();
  await hostContext.addInitScript(({session,home,host})=>{
   localStorage.setItem('hh-test:hh-test:home-together-auth',JSON.stringify(session));
   localStorage.setItem('hh:family-setup:v1:'+host+':'+home,'done');
  },{session,home,host});
  const hostPage=await hostContext.newPage();
  hostPage.on('pageerror',e=>errors.push(e.message));
  await hostPage.goto(url);
  const setup=hostPage.getByRole('button',{name:/Skip setup|Finish setup/i}).first();
  if(await setup.isVisible())await setup.click();
  await hostPage.locator('.home-events').getByText('Family dinner',{exact:true}).click();
  await hostPage.getByRole('button',{name:'Invite guests & view RSVPs'}).click();
  await hostPage.getByLabel('Guest email',{exact:true}).fill('guest@example.invalid');
  await hostPage.getByLabel('Message for this guest (optional)',{exact:true}).fill('Bring a snack');
  await hostPage.getByRole('button',{name:'Review invitation',exact:true}).click();
  assert.equal(calls.filter(x=>x.action==='send').length,0);
  await hostPage.getByRole('button',{name:'Create TEST invitation',exact:true}).click();
  const testLink=hostPage.getByRole('link',{name:'No · Decline',exact:true});
  const href=new URL(await testLink.getAttribute('href'));
  const guestContext=await context(),guest=await guestContext.newPage();
  guest.on('pageerror',e=>errors.push(e.message));
  await guest.goto(url+href.hash);
  await guest.getByRole('heading',{name:'Family dinner',exact:true}).waitFor();
  assert.equal(calls.filter(x=>x.action==='respond').length,0,'Opening the email link must leave the RSVP unchanged');
  assert.equal(await guest.getByText('Private note',{exact:true}).count(),0);
  await guest.getByRole('button',{name:'No · Decline',exact:true}).click();
  await guest.getByText('Your reply: No',{exact:true}).waitFor();
  assert.equal(await guest.getByRole('heading',{name:'Add to your calendar'}).count(),0);
  await hostPage.getByRole('button',{name:'Refresh replies'}).click();
  await hostPage.locator('.event-guest-responses li').getByText('No',{exact:true}).waitFor();
  for(const [button,status] of [['Maybe · Add to calendar','Maybe'],['Yes · Add to calendar','Yes']]){
   await guest.getByRole('button',{name:button,exact:true}).click();
   await guest.getByText('Your reply: '+status,{exact:true}).waitFor();
   const link=new URL(await guest.getByRole('link',{name:'Google Calendar'}).getAttribute('href'));
   assert.equal(link.searchParams.get('text'),'Family dinner');
   assert.equal(link.searchParams.get('details'),'Bring a snack');
   const download=guest.waitForEvent('download');
   await guest.getByRole('button',{name:'Apple Calendar or Outlook (.ics)'}).click();
   assert.equal((await download).suggestedFilename(),'hh-event.ics');
   await hostPage.getByRole('button',{name:'Refresh replies'}).click();
   await hostPage.locator('.event-guest-responses li').getByText(status,{exact:true}).waitFor();
   await guest.getByRole('button',{name:'Change my reply'}).click();
  }
  for(const width of [320,390]){
   await guest.setViewportSize({width,height:600});
   assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await hostPage.getByRole('button',{name:'Cancel invitation for guest@example.invalid'}).click();
  await hostPage.getByRole('button',{name:'Cancel invitation',exact:true}).click();
  await guest.reload();
  await guest.getByRole('alert').getByText(/unavailable or has expired/).waitFor();
  assert(calls.filter(x=>['preview','respond'].includes(x.action)).every(x=>!x.signedIn));
  assert.equal(service.sent.length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS Event invitations: host review, private guest link, No without calendar, Maybe and Yes with calendar, refresh, cancellation, and mobile widths');
 }finally{await browser.close();await service.db.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
