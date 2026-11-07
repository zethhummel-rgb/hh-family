import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';

async function module(path){const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))}
const {createLoginStorage,rememberedAuthKey}=await module('../src/loginStorage.ts');
const {createAccountSwitchStorage,SWITCH_ACCOUNTS,switchEmail}=await module('../src/accountSwitchStorage.ts');
const family=SWITCH_ACCOUNTS[0].email,admin=SWITCH_ACCOUNTS[1].email;
const familyId='11111111-1111-4111-8111-111111111111',adminId='22222222-2222-4222-8222-222222222222';
const token=(id,email,refresh='synthetic-refresh')=>JSON.stringify({user:{id,email},access_token:'synthetic-access',refresh_token:refresh});
function storage(){const data=new Map();let failNext='';return {data,failOnce:key=>{failNext=key},getItem:key=>data.get(key)??null,setItem(key,value){if(key===failNext){failNext='';throw Error('Full')}data.set(key,value)},removeItem:key=>data.delete(key)}}
let sequence=0;
const setup=(local=storage(),tab=storage())=>{const login=createLoginStorage(()=>local,()=>tab,()=>String(++sequence));return {local,tab,login,accounts:createAccountSwitchStorage(login,()=>String(++sequence))}};
const reference=(accounts,email,id,remember=true,key=accounts.keyFor(email,remember))=>({email,userId:id,key,remember});

assert.equal(switchEmail(' ZETHHUMMEL@GMAIL.COM '),family);
assert.equal(switchEmail('another@example.com'),null);
assert.equal(switchEmail('zethhummel@gmail.com.attacker.test'),null);

{
 const first=setup(),second=setup(first.local);const a=reference(first.accounts,family,familyId,true,rememberedAuthKey),b=reference(first.accounts,admin,adminId);
 const source=first.accounts.options(a),target=first.accounts.options(b);
 source.storage.setItem(a.key,token(familyId,family));target.storage.setItem(b.key,token(adminId,admin));
 first.accounts.initial(false);second.accounts.initial(false);first.accounts.record(a);first.accounts.activate(b);
 assert.equal(first.accounts.initial(false).key,b.key,'The activating tab chooses the target');
 assert.equal(second.accounts.initial(false).key,a.key,'An existing second tab stays pinned to its source');
 assert.equal(setup(first.local).accounts.initial(false).key,b.key,'A new remembered launch uses the last chosen account');
 assert.equal(source.storage.getItem(a.key),token(familyId,family),'Switching does not overwrite or revoke source credentials');
 const registry=first.local.getItem('hh:account-links:v1');assert.ok(registry.includes(familyId)&&registry.includes(adminId));assert.ok(!registry.includes('synthetic-access')&&!registry.includes('synthetic-refresh'),'Metadata stores references, never token copies');
 target.storage.setItem(b.key,token(adminId,admin,'rotated-token'));
 assert.equal(first.accounts.readRegistry(true)[admin].key,b.key,'Rotation leaves one canonical SDK key');
 assert.equal(first.accounts.storedIdentityMatches(b),true);
 target.storage.setItem(b.key,token(familyId,family));assert.equal(first.accounts.storedIdentityMatches(b),false,'A replaced key no longer looks like the saved target');
}

for(const failedKey of ['hh:account-links:v1','hh:default-account:v1','hh:active-account:v1']){
 const f=setup(),a=reference(f.accounts,family,familyId,true,rememberedAuthKey),b=reference(f.accounts,admin,adminId);
 f.accounts.options(a).storage.setItem(a.key,token(familyId,family));f.accounts.record(a);f.accounts.activate(a);
 const oldRegistry=f.local.getItem('hh:account-links:v1'),oldDefault=f.local.getItem('hh:default-account:v1'),oldChoice=f.tab.getItem('hh:active-account:v1');
 (failedKey==='hh:active-account:v1'?f.tab:f.local).failOnce(failedKey);
 assert.throws(()=>f.accounts.activate(b),/cannot save/);
 assert.equal(f.local.getItem('hh:account-links:v1'),oldRegistry,'A partial failure rolls back registry metadata');
 assert.equal(f.local.getItem('hh:default-account:v1'),oldDefault,'A partial failure rolls back the cold-start default');
 assert.equal(f.tab.getItem('hh:active-account:v1'),oldChoice,'A partial failure keeps the current tab selected');
 assert.equal(setup(f.local,f.tab).accounts.initial(false).key,a.key,'Reload after failure still selects the source');
}

{
 const first=setup(),second=setup(first.local);const a=reference(first.accounts,family,familyId,true,rememberedAuthKey),b=reference(first.accounts,admin,adminId);
 const source=first.accounts.options(a),oldOne=first.accounts.options(b),oldTwo=second.accounts.options(b);
 source.storage.setItem(a.key,token(familyId,family));oldOne.storage.setItem(b.key,token(adminId,admin));oldOne.storage.setItem(b.key+'-user','old-user');
 second.accounts.blockAndRemove(b);
 assert.equal(oldOne.storage.isCurrent(),false);assert.equal(oldTwo.storage.isCurrent(),false,'Auth event handlers can reject a retired SDK lifecycle');
 assert.equal(oldOne.storage.getItem(b.key),null);assert.equal(oldTwo.storage.getItem(b.key),null);
 oldOne.storage.setItem(b.key,token(adminId,admin,'late-refresh'));oldTwo.storage.setItem(b.key+'-user','late-user');
 assert.equal(first.local.getItem(b.key),null,'A late refresh in another tab cannot restore a forgotten login');
 assert.equal(first.local.getItem(b.key+'-user'),null);
 const fresh=first.accounts.options(b);fresh.storage.setItem(b.key,token(adminId,admin,'new-login'));
 oldOne.storage.removeItem(b.key);assert.equal(first.local.getItem(b.key),token(adminId,admin,'new-login'),'An old SDK lifecycle cannot erase a new login');
 assert.equal(source.storage.getItem(a.key),token(familyId,family),'Revoking a target key does not affect another canonical key');
 first.local.setItem('sb-ybizqfghnplcxlmlhvyn-auth-token','personal-app');
 first.accounts.blockAndRemove(b);assert.equal(first.local.getItem('sb-ybizqfghnplcxlmlhvyn-auth-token'),'personal-app');
}

