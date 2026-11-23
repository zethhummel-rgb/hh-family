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
const context={exports:{},location:{hostname:'zethhummel-rgb.github.io',pathname:'/hh-family/'}};
const source=fs.readFileSync('src/config.ts','utf8').replace('import.meta.env',JSON.stringify(env));
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
assert.equal(context.exports.testEnvironment,false);
assert.equal(context.exports.authNamespace,'');
assert.equal(context.exports.publicConfig.url,'https://njpdqiwrwgoothkstoql.supabase.co');
assert.equal(context.exports.publicConfig.key,'sb_publishable_Ok3ZhlQo6hYLRWcl68Z_Zw_qKEauTkq');
assert(fs.readFileSync('src/main.tsx','utf8').includes('testEnvironment&&<aside className="test-environment-banner"'),'TEST banner must be gated by the selected environment');
assert(!/HH Test|(?:Hummel Home|Humble Home App) TEST/.test(html),'TEST branding in production HTML');
for(const file of ['manifest.webmanifest','icon.svg','favicon.svg'])assert(fs.readFileSync('dist/'+file).equals(fs.readFileSync('public/'+file)),file+' changed during production build');
assert(!fs.existsSync('dist/test-guide.html'),'TEST guide in production output');
for (const file of ['home.html','about.html','request-invitation.html']) {
 const page=fs.readFileSync('dist/'+file,'utf8');
 assert(!/TEST preview|test-guide\.html|Family TEST|TEST%20invitation/.test(page),file+' includes TEST content');
}
const requestPage=fs.readFileSync('dist/request-invitation.html','utf8');
assert(requestPage.includes('data-endpoint="'+context.exports.publicConfig.url+'/functions/v1/request-pilot-invitation"'),'Invitation form must use the production backend');
assert(fs.existsSync('dist/homepage/request-invitation.js'),'Invitation form script missing from production output');
const home=fs.readFileSync('dist/home.html','utf8');
assert(home.includes('id="google"')&&home.includes('connect a dedicated Google calendar to see a copy of your HH plans'),'Production homepage must describe the currently available Google Calendar connection');
assert(!home.includes('Outlook sync'),'TEST-only Outlook sync appears on the production homepage');
const about=fs.readFileSync('dist/about.html','utf8');
assert(about.includes('<noscript><meta http-equiv="refresh" content="0; url=./home.html">'),'Older About links must reach the homepage when JavaScript is disabled');
assert(!fs.readFileSync('dist/sw.js','utf8').includes("version:'dev'"),'Offline shell was not built');
console.log('Production build verified: selected HH backend/key, existing login namespace, production mode, branding, offline shell and no TEST guide.');
