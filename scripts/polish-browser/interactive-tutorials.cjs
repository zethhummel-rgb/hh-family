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
let server,browser,page,serve=true,writes=0,failWrites=false;const mutations=[];
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
   const req=route.request(),u=new URL(req.url()),table=u.pathname.split('/').pop();if(req.method()!=='GET'&&!u.pathname.startsWith('/auth/')&&!['household_transition_active','household_calendar_source','pilot_status'].includes(table)&&!['status','list','search','range'].includes(req.postDataJSON()?.action))mutations.push({method:req.method(),path:u.pathname,body:req.postDataJSON()});
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





 const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish'),results=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const record=(id,checks)=>{results.push({id,checks,mutations:mutations.length,errors:[...errors]});fs.writeFileSync(path.join(out,'interactive-tutorials.json'),JSON.stringify(results,null,2));console.log('PASS '+id+': '+checks.join('; '))};
 const source=fs.readFileSync(path.resolve('src/tutorialGuides.ts'),'utf8');
 const ts=require('typescript');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {tutorialGuides}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const continueButton=()=>page.locator('.tutorial-coach').getByRole('button',{name:'Continue',exact:true});
 async function target(selector){const nodes=page.locator(selector+':visible');for(let attempt=0;attempt<100;attempt++){for(const node of await nodes.all())if(!await node.evaluate(el=>!!el.closest('[inert]')))return node;await page.waitForTimeout(40)}throw Error('Tutorial control unavailable: '+selector)}
 async function openHelp(){await page.locator('[data-tour="nav-More"]:visible').first().click();await page.getByRole('button',{name:/Help & tutorials/}).click();await page.locator('.interactive-lessons').waitFor()}
 async function inputValue(node,guide,index){
  const type=await node.getAttribute('type'),label=await node.getAttribute('aria-label')||'';
  if(type==='number')return '2';if(type==='email')return 'practice@example.com';if(type==='url')return 'https://example.com/recipe';if(type==='date')return '2026-12-10';if(type==='time')return '10:00';if(type==='color')return '#345678';
  return label.includes('Unit')?'bags':'HH practice '+guide.id+' '+index;
 }
 async function act(step,guide,index){
  const node=await target(step.target);
  if(await node.isDisabled()){await page.getByRole('button',{name:'Skip unavailable option',exact:true}).click();return}
  if(step.action==='read'){await continueButton().click();return}
  if(step.action==='save'){await node.click();await page.getByRole('heading',{name:'You did it.',exact:true}).waitFor();return}
  if(step.action==='input'){
   await node.click();const entered=await inputValue(node,guide,index);
   await node.fill(entered);
   assert.equal(await node.evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>resolve(el.value)))),entered,'Practice typing is preserved');
   if(guide.id==='calendar'&&index===6){await node.evaluate(el=>el.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.match(await page.locator('.tutorial-help').innerText(),/Finish the highlighted step/);assert.equal(mutations.length,0)}
   const notesWithKeyboard=guide.id==='event-options'&&step.target.includes('Notes (optional)');
   if(notesWithKeyboard){
    // Model the iPhone keyboard: only the visual viewport shrinks.
    await page.evaluate(()=>{
     const vv=window.visualViewport;if(!vv)throw Error('VisualViewport unavailable');
     Object.defineProperty(vv,'height',{configurable:true,value:360});
     vv.dispatchEvent(new Event('resize'));
    });
    try{
     await page.waitForFunction(()=>{
      const coach=document.querySelector('.tutorial-coach'),next=coach?.querySelector('.tutorial-coach-actions .button'),vv=window.visualViewport;
      if(!coach||!next||!vv||coach.dataset.keyboardVisible!=='true')return false;
      const b=coach.getBoundingClientRect(),a=next.getBoundingClientRect(),top=vv.offsetTop,bottom=top+vv.height;
      return b.top>=top-1&&b.bottom<=bottom+1&&a.top>=top-1&&a.bottom<=bottom+1;
     },null,{timeout:4000});
     assert(await node.evaluate(el=>document.activeElement===el),'Notes field stays focused with keyboard visible');
     assert.equal(await page.locator('.tutorial-coach').getAttribute('data-keyboard-visible'),'true');
     await continueButton().click(); // Advance while the simulated keyboard is visible.
    }finally{
     await page.evaluate(()=>{delete window.visualViewport.height;window.visualViewport.dispatchEvent(new Event('resize'))});
    }
    return;
   }
   await continueButton().click();return
  }
  if(step.action==='change'){
   if(await node.evaluate(el=>el.tagName==='SELECT')){
    const choices=await node.locator('option').evaluateAll(options=>options.map(o=>o.value));const label=await node.getAttribute('aria-label');let value=choices[0];
    if(label==='Start time')value='10:00';else if(label==='End time')value='11:00';else if(label==='Repeat')value='WEEKLY';else if(label==='Reminder repeat')value='week';else if(label==='Event reminder')value='60';else if(label==='Meal section')value='supper';else value=choices.find(v=>v)||choices[0];
    await node.selectOption(value);
   }else if(await node.getAttribute('type')==='checkbox')await node.click();else await node.fill(await inputValue(node,guide,index));
   await continueButton().click();return;
  }
  if(await node.evaluate(el=>el.matches('input,select,textarea'))){if(await node.getAttribute('type')==='date'&&!(await node.inputValue()))await node.fill('2026-12-10');else await node.click();await continueButton().click()}else await node.click();
 }
 // Values are selected by semantic type, not by automatic fills in the app.
 await page.goto(url);await page.locator('.home-family-name').first().waitFor();
 const initial=JSON.stringify(tables),initialProducts=JSON.stringify(products),initialMember=JSON.stringify(member);
 for(const guide of tutorialGuides){
  await page.setViewportSize(['calendar','notes'].includes(guide.id)?{width:320,height:568}:guide.id==='meals'?{width:1280,height:900}:['saved-meals','invitations'].includes(guide.id)?{width:390,height:500}:{width:390,height:844});
  if(guide.id==='calendar'){await page.locator('[data-tour="nav-Calendar"]:visible').first().click();await page.locator('[data-tour="view-Agenda"]').click()}
  await openHelp();await page.locator('[data-tutorial-id="'+guide.id+'"]').click();await page.getByRole('button',{name:'Start practice',exact:true}).click();
  for(let index=0;index<guide.steps.length;index++){
   await page.waitForFunction(({number,total})=>document.querySelector('.tutorial-counter')?.textContent===`Step ${number} of ${total}`,{number:index+1,total:guide.steps.length});
   const step=guide.steps[index];await target(step.target);await page.waitForFunction(selector=>Array.from(document.querySelectorAll(selector)).some(el=>el.hasAttribute('data-tutorial-highlight')),step.target);if(step.action!=='read'&&step.action!=='save')assert(await page.locator('.tutorial-coach-actions .button').isDisabled(),'Cannot advance before interacting: '+guide.id+' '+index);
   if(guide.id==='event-options'&&index===0){
    const glow=await page.locator('.tutorial-spotlight').evaluate(el=>getComputedStyle(el).boxShadow);
    assert(!/9999px/.test(glow),'Spotlight must not dim or pulse the entire page');
   }
   // Highlight and coach positioning settle on successive animation frames.
   await page.waitForFunction(()=>{
    const coach=document.querySelector('.tutorial-coach');if(!coach)return false;
    const box=coach.getBoundingClientRect();
    return box.left>=-1&&box.top>=-1&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1;
   },null,{timeout:3000});
   const box=await page.locator('.tutorial-coach').boundingBox(),vp=page.viewportSize();assert(box.x>=0&&box.y>=0&&box.x+box.width<=vp.width+1&&box.y+box.height<=vp.height+1,'Coach stays inside viewport: '+guide.id+' step '+index+' '+JSON.stringify({box,vp}));await act(step,guide,index);
   assert.equal(mutations.length,0,'Practice must never mutate the server: '+JSON.stringify(mutations));
  }
  await page.getByRole('heading',{name:'You did it.',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'tutorial-'+guide.id+'.png')});
  await page.getByRole('button',{name:'Finish practice',exact:true}).click();await page.locator('.tutorial-coach').waitFor({state:'detached'});
  assert.equal(await page.locator('.quick-form,.event-modal,.settings-dialog').count(),0,'Finish cleans practice forms');
  if(guide.id==='calendar')assert.equal(await page.locator('[data-tour="view-Agenda"]').getAttribute('aria-pressed'),'true','Practice restores preferred calendar view');
  assert.equal(JSON.stringify(tables),initial);assert.equal(JSON.stringify(products),initialProducts);assert.equal(JSON.stringify(member),initialMember);assert.equal(JSON.stringify(await page.evaluate(()=>Object.values(localStorage))).includes('HH practice'),false,'Practice field values are not persisted');
  record(guide.id,[guide.steps.length+' required steps completed','no server writes or email','practice forms cleared',...(guide.id==='event-options'?['focused spotlight and keyboard-visible Next']:[])]);
 }

 // Safari controls live outside the DOM: practise all three example layouts without claiming installation.
 await openHelp();const safari=page.getByRole('region',{name:'Safari Home Screen tutorial',exact:true});assert.equal(await safari.count(),1,'Show a single Safari lesson');
 for(const width of [320,390,1280])for(const layout of ['dots','share','left']){const compact=layout!=='share';
  await page.setViewportSize({width,height:568});await safari.getByRole('button',{name:'Add the HH icon to your iPhone'}).click();
  await safari.getByLabel(layout==='left'?'The three-line menu is on the left':layout==='dots'?'A three-dot (…) menu':'The Share arrow is visible').check();
  assert.equal(await safari.locator('.safari-target').count(),1);
  if(compact)await safari.getByRole('button',{name:'Practice: Open Safari menu',exact:true}).click();
  await safari.getByRole('button',{name:'Practice: Share',exact:true}).click();
  await safari.getByRole('button',{name:'Practice: Add to Home Screen',exact:true}).click();
  await safari.getByRole('switch',{name:'Open as Web App',exact:true}).uncheck();
  assert(await safari.getByRole('button',{name:'Practice: Add',exact:true}).isDisabled());
  await safari.getByRole('switch',{name:'Open as Web App',exact:true}).check();
  await safari.getByRole('button',{name:'Practice: Add',exact:true}).click();
  assert.match(await safari.innerText(),/has not added an icon/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(mutations.length,0,'Safari practice must not write or email');
  if(width===320&&compact)await safari.screenshot({path:path.join(out,'safari-install-complete.png')});
  await safari.getByRole('button',{name:'Restart practice',exact:true}).click();
  assert(await safari.getByRole('button',{name:compact?'Practice: Open Safari menu':'Practice: Share',exact:true}).isVisible());
  await safari.getByRole('button',{name:'Close Safari tutorial',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.matches('.safari-launch'));
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Done',exact:true}).click();
 record('safari-install',['All three Safari layouts at 320/390/1280px','Action-only highlight','No writes or installation claim','Open as Web App, restart and close focus']);
 await openHelp();await page.locator('[data-tutorial-id="calendar"]').click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await (await target('[data-tour="nav-Calendar"]')).click();await (await target('[data-tour="calendar-today"]')).click();await page.keyboard.press('Escape');await page.getByRole('alertdialog',{name:'Exit practice?'}).waitFor();await page.getByRole('button',{name:'Keep practising',exact:true}).click();assert(await page.locator('.tutorial-coach').isVisible());await page.keyboard.press('Escape');await page.getByRole('button',{name:'Exit practice',exact:true}).click();assert.equal(await page.locator('.tutorial-coach').count(),0);record('exit',['Escape offers explicit exit','Keep practising retains position','Exit releases tutorial']);
 // Restart and exit must clean up only the practice form, including a typed draft.
 await page.emulateMedia({reducedMotion:'reduce'});await openHelp();await page.locator('[data-tutorial-id="groceries"]').click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await (await target('[data-tour="nav-Groceries"]')).click();await (await target('[data-tour="grocery-add"]')).click();await (await target('.grocery-editor input[placeholder="e.g. Kidney beans"]')).fill('Half-finished practice');await page.waitForFunction(()=>document.querySelector('[data-tutorial-highlight]'));
 await page.waitForFunction(()=>{const el=document.querySelector('.tutorial-spotlight');return !!el?.isConnected&&getComputedStyle(el).animationName==='none'},{},{timeout:3000});await page.locator('.tutorial-coach').getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Restart lesson',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).waitFor();assert.equal(await page.locator('.grocery-editor').count(),0);await page.getByRole('button',{name:'Start practice',exact:true}).click();await (await target('[data-tour="nav-Groceries"]')).click();await (await target('[data-tour="grocery-add"]')).click();await (await target('.grocery-editor input[placeholder="e.g. Kidney beans"]')).fill('Half-finished practice');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Keep practising',exact:true}).click();assert.equal(await page.getByLabel('Item',{exact:true}).inputValue(),'Half-finished practice');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Exit practice',exact:true}).click();await page.locator('.grocery-editor').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.position),'');await page.emulateMedia({reducedMotion:'no-preference'});record('restart-and-draft-exit',['Restart clears the practice form','Keep practising preserves typed practice','Exit discards practice and releases scroll lock','Reduced motion disables pulsing']);
 // An unfinished ordinary staple must survive an attempted tutorial launch.
 await page.locator('[data-tour="nav-Groceries"]:visible').first().click();await page.locator('.staples-toggle').click();await page.getByRole('button',{name:'New staple',exact:true}).click();await page.getByLabel('Item name',{exact:true}).fill('Real draft before practice');
 await page.getByRole('button',{name:'Open Settings',exact:true}).click();await page.getByRole('button',{name:/Help & tutorials/}).click();await page.locator('[data-tutorial-id="calendar"]').click();await page.getByRole('alertdialog',{name:'Save your changes?'}).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.locator('.tutorial-coach').count(),0);assert.equal(await page.getByLabel('Item name',{exact:true}).inputValue(),'Real draft before practice');await page.getByRole('button',{name:'Done',exact:true}).click();await page.locator('.staple-editor').getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();record('ordinary-draft',['Tutorial launch protects an existing real draft','Keep editing retains it','No automatic discard or save']);
 assert.deepEqual(errors,[]);assert.equal(mutations.length,0);
 // A real save outside practice must still use the normal application path.
 await page.getByRole('button',{name:'Add item',exact:true}).click();await page.getByLabel('Item',{exact:true}).fill('Normal item after practice');await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();for(let i=0;i<100&&!products.some(p=>p.title==='Normal item after practice');i++)await page.waitForTimeout(50);assert(products.some(p=>p.title==='Normal item after practice'));assert.equal(mutations.filter(x=>x.path.endsWith('/household_items')).length,1);record('normal-save',['Real saving resumes after tutorial exit','Exactly one normal grocery save']);
 assert.deepEqual(errors,[]);console.log('Interactive tutorials complete: '+tutorialGuides.length+' lessons; practice made no writes or email; ordinary saving verified');
})().catch(async error=>{console.error(error);if(page){fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','interactive-tutorials-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','interactive-tutorials-failure.png')}).catch(()=>{})}process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
