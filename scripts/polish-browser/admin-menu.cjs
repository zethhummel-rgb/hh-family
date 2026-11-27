// Synthetic signed-in menu checks. The browser is limited to the local fixture.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {launchBrowser}=require('./browser.cjs');
const {setFixtureHandler,serveFixture,redirectFixtureAPI}=require('./fixture-api.cjs');
const liveBuild=process.env.HH_ADMIN_MENU_TARGET==='live';
const appScope=liveBuild?'/hh-family/':'/hummel-home/';
const releaseTarget=liveBuild?'Live HH':'HH TEST';
const namespace=liveBuild?'':'hh-test:';
const backend=liveBuild?'https://njpdqiwrwgoothkstoql.supabase.co':'https://ybizqfghnplcxlmlhvyn.supabase.co';
const currentVersion=fs.readFileSync('src/releaseVersion.ts','utf8').match(/^export const appReleaseVersion = '(V[0-9]+\.[0-9])';$/m)?.[1];
assert.ok(currentVersion,'The fixture needs the current app release version');

const user={id:'22222222-2222-4222-8222-222222222228',email:'admin-menu@example.invalid',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-01-01',user_metadata:{},app_metadata:{provider:'email'}};
const home='11111111-1111-4111-8111-111111111118';
const authLifetime=7*86400;
const exp=Math.floor(Date.now()/1000)+authLifetime;
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const session={access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp,sub:user.id,aud:'authenticated',session_id:home}),'fixture'].join('.'),refresh_token:'fixture',expires_in:authLifetime,expires_at:exp,token_type:'bearer',user};
const member={user_id:user.id,display_name:'Fixture Admin',role:'owner',household_id:home};
const basePaletteKey='home-together:palette:'+user.id;
const rememberedAuthKey=namespace+namespace+'home-together-auth';
const factorId='44444444-4444-4444-8444-444444444444';
const verifiedSession={...session,access_token:[b64({alg:'HS256',typ:'JWT'}),b64({exp,sub:user.id,aud:'authenticated',session_id:home,aal:'aal2'}),'fixture'].join('.')};
const notices=[
 {id:'notice-fixture',kind:'notice',title:'Holiday support hours',body:'Support will be back Tuesday.\nThanks for your patience.',published_at:'2026-11-26T17:00:00Z'},
 {id:'update-fixture',kind:'update',title:'New calendar features',body:'See the weekly agenda on Home.',published_at:'2026-11-25T15:00:00Z'},
];
const ratingNotice={id:'rating-notice-fixture',kind:'notice',title:'A note from HH',body:'This arrived while you were rating HH.',published_at:'2026-11-28T17:00:00Z'};
const feedbackFixtures=[
 {id:'issue-fixture',area:'Calendar',message:'The reminder time was hard to see.',created_at:'2026-11-28T17:00:00Z'},
 {id:'idea-fixture',area:'New Feature Suggestion',message:'Add a family birthday view.',created_at:'2026-11-27T17:00:00Z'},
];
const noticeImageBucket='hh-notice-images';
const imageNotices=[
 {id:'33333333-3333-4333-8333-333333333331',kind:'notice',title:'',body:'',
  published_at:'2026-11-28T17:00:00Z',image_path:'33333333-3333-4333-8333-333333333331/artwork.png',image_alt:'Green and gold pixels in a checkerboard.'},
 {id:'33333333-3333-4333-8333-333333333332',kind:'update',title:'',body:'',release_version:'V2.2',
  published_at:'2026-11-28T16:00:00Z',image_path:'33333333-3333-4333-8333-333333333332/artwork.png',image_alt:'Archived green and gold checkerboard.'},
];
const noticePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGMwDXX5cjKV4cvJVNNQFwAqLgXhW7KSRAAAAABJRU5ErkJggg==','base64');
const noticeHistory=[
 {id:'33333333-3333-4333-8333-333333333341',kind:'update',title:'',body:'',release_version:'V2.2',
  published_at:'2026-11-27T17:00:00Z',image_path:'33333333-3333-4333-8333-333333333341/artwork.png',
  image_alt:'A gold and green release graphic.'},
 {id:'33333333-3333-4333-8333-333333333342',kind:'notice',title:'Fictional service announcement',body:'The test service is available again.',
  published_at:'2026-11-26T17:00:00Z'},
];
const festivePalettes={spring:'Spring Garden',summer:'Summer Shore',easter:'Easter',halloween:'Halloween',thanksgiving:'Thanksgiving',christmas:'Christmas'};
const seasonalPaletteIds=['spring','summer','autumn','winter','easter','halloween','thanksgiving','christmas'];
const releaseCandidate={id:'33333333-3333-4333-8333-333333333359',version:'V2.4',commit_sha:'a'.repeat(40),artifact_run_id:'1201',artifact_sha256:'b'.repeat(64),
 status:'ready',title:'',body:'',image_path:null,image_alt:null,error:null,created_at:'2026-11-28T17:00:00Z',updated_at:'2026-11-28T17:00:00Z'};

async function checkAdminBlocked(page){
 await page.getByRole('heading',{name:'Open HH to use Admin',exact:true}).waitFor();
 assert.equal(await page.locator('input[type="password"]').count(),0);
 assert.equal(await page.getByRole('heading',{name:'Pilot access',exact:true}).count(),0);
 await page.getByRole('link',{name:/Back to HH/}).waitFor();
}

