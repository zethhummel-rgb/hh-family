import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
const html=fs.readFileSync('dist/index.html','utf8');
const script=html.match(/src="\.\/assets\/([^" ]+\.js)"/);
assert(script,'Built application script missing');
const js=fs.readFileSync('dist/assets/'+script[1],'utf8');
// Both environment fallbacks are intentionally present in the shared source.
// Verify the environment actually embedded in the bundle, not string absence.
const embedded=js.match(/\b(?:var|let|const) [\w$]+=(\{BASE_URL:[^}]+\})/);
assert(embedded,'Built environment object missing');
const env=vm.runInNewContext('('+embedded[1]+')');
assert.equal(env.VITE_APP_ENV,'production');
assert.equal(env.VITE_SUPABASE_URL,'https://njpdqiwrwgoothkstoql.supabase.co');
assert.equal(env.VITE_SUPABASE_PUBLISHABLE_KEY,'sb_publishable_Ok3ZhlQo6hYLRWcl68Z_Zw_qKEauTkq');
const context={exports:{},location:{hostname:'zethhummel-rgb.github.io',pathname:'/hh-family/'}};
const source=fs.readFileSync('src/config.ts','utf8').replace('import.meta.env',JSON.stringify(env));
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
assert.equal(context.exports.testEnvironment,false);
assert.equal(context.exports.authNamespace,'');
assert.equal(context.exports.publicConfig.url,env.VITE_SUPABASE_URL);
assert.equal(context.exports.publicConfig.key,env.VITE_SUPABASE_PUBLISHABLE_KEY);
assert(fs.readFileSync('src/main.tsx','utf8').includes('testEnvironment&&<aside className="test-environment-banner"'),'TEST banner must be gated by the selected environment');
assert(!/HH Test|Hummel Home/.test(html),'TEST branding in production HTML');
for(const file of ['manifest.webmanifest','icon.svg','favicon.svg'])assert(fs.readFileSync('dist/'+file).equals(fs.readFileSync('public/'+file)),file+' changed during production build');
assert(!fs.existsSync('dist/test-guide.html'),'TEST guide in production output');
assert(!fs.readFileSync('dist/sw.js','utf8').includes("version:'dev'"),'Offline shell was not built');
console.log('Production build verified: selected HH backend/key, existing login namespace, production mode, original branding, offline shell and no TEST guide.');
