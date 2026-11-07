// Environment selection is build-time only, never controlled by a URL parameter.
const env=import.meta.env as Record<string,string|undefined>;
export const testEnvironment=env.VITE_APP_ENV==='test';
export const authNamespace=testEnvironment?'hh-test:':'';
const productionUrl='https://njpdqiwrwgoothkstoql.supabase.co';
const testUrl='https://ybizqfghnplcxlmlhvyn.supabase.co';
const url=env.VITE_SUPABASE_URL||(testEnvironment?testUrl:productionUrl);
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||(testEnvironment?'sb_publishable_jbLSo5LPkS9k06Fx1txlBQ_3rWWkWh_':'sb_publishable_Ok3ZhlQo6hYLRWcl68Z_Zw_qKEauTkq');
if(testEnvironment&&url!==testUrl)throw Error('The test app must use its own Supabase project.');
if(!testEnvironment&&url.includes('ybizqfghnplcxlmlhvyn'))throw Error('HH must use its own Supabase project.');
if(typeof location!=='undefined'&&location.hostname==='zethhummel-rgb.github.io'){
 const path=testEnvironment?'/hummel-home/':'/hh-family/';
 if(!(location.pathname===path.slice(0,-1)||location.pathname.startsWith(path)))throw Error('This build belongs to a different app environment.');
 if(!testEnvironment&&url!==productionUrl)throw Error('HH production backend mismatch.');
}
export const backendConfigured=/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)&&!!key;
export const publicConfig={url:backendConfigured?url:'https://setup.invalid',key:key||'not-configured'};
