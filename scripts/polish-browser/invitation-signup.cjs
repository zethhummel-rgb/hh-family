// Synthetic browser regression test. Build VITE_APP_ENV=test first; API requests are mocked.
const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve('dist'),home='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email:'a'.repeat(64)+'@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'email'},email_confirmed_at:'2026-01-01'};
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

 const requests=[],checks=[],errors=[];let scenario='new',registered=false,joined=false;
 const code='a'.repeat(64),expired='e'.repeat(64);const out=path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish');
 function pass(name){checks.push(name);fs.writeFileSync(path.join(out,'invitation-signup.json'),JSON.stringify({checks,errors,requests},null,2));console.log('PASS '+name)}
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
 await context.routeWebSocket('**/*',socket=>socket.close());await context.addInitScript(redirectFixtureAPI);
 setFixtureHandler(async route=>{
  const req=route.request(),u=new URL(req.url()),body=req.postDataJSON();requests.push({path:u.pathname,body});
  if(u.pathname.endsWith('/invitation-registration')){
   if(body.token===expired)return route.fulfill({status:400,json:{error:'This invitation is invalid, expired or already used. Ask for a new invitation.'}});
   if(body.action==='preview')return route.fulfill({json:{email:user.email,householdName:body.kind==='family'?'The Test Home':null,existingAccount:scenario==='existing'}});
   if(scenario==='failure')return route.fulfill({status:503,json:{error:'Could not prepare your account. Please try again.'}});
   registered=true;return route.fulfill({json:{email:user.email,registered:true}});
  }
  if(u.pathname.endsWith('/token'))return route.fulfill({json:{...session,user}});
  if(u.pathname.endsWith('/user'))return route.fulfill({json:user});
  if(u.pathname.includes('/auth/')&&!u.pathname.endsWith('/logout'))throw Error('Unexpected auth email request: '+u.pathname);
  if(u.pathname.endsWith('/accept_household_invite')||u.pathname.endsWith('/create_pilot_household')){joined=true;return route.fulfill({json:home})}
  if(u.pathname.endsWith('/pilot_status'))return route.fulfill({json:{is_host:false}});
  if(u.pathname.endsWith('/household_members'))return route.fulfill({json:joined?[member]:[]});
  return route.fulfill({json:[]});
 });
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('button',{name:'Create my account',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(requests.length,0);pass('Missing invitation cannot create an account');
 await page.getByLabel('Invitation code',{exact:true}).fill(code);await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.getByLabel('Email address',{exact:true}).inputValue(),user.email);assert(await page.getByLabel('Email address',{exact:true}).getAttribute('readonly')!==null);for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Long email overflow at '+width)}await page.setViewportSize({width:390,height:844});pass('Manual code resolves and locks the invited address; long emails fit at 320/390/1280');
 async function fillAccount(){await page.getByLabel('Your name',{exact:true}).fill('Invited Person');await page.getByLabel(/^Password/).fill('Fixture-password-123');if(await page.getByLabel(/^Confirm password/).count())await page.getByLabel(/^Confirm password/).fill('Fixture-password-123')}
 for(const kind of ['family','pilot']){
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});registered=false;joined=false;scenario='new';
  await page.goto(url+'?'+(kind==='family'?'invite':'pilot')+'='+code+'&email=attacker%40example.invalid');await page.getByLabel('Email address',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Email address',{exact:true}).inputValue(),user.email);await page.getByText('Your invitation code',{exact:true}).click();assert.equal(await page.getByLabel('Invitation code',{exact:true}).inputValue(),code);await fillAccount();
  await page.getByRole('button',{name:'Create my account',exact:true}).click();
  await page.getByRole('heading',{name:kind==='family'?'Join your family.':'Make a home of your own.',exact:true}).waitFor();assert(registered);assert.equal(await page.getByRole('alertdialog').count(),0);
  const registration=requests.filter(x=>x.path.endsWith('/invitation-registration')&&x.body.action==='register').at(-1);assert.equal(registration.body.kind,kind);assert.equal(registration.body.token,code);assert.equal(registration.body.email,undefined);
  assert.equal(requests.filter(x=>/\/(signup|resend|otp)$/.test(x.path)).length,0);pass(kind+': invitation creates account and signs in without a second email');
  if(kind==='pilot')await page.getByLabel('Family or household name',{exact:true}).fill('Fixture Home');
  await page.getByRole('button',{name:kind==='family'?'Join household':'Create my household',exact:true}).click();
  await page.waitForURL(url);assert(joined);const acceptance=requests.findLast(x=>x.path.endsWith(kind==='family'?'/accept_household_invite':'/create_pilot_household'));assert.equal(acceptance.body[kind==='family'?'invite_token':'pilot_token'],code);pass(kind+': household acceptance uses the original code and clears the invitation URL');
 }
 await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});joined=false;scenario='existing';await page.goto(url+'?invite='+code);await page.getByText(/You already started an account/).waitFor();assert.equal(await page.getByLabel(/^Confirm password/).count(),0);await fillAccount();await page.getByRole('button',{name:'Continue to household',exact:true}).click();await page.getByRole('heading',{name:'Join your family.',exact:true}).waitFor();pass('Previously started accounts use the existing password without a duplicate signup');
 await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await page.goto(url+'?invite='+expired);await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/already used/);assert.equal(await page.getByLabel(/^Password/).count(),0);pass('Expired, cancelled or used invitation shows recovery guidance before requesting a password');
 scenario='failure';await page.goto(url+'?invite='+code);await page.getByLabel('Email address',{exact:true}).waitFor();await fillAccount();await page.getByRole('button',{name:'Create my account',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Your name',{exact:true}).inputValue(),'Invited Person');assert.equal(await page.getByLabel(/^Password/).inputValue(),'Fixture-password-123');pass('Service failure preserves entries for retry');
 await page.screenshot({path:path.join(out,'one-email-invitation.png'),fullPage:true});
 assert.deepEqual(errors,[]);pass('No runtime exceptions; all account and email requests intercepted');
})().catch(async e=>{console.error(e);if(page)fs.writeFileSync(path.resolve(process.env.HH_POLISH_OUTPUT||'artifacts/polish','invitation-signup-failure.txt'),await page.locator('body').innerText().catch(()=>''));process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