async function checkMemberContent(page,setSeasons,setNotices){
 const notice=page.getByRole('dialog',{name:'Notice',exact:true});
 const update=page.getByRole('dialog',{name:'App update',exact:true});
 await notice.waitFor();
 await notice.getByText(notices[0].title,{exact:true}).waitFor();
 await notice.getByText('Support will be back Tuesday.',{exact:false}).waitFor();
 assert.equal(await update.count(),0,'Only one post opens at a time');
 if(process.env.HH_NOTICE_SAMPLE)await page.screenshot({path:process.env.HH_NOTICE_SAMPLE,animations:'disabled'});
 await page.setViewportSize({width:320,height:844});
 assert.ok(await notice.evaluate(node=>{const boxes=node.getBoundingClientRect();return boxes.left>=0&&boxes.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1}));
 await page.mouse.click(1,1);
 assert.equal(await notice.isVisible(),true,'A backdrop click does not dismiss a post');
 await notice.getByRole('button',{name:'Got it',exact:true}).click();
 await update.waitFor();
 await update.getByText(notices[1].title,{exact:true}).waitFor();
 await update.getByText(notices[1].body,{exact:true}).waitFor();
 assert.equal(await notice.count(),0);

 await page.reload();
 await update.waitFor();
 assert.equal(await notice.count(),0,'Only the previously dismissed post stays hidden');
 await page.keyboard.press('Escape');
 await update.waitFor({state:'detached'});
 const today=page.getByRole('heading',{name:'Today & coming up',exact:true});
 await today.waitFor();

 const openAppearance=async()=>{
  await page.getByRole('button',{name:'Open Settings',exact:true}).click();
  await page.getByRole('button',{name:/^Appearance /}).click();
 };
 await openAppearance();
 const spring=page.getByRole('button',{name:/Spring Garden/});
 const palette=name=>page.waitForFunction(id=>document.documentElement.dataset.palette===id,name);
 const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await spring.waitFor();
 assert.equal(await spring.count(),1);
 await palette('sage');
 assert.equal(await spring.getAttribute('aria-pressed'),'false');
 await spring.click();
 await palette('spring');
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),basePaletteKey),'sage');
 setSeasons([]);
 await refresh();
 await palette('sage');
 await spring.waitFor({state:'detached'});
 setSeasons(['spring']);
 await refresh();
 await spring.waitFor();
 await palette('spring');
 assert.equal(await spring.getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:/Classic Ivory/}).click();
 await palette('ivory');
 assert.equal(await page.evaluate(key=>localStorage.getItem(key+':seasonal'),basePaletteKey),null);
 await page.reload();
 await openAppearance();
 await spring.waitFor();
 await palette('ivory');
 const queued={id:'33333333-3333-4333-8333-333333333353',kind:'notice',title:'A new notice',body:'This notice arrived while Settings was open.',published_at:'2026-11-27T17:00:00Z'};
 setNotices([queued,...notices]);
 setSeasons(['spring','winter']);
 await refresh();
 await page.getByRole('button',{name:/Winter Pine/}).waitFor();
 assert.equal(await notice.count()+await update.count(),0,'New notices wait while Settings is open');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await notice.getByText(queued.title,{exact:true}).waitFor();
 const saved=page.waitForResponse(response=>response.url().includes('/rpc/hh_member_acknowledge_notices')&&
  response.request().postDataJSON().p_notice_ids.includes(queued.id)&&response.ok());
 await notice.getByRole('button',{name:'Got it',exact:true}).click();
 await saved;
 await today.waitFor();
 await page.getByRole('button',{name:'Open Settings',exact:true}).click();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await page.getByRole('heading',{name:'Welcome home.',exact:true}).waitFor();
 await page.evaluate(userId=>localStorage.removeItem('hh-test:hh:member-notice-dismissals:'+userId),user.id);
 await page.getByLabel('Email address',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('Fixture-password-123');
 const freshContent=page.waitForResponse(response=>response.url().includes('/rpc/hh_member_content')&&response.ok());
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const returned=await (await freshContent).json();
 assert.ok(returned.acknowledged_notice_ids.includes(queued.id));
 await today.waitFor();
 assert.equal(await notice.count()+await update.count(),0,'Server acknowledgements stay closed after signing out and back in without a browser cache');
}

async function checkMemberNoticeImages(page,storageRequests){
 await page.setViewportSize({width:320,height:650});
 const notice=page.getByRole('dialog',{name:'Notice',exact:true});
 const update=page.getByRole('dialog',{name:'V2.2 · App update',exact:true});
 const image=notice.getByRole('img',{name:imageNotices[0].image_alt,exact:true});
 await image.waitFor();
 assert.equal(await image.evaluate(async node=>{await node.decode();return node.naturalWidth}),2);
 await checkArtworkOnlyPopup(notice);
 const gotIt=notice.getByRole('button',{name:'Got it',exact:true});
 const imageBounds=await image.boundingBox();
 const actionBounds=await gotIt.boundingBox();
 assert.ok(imageBounds&&actionBounds&&imageBounds.y+imageBounds.height<=actionBounds.y,
  'Photo-only popups have visible artwork above the acknowledgement button');
 assert.ok(await notice.evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1}));
 assert.equal(await update.count(),0);
 await gotIt.click();
 await update.getByText(imageNotices[1].image_alt,{exact:true}).waitFor();
 await update.getByText('Loading image…',{exact:true}).waitFor({state:'detached'});
 assert.equal(await update.getByRole('img').count(),0,'A storage failure has visible alternative text');
 await checkArtworkOnlyPopup(update);
 await update.getByRole('button',{name:'Got it',exact:true}).click();
 await update.waitFor({state:'detached'});
 assert.deepEqual(storageRequests,
  imageNotices.map(item=>({method:'GET',path:`/storage/v1/object/${noticeImageBucket}/${item.image_path}`})));
 await page.reload();
 await page.getByRole('heading',{name:'Today & coming up',exact:true}).waitFor();
 const dismissed=await page.evaluate(userId=>JSON.parse(localStorage.getItem('hh-test:hh:member-notice-dismissals:'+userId)||'[]'),user.id);
 assert.deepEqual(dismissed,imageNotices.map(item=>item.id));
 assert.equal(await notice.count()+await update.count(),0,'Dismissed image notices do not reopen');
}

async function checkArtworkOnlyPopup(container){
 assert.equal(await container.getByRole('heading',{level:3}).count(),0,'Artwork-only popups omit the empty title');
 assert.equal(await container.locator('time').count(),0,'Artwork-only popups omit the date');
}

