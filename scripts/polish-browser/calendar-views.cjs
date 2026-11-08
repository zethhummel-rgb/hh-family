// Synthetic browser regression test. Build VITE_APP_ENV=test first; API requests are mocked.
const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve('dist'),home='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email:'shopper@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
const member={user_id:uid,display_name:'Alex Morgan',role:'member',household_id:home};
const products=['Milk','Bread','Eggs'].map((title,i)=>({id:'33333333-3333-4333-8333-33333333333'+i,title,category:'Dairy & eggs',kind:'grocery',done:false,household_id:home,reminder_version:1,person:'Everyone',created_at:'2026-01-01',grocery_store:'Test market'}));
products.push({...products[1],id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',done:true});
products.push({id:'44444444-4444-4444-8444-444444444444',household_id:home,kind:'task',title:'Book camp tickets',category:'Other',person:'Everyone',done:true,due:'2026-10-01',reminder_version:1,created_at:'2026-01-01'});
const note={id:'55555555-5555-4555-8555-555555555555',household_id:home,title:'Packing checklist',body:'Remember the camp tickets and warm clothes.',pinned:false,version:1,created_at:'2026-01-01',updated_at:'2026-11-01'};
const meal={id:'66666666-6666-4666-8666-666666666666',household_id:home,title:'Camp chili',instructions:'Simmer the beans.',ingredients:[],source_url:'',version:1,meal_date:'2026-09-01',meal_type:'supper',created_at:'2026-01-01',updated_at:'2026-01-01'};
const event={id:'77777777-7777-4777-8777-777777777777',household_id:home,title:'Camp registration',description:'Family day',location:'Cornwall',person:'Everyone',starts_at:'2026-12-01T15:00:00Z',ends_at:'2026-12-01T16:00:00Z',all_day:false,start_date:null,end_date:null,recurrence:[],exceptions:{},version:1};

const calendarEvents=[
 {...event,id:'10000000-0000-4000-8000-000000000001',title:'Midnight finish',starts_at:'2026-12-01T03:07:00Z',ends_at:'2026-12-01T05:00:00Z'},
 {...event,id:'10000000-0000-4000-8000-000000000002',title:'Overnight trip',starts_at:'2026-12-01T04:00:00Z',ends_at:'2026-12-01T07:00:00Z'},
 {...event,id:'10000000-0000-4000-8000-000000000003',title:'Two day holiday',all_day:true,start_date:'2026-11-30',end_date:'2026-12-02',starts_at:'2026-11-30T05:00:00Z',ends_at:'2026-12-02T05:00:00Z'},
 {...event,id:'10000000-0000-4000-8000-000000000004',title:'Riley football practice and team celebration with a very long descriptive title',person:'Riley Morgan',person_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],starts_at:'2026-12-01T22:00:00Z',ends_at:'2026-12-01T23:00:00Z',location:'Riverside community sports field with a long entrance description'},
 {...event,id:'10000000-0000-4000-8000-000000000005',title:'Weekly piano',person:'Casey Morgan',person_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'],starts_at:'2026-11-30T21:00:00Z',ends_at:'2026-11-30T22:00:00Z',recurrence:['RRULE:FREQ=WEEKLY;COUNT=5']}
];
const staple={id:'88888888-8888-4888-8888-888888888888',household_id:home,title:'Camp coffee',category:'Pantry',created_at:'2026-01-01'};
const exp=Math.floor(Date.now()/1000)+86400;
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const session={access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp,sub:uid,aud:'authenticated',role:'authenticated',session_id:home}),'fixture'].join('.'),refresh_token:'fixture',expires_in:86400,expires_at:exp,token_type:'bearer',user};
let server,browser,page,serve=true,writes=0,failWrites=false;
(async()=>{fs.mkdirSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish'),{recursive:true});
 server=http.createServer(async(req,res)=>{if(await serveFixture(req,res))return;
   if(!serve){req.socket.destroy();return;}
   let rel=new URL(req.url,'http://localhost').pathname.replace(/^\/hummel-home\//,'')||'index.html';
   const p=path.join(dir,rel);if(!p.startsWith(dir)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return}
   res.setHeader('Content-Security-Policy',"connect-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'");res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');
   res.end(fs.readFileSync(p));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/hummel-home/';
 browser=await launchBrowser();
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Toronto'});
 // Allow only the local static server. The specific API handler below fulfills every Supabase request from fixtures.
 // Keep loopback requests native across service-worker-controlled reloads; the server already serves every fixture.
 await context.route(url=>url.hostname!=='127.0.0.1',route=>route.abort('blockedbyclient'));
 await context.routeWebSocket('**/*',socket=>socket.close());await context.addInitScript(redirectFixtureAPI);
 setFixtureHandler(async route=>{
   if(!serve){await route.abort('internetdisconnected');return;}
   const req=route.request(),u=new URL(req.url()),table=u.pathname.split('/').pop();
   let data=[];
   if (u.pathname.startsWith('/auth/'))data=user;
   else if(u.pathname.includes('/functions/'))data={configured:false,connected:false,googleConnected:false,nativeReady:true,copyStatus:'off',enabled:false};
   else if(u.pathname.includes('/rpc/'))data=table==='household_transition_active'?false:table==='household_calendar_source'?'hh':{};
   else if(table==='household_members'){if(req.method()==='PATCH')Object.assign(member,req.postDataJSON());data=[member];}
   else if(table==='household_people')data=['Jamie Morgan','Riley Morgan','Casey Morgan'].map((display_name,i)=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'+i,household_id:home,display_name,calendar_color:['#E78725','#467EB6','#C46B8C'][i],linked_user_id:null}));
   else if(table==='households')data={calendar_id:'',name:'The Montgomery-Sutherland Family With A Very Long Household Name'};
   else if(['household_notes','household_meal_plans','household_meal_recipes','household_events','household_grocery_staples'].includes(table)){data=({household_notes:[note],household_meal_plans:[meal],household_meal_recipes:[{...meal,id:'99999999-9999-4999-8999-999999999999',title:'Camp stew'}],household_events:calendarEvents,household_grocery_staples:[staple]})[table];const id=u.searchParams.get('id')?.slice(3);if(id)data=data.filter(row=>row.id===id);}
   else if(table==='household_items'){if(failWrites&&['POST','PATCH'].includes(req.method())){await route.fulfill({status:503,json:{message:'Fixture unavailable'}});return;}
     const id=u.searchParams.get('id')?.slice(3),version=u.searchParams.get('reminder_version')?.slice(3);
     const match=products.filter(p=>(!id||p.id===id)&&(!version||p.reminder_version===Number(version))&&(!u.searchParams.get('kind')||p.kind===u.searchParams.get('kind').slice(3)));
     if(req.method()==='PATCH'){for(const item of match){Object.assign(item,req.postDataJSON());item.reminder_version++;writes++}}
     if(req.method()==='POST'){const item={...req.postDataJSON(),reminder_version:1};products.push(item);match.splice(0,match.length,item);writes++}
     data=match;
   }
   if(req.headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]||null;
   await route.fulfill({status:200,json:data});
 });
 page=await context.newPage();page.setDefaultTimeout(10000);
 await page.addInitScript(({session})=>{Object.defineProperty(navigator,"onLine",{get:()=>localStorage.getItem("fixture-offline")!=="1"});if(!sessionStorage.getItem('shop-fixture')){localStorage.setItem('hh-test:hh-test:home-together-auth',JSON.stringify(session));sessionStorage.setItem('shop-fixture','1')}},{session});



 const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish'),checks=[],errors=[],reloadDiagnostics=[];let reloading=false;
 page.on('pageerror',e=>{
  // WebKit's inspector reports cancelled loopback fetches from the document being
  // replaced as page errors. Keep these diagnostics, but do not classify them as
  // app exceptions. Match only its bootstrap frame during our deliberate reloads.
  const stack=e.stack||'';
  if(reloading&&stack.includes('web-inspector://bootstrap.js')&&stack.includes(new URL(url).origin+'/__fixture_api/')&&stack.includes('due to access control checks.')){reloadDiagnostics.push(stack);return}
  errors.push(e.message);console.error('Calendar page error:',stack||e.message);
 });
 function pass(name){checks.push(name);fs.writeFileSync(path.join(out,'calendar-views.json'),JSON.stringify({checks,errors,reloadDiagnostics},null,2));console.log('PASS '+name)}
 // Reminder date links intentionally open Calendar directly, not Home.
 await page.goto(url+'?reminder_date=2026-11-30');await page.locator('.native-calendar').waitFor();
 const actions=page.getByRole('group',{name:'Calendar actions',exact:true}),filter=actions.getByRole('button',{name:'Filter',exact:true});
 assert.deepEqual(await actions.getByRole('button').allTextContents(),['Today','Filter','Event']);
 assert.equal(await page.getByRole('heading',{name:'Family calendar',exact:true}).count(),0);
 assert.equal(await page.getByRole('dialog',{name:'Filter calendar'}).count(),0);
 await filter.click();const panel=page.getByRole('dialog',{name:'Filter calendar'});await panel.waitFor();
 assert.equal(await panel.locator('select').count(),0);assert.equal(await page.getByRole('button',{name:'Close calendar filter'}).evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await filter.evaluate(el=>el===document.activeElement),true);
 await filter.click();await panel.getByRole('button',{name:'Riley Morgan',exact:true}).click();assert.equal(await panel.count(),0);assert.match(await filter.getAttribute('class'),/has-filter/);assert.match(await filter.getAttribute('title'),/Riley/);
 await filter.click();assert.equal(await panel.getByRole('button',{name:'Riley Morgan',exact:true}).getAttribute('aria-pressed'),'true');await panel.getByRole('button',{name:'Everyone',exact:true}).click();assert.doesNotMatch(await filter.getAttribute('class'),/has-filter/);
 for(const width of [320,390]){await page.setViewportSize({width,height:844});await filter.click();const bounds=await panel.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);await page.screenshot({path:path.join(out,'calendar-filter-'+width+'.png'),fullPage:true});await page.mouse.click(5,450);assert.equal(await panel.count(),0)}
 pass('Compact action row replaces the title; filter opens on demand without a native picker, restores focus, marks selection, clears and fits narrow phones');

 const view=page.getByRole('group',{name:'Calendar view',exact:true});
 assert.deepEqual(await view.getByRole('button').allTextContents(),['Agenda','3 Day','Month']);
 assert.equal(await view.getByRole('button',{name:'Agenda',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:/Midnight finish/}).waitFor();pass('Agenda opens with all three view buttons in requested order');
 await view.getByRole('button',{name:'3 Day',exact:true}).click();
 const days=page.locator('.three-day-agenda .agenda-day');
 assert.deepEqual(await days.evaluateAll(es=>es.map(e=>e.dataset.date)),['2026-11-30','2026-12-01','2026-12-02']);
 await page.getByRole('button',{name:/Riley football practice/}).waitFor();pass('Three day window loads events across the month boundary');
 const nov=page.locator('[data-date="2026-11-30"]'),dec=page.locator('[data-date="2026-12-01"]');
 assert.equal(await nov.getByRole('button',{name:/Midnight finish/}).count(),1);assert.equal(await dec.getByRole('button',{name:/Midnight finish/}).count(),0);
 assert.equal(await dec.getByRole('button',{name:/Until 2:00.*Overnight trip/i}).count(),1);
 assert.equal(await page.locator('[data-date="2026-12-02"]').getByRole('button').count(),0);
 assert.equal(await nov.getByRole('button').first().locator('.agenda-event-copy>b').innerText(),'Two day holiday');pass('All-day order, midnight exclusion, overnight continuation and empty day are correct');
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const mode of ['Agenda','3 Day','Month']){
   await view.getByRole('button',{name:mode,exact:true}).click();await page.evaluate(()=>document.fonts.ready);
   const actionMetrics=await page.getByRole('group',{name:'Calendar actions',exact:true}).getByRole('button').evaluateAll(es=>es.map(e=>({y:e.getBoundingClientRect().y,h:e.getBoundingClientRect().height})));assert.equal(actionMetrics.length,3);assert(actionMetrics.every(e=>Math.abs(e.y-actionMetrics[0].y)<1&&e.h>=44));
   const metrics=await view.getByRole('button').evaluateAll(es=>es.map(e=>({y:e.getBoundingClientRect().y,h:e.getBoundingClientRect().height})));
   assert(metrics.every(e=>Math.abs(e.y-metrics[0].y)<1&&e.h>=44));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page overflow at '+width+' '+mode);
   assert.equal(await page.locator('.agenda-event').evaluateAll(es=>es.some(e=>e.scrollWidth>e.clientWidth+1)),false,'Long event text stays inside rows');
   if(width===390||width===1280)await page.screenshot({path:path.join(out,'calendar-'+mode.replace(' ','-')+'-'+width+'.png'),fullPage:true});
  }
 }pass('Agenda, 3 Day and Month fit 320/390/768/1280px; selector remains a single row with 44px targets');
 await view.getByRole('button',{name:'3 Day',exact:true}).click();
 await page.getByRole('button',{name:'Filter',exact:true}).click();await page.getByRole('dialog',{name:'Filter calendar'}).getByRole('button',{name:'Riley Morgan',exact:true}).click();
 await page.getByRole('button',{name:/Riley football practice/}).waitFor();assert.equal(await page.getByRole('button',{name:/Weekly piano/}).count(),0);pass('Family filtering applies to three day events');
 await page.getByRole('button',{name:'Filter',exact:true}).click();await page.getByRole('dialog',{name:'Filter calendar'}).getByRole('button',{name:'Everyone',exact:true}).click();
 await page.getByRole('button',{name:'Next 3 days',exact:true}).click();assert.deepEqual(await days.evaluateAll(es=>es.map(e=>e.dataset.date)),['2026-12-03','2026-12-04','2026-12-05']);
 await page.getByRole('button',{name:'Previous 3 days',exact:true}).click();await page.getByRole('button',{name:/Midnight finish/}).waitFor();pass('Previous and next navigate three days and restore the original range');
 await page.getByRole('button',{name:/Midnight finish/}).click();await page.getByLabel('Event name').waitFor();assert.equal(await page.getByLabel('Event name').inputValue(),'Midnight finish');assert.equal(await page.getByLabel('Start time',{exact:true}).inputValue(),'22:07');assert.equal(await page.getByLabel('Start time',{exact:true}).locator('option').count(),97);assert.equal(await page.getByLabel('End time',{exact:true}).inputValue(),'00:00');pass('Opening an existing off-quarter event preserves its exact time');await page.getByRole('button',{name:'Close event editor'}).click();pass('Compact event rows still open the correct event editor');
 await page.getByRole('button',{name:'Add event',exact:true}).click();assert.equal(await page.getByLabel('Starts',{exact:true}).inputValue(),'2026-11-30');await page.getByRole('button',{name:'Close event editor'}).click();pass('Add event uses the selected three day start');
 await view.getByRole('button',{name:'Month',exact:true}).click();await page.getByRole('button',{name:'Next month',exact:true}).click();
 await page.locator('.month-grid').getByRole('button',{name:/Thursday, December 31,/}).click();await page.getByRole('button',{name:'Close day plans'}).click();
 await view.getByRole('button',{name:'3 Day',exact:true}).click();assert.deepEqual(await days.evaluateAll(es=>es.map(e=>e.dataset.date)),['2026-12-31','2027-01-01','2027-01-02']);pass('A selected month day anchors three day view across New Year');
 await page.getByRole('button',{name:'Today',exact:true}).click();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 assert.equal(await days.first().getAttribute('data-date'),today);pass('Today resets three day view to the current Eastern date');
 await page.setViewportSize({width:390,height:844});
 for(const chosen of ['Month','Agenda','3 Day']){
  await view.getByRole('button',{name:chosen,exact:true}).click();
  await page.locator('.mobile-nav').getByRole('button',{name:'Home',exact:true}).click();
  await page.locator('.mobile-nav').getByRole('button',{name:'Calendar',exact:true}).click();
  assert.equal(await view.getByRole('button',{name:chosen,exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForLoadState('networkidle');reloading=true;await page.reload();await page.locator('.native-calendar').waitFor();
  assert.equal(await view.getByRole('button',{name:chosen,exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForLoadState('networkidle');await page.goto(url);await page.locator('.native-calendar').waitFor();
  assert.equal(await view.getByRole('button',{name:chosen,exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('.native-calendar .spin')&&!document.querySelector('.native-calendar .error'));reloading=false;
 }pass('Month, Agenda and 3 Day each persist across navigation, refresh, notification entry and reopening the app');
 assert.deepEqual(errors,[]);pass('No browser runtime exceptions');
})().catch(async e=>{console.error(e);if(page){fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','calendar-views-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','calendar-views-failure.png')}).catch(()=>{})}process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