{
 const f=setup();f.login.select(false);const a=reference(f.accounts,family,familyId,false,f.login.options().storageKey),b=reference(f.accounts,admin,adminId,false);
 f.accounts.options(a).storage.setItem(a.key,token(familyId,family));f.accounts.options(b).storage.setItem(b.key,token(adminId,admin));f.accounts.record(a);f.accounts.activate(b);
 assert.equal(setup(f.local,f.tab).accounts.initial(false).key,b.key,'Visit switching survives only the current tab reload');
 const separate=setup(f.local);assert.notEqual(separate.accounts.initial(false).key,b.key);assert.equal(separate.accounts.readRegistry(false)[admin],undefined);
 assert.ok(![...f.local.data.values()].some(value=>value.includes('synthetic-access')),'Visit credentials never reach local storage');
}

for(const failure of ['throw','silent']){
 const f=setup(),a=reference(f.accounts,family,familyId,true,rememberedAuthKey),b=reference(f.accounts,admin,adminId);
 const source=f.accounts.options(a),target=f.accounts.options(b);
 source.storage.setItem(a.key,token(familyId,family));target.storage.setItem(b.key,token(adminId,admin));
 f.accounts.record(a);f.accounts.activate(b);
 const remove=f.local.removeItem;
 f.local.removeItem=key=>{if(key===a.key||key===b.key){if(failure==='throw')throw Error('Removal blocked');return}remove(key)};
 f.accounts.clearSelection();
 for(const ref of [a,b]){f.accounts.blockAndRemove(ref);f.accounts.removeReference(ref.email,ref.remember)}
 f.accounts.pinChoice({key:b.key,remember:true});
 assert.equal(f.accounts.store(true).failed,true,`${failure} removal is observable to the sign-out runtime`);
 assert.equal(source.storage.isCurrent(),false);assert.equal(target.storage.isCurrent(),false,'The current realm stays retired when removal fails');
 assert.equal(source.storage.getItem(a.key),null);assert.equal(target.storage.getItem(b.key),null);
 assert.equal(f.local.getItem(b.key),token(adminId,admin),'Persistent tokens can remain despite an in-memory removal');
 const reload=setup(f.local,f.tab),reloadedChoice=reload.accounts.initial(false);
 assert.equal(reload.accounts.options(reloadedChoice).storage.getItem(b.key),token(adminId,admin),'Reload would read the leftover session, so failed cleanup must not reload');
}

{
 const f=setup(),a=reference(f.accounts,family,familyId,true,rememberedAuthKey),b=reference(f.accounts,admin,adminId);
 f.accounts.options(a).storage.setItem(a.key,token(familyId,family));f.accounts.activate(b);
 assert.equal(f.accounts.initial(true).key,rememberedAuthKey,'Auth callback URLs bypass account selection');
 const entry={key:f.accounts.entryKey(true),remember:true};f.accounts.blockAndRemove(entry);f.accounts.pinChoice(entry);
 assert.equal(setup(f.local,f.tab).accounts.initial(false).key,entry.key,'Explicit sign-in entry does not restore a saved legacy account');
 assert.equal(f.local.getItem(a.key),token(familyId,family));
 const other={key:f.accounts.normalLoginKey(true),remember:true};f.accounts.pinChoice(other);assert.equal(setup(f.local,f.tab).accounts.initial(false).key,other.key);
 assert.equal(f.accounts.options({...b,userId:''}).storageKey,b.key,'A bounded candidate key can be opened before password verification supplies its user ID');
 assert.throws(()=>f.accounts.record({...b,userId:''}),/Invalid/,'An unverified candidate is never enrolled');
 assert.throws(()=>f.accounts.options({key:'arbitrary-other-app-key',remember:true}),/Invalid/);
 assert.throws(()=>f.accounts.pinChoice({key:'arbitrary-other-app-key',remember:true}),/Invalid/);
 assert.throws(()=>f.accounts.blockAndRemove({key:'arbitrary-other-app-key',remember:true}),/Invalid/);
 f.local.setItem('hh:account-links:v1',JSON.stringify({[admin]:{...b,key:'arbitrary-other-app-key'}}));assert.equal(f.accounts.readRegistry(true)[admin],undefined,'Unbounded forged references are ignored');
 f.local.setItem('hh:account-links:v1',JSON.stringify({[admin]:{...b,key:f.accounts.keyFor(family,true)}}));assert.equal(f.accounts.readRegistry(true)[admin],undefined,'A dedicated key belongs only to its declared account');
}

{
 const f=setup(),a=reference(f.accounts,family,familyId,true,rememberedAuthKey);
 for(const version of ['v1','v2'])f.accounts.store(true).setItem('shopping:'+version+':'+a.key,'synthetic grocery cache');
 f.accounts.blockAndRemove(a);
 for(const version of ['v1','v2'])assert.equal(f.accounts.store(true).getItem('shopping:'+version+':'+a.key),null,'Sign-out removes both grocery cache versions');
}
console.log('Account-switch storage checks passed: reference-only metadata, exact eligibility, source preservation, per-tab choice and cold start, refresh rotation, partial-write rollback, cross-tab late-write/removal fencing, failed-removal detection, visit isolation, callback bypass, safe sign-in entry and bounded keys. Synthetic data only.');
