import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/familySetup.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {queueFamilySetup,familySetupStep,saveFamilySetupStep,finishFamilySetup}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const data=new Map(),store={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
assert.equal(familySetupStep('owner','home',store),null,'Existing homes do not get an automatic setup prompt');
queueFamilySetup('owner','home',store);
assert.equal(familySetupStep('owner','home',store),'email','New owners invite members first');
assert.equal(familySetupStep('other','home',store),null,'Setup belongs to its creator');
assert.equal(familySetupStep('owner','other-home',store),null,'Setup belongs to its household');
for(const step of ['profiles','palette','email']){
 saveFamilySetupStep('owner','home',step,store);
 assert.equal(familySetupStep('owner','home',store),step,'A reload resumes the selected setup step');
}
finishFamilySetup('owner','home',store);
assert.equal(familySetupStep('owner','home',store),null,'Done or dismissal stops automatic reopening');
const denied={getItem:()=>{throw Error('Denied')},setItem:()=>{throw Error('Denied')},removeItem:()=>{throw Error('Denied')}};
assert.doesNotThrow(()=>queueFamilySetup('owner','home',denied));
assert.doesNotThrow(()=>saveFamilySetupStep('owner','home','palette',denied));
assert.equal(familySetupStep('owner','home',denied),null);
assert.doesNotThrow(()=>finishFamilySetup('owner','home',denied));
console.log('Family setup checks passed: new-owner trigger, per-home/account isolation, all three resume points, dismissal and unavailable storage.');
