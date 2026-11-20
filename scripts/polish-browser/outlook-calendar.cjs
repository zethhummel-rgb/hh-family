const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const householdId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const user={id:userId,email:'outlook-fixture@example.invalid',aud:'authenticated',role:'authenticated',
 user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
const expires=Math.floor(Date.now()/1000)+86400,b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const session={access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp:expires,sub:userId,aud:'authenticated',role:'authenticated'}),'fixture'].join('.'),
 refresh_token:'fixture',expires_in:86400,expires_at:expires,token_type:'bearer',user};
const state='s'.repeat(43),code='synthetic-outlook-code';

(async()=>{
 const dir=path.resolve('dist');
 const server=http.createServer(async(req,res)=>{
  if(await serveFixture(req,res))return;
  const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/hummel-home\//,'')||'index.html';
  const file=path.join(dir,relative);
  if(!file.startsWith(dir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await launchBrowser();
  const url='http://127.0.0.1:'+server.address().port+'/hummel-home/';
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.addInitScript(redirectFixtureAPI);
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  await page.addInitScript(value=>{
   if(!sessionStorage.getItem('outlook-fixture')){
    localStorage.setItem('hh-test:hh-test:home-together-auth',JSON.stringify(value));
    sessionStorage.setItem('outlook-fixture','1');
   }
  },session);
  const calls=[],calendars=[{id:'calendar=existing',name:'Existing family calendar'}];
  let status={available:true,active:false};
  setFixtureHandler(async route=>{
   const req=route.request(),target=new URL(req.url()),resource=target.pathname.split('/').pop();
   let data=[];
   if(resource==='outlook-calendar'){
    const payload=req.postDataJSON();
    assert.equal(req.headers().authorization,'Bearer '+session.access_token);
    assert.equal(payload.householdId,householdId);
    calls.push(payload);
    if(payload.action==='complete'){
     assert.deepEqual([payload.state,payload.code],[state,code]);
     status={...status,calendars};
    }
    if(payload.action==='connect'){
     assert.equal(payload.calendarId,calendars[0].id);
     status={available:true,active:true,calendarName:calendars[0].name};
    }
    if(payload.action==='sync')status={...status,syncedAt:new Date().toISOString()};
    if(payload.action==='disconnect')status={...status,active:false};
    data=payload.action==='status'?status:{ok:true};
   }else if(target.pathname.startsWith('/auth/'))data=user;
   else if(resource==='household_members')data=[{household_id:householdId,user_id:userId,display_name:'Fixture member',role:'member'}];
   else if(resource==='households')data={calendar_id:'',name:'TEST household'};
   else if(resource==='household_transition_active')data=false;
   else if(resource==='household_calendar_source')data='hh';
   else if(target.pathname.includes('/rpc/'))data={};
   if(req.headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]||null;
   await route.fulfill({status:200,json:data});
  });
  await page.goto(url+'?outlook_calendar=return#'+new URLSearchParams({outlook_state:state,outlook_code:code}).toString());
  const card=page.locator('.settings-calendar-card').filter({has:page.getByRole('heading',{name:'Outlook Calendar',exact:true})});
  const connect=card.getByRole('button',{name:'Connect selected calendar',exact:true});
  await connect.waitFor();
  assert.ok(await connect.isDisabled());
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(new URL(page.url()).search,'');
  assert.equal(calls.filter(call=>call.action==='complete').length,1);
  assert.equal(calls.some(call=>call.action==='connect'),false);
  await card.getByLabel('Outlook calendar',{exact:true}).selectOption(calendars[0].id);
  await connect.click();
  await card.getByText(calendars[0].name,{exact:true}).waitFor();
  await card.getByRole('button',{name:'Sync now',exact:true}).click();
  await card.getByText('Calendar synced.',{exact:true}).waitFor();
  await card.getByRole('button',{name:'Disconnect Outlook',exact:true}).click();
  await card.getByRole('button',{name:'Reconnect Outlook',exact:true}).waitFor();
  assert.deepEqual(calls.map(call=>call.action).filter(action=>action!=='status'),['complete','connect','sync','disconnect']);
  console.log('Outlook browser passed: returning from Microsoft, choosing an existing calendar, syncing and disconnecting as a regular member.');
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
