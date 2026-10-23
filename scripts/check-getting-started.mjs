import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/gettingStarted.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {gettingStartedProgress,saveGettingStarted}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const data=new Map(),store={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
assert.deepEqual(gettingStartedProgress('one','home',store),{dismissed:false,eventAdded:false});
saveGettingStarted('one','home',{eventAdded:true},store);
saveGettingStarted('one','home',{dismissed:true},store);
assert.deepEqual(gettingStartedProgress('one','home',store),{dismissed:true,eventAdded:true});
assert.deepEqual(gettingStartedProgress('two','home',store),{dismissed:false,eventAdded:false});
assert.deepEqual(gettingStartedProgress('one','different-home',store),{dismissed:false,eventAdded:false});
saveGettingStarted('one','home',{dismissed:false},store);
assert.deepEqual(gettingStartedProgress('one','home',store),{dismissed:false,eventAdded:true},'Reopening keeps completed steps');
const denied={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
saveGettingStarted('private','home',{dismissed:true,eventAdded:true},denied);
assert.deepEqual(gettingStartedProgress('private','home',denied),{dismissed:true,eventAdded:true});
const full={getItem:()=>null,setItem(){throw Error('quota')}};
saveGettingStarted('full-device','home',{dismissed:true},full);
assert.equal(gettingStartedProgress('full-device','home',full).dismissed,true,'A full store retains dismissal for this session');
for(const value of ['null','invalid','{"dismissed":"false","eventAdded":1}']){
 assert.deepEqual(gettingStartedProgress('new','home',{getItem:()=>value,setItem(){}}),{dismissed:false,eventAdded:false});
}
console.log('Getting-started progress passed: account/home isolation, saved completion, dismissal and replay, invalid storage, and session fallback. No backend writes.');
