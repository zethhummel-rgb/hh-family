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
   else if(['household_notes','household_meal_plans','household_meal_recipes','household_events','household_grocery_staples'].includes(table)){data=({household_notes:[note],household_meal_plans:[meal],household_meal_recipes:[{...meal,id:'99999999-9999-4999-8999-999999999999',title:'Camp stew'}],household_events:[event],household_grocery_staples:[staple]})[table];const id=u.searchParams.get('id')?.slice(3);if(id)data=data.filter(row=>row.id===id);}
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



 const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish');fs.mkdirSync(out,{recursive:true});const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 function pass(name){checks.push(name);fs.writeFileSync(path.join(out,'scroll-lock.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+name)}
 async function nav(name){await page.locator('.mobile-nav').getByRole('button',{name,exact:true}).click()}
 async function protect(close,field,value){await close();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await field.inputValue(),value);await close();await page.getByRole('button',{name:'Discard changes',exact:true}).click()}

 await page.goto(url);await page.locator('.home-family-name').first().waitFor();
 async function prepare(){
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('#scroll-test-space')?.remove();const space=document.createElement('div');space.id='scroll-test-space';space.style.height='2000px';document.querySelector('main').append(space);document.documentElement.style.scrollBehavior='auto'});
  // Finish the navigation restoration, then scroll as a user would before opening.
  await page.mouse.move(80,200);await page.mouse.wheel(0,180);await page.waitForTimeout(100);
  await page.evaluate(()=>window.scrollTo(0,180));
  assert.equal(await page.evaluate(()=>window.scrollY),180);
 }
 async function open(button){
  await prepare();
  const before=await page.evaluate(()=>({top:document.querySelector('.shell').getBoundingClientRect().top,y:scrollY}));
  await button.evaluate(el=>el.click());await page.waitForFunction(()=>document.body.style.position==='fixed');
  assert.equal(await page.evaluate(()=>document.body.style.top),'-180px');
  return before;
 }
 async function stationary(before){
  const top=()=>page.evaluate(()=>document.querySelector('.shell').getBoundingClientRect().top);
  assert(Math.abs(await top()-before.top)<1,'Opening keeps the background in place');
  await page.mouse.move(3,3);await page.mouse.wheel(0,600);await page.waitForTimeout(100);
  await page.evaluate(()=>window.scrollTo(0,900));await page.waitForTimeout(50);
  assert(Math.abs(await top()-before.top)<1,'Wheel and document scrolling cannot move the background');
  assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
 }
 async function restored(before){
  await page.waitForFunction(()=>document.body.style.position!=='fixed');
  assert.equal(await page.evaluate(()=>window.scrollY),before.y,'Closing restores the page position');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
  await page.evaluate(()=>window.scrollTo(0,240));assert.equal(await page.evaluate(()=>window.scrollY),240,'Page can scroll again');
  await page.evaluate(()=>window.scrollTo(0,0));
 }
 await nav('Groceries');
 let before=await open(page.getByRole('button',{name:'Add item',exact:true}));
 await stationary(before);await page.getByRole('button',{name:'Close grocery editor'}).click();await restored(before);
 pass('Grocery sheet pins the background and restores the exact scrolled position');
 before=await open(page.getByRole('button',{name:'Add item',exact:true}));
 await page.getByLabel('Item',{exact:true}).fill('Milk');await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();await page.getByRole('alertdialog').waitFor();
 await stationary(before);await page.getByRole('button',{name:'Back to editing',exact:true}).click();
 await stationary(before);await page.getByRole('button',{name:'Close grocery editor'}).click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();await stationary(before);
 await page.getByRole('button',{name:'Close grocery editor'}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await restored(before);
 pass('Closing duplicate and discard confirmations keeps the parent editor locked');
 before=await open(page.getByRole('button',{name:'Add item',exact:true}));await page.getByLabel('Item',{exact:true}).fill('Milk');await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();await page.getByRole('button',{name:'Discard new item',exact:true}).click();await restored(before);assert.equal(await page.locator('.mobile-nav').evaluate(el=>el.inert),false,'Closing both dialogs releases the navigation');
 pass('Closing stacked grocery dialogs together restores scrolling once');
 await nav('To Do');before=await open(page.getByRole('button',{name:'Add to do',exact:true}).first());await stationary(before);await page.getByRole('button',{name:'Close reminder editor'}).click();await restored(before);
 pass('To-do input locks and restores page scrolling');
 await nav('Calendar');before=await open(page.getByRole('button',{name:'Add event',exact:true}));await stationary(before);
 const eventBody=page.locator('.event-editor-body');await eventBody.evaluate(el=>el.scrollTop=0);const er=await eventBody.boundingBox();await page.mouse.move(er.x+er.width/2,er.y+er.height/2);await page.mouse.wheel(0,500);await page.waitForTimeout(100);assert(await eventBody.evaluate(el=>el.scrollTop)>0,'Event form still scrolls');await stationary(before);await page.getByRole('button',{name:'Close event editor'}).click();await restored(before);
 pass('Event fields scroll independently while the website stays fixed');
 await nav('More');await page.getByRole('button',{name:/Family notes/}).click();before=await open(page.getByRole('button',{name:'Add note',exact:true}));await stationary(before);
 await page.getByRole('button',{name:'Close family note'}).click();await restored(before);
 pass('Family-note input locks and restores page scrolling');
 await nav('More');await page.getByRole('button',{name:/Meal planner/}).click();await page.getByRole('button',{name:'Saved meals',exact:true}).click();before=await open(page.getByRole('button',{name:'Save a meal',exact:true}));await stationary(before);
 await page.getByRole('button',{name:'Close meal',exact:true}).click();await restored(before);
 pass('Saved-meal input locks and restores page scrolling');
 await page.getByRole('button',{name:'Plan week',exact:true}).click();before=await open(page.locator('button[aria-label^="Add breakfast on"]:visible').first());await stationary(before);
 await page.getByRole('button',{name:'Use a saved meal',exact:true}).click();await stationary(before);await page.getByRole('button',{name:'Back to meal',exact:true}).click();await stationary(before);
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Add ingredient',exact:true}).click();
 const modal=page.locator('.meal-dialog');await modal.evaluate(el=>el.scrollTop=0);const mr=await modal.boundingBox();await page.mouse.move(mr.x+mr.width/2,mr.y+mr.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(100);assert(await modal.evaluate(el=>el.scrollTop)>0,'Long meal sheet still scrolls');
 await modal.evaluate(el=>el.scrollTop=el.scrollHeight);await page.mouse.wheel(0,700);await stationary(before);
 await page.getByRole('button',{name:'Close meal',exact:true}).click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();await stationary(before);await page.getByRole('button',{name:'Close meal',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await restored(before);
 pass('Long meal sheets, their scroll boundaries and saved-meal picker keep the website fixed');
 assert.deepEqual(errors,[]);pass('No runtime exceptions during scroll-lock journeys');
})().catch(async e=>{console.error(e);if(page){fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','scroll-lock-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','focused-failure.png')}).catch(()=>{})}process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
