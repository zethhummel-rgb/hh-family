import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/pilot.ts',import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const {invitationFrom,invitationRedirect}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
assert.deepEqual(invitationFrom(new URLSearchParams('pilot=new'),'old-pilot','old-family'),{pilot:'new',family:''});
assert.deepEqual(invitationFrom(new URLSearchParams('invite=new'),'old-pilot','old-family'),{pilot:'',family:'new'});
assert.deepEqual(invitationFrom(new URLSearchParams(),'kept-pilot',''),{pilot:'kept-pilot',family:''});
assert.equal(invitationRedirect('https://hh.example.test/hh/?old=1#hash','new pilot',''),'https://hh.example.test/hh/?pilot=new+pilot');
assert.equal(invitationRedirect('https://hh.example.test/hh/','new-pilot','new-family'),'https://hh.example.test/hh/?invite=new-family');
const config=fs.readFileSync(new URL('../src/config.ts',import.meta.url),'utf8');
async function configuration(env){const code=ts.transpileModule(config.replace('import.meta.env',JSON.stringify(env)),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))}
assert.equal((await configuration({})).backendConfigured,false);
assert.equal((await configuration({VITE_SUPABASE_URL:'https://pilot.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public'})).backendConfigured,true);
await assert.rejects(configuration({VITE_SUPABASE_URL:'https://ybizqfghnplcxlmlhvyn.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public'}),/own Supabase project/);
console.log('Pilot checks passed: explicit invitation precedence, confirmation-link preservation, clean redirects, and original database connection refused.');
