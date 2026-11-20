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
  const openCalendar=async()=>{
   await page.getByRole('button',{name:'Open Settings',exact:true}).click();
   await page.getByRole('button',{name:/^Calendar /}).click();
  };
  await page.addInitScript(value=>{
   if(!sessionStorage.getItem('outlook-fixture')){
    localStorage.setItem('hh-test:hh-test:home-together-auth',JSON.stringify(value));
    sessionStorage.setItem('outlook-fixture','1');
   }
  },session);
  const calls=[],calendars=[{id:'calendar=existing',name:'Existing family calendar'}];
  const family={id:'calendar=family',name:'HH Family'},googleChoice={id:'existing-google',name:'Original Google calendar'};
  const googleCalls=[];
  let googleExisting=false;
  let status={available:true,active:false};
  let googleStatus={available:true,configured:true,connected:false,status:'off'};
  setFixtureHandler(async route=>{
   const req=route.request(),target=new URL(req.url()),resource=target.pathname.split('/').pop();
   let data=[];
   if(resource==='outlook-calendar'){
    const payload=req.postDataJSON();
    assert.equal(req.headers().authorization,'Bearer '+session.access_token);
    assert.equal(payload.householdId,householdId);
    calls.push(payload);
    if(payload.action==='authorize')return route.fulfill({status:200,json:{url:'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'}});
    if(payload.action==='complete'){
     assert.deepEqual([payload.state,payload.code],[state,code]);
     status={...status,calendars};
    }
    if(payload.action==='create_family'){
     status={...status,calendars:[...calendars,family]};
     return route.fulfill({status:200,json:{calendarId:family.id}});
    }
    if(payload.action==='connect'){
     assert.equal(payload.calendarId,family.id);
     assert.equal(payload.importEvents,true);
     status={available:true,active:true,calendarName:family.name,importEvents:true};
    }
    if(payload.action==='sync')status={...status,syncedAt:new Date().toISOString()};
    if(payload.action==='disconnect')status={...status,active:false};
    data=payload.action==='status'?status:{ok:true};
   }else if(resource==='google-calendar'){
    const payload=req.postDataJSON();
    if(['personal_existing_start','personal_two_way_copy_start'].includes(payload?.action)){
     googleExisting=payload.action==='personal_existing_start';
     googleCalls.push(payload.action);
     return route.fulfill({status:200,json:{url:'https://accounts.google.com/o/oauth2/v2/auth'}});
    }
    if(payload?.action==='personal_complete'){
     googleCalls.push(payload.action);
     googleStatus=googleExisting?{...googleStatus,choices:[googleChoice]}:
      {...googleStatus,connected:true,status:'pending',twoWay:{enabled:true,ready:false}};
    }
    if(payload?.action==='personal_existing_connect'){
     assert.equal(payload.calendarId,googleChoice.id);
     assert.equal(payload.acknowledgeShared,true);
     googleCalls.push(payload.action);
     googleStatus={...googleStatus,choices:null,existingSource:true,calendarName:googleChoice.name,connected:true,status:'pending',
      twoWay:{enabled:true,ready:false}};
    }
    if(payload?.action==='personal_disconnect'){
     googleCalls.push(payload.action);
     googleStatus={available:true,configured:true,connected:false,status:'off'};
    }
    data=payload?.action==='personal_status'?googleStatus:{};
   }else if(target.pathname.startsWith('/auth/'))data=user;
   else if(resource==='household_members')data=[{household_id:householdId,user_id:userId,display_name:'Fixture member',role:'member'}];
   else if(resource==='households')data={calendar_id:'',name:'TEST household'};
   else if(resource==='household_transition_active')data=false;
   else if(resource==='household_calendar_source')data='hh';
   else if(target.pathname.includes('/rpc/'))data={};
   if(req.headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]||null;
   await route.fulfill({status:200,json:data});
  });
  const outlookReturn=url+'?outlook_calendar=return#'+new URLSearchParams({outlook_state:state,outlook_code:code}).toString();
  await page.route('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',route=>route.fulfill({
   contentType:'text/html',body:'<script>location.replace('+JSON.stringify(outlookReturn)+')</script>'
  }));
  await page.goto(url);
  await openCalendar();
  const card=page.locator('.settings-calendar-card').filter({has:page.getByRole('heading',{name:'Outlook Calendar',exact:true})});
  assert.equal(await card.getByRole('button',{name:'Send HH events to Outlook',exact:true}).count(),0);
  await card.getByRole('button',{name:'Use both HH and Outlook',exact:true}).click();
  const finish=page.getByRole('dialog',{name:'Finish calendar setup',exact:true});
  const connected=page.getByRole('dialog',{name:'Calendar connected',exact:true});
  const connect=finish.getByRole('button',{name:'Start two-way sync',exact:true});
  await connect.waitFor();
  assert.equal(await finish.getByRole('heading',{name:'My Google Calendar'}).count(),0);
  assert.ok(await connect.isDisabled());
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(new URL(page.url()).search,'');
  assert.equal(calls.filter(call=>call.action==='complete').length,1);
  assert.equal(calls.some(call=>call.action==='connect'),false);
  await card.getByText('Signed in to Microsoft',{exact:true}).waitFor();
  await card.getByRole('button',{name:'Create HH Family calendar',exact:true}).click();
  await card.getByText('HH Family is selected. Start syncing to finish setup.',{exact:true}).waitFor();
  assert.equal(await card.getByLabel('Outlook calendar',{exact:true}).inputValue(),family.id);
  assert.ok(await connect.isEnabled());
  await connect.click();
  await connected.locator('p').filter({hasText:/HH Family.*Syncing both ways/}).waitFor();
  await connected.getByRole('button',{name:'Close',exact:true}).click();
  await openCalendar();
  await card.getByRole('button',{name:'Sync now',exact:true}).click();
  await card.getByText('Calendar synced.',{exact:true}).waitFor();
  await card.getByRole('button',{name:'Disconnect Outlook',exact:true}).click();
  await card.getByRole('button',{name:'Use both HH and Outlook',exact:true}).waitFor();
  assert.deepEqual(calls.map(call=>call.action).filter(action=>action!=='status'),['authorize','complete','create_family','connect','sync','disconnect']);
  console.log('Outlook browser passed: only two-way setup, focused finish dialog, calendar creation, connection and disconnect.');

  const googleReturn=url+'?personal_calendar=return#'+new URLSearchParams({
   personal_calendar_state:'hhp_'+state,personal_calendar_code:'synthetic-google-code'
  }).toString();
  await page.route('https://accounts.google.com/**',route=>route.fulfill({
   contentType:'text/html',body:'<script>location.replace('+JSON.stringify(googleReturn)+')</script>'
  }));
  const googleCard=page.locator('.settings-calendar-card').filter({has:page.getByRole('heading',{name:'My Google Calendar',exact:true})});
  await googleCard.getByRole('button',{name:'Create an HH calendar in Google',exact:true}).waitFor();
  await googleCard.getByRole('button',{name:'Use an existing Google calendar',exact:true}).click();
  const importGoogle=finish.getByRole('button',{name:'Start two-way sync',exact:true});
  await importGoogle.waitFor();
  assert.equal(await finish.getByRole('heading',{name:'Outlook Calendar'}).count(),0);
  assert.ok(await importGoogle.isDisabled());
  await googleCard.getByLabel('Google calendar',{exact:true}).selectOption(googleChoice.id);
  assert.ok(await importGoogle.isDisabled());
  await googleCard.getByRole('checkbox',{name:/Share ordinary events/}).check();
  await importGoogle.click();
  await connected.locator('p').filter({hasText:/Original Google calendar.*Syncing both ways/}).waitFor();
  assert.deepEqual(googleCalls,['personal_existing_start','personal_complete','personal_existing_connect']);
  await connected.getByRole('button',{name:'Close',exact:true}).click();
  await openCalendar();
  await googleCard.getByRole('button',{name:'Disconnect my Google Calendar',exact:true}).click();
  await googleCard.getByRole('button',{name:'Disconnect',exact:true}).click();
  await googleCard.getByRole('button',{name:'Create an HH calendar in Google',exact:true}).click();
  await connected.getByText('Google Calendar connected for two-way sync.',{exact:true}).waitFor();
  assert.equal(await connected.getByRole('button',{name:'Enable two-way sync'}).count(),0);
  assert.deepEqual(googleCalls.slice(-3),['personal_disconnect','personal_two_way_copy_start','personal_complete']);
  console.log('Google browser passed: existing calendar picker and consent, new HH calendar with two-way sync from sign-in.');
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