async function checkAdminNoticeImage(page,noticeWrites,storageRequests){
 await page.getByRole('button',{name:'Notices & updates',exact:true}).click();
 const compose=page.getByRole('region',{name:'Write a notice'});
 await compose.getByRole('combobox',{name:'Notice type'}).selectOption('update');
 const releaseVersion='V2.3';
 const imageAlt='Two green and gold squares.';
 const previewButton=compose.getByRole('button',{name:'Preview notice',exact:true});
 const preview=compose.locator('.member-notice-preview');
 const titleInput=compose.getByRole('textbox',{name:/^Title/});
 const bodyInput=compose.getByRole('textbox',{name:/^What changed/});
 const versionInput=compose.getByRole('textbox',{name:'App version',exact:true});
 assert.equal(await versionInput.inputValue(),currentVersion);
 assert.equal(await titleInput.evaluate(node=>node.required),true,'Text-only updates still require a title');
 assert.equal(await bodyInput.evaluate(node=>node.required),true,'Text-only updates still require a message');
 await previewButton.click();
 assert.equal(await preview.count(),0);
 await titleInput.fill('Text-only fixture');
 await bodyInput.fill('A fictional update without artwork.');
 await versionInput.fill('invalid');
 await previewButton.click();
 await page.getByRole('alert').filter({hasText:`Enter an app version such as ${currentVersion}.`}).waitFor();
 assert.equal(await preview.count(),0);
 await versionInput.fill(' v2.3 ');
 await previewButton.click();
 await preview.getByRole('heading',{name:'V2.3 · Text-only fixture',exact:true}).waitFor();
 await preview.getByText('A fictional update without artwork.',{exact:true}).waitFor();
 await compose.getByRole('button',{name:'Keep editing',exact:true}).click();
 await titleInput.fill('');
 await bodyInput.fill('');
 await compose.locator('input[type="file"]').setInputFiles({name:'fixture-notice.png',mimeType:'image/png',buffer:noticePng});
 await compose.getByRole('textbox',{name:/image description|alt text/i}).fill(imageAlt);
 assert.equal(await titleInput.evaluate(node=>node.required),false);
 assert.equal(await bodyInput.evaluate(node=>node.required),false);
 await previewButton.click();
 const image=preview.getByRole('img',{name:imageAlt,exact:true});
 assert.equal(await image.evaluate(async node=>{await node.decode();return node.naturalWidth}),2);
 await preview.getByRole('heading',{name:`${releaseVersion} · App update`,exact:true}).waitFor();
 await checkArtworkOnlyPopup(preview);
 await preview.getByText('Got it',{exact:true}).waitFor();
 assert.equal(storageRequests.length,0,'Preview does not upload an image');
 assert.equal(noticeWrites.length,0,'Preview does not publish a notice');

 await compose.getByRole('button',{name:'Publish notice',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Published in HH.'}).waitFor();
 assert.equal(noticeWrites.length,1);
 assert.equal(storageRequests.length,1);
 const {payload}=noticeWrites[0];
 assert.match(payload.id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
 const imagePath=payload.id+'/artwork.png';
 assert.deepEqual(noticeWrites[0],{
  action:'publish_notice',
  payload:{id:payload.id,kind:'update',title:'',body:'',image_path:imagePath,image_alt:imageAlt,release_version:releaseVersion},
 });
 assert.deepEqual(storageRequests[0],{method:'POST',path:`/storage/v1/object/${noticeImageBucket}/${imagePath}`});
 await page.getByRole('button',{name:`Archive ${releaseVersion} · ${imageAlt}`,exact:true}).waitFor();
}

async function checkPaletteGroups(page){
 const done=page.getByRole('button',{name:'Done',exact:true});
 const openAppearance=async()=>{
  await page.getByRole('button',{name:'Open Settings',exact:true}).click();
  await page.getByRole('button',{name:/^Appearance /}).click();
 };
 const group=name=>page.getByRole('group',{name,exact:true});
 const names=optionGroup=>optionGroup.locator('.palette-copy b').allTextContents();
 const classic=group('Classic colours');
 const seasonal=group('Seasonal colours');
 const holiday=group('Holiday themes');
 const paletteOption=(id,optionGroup)=>optionGroup.getByRole('button',{name:new RegExp(`^${festivePalettes[id]}\\b`)});
 await openAppearance();
 await classic.waitFor();
 assert.deepEqual(await names(classic),['Blush & Gold','Sage & Linen','Coastal Blue','Lavender','Warm Sand','Classic Ivory']);
 assert.deepEqual(await names(seasonal),['Spring Garden','Summer Shore','Autumn Harvest','Winter Pine']);
 assert.deepEqual(await names(holiday),['Easter','Halloween','Thanksgiving','Christmas']);
 assert.equal(await classic.getByRole('button',{name:/^Sage & Linen/}).getAttribute('aria-pressed'),'true');

 const artwork=new Set();
 const heroColours=new Set();
 for(const [index,id] of Object.keys(festivePalettes).entries()){
  if(index)await openAppearance();
  const option=paletteOption(id,['spring','summer'].includes(id)?seasonal:holiday);
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'),'true');
  await page.waitForFunction(palette=>document.documentElement.dataset.palette===palette,id);
  await done.click();
  const illustration=page.locator(`.seasonal-decor[data-season="${id}"]`);
  await illustration.waitFor();
  assert.equal(await illustration.getAttribute('aria-hidden'),'true');
  assert.equal(await illustration.evaluate(node=>getComputedStyle(node).pointerEvents),'none');
  artwork.add(await illustration.locator('svg').innerHTML());
  const heroColour=await illustration.evaluate(node=>getComputedStyle(node.closest('.page-heading')).backgroundImage);
  assert.notEqual(heroColour,'none',`Home has a visible themed hero for ${id}`);
  heroColours.add(heroColour);
 }
 const count=Object.keys(festivePalettes).length;
 assert.equal(artwork.size,count,'Each seasonal or holiday theme has its own illustration');
 assert.equal(heroColours.size,count,'Each seasonal or holiday theme has its own hero colours');

 await openAppearance();
 await classic.getByRole('button',{name:/^Sage & Linen/}).click();
 await done.click();
 await page.waitForFunction(()=>document.documentElement.dataset.palette==='sage');
 await page.locator('.page-heading .little-house').waitFor();
 assert.equal(await page.locator('.seasonal-decor').count(),0);
}

async function checkAdminPaletteSchedule(page,paletteWrites){
 await page.setViewportSize({width:320,height:780});
 const nav=page.getByRole('navigation',{name:'Admin Dashboard'});
 await nav.waitFor();
 const active=nav.locator('button[aria-current="page"]');
 assert.deepEqual(await nav.getByRole('button').allTextContents(),[
  'Pilot access','Manage households','Notices & updates','Seasonal palettes','Feedback & ideas','App ratings','Releases',
 ]);
 assert.equal(await active.innerText(),'Pilot access');
 await nav.getByRole('button',{name:'Seasonal palettes',exact:true}).click();
 const availability=page.getByRole('region',{name:'Theme availability'});
 await availability.waitFor();
 assert.equal(await active.innerText(),'Seasonal palettes');
 assert.equal(await active.count(),1,'Only the current dashboard section is active');
 await availability.getByRole('region',{name:'Seasonal colours'}).waitFor();
 const holidays=availability.getByRole('region',{name:'Holiday themes'});
 const christmas=holidays.locator('details[data-theme="christmas"]');
 assert.equal(await christmas.locator('.theme-card-status').getAttribute('data-state'),'off');
 await christmas.locator('summary').click();
 const schedule=christmas.getByRole('form',{name:'Christmas schedule'});
 await schedule.getByRole('checkbox',{name:'Enable theme',exact:true}).check();
 const start='2090-12-20',stop='2090-12-27';
 const startDate=schedule.getByLabel('Start date',{exact:true});
 const stopDate=schedule.getByLabel('Stop date',{exact:true});
 await startDate.fill(start);
 await stopDate.fill('2090-12-19');
 const save=schedule.getByRole('button',{name:'Save schedule',exact:true});
 await save.click();
 await page.getByRole('alert').filter({hasText:'Choose a stop date after the start date.'}).waitFor();
 assert.equal(paletteWrites.length,0,'An invalid schedule stays local');

 await stopDate.fill(stop);
 const startBounds=await startDate.boundingBox();
 const stopBounds=await stopDate.boundingBox();
 assert.ok(startBounds&&stopBounds&&stopBounds.y>=startBounds.y+startBounds.height,'Phone date fields are stacked');
 const viewport=await page.evaluate(()=>{
  const width=document.documentElement.scrollWidth;
  const overflow=width>innerWidth?[...document.querySelectorAll('body *')].filter(node=>{
   const bounds=node.getBoundingClientRect();
   return bounds.width>0&&bounds.right>innerWidth;
  }).slice(0,12).map(node=>({tag:node.tagName,style:node.getAttribute('class'),right:node.getBoundingClientRect().right})):[];
  return {width,viewport:innerWidth,overflow};
 });
 assert.ok(viewport.width<=viewport.viewport,`Dashboard and date controls fit a 320px phone: ${JSON.stringify(viewport)}`);
 await save.click();
 await page.getByRole('status').filter({hasText:'Christmas schedule saved.'}).waitFor();
 assert.deepEqual(paletteWrites,[{action:'set_palette',payload:{palette:'christmas',enabled:true,starts_on:start,stops_on:stop}}]);
 assert.equal(await christmas.locator('.theme-card-status').getAttribute('data-state'),'scheduled');
 assert.deepEqual(await christmas.locator('.theme-card-period time').evaluateAll(nodes=>nodes.map(node=>node.dateTime)),[start,stop]);
 if(process.env.HH_ADMIN_PALETTE_SAMPLE)await page.screenshot({path:process.env.HH_ADMIN_PALETTE_SAMPLE,fullPage:true,animations:'disabled'});
}

async function checkMemberNoticeHistory(page,historyRequests){
 const {release_version:version,image_alt:alt}=noticeHistory[0];
 const popup=page.getByRole('dialog',{name:`${version} · App update`,exact:true});
 const title=`${version} · ${alt}`;
 await popup.getByRole('img',{name:alt,exact:true}).waitFor();
 await checkArtworkOnlyPopup(popup);
 await popup.getByRole('button',{name:'Got it',exact:true}).click();
 await popup.waitFor({state:'detached'});
 assert.equal(historyRequests.length,0,'The history is loaded when requested');
 await page.setViewportSize({width:320,height:650});
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 await nav.getByRole('button',{name:'More',exact:true}).click();
 const more=page.getByRole('dialog',{name:'More for your home'});
 assert.equal(await more.getByRole('button',{name:/^Notices & updates/}).count(),0);
 await more.getByRole('button',{name:'Close More menu'}).click();
 await page.getByRole('button',{name:'Open Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 assert.equal(await settings.getByRole('button',{name:/^Notices & updates/}).count(),0);
 await settings.getByRole('button',{name:'Done',exact:true}).first().click();
 const footer=page.getByRole('navigation',{name:'HH information',exact:true});
 assert.deepEqual(await footer.getByRole('link').allTextContents(),['About HH','Privacy','Terms']);
 const openHistory=footer.getByRole('button',{name:'Notices & updates',exact:true});
 await openHistory.click();
 const history=page.getByRole('dialog',{name:'Notices & updates',exact:true});
 await history.getByText(`App version on this device ${currentVersion}`,{exact:true}).waitFor();
 const dismissed=history.getByText(title,{exact:true});
 await dismissed.click();
 await history.getByRole('img',{name:alt,exact:true}).waitFor();
 const loadEarlier=history.getByRole('button',{name:'Load earlier posts',exact:true});
 await loadEarlier.click();
 await history.getByText(noticeHistory[1].title,{exact:true}).click();
 await history.getByText(noticeHistory[1].body,{exact:true}).waitFor();
 await loadEarlier.waitFor({state:'detached'});
 assert.deepEqual(historyRequests,[
  {before_published_at:null,before_id:null},
  {before_published_at:noticeHistory[0].published_at,before_id:noticeHistory[0].id},
 ]);
 assert.equal(await dismissed.count(),1,
  'Loading earlier pages preserves already-dismissed updates in history');
 assert.equal(await history.getByRole('button',{name:'Back to Settings',exact:true}).count(),0);
 await page.keyboard.press('Escape');
 await history.waitFor({state:'detached'});
 await openHistory.evaluate(button=>{if(document.activeElement!==button)throw Error('Focus did not return to the footer')});
}

async function checkRatingClosedAfterReload(page,rating,message){
 await page.reload();
 await page.getByRole('button',{name:'Open Settings',exact:true}).click();
 await page.getByRole('button',{name:/^Appearance /}).click();
 // The fixture's seasonal palette arrives in the same response as rating eligibility.
 await page.getByRole('button',{name:/Spring Garden/}).waitFor();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.getByRole('heading',{name:'Today & coming up',exact:true}).waitFor();
 assert.equal(await rating.count(),0,message);
}

async function checkRatingPrompt(page,state,requests,queueNotice,moveRatingTime){
 const rating=page.getByRole('dialog',{name:/HH working for you/});
 const notice=page.getByRole('dialog',{name:'Notice',exact:true});
 if(state==='rating-submit'){
  await notice.getByText(notices[0].title,{exact:true}).waitFor();
  assert.equal(await rating.count(),0,'Notices come before the rating prompt');
  await notice.getByRole('button',{name:'Got it',exact:true}).click();
 }
 await rating.waitFor();
 await page.setViewportSize({width:320,height:650});
 assert.ok(await rating.evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1}));
 const send=rating.getByRole('button',{name:'Send rating',exact:true});
 const skip=rating.getByRole('button',{name:'Dismiss for now',exact:true});
 const comment=rating.getByRole('textbox',{name:/^Comment/});
 const quote=rating.getByRole('checkbox',{name:/quote my comment/});
 const quoteLabel=rating.getByText(/^HH may quote my comment on its website/);
 assert.equal(await send.isEnabled(),false);
 assert.equal(await quote.isChecked(),true);
 assert.equal(await quote.isEnabled(),true);
 await quoteLabel.click();
 assert.equal(await quote.isChecked(),false,'Tapping the optional label clears permission before typing');
 if(state==='rating-submit'){
  const first=rating.getByRole('radio',{name:'1 star',exact:true});
  const second=rating.getByRole('radio',{name:'2 stars',exact:true});
  await first.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  assert.equal(await second.isChecked(),true,'Arrow keys can choose a rating');
  assert.equal(await send.isEnabled(),true,'A comment is optional');
  await comment.fill('  The shared calendar is clear.  ');
  assert.equal(await quote.isEnabled(),true);
  assert.equal(await quote.isChecked(),false,'Adding a comment preserves the member’s unchecked choice');
  const refreshed=queueNotice();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await Promise.race([refreshed,delay(10000,false,{ref:false})]),true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await notice.count(),0,'New notices wait while a rating is in progress');
  await page.mouse.click(1,1);
  assert.equal(await rating.isVisible(),true,'The backdrop does not dismiss the rating prompt');
  await send.click();
  await rating.getByRole('alert').waitFor();
  assert.deepEqual(requests[0],{action:'submit',payload:{stars:2,comment:'The shared calendar is clear.',allow_quote:false}});
  assert.equal(await second.isChecked(),true);
  assert.equal(await comment.inputValue(),'  The shared calendar is clear.  ');
  assert.equal(await quote.isChecked(),false);
  await quoteLabel.click();
  assert.equal(await quote.isChecked(),true,'Tapping the optional label restores permission');
  await send.click();
  await notice.getByText(ratingNotice.title,{exact:true}).waitFor();
  assert.deepEqual(requests[1],{action:'submit',payload:{stars:2,comment:'The shared calendar is clear.',allow_quote:true}});
  await notice.getByRole('button',{name:'Got it',exact:true}).click();
 }else if(state==='rating-no-comment'||state==='rating-unquoted'){
  const five=rating.getByRole('radio',{name:'5 stars',exact:true});
  await five.focus();
  await page.keyboard.press('Space');
  const message=state==='rating-unquoted'?'A fictional comment for the admin only.':'';
  if(message){
   await comment.fill(message);
   assert.equal(await quote.isChecked(),false);
  }else{
   await quoteLabel.click();
   assert.equal(await quote.isChecked(),true);
   assert.equal(await comment.inputValue(),'');
  }
  await send.click();
  await rating.waitFor({state:'detached'});
  assert.deepEqual(requests,[{action:'submit',payload:{stars:5,comment:message,allow_quote:false}}]);
 }else{
  await skip.click();
  await rating.waitFor({state:'detached'});
  assert.equal(requests.length,1);
  assert.equal(requests[0].action,'dismiss');
  assert.deepEqual(requests[0].payload??{},{});
  await moveRatingTime(-1000);
  await checkRatingClosedAfterReload(page,rating,'Dismissing does not prompt again within 24 hours');
  assert.equal(requests.length,1,'Reopening during the snooze does not save another dismissal');
  await moveRatingTime(1000);
  await page.reload();
  await rating.waitFor();
  const four=rating.getByRole('radio',{name:'4 stars',exact:true});
  await four.focus();
  await page.keyboard.press('Space');
  await send.click();
  await rating.waitFor({state:'detached'});
  assert.deepEqual(requests[1],{action:'submit',payload:{stars:4,comment:'',allow_quote:false}});
 }
 const completedRequests=requests.length;
 await checkRatingClosedAfterReload(page,rating,'Members are not prompted after submitting a rating');
 assert.equal(requests.length,completedRequests);
}

async function checkAdminReleases(page,connected,draftWrites,dispatchWrites,storageRequests,setStatus){
 const open=()=>page.getByRole('button',{name:'Releases',exact:true}).click();
 const editor=page.getByRole('region',{name:`V2.4 for ${releaseTarget}`,exact:true});
 const records=page.getByRole('region',{name:`Builds for ${releaseTarget}`,exact:true});
 const button=name=>editor.getByRole('button',{name,exact:true});
 const form=editor.getByRole('form',{name:'Announcement draft'});
 const imageAlt='A gold and green preview of the next HH release.';
 const savedAt='2026-11-28T18:00:00.123456Z';
 const refresh=()=>records.getByRole('button',{name:'Refresh',exact:true}).click();
 const status=expected=>editor.locator(`.release-status[data-status="${expected}"]`).waitFor();
 await open();
 await status('ready');
 if(connected){
  await form.locator('input[type="file"]').setInputFiles({name:'release-fixture.png',mimeType:'image/png',buffer:noticePng});
  await form.getByRole('textbox',{name:'Image description (alt text)',exact:true}).fill(imageAlt);
 }else{
  await editor.getByText(/Release connection isn’t configured yet/).waitFor();
  await form.getByRole('textbox',{name:'Title',exact:true}).fill('Calendar refresh');
  await form.getByRole('textbox',{name:'Message',exact:true}).fill('The release preview works without a deployment connection.');
 }
 await button('Preview announcement').click();
 if(connected)await editor.getByRole('img',{name:imageAlt}).waitFor();
 else await editor.getByRole('heading',{name:'V2.4 · Calendar refresh',exact:true}).waitFor();
 assert.deepEqual(storageRequests,[]);
 assert.deepEqual(draftWrites,[]);
 assert.deepEqual(dispatchWrites,[]);
 await button('Save draft').click();
 await editor.getByText('Draft saved.',{exact:true}).waitFor();
 assert.deepEqual(draftWrites,[{release_id:releaseCandidate.id,
  title:connected?'':'Calendar refresh',
  body:connected?'':'The release preview works without a deployment connection.',
  image_path:connected?`${releaseCandidate.id}/artwork.png`:null,
  image_alt:connected?imageAlt:null,
 }]);
 assert.deepEqual(dispatchWrites,[]);
 if(connected)assert.equal(storageRequests.filter(({method})=>method==='POST').length,1);

 await page.reload();
 await page.getByRole('heading',{name:'Pilot access',exact:true}).waitFor();
 await open();
 await status('ready');
 if(!connected){
  assert.equal(await form.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Calendar refresh');
  await editor.getByText(/Release connection isn’t configured yet/).waitFor();
  assert.equal(await button('Review release').count(),0);
  assert.equal(await button(`Release to ${releaseTarget}`).count(),0);
  assert.deepEqual(dispatchWrites,[]);
  return;
 }
 assert.equal(await form.getByRole('textbox',{name:'Image description (alt text)',exact:true}).inputValue(),imageAlt);
 await button('Preview announcement').click();
 await editor.getByRole('img',{name:imageAlt}).waitFor();
 assert.ok(storageRequests.some(({method})=>method==='GET'),'Reopening downloads the saved artwork from private storage');

 const confirmation=editor.getByRole('region',{name:`Release V2.4 to ${releaseTarget}?`,exact:true});
 await button('Review release').click();
 await confirmation.getByText(liveBuild?/app\.hhfamily\.ca/:/test\.hhfamily\.ca/).waitFor();
 await confirmation.getByText(releaseCandidate.commit_sha.slice(0,12),{exact:true}).waitFor();
 await confirmation.getByRole('button',{name:'Back',exact:true}).click();
 assert.deepEqual(dispatchWrites,[]);
 await button('Review release').click();
 setStatus('ready',null,'2026-11-28T18:00:01.123456Z');
 await refresh();
 await confirmation.waitFor({state:'detached'});
 assert.deepEqual(dispatchWrites,[],'Refreshing a revised draft must invalidate its prior confirmation');
 setStatus('ready',null,savedAt);
 await refresh();
 await button('Review release').click();
 await confirmation.getByRole('button',{name:`Release to ${releaseTarget}`,exact:true}).click();
 await status('queued');
 assert.deepEqual(dispatchWrites,[{action:'release',release_id:releaseCandidate.id,expected_updated_at:savedAt}]);
 assert.equal(await editor.getByRole('link',{name:'Open GitHub run',exact:true}).getAttribute('href'),'https://github.com/example/hh/actions/runs/1202');

 setStatus('deploying',null,new Date().toISOString());
 await refresh();
 await status('deploying');
 assert.equal(await button('Review deployment retry').count(),0);
 setStatus('verified','The announcement was not posted.');
 await refresh();
 await status('verified');
 await editor.getByText('The announcement was not posted.',{exact:true}).waitFor();
 await button('Review announcement retry').click();
 await button('Retry announcement').click();
 await editor.getByRole('alert').getByText(/HH could not confirm the request/).waitFor();
 await status('verified');
 await button('Review announcement retry').click();
 await button('Retry announcement').click();
 await status('published');
 assert.deepEqual(dispatchWrites.slice(1),Array.from({length:2},()=>({action:'retry_announcement',release_id:releaseCandidate.id})));
 assert.equal(await button('Review announcement retry').count(),0);
}

async function run(){
 const dist=path.resolve(process.env.HH_ADMIN_MENU_DIST||'dist');
 const server=http.createServer(async(req,res)=>{
  if(await serveFixture(req,res))return;
  const relative=new URL(req.url,'http://localhost').pathname.replace(appScope,'')||'index.html';
  const file=path.join(dist,relative);
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await launchBrowser();
  const url='http://127.0.0.1:'+server.address().port+appScope;
  const adminUrl=new URL('admin.html',url).href;
  const allScenarios=['authorized','authorized-visit','signed-out','callback','ordinary','unavailable','signout','member-content','member-palettes','member-images','member-notice-history','admin-notice-image','admin-palette-schedule','admin-mfa','admin-releases','admin-release-disconnected','rating-submit','rating-dismiss','rating-no-comment','rating-unquoted'];
  const scenarios=process.env.HH_ADMIN_MENU_SCENARIOS?.split(',').map(scenario=>scenario.trim())??allScenarios;
  assert.ok(scenarios.every(scenario=>allScenarios.includes(scenario)),'Unknown admin menu browser scenario');
  for(const state of scenarios){
   const releaseScenario=['admin-releases','admin-release-disconnected'].includes(state);
   const approved=releaseScenario||['authorized','authorized-visit','callback','signout','admin-notice-image','admin-palette-schedule','admin-mfa'].includes(state);
   const ratingMember=['rating-submit','rating-dismiss','rating-no-comment','rating-unquoted'].includes(state);
   const context=await browser.newContext({
    viewport:{width:390,height:844},
    ...(['signout','member-content'].includes(state)?{serviceWorkers:'block'}:{}),
   });
   const localOrigin=new URL(url).origin;
   await context.route('**/*',route=>new URL(route.request().url()).origin===localOrigin?route.continue():route.abort('blockedbyclient'));
   await context.routeWebSocket('**/*',socket=>socket.close());
   await context.addInitScript(redirectFixtureAPI,backend);
   await context.addInitScript(({session,key,state,rememberedAuthKey,namespace})=>{
    if(sessionStorage.getItem('admin-menu-fixture'))return;
    if(state==='authorized-visit'){
     sessionStorage.setItem(namespace+'hh:login-choice:v1','visit');
     sessionStorage.setItem(namespace+'hh:login-visit:v1','admin-menu-visit');
     sessionStorage.setItem(namespace+namespace+'hh:visit-auth:v1:admin-menu-visit',JSON.stringify(session));
    }else if(state!=='signed-out')localStorage.setItem(rememberedAuthKey,JSON.stringify(session));
    localStorage.setItem(key,'sage');
    sessionStorage.setItem('admin-menu-fixture','1');
   },{session,key:basePaletteKey,state,rememberedAuthKey,namespace});
   const {promise:adminCheck,resolve:checked}=Promise.withResolvers();
   const {promise:waitToReply,resolve:reply}=Promise.withResolvers();
   let activeSeasons=state==='member-palettes'?seasonalPaletteIds:['spring','spring','unknown'];
   const initialNotices={'rating-submit':notices.slice(0,1),'rating-dismiss':[],'rating-no-comment':[],'rating-unquoted':[],'member-palettes':[],'member-images':imageNotices,
    'member-notice-history':noticeHistory.slice(0,1)};
   let publishedNotices=initialNotices[state]??notices;
   const acknowledgedNotices=new Set();
   let ratingComplete=false;
   let ratingTime=Date.now();
   let snoozedUntil=0;
   const ratingRequests=[];
   const ratingToggles=[];
   const feedbackFilters=[];
   const noticeWrites=[];
   const storageRequests=[];
   const paletteWrites=[];
   const historyRequests=[];
   const draftWrites=[];
   const dispatchWrites=[];
   let releaseRecord={...releaseCandidate};
   let announcementRetries=0;
   let ratingPromptEnabled=false;
   const {promise:queuedRatingNotice,resolve:ratingNoticeRefreshed}=Promise.withResolvers();
   let accountChecks=0,roleChecks=0,dashboardChecks=0,tokenRequests=0;
   let mfaVerified=false;
   setFixtureHandler(async route=>{
    const req=route.request(),target=new URL(req.url()),name=target.pathname.split('/').pop();
    const fixtureSession=mfaVerified?verifiedSession:session;
    let data=[];
    if(target.pathname.startsWith('/storage/v1/')){
     const method=req.method();
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     storageRequests.push({method,path:target.pathname});
     if(method==='GET'&&state==='member-images'){
      if(target.pathname.endsWith(imageNotices[0].image_path))return route.fulfill({body:noticePng,headers:{'Content-Type':'image/png'}});
      if(target.pathname.endsWith(imageNotices[1].image_path))return route.fulfill({status:404,json:{message:'Fixture image unavailable'}});
     }
     if(method==='GET'&&state==='member-notice-history'&&target.pathname.endsWith(noticeHistory[0].image_path)){
      return route.fulfill({body:noticePng,headers:{'Content-Type':'image/png'}});
     }
     if(method==='GET'&&releaseScenario&&target.pathname.endsWith(`${releaseCandidate.id}/artwork.png`)){
      return route.fulfill({body:noticePng,headers:{'Content-Type':'image/png'}});
     }
     if(method==='POST'&&(state==='admin-notice-image'||releaseScenario)){
      assert.match(req.headers()['content-type'],/image\/png|multipart\/form-data/);
      return route.fulfill({json:{Key:target.pathname.slice('/storage/v1/object/'.length)}});
     }
     assert.fail('Unexpected notice image request '+target.pathname);
    }
    else if(target.pathname.startsWith('/auth/')){
     if(name==='user')accountChecks++;
     if(name==='token')tokenRequests++;
     if(name==='logout'&&['signout','member-content'].includes(state))return route.fulfill({status:204});
     if(name==='token'&&state==='member-content')return route.fulfill({json:fixtureSession});
     if(state==='admin-mfa'&&name==='challenge')data={id:'fixture-challenge',type:'totp',expires_at:exp};
     else if(state==='admin-mfa'&&name==='verify'){
      assert.equal(req.postDataJSON()?.challenge_id,'fixture-challenge');
      if(req.postDataJSON()?.code!=='123456')return route.fulfill({status:400,json:{message:'Invalid test OTP'}});
      mfaVerified=true;
      data=verifiedSession;
     }else data=state==='admin-mfa'?{...user,factors:[{id:factorId,status:'verified',factor_type:'totp'}]}:user;
    }
    else if(target.pathname.includes('/functions/')&&name==='hh-release-dispatch'){
     assert.ok(releaseScenario,'Only the Releases tab checks dispatch availability');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const request=req.postDataJSON();
     if(request.action==='availability')data={dispatch_ready:state==='admin-releases',target:liveBuild?'LIVE':'TEST'};
     else{
      assert.equal(state,'admin-releases','A disconnected release cannot dispatch');
      assert.equal(request.release_id,releaseRecord.id);
      dispatchWrites.push(request);
      if(request.action==='release'){
       assert.equal(request.expected_updated_at,releaseRecord.updated_at);
       releaseRecord={...releaseRecord,status:'queued'};
       data={ok:true,run_url:'https://github.com/example/hh/actions/runs/1202'};
      }else{
       assert.equal(request.action,'retry_announcement');
       assert.equal(releaseRecord.status,'verified');
       if(++announcementRetries===1)return route.fulfill({status:502,json:{error:'Fixture announcement unavailable'}});
       releaseRecord={...releaseRecord,status:'published',error:null};
       data={ok:true};
      }
     }
    }
    else if(target.pathname.includes('/functions/'))data={configured:false,connected:false,nativeReady:true};
    else if(name==='household_members')data=req.headers().accept?.includes('vnd.pgrst.object')?member:[member];
    else if(name==='households')data={id:home,name:'Fixture Home',owner_id:user.id};
    else if(name==='household_calendar_source')data='hh';
    else if(name==='household_transition_active')data=false;
    else if(name==='pilot_status')data={is_host:false};
    else if(name==='hh_member_content'){
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const includesRatingNotice=publishedNotices.includes(ratingNotice);
     if(state==='member-content'||state==='member-palettes'||state==='member-images'||state==='member-notice-history'||ratingMember){
      data={notices:publishedNotices,acknowledged_notice_ids:[...acknowledgedNotices],seasonal_palettes:activeSeasons,rating_eligible:ratingMember&&!ratingComplete&&ratingTime>=snoozedUntil};
     }
     await route.fulfill({json:data});
     if(includesRatingNotice)ratingNoticeRefreshed(true);
     return;
    }
    else if(name==='hh_member_acknowledge_notices'){
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     for(const id of req.postDataJSON().p_notice_ids)acknowledgedNotices.add(id);
     return route.fulfill({status:204});
    }
    else if(name==='hh_member_notice_history'){
     assert.equal(state,'member-notice-history');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const {before_id=null,before_published_at=null}=req.postDataJSON()??{};
     historyRequests.push({before_published_at,before_id});
     data=before_id?{notices:noticeHistory.slice(1),has_more:false}:{notices:noticeHistory.slice(0,1),has_more:true};
    }
    else if(name==='hh_member_rating'){
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     ratingRequests.push(req.postDataJSON());
     if(state==='rating-submit'&&ratingRequests.length===1)return route.fulfill({status:409,json:{message:'Fixture save failure'}});
     const action=ratingRequests.at(-1).action;
     if(action==='dismiss'){
      snoozedUntil=ratingTime+86400000;
      data={completed:true,snoozed_until:new Date(snoozedUntil).toISOString()};
     }else{
      assert.equal(action,'submit');
      ratingComplete=true;
      data={completed:true};
     }
    }
    else if(name==='hh_admin_status'){
     roleChecks++;
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     if(state==='signout'){checked(true);await waitToReply}
     await route.fulfill(state==='unavailable'?{status:404,json:{message:'Missing RPC'}}:
      {json:{is_admin:approved,requires_mfa:state==='admin-mfa'&&!mfaVerified}});
     checked(true);
     return;
    }
    else if(name==='hh_admin_dashboard'){
     dashboardChecks++;
     assert.ok(approved&&(state!=='admin-mfa'||mfaVerified),'Only verified admins can request dashboard data');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     assert.equal(req.postDataJSON()?.action,'snapshot');
     data={requests:[{id:'request-fixture',name:'Fixture applicant',email:'request@example.invalid',received_at:'2026-11-26T17:00:00Z',status:'preview'}],invitations:[],capacity:{used:0,total:14}};
    }
    else if(name==='hh_admin_releases'){
     assert.ok(releaseScenario,'Only the Releases tab loads candidate records');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const {action,payload}=req.postDataJSON();
     if(action==='save_draft'){
      const {release_id,...fields}=payload;
      assert.equal(release_id,releaseRecord.id);
      draftWrites.push(payload);
      releaseRecord={...releaseRecord,...fields,updated_at:'2026-11-28T18:00:00.123456Z'};
     }else assert.equal(action,'snapshot');
     data={releases:[releaseRecord],can_release:true};
    }
    else if(name==='hh_admin_content'){
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const request=req.postDataJSON();
     data={notices:[],seasonal_palettes:[],palette_schedule:[]};
     if(request.action==='publish_notice'){
      assert.equal(state,'admin-notice-image');
      assert.equal(storageRequests.length,1,'The artwork must upload before publishing');
      noticeWrites.push(request);
      data.notices=[{...request.payload,published_at:'2026-11-29T17:00:00Z'}];
     }else if(request.action==='set_palette'){
      assert.equal(state,'admin-palette-schedule');
      paletteWrites.push(request);
     }else assert.equal(request.action,'snapshot');
     data.palette_schedule=paletteWrites.map(entry=>entry.payload);
    }
    else if(name==='hh_admin_ratings'){
     assert.ok(approved,'Only an authorized admin can load the ratings inbox');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const {action,payload}=req.postDataJSON();
     if(action==='set_enabled'){
      assert.equal(typeof payload.enabled,'boolean');
      ratingPromptEnabled=payload.enabled;
      ratingToggles.push(ratingPromptEnabled);
     }else assert.equal(action,'snapshot');
     data={enabled:ratingPromptEnabled,ratings:[],has_more:false};
    }
    else if(name==='hh_admin_feedback'){
     assert.ok(approved,'Only an authorized admin can load the feedback inbox');
     assert.equal(req.headers().authorization,'Bearer '+fixtureSession.access_token);
     const {kind}=req.postDataJSON();
     feedbackFilters.push(kind);
     const submissions=kind==='all'?feedbackFixtures:feedbackFixtures.filter(item=>(item.area==='New Feature Suggestion')===(kind==='ideas'));
     data={submissions,has_more:false};
    }
    await route.fulfill({json:data});
   });
   try{
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    if(state==='signed-out'||state==='callback'){
     const entries=state==='callback'?[`${adminUrl}?code=synthetic-callback`,`${adminUrl}#access_token=synthetic-callback&type=recovery`]:[adminUrl];
     for(const entry of entries){await page.goto(entry);await checkAdminBlocked(page)}
     assert.equal(accountChecks,0);
     assert.equal(roleChecks,0);
     assert.equal(dashboardChecks,0);
     assert.equal(tokenRequests,0);
     continue;
    }
    await page.goto(url);
    if(state==='member-content'){
     await checkMemberContent(page,seasons=>{activeSeasons=seasons},entries=>{publishedNotices=entries});
     continue;
    }
    if(state==='member-palettes'){
     await checkPaletteGroups(page);
     continue;
    }
    if(state==='member-images'){
     await checkMemberNoticeImages(page,storageRequests);
     continue;
    }
    if(state==='member-notice-history'){
     await checkMemberNoticeHistory(page,historyRequests);
     continue;
    }
    if(ratingMember){
     await checkRatingPrompt(page,state,ratingRequests,()=>{publishedNotices=[ratingNotice,...publishedNotices];return queuedRatingNotice},async offset=>{
      assert.ok(snoozedUntil,'The fixture needs a saved snooze before moving time');
      ratingTime=snoozedUntil+offset;
      await page.clock.setFixedTime(ratingTime);
     });
     continue;
    }
    await page.getByRole('button',{name:'Open Settings',exact:true}).click();
    assert.equal(await Promise.race([adminCheck,delay(10000,false,{ref:false})]),true,`Admin status fixture was not reached for ${state}`);
    const link=page.getByRole('link',{name:/Admin Dashboard/});
    if(state==='signout'){
     try{
      assert.ok(await page.evaluate(key=>localStorage.getItem(key),rememberedAuthKey),'The race starts with a saved sign-in');
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      // Sign-out can replace the document while the old role request is pending.
      // Observe the durable change before releasing the stale approval.
      await page.waitForFunction(key=>localStorage.getItem(key)===null,rememberedAuthKey);
     }catch(error){
      const screen=await page.locator('body').innerText({timeout:2000}).catch(()=>'page unavailable');
      throw new Error('Sign-out did not clear the fixture session. Screen: '+screen.slice(0,600),{cause:error});
     }finally{reply()}
     await page.getByRole('heading',{name:'Welcome home.',exact:true}).waitFor();
     assert.equal(await link.count(),0);
     await page.goto(adminUrl);
     await checkAdminBlocked(page);
     assert.equal(dashboardChecks,0);
    }else{
     if(approved){
      await link.waitFor();
      assert.equal(await link.getAttribute('href'),'./admin.html');
      assert.equal(await link.getAttribute('target'),null,'TEST Admin keeps the current tab’s HH sign-in');
      const priorAccountChecks=accountChecks;
      await link.click();
      await page.waitForURL(adminUrl);
      if(state==='admin-mfa'){
       await page.getByRole('heading',{name:'Verify your sign-in',exact:true}).waitFor();
       assert.equal(dashboardChecks,0);
       assert.equal(await page.locator('input[type="password"]').count(),0);
       const code=page.getByRole('textbox',{name:'Verification code',exact:true});
       const verify=page.getByRole('button',{name:'Verify',exact:true});
       await code.fill('000000');await verify.click();
       await page.getByRole('alert').getByText('That code could not be verified. Try a fresh code.').waitFor();
       assert.equal(dashboardChecks,0);
       await code.fill('123456');await verify.click();
      }
      await page.getByRole('heading',{name:'Pilot access',exact:true}).waitFor();
      await page.getByText('Fixture applicant',{exact:true}).waitFor();
      assert.ok(accountChecks>priorAccountChecks,'Dashboard verifies the shared user with Auth');
      assert.ok(dashboardChecks>0);
      assert.equal(await page.locator('input[type="password"]').count(),0);
      assert.equal(context.pages().length,1);
      if(state==='authorized-visit')assert.equal(await page.evaluate(key=>localStorage.getItem(key),rememberedAuthKey),null);
      if(state==='admin-notice-image')await checkAdminNoticeImage(page,noticeWrites,storageRequests);
      if(state==='admin-palette-schedule')await checkAdminPaletteSchedule(page,paletteWrites);
      if(releaseScenario)await checkAdminReleases(page,state==='admin-releases',draftWrites,dispatchWrites,storageRequests,
       (status,error=null,updated_at=releaseRecord.updated_at)=>{releaseRecord={...releaseRecord,status,error,updated_at}});
      if(state==='authorized'){
       await page.getByRole('button',{name:'App ratings',exact:true}).click();
       const ratingsSwitch=checked=>page.getByRole('switch',{name:'Show the rating pop-up',checked});
       await ratingsSwitch(false).click();
       await ratingsSwitch(true).click();
       await ratingsSwitch(false).waitFor();
       assert.deepEqual(ratingToggles,[true,false]);
       await page.getByRole('button',{name:'Feedback & ideas',exact:true}).click();
       const issue=page.getByText(feedbackFixtures[0].message,{exact:true});
       const idea=page.getByText(feedbackFixtures[1].message,{exact:true});
       await issue.waitFor();
       await idea.waitFor();
       await page.getByRole('button',{name:'Ideas',exact:true}).click();
       await issue.waitFor({state:'detached'});
       await idea.waitFor();
       await page.getByRole('button',{name:'Feedback',exact:true}).click();
       await idea.waitFor({state:'detached'});
       await issue.waitFor();
       assert.deepEqual(feedbackFilters,['all','ideas','feedback']);
      }
     }else{
      assert.equal(await link.count(),0,state);
      await page.goto(adminUrl);
      await checkAdminBlocked(page);
      assert.equal(dashboardChecks,0);
      await page.getByRole('link',{name:/Back to HH/}).click();
      await page.getByRole('heading',{name:'Today & coming up',exact:true}).waitFor();
     }
    }
    assert.equal(tokenRequests,0);
   }finally{reply();await context.close()}
  }
 }finally{if(browser)await browser.close();server.close()}
}

run().then(()=>console.log('Admin menu checks passed: '+(process.env.HH_ADMIN_MENU_SCENARIOS||'TEST sign-in reuse, direct-entry denial, late sign-out, notices with optional images, seasonal palettes and rating snooze.'))).catch(error=>{console.error(error);process.exitCode=1});
