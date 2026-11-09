// Synthetic browser regression test. Build VITE_APP_ENV=test first; API requests are mocked.
const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve('dist'),home='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email:'shopper@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
const member={user_id:uid,display_name:'Alex Morgan',role:'member',household_id:home};
const products=['Milk','Bread','Eggs'].map((title,i)=>({id:'33333333-3333-4333-8333-33333333333'+i,title,category:'Dairy & eggs',kind:'grocery',done:false,household_id:home,reminder_version:1,person:'Everyone',created_at:'2026-01-01',grocery_store:'Test market'}));
products.push({id:'44444444-4444-4444-8444-444444444444',household_id:home,kind:'task',title:'Book camp tickets',category:'Other',person:'Everyone',done:true,due:'2026-10-01',reminder_version:1,created_at:'2026-01-01'});
const note={id:'55555555-5555-4555-8555-555555555555',household_id:home,title:'Packing checklist',body:'Remember the camp tickets and warm clothes.',pinned:false,version:1,created_at:'2026-01-01',updated_at:'2026-11-01'};
const meal={id:'66666666-6666-4666-8666-666666666666',household_id:home,title:'Camp chili',instructions:'Simmer the beans.',ingredients:[],source_url:'',version:1,meal_date:'2026-09-01',meal_type:'supper',created_at:'2026-01-01',updated_at:'2026-01-01'};
const event={id:'77777777-7777-4777-8777-777777777777',household_id:home,title:'Camp registration',description:'Family day',location:'Cornwall',person:'Everyone',starts_at:'2026-12-01T15:00:00Z',ends_at:'2026-12-01T16:00:00Z',all_day:false,start_date:null,end_date:null,recurrence:[],exceptions:{},version:1};
const staple={id:'88888888-8888-4888-8888-888888888888',household_id:home,title:'Camp coffee',category:'Pantry',created_at:'2026-01-01'};
const exp=Math.floor(Date.now()/1000)+86400;
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const session={access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp,sub:uid,aud:'authenticated',role:'authenticated',session_id:home}),'fixture'].join('.'),refresh_token:'fixture',expires_in:86400,expires_at:exp,token_type:'bearer',user};
const tables={household_notes:[note],household_meal_plans:[meal],household_meal_recipes:[{...meal,id:'99999999-9999-4999-8999-999999999999',title:'Camp stew'}],household_events:[event],household_grocery_staples:[staple]};
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
 const context=await browser.newContext({viewport:{width:390,height:844}});
 // Allow only the local static server. The specific API handler below fulfills every Supabase request from fixtures.
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
 await context.routeWebSocket('**/*',socket=>socket.close());await context.addInitScript(redirectFixtureAPI);
 setFixtureHandler(async route=>{
   if(!serve){await route.abort('internetdisconnected');return;}
   const req=route.request(),u=new URL(req.url()),table=u.pathname.split('/').pop();
   let data=[];
   if (u.pathname.startsWith('/auth/'))data=user;
   else if(u.pathname.includes('/rpc/'))data=table==='household_transition_active'?false:table==='household_calendar_source'?'hh':{};
   else if(table==='household_members'){if(req.method()==='PATCH')Object.assign(member,req.postDataJSON());data=[member];}
   else if(table==='household_people')data=['Jamie Morgan','Riley Morgan','Casey Morgan'].map((display_name,i)=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'+i,household_id:home,display_name,calendar_color:['#E78725','#467EB6','#C46B8C'][i],linked_user_id:null}));
   else if(table==='households')data={calendar_id:'',name:'Test Market Home'};
   else if(['household_notes','household_meal_plans','household_meal_recipes','household_events','household_grocery_staples'].includes(table)){if(failWrites&&['POST','PATCH'].includes(req.method())){await route.fulfill({status:503,json:{message:'Fixture unavailable'}});return;}
data=tables[table];const id=u.searchParams.get('id')?.slice(3);if(id)data=data.filter(row=>row.id===id);
if(req.method()==='POST'){const row={id:require('node:crypto').randomUUID(),version:1,created_at:'2026-11-08',updated_at:'2026-11-08',...req.postDataJSON()};tables[table].push(row);data=[row];writes++}
if(req.method()==='PATCH'){for(const row of data){Object.assign(row,req.postDataJSON());row.version++;writes++}}}
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




 const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish'),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 function pass(name){checks.push(name);fs.writeFileSync(path.join(out,'input-cards.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+name)}
 async function nav(name){await page.locator('.mobile-nav').getByRole('button',{name,exact:true}).click()}
 async function more(name){await nav('More');await page.getByRole('button',{name:new RegExp(name)}).click()}
 const card=()=>page.locator('.quick-form,.compact-event-modal');
 async function swipe(dx=0,dy=100){
  await card().evaluate(el=>el.scrollTop=0);
  const handle=page.getByRole('button',{name:'Close input card',exact:true}),r=await handle.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
 }
 async function centered(){
  const r=await card().boundingBox(),v=page.viewportSize();
  assert(r.x>=10&&r.x+r.width<=v.width-10,'Card has side margins');
  assert(r.y>=19&&r.y+r.height<=v.height-19,'Card has top and bottom margins');
  assert(Math.abs(r.y-(v.height-r.y-r.height))<=2,'Card is vertically centered');
  assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
 }
 async function closed(){await card().waitFor({state:'detached'});await page.waitForFunction(()=>document.body.style.position!=='fixed');assert.equal(await page.locator('.mobile-nav').evaluate(el=>el.inert),false)}
 async function confirm(){await page.getByRole('alertdialog',{name:'Save your changes?'}).waitFor()}
 await page.goto(url);await page.locator('.home-family-name').first().waitFor();
 const cases=[
 {name:'groceries',go:()=>nav('Groceries'),open:()=>page.getByRole('button',{name:'Add item',exact:true}).click(),field:()=>page.getByLabel('Item',{exact:true})},
 {name:'to-do',go:()=>nav('To Do'),open:()=>page.getByRole('button',{name:'Add to do',exact:true}).first().click(),field:()=>page.getByLabel('To do or reminder')},
 {name:'event',go:()=>nav('Calendar'),open:()=>page.getByRole('button',{name:'Add event',exact:true}).click(),field:()=>page.getByLabel('Event name')},
 {name:'family note',go:()=>more('Family notes'),open:()=>page.getByRole('button',{name:'Add note',exact:true}).click(),field:()=>page.getByLabel('Title',{exact:true}),fill:()=>page.getByLabel('Note',{exact:true}).fill('Keep these details.')},
 {name:'saved meal',go:async()=>{await more('Meal planner');await page.getByRole('button',{name:'Saved meals',exact:true}).click()},open:()=>page.getByRole('button',{name:'Save a meal',exact:true}).click(),field:()=>page.getByLabel('Meal name',{exact:true})},
 {name:'planned meal',go:async()=>{await more('Meal planner');await page.getByRole('button',{name:'Plan week',exact:true}).click()},open:()=>page.locator('button[aria-label^="Add breakfast on"]:visible').first().click(),field:()=>page.getByLabel('Meal name',{exact:true})}
 ];
 for(const c of cases){
  await c.go();await c.open();await centered();await page.screenshot({path:path.join(out,'centered-'+c.name.replace(/ /g,'-')+'.png')});
  await swipe(0,20);assert.equal(await card().count(),1,'Short drag stays open');
  await swipe(80,25);assert.equal(await card().count(),1,'Sideways drag stays open');
  await swipe();await closed();pass(c.name+': centered, short/sideways drags ignored, unchanged downward swipe closes');
  await c.open();await c.field().fill('Swipe '+c.name);if(c.fill)await c.fill();const before=writes;
  await swipe();await confirm();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await c.field().inputValue(),'Swipe '+c.name);assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
  await swipe();await confirm();await page.keyboard.press('Escape');assert.equal(await card().count(),1);
  await swipe();await confirm();await page.getByRole('button',{name:'Discard',exact:true}).click();await closed();assert.equal(writes,before);pass(c.name+': Keep editing/Escape preserve draft; Discard closes without saving');
  await c.open();await c.field().fill('   ');if(c.fill)await c.fill();
  await swipe();await confirm();await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(150);assert.equal(await card().count(),1,'Invalid save keeps card');assert.equal(writes,before);
  await c.field().fill('Saved by swipe '+c.name);await swipe();await confirm();await page.getByRole('button',{name:'Save',exact:true}).click();await closed();for(let i=0;i<100&&writes<before+1;i++)await page.waitForTimeout(50);assert.equal(writes,before+1,'Save persists exactly once');pass(c.name+': invalid Save preserves form; valid Save writes once and closes');
 }
 // Failed server save retains the draft and the page lock.
 await more('Family notes');await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Retry note');await page.getByLabel('Note',{exact:true}).fill('Do not lose this.');
 failWrites=true;await swipe();await confirm();await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.notes-error').waitFor();assert.equal(await page.getByLabel('Note',{exact:true}).inputValue(),'Do not lose this.');assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');failWrites=false;
 await swipe();await confirm();await page.getByRole('button',{name:'Save',exact:true}).click();await closed();pass('Failed save keeps draft and background lock; retry saves and closes');
 // An existing item collision still uses the regular duplicate decision.
 await nav('Groceries');await page.getByRole('button',{name:'Add item',exact:true}).click();await page.getByLabel('Item',{exact:true}).fill('Milk');await swipe();await confirm();await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('alertdialog',{name:'Already on your grocery list'}).waitFor();await page.getByRole('button',{name:'Discard new item',exact:true}).click();await closed();pass('Swipe Save preserves duplicate-grocery protection');
 await more('Meal planner');await page.getByRole('button',{name:'Saved meals',exact:true}).click();await page.getByRole('button',{name:'Save a meal',exact:true}).click();await page.getByLabel('Meal name',{exact:true}).fill('Long draft');for(let i=0;i<6;i++)await page.getByRole('button',{name:'Add ingredient',exact:true}).click();
 for(const viewport of [{width:320,height:520},{width:390,height:844},{width:1280,height:900}]){
  await page.setViewportSize(viewport);await centered();await card().evaluate(el=>el.scrollTop=el.scrollHeight);assert(await card().evaluate(el=>el.scrollTop)>0);const footer=await page.locator('.quick-form-footer button').boundingBox();assert(footer.y>=0&&footer.y+footer.height<=viewport.height-19);await page.screenshot({path:path.join(out,'long-card-'+viewport.width+'.png')});
 }
 await page.setViewportSize({width:390,height:844});await page.locator('.quick-form-backdrop').evaluate(el=>{el.style.setProperty('--input-card-gap-top','44px');el.style.setProperty('--input-card-gap-bottom','34px')});
 const safe=await card().boundingBox();assert(safe.y>=44&&safe.y+safe.height<=810,'Long cards respect phone safe areas');assert(Math.abs((safe.y-44)-(810-safe.y-safe.height))<=2,'Centered within usable phone area');
 await swipe();await confirm();await page.getByRole('button',{name:'Discard',exact:true}).click();await closed();pass('Long cards stay centered and scroll internally at short phone, phone and desktop sizes');
 assert.deepEqual(errors,[]);pass('No runtime errors');
})().catch(async e=>{console.error(e);if(page){fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','input-cards-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','input-cards-failure.png')}).catch(()=>{})}process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});

