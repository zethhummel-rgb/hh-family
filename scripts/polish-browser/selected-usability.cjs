// Synthetic browser regression test. Build VITE_APP_ENV=test first; API requests are mocked.
const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve('dist'),home='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email:'shopper@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
const member={user_id:uid,display_name:'Alex Morgan',role:'owner',household_id:home};
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
let server,browser,page,serve=true,writes=0,failWrites=false,reissues=0,sends=0,pauseHomeSave=false,releaseHomeSave=null;
let householdName='Test Market Home';
let invitations=[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',household_id:home,email:'relative@icolud.com',expires_at:new Date(Date.now()+86400000).toISOString(),used_at:null}];
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
   else if(table==='reissue_household_invite'){
 if(failWrites){await route.fulfill({status:503,json:{message:'Fixture unavailable'}});return}
 const v=req.postDataJSON();assert.equal(invitations[0].id,v.source_invitation_id);assert.equal(invitations[0].email,v.expected_email);
 invitations=[{...invitations[0],id:v.replacement_id,email:v.recipient_email}];data=v.replacement_token;reissues++;
}
else if(u.pathname.includes('/functions/v1/invitation-email')){sends++;data={status:'sent'};}
else if(table==='household_invites'){
 if(req.method()==='DELETE'){const id=u.searchParams.get('id').slice(3);data=invitations.filter(i=>i.id===id);invitations=invitations.filter(i=>i.id!==id)}else data=invitations;
}
else if(u.pathname.includes('/rpc/'))data=table==='household_transition_active'?false:table==='household_calendar_source'?'hh':table==='pilot_status'?{is_host:true}:table==='pilot_invitations'?[]:{};
   else if(table==='household_members'){if(req.method()==='PATCH')Object.assign(member,req.postDataJSON());data=[member];}
   else if(table==='household_people')data=['Jamie Morgan','Riley Morgan','Casey Morgan'].map((display_name,i)=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'+i,household_id:home,display_name,calendar_color:['#E78725','#467EB6','#C46B8C'][i],linked_user_id:null}));
   else if(table==='households'){
 if(req.method()==='PATCH'){if(failWrites){await route.fulfill({status:503,json:{message:'Fixture unavailable'}});return}if(pauseHomeSave)await new Promise(resolve=>releaseHomeSave=resolve);householdName=req.postDataJSON().name;writes++}
 data={id:home,owner_id:uid,calendar_id:'',name:householdName};
}
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





 const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish'),checks=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const pass=name=>{checks.push(name);fs.writeFileSync(path.join(out,'selected-usability.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+name)};
 const nav=name=>page.locator('.mobile-nav').getByRole('button',{name,exact:true}).click();
 const choice=()=>page.getByRole('alertdialog',{name:'Save your changes?'});
 const choose=name=>choice().getByRole('button',{name,exact:true}).click();
 const settings=()=>page.getByRole('button',{name:'Open Settings',exact:true}).click();
 await page.goto(url);await page.locator('.home-family-name').first().waitFor();
 await nav('Groceries');await page.locator('.staples-toggle').click();await page.getByRole('button',{name:'New staple',exact:true}).click();
 await page.getByLabel('Item name',{exact:true}).fill('Draft cereal');await nav('Calendar');await choose('Keep editing');assert.equal(await page.getByLabel('Item name',{exact:true}).inputValue(),'Draft cereal');
 await nav('Calendar');await choose('Discard');await page.locator('.calendar-view-switch').waitFor();
 await nav('Groceries');await page.locator('.staples-toggle').click();await page.getByRole('button',{name:'New staple',exact:true}).click();await page.getByLabel('Item name',{exact:true}).fill('Save cereal');
 failWrites=true;await nav('Calendar');await choose('Save');await page.getByText('Fixture unavailable',{exact:false}).waitFor();assert.equal(await page.getByLabel('Item name',{exact:true}).inputValue(),'Save cereal');failWrites=false;
 await nav('Calendar');await choose('Save');await page.locator('.calendar-view-switch').waitFor();assert(tables.household_grocery_staples.some(i=>i.title==='Save cereal'));pass('Staples: Keep editing, Discard, failed Save and successful Save before navigation');
 await settings();await page.getByRole('button',{name:/Your household/}).first().click();
 await page.getByLabel('Household name',{exact:true}).fill('Draft home');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Keep editing');assert.equal(await page.getByLabel('Household name',{exact:true}).inputValue(),'Draft home');
 await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Discard');await settings();await page.getByRole('button',{name:/Your household/}).first().click();assert.equal(await page.getByLabel('Household name',{exact:true}).inputValue(),'Test Market Home');
 pauseHomeSave=true;await page.getByLabel('Household name',{exact:true}).fill('Saved home');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Save');await page.waitForFunction(()=>document.querySelector('.settings-content')?.inert);assert(await page.getByRole('button',{name:'Done',exact:true}).isDisabled());for(let i=0;i<100&&!releaseHomeSave;i++)await page.waitForTimeout(50);assert(releaseHomeSave,'Delayed save reached server');pauseHomeSave=false;releaseHomeSave();await page.locator('.settings-dialog').waitFor({state:'detached'});assert.equal(householdName,'Saved home');pass('Household name: protects drafts, freezes other controls during pending Save, saves before closing and Discard resets');
 await settings();await page.getByRole('button',{name:/Your household/}).first().click();await page.getByRole('button',{name:'Add a family member without email',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Draft child');await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await choose('Keep editing');assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Draft child');await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await choose('Discard');await page.getByRole('button',{name:/Your household/}).first().click();assert.equal(await page.locator('.profile-editor').count(),0);pass('Family profiles: Back protects draft and Discard resets form');
 await page.getByRole('button',{name:'Correct address for relative@icolud.com',exact:true}).click();await page.getByLabel('Their email address',{exact:true}).fill('relative@icloud.com');await page.getByRole('button',{name:'Review invitation',exact:true}).click();
 assert.equal(reissues,0);assert.equal(sends,0);assert.match(await page.getByRole('alertdialog',{name:'Review invitation'}).innerText(),/relative@icloud.com/);await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.getByLabel('Their email address',{exact:true}).inputValue(),'relative@icloud.com');
 await page.getByRole('button',{name:'Close email invitation',exact:true}).click();await choose('Save');await page.getByRole('alertdialog',{name:'Review invitation'}).waitFor();assert.equal(sends,0,'Saving an invitation draft still requires address review');
 await page.getByRole('button',{name:'Send new invitation',exact:true}).click();await page.getByRole('button',{name:'Resend invitation to relative@icloud.com',exact:true}).waitFor();assert.equal(reissues,1);assert.equal(sends,1);assert.equal(invitations.length,1);
 await page.getByRole('button',{name:'Resend invitation to relative@icloud.com',exact:true}).click();await page.getByRole('button',{name:'Send new invitation',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role=alertdialog]'));for(let i=0;i<100&&(reissues<2||sends<2);i++)await page.waitForTimeout(50);assert.equal(reissues,2);assert.equal(sends,2);
 await page.getByRole('button',{name:'Cancel invitation for relative@icloud.com',exact:true}).click();await page.getByRole('button',{name:'Keep invitation',exact:true}).click();assert.equal(invitations.length,1);await page.getByRole('button',{name:'Cancel invitation for relative@icloud.com',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Cancel invitation',exact:true}).click();await page.getByText('Invitation cancelled. Its link can no longer be used.',{exact:true}).waitFor();assert.equal(invitations.length,0);pass('Invitations: full-address review, correction, fresh-link resend, confirmed cancellation; no silent sending');
 await page.getByRole('button',{name:'Invite a family member by email',exact:true}).click();await page.getByLabel('Their email address',{exact:true}).fill('someone@icolud.com');await page.getByRole('button',{name:'someone@icloud.com',exact:true}).click();assert.equal(await page.getByLabel('Their email address',{exact:true}).inputValue(),'someone@icloud.com');await page.getByLabel('Their email address',{exact:true}).fill('invalid');await page.getByRole('button',{name:'Review invitation',exact:true}).click();assert.equal(await page.getByRole('alertdialog').count(),0);assert.equal(sends,2);await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Discard');pass('Invitation validation and optional spelling correction preserve explicit consent');
 await settings();await page.getByRole('button',{name:/Your profile/}).first().click();await page.getByLabel('Custom calendar colour',{exact:true}).fill('#123456');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Keep editing');assert.equal(await page.getByLabel('Custom calendar colour',{exact:true}).inputValue(),'#123456');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Save');await page.locator('.settings-dialog').waitFor({state:'detached'});assert.equal(member.calendar_color,'#123456');pass('Calendar colour draft is protected and Save persists before closing');
 await settings();await page.getByRole('button',{name:/Pilot invitations/}).first().click();await page.getByLabel(/New household owner/).fill('new-home@example.invalid');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Save');await page.getByRole('alertdialog',{name:'Review new-household invitation'}).waitFor();assert.equal(sends,2,'Draft Save requires review before pilot email');await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.getByLabel(/New household owner/).inputValue(),'new-home@example.invalid');await page.getByRole('button',{name:'Done',exact:true}).click();await choose('Discard');pass('New-household invitation draft is protected and address review does not silently send');
 await nav('Groceries');await page.getByRole('button',{name:'Add item',exact:true}).click();await page.getByLabel('Item',{exact:true}).fill('Toast check');await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();await page.locator('.grocery-editor').waitFor({state:'detached'});await page.getByRole('button',{name:'Add item',exact:true}).click();assert.equal(await page.locator('.toast').count(),0);await page.getByRole('button',{name:'Close grocery editor',exact:true}).click();pass('Background save message does not cover a newly opened editor');
 await nav('Home');
 // Enlarge existing text, as in the audit, without forcing fixed layout dimensions.
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body *')){if(el instanceof HTMLElement&&getComputedStyle(el).display!=='none'){const size=parseFloat(getComputedStyle(el).fontSize);el.dataset.auditSize=String(size)}}for(const el of document.querySelectorAll('[data-audit-size]'))el.style.fontSize=Number(el.dataset.auditSize)*2+'px'});
 await page.waitForFunction(()=>document.documentElement.hasAttribute('data-large-text'));
 for(const viewport of [{width:320,height:740},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(100);
  assert(await page.locator('.home-encouragement').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  const labels=await page.locator('.mobile-nav button').evaluateAll(nodes=>nodes.map(el=>{const s=el.querySelector('span'),r=el.getBoundingClientRect(),t=s.getBoundingClientRect();return {ok:t.left>=r.left&&t.right<=r.right+1&&t.top>=r.top&&t.bottom<=r.bottom+1}}));assert(labels.every(x=>x.ok),'Enlarged navigation labels fit targets');
  assert(await page.locator('.mobile-nav').evaluate(el=>el.getBoundingClientRect().height)>100,'Enlarged navigation reflows into readable rows');
  const family=await page.locator('.home-family-strip').boundingBox(),heading=await page.locator('.page-heading').boundingBox();assert(family.y+family.height<=heading.y+1,'Family names do not overlap greeting');
  await page.screenshot({path:path.join(out,'enlarged-home-'+viewport.width+'.png')});
 }
 await nav('Calendar');await page.getByRole('button',{name:'Add event',exact:true}).click();
 // The newly mounted editor needs the same enlarged text treatment.
 await page.locator('.event-modal *').evaluateAll(nodes=>{for(const el of nodes)if(el instanceof HTMLElement)el.dataset.auditSize=String(parseFloat(getComputedStyle(el).fontSize));for(const el of nodes)if(el instanceof HTMLElement)el.style.fontSize=Number(el.dataset.auditSize)*2+'px'});
 const boxes=await page.locator('.event-date-row input,.event-date-row select').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),p=el.closest('.event-date-row').getBoundingClientRect();return {left:r.left,right:r.right,pLeft:p.left,pRight:p.right}}));assert(boxes.length>=4);assert(boxes.every(r=>r.left>=r.pLeft-1&&r.right<=r.pRight+1),'Enlarged date/time fields stay inside form');
 await page.screenshot({path:path.join(out,'enlarged-event.png')});pass('Enlarged Home message, navigation and event fields fit narrow screens');
 assert.deepEqual(errors,[]);pass('No runtime errors');
 // Use a clean unauthenticated browser context to test password controls.
 const anon=await browser.newContext({viewport:{width:390,height:844}});await anon.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));await anon.addInitScript(redirectFixtureAPI);const login=await anon.newPage();await login.goto(url);const password=login.getByLabel('Password',{exact:true});await password.fill('Test-password-123!');await password.evaluate(el=>el.setSelectionRange(3,7));await login.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await password.getAttribute('type'),'text');assert.equal(await password.inputValue(),'Test-password-123!');await login.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');assert.equal(await password.inputValue(),'Test-password-123!');assert.equal(await password.getAttribute('autocomplete'),'current-password');await anon.close();pass('Password Show/Hide preserves value and password-manager autocomplete');
})().catch(async e=>{console.error(e);if(page){fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','selected-usability-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','selected-usability-failure.png')}).catch(()=>{})}process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
