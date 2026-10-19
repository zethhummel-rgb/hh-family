// Only the new pilot project is allowed. Production Hummel Home is explicitly denied.
const env=import.meta.env as Record<string,string|undefined>;
const url=env.VITE_SUPABASE_URL||'https://njpdqiwrwgoothkstoql.supabase.co';
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_Ok3ZhlQo6hYLRWcl68Z_Zw_qKEauTkq';
if(url.includes('ybizqfghnplcxlmlhvyn'))throw Error('The pilot must use its own Supabase project.');
export const backendConfigured=/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)&&!!key;
export const publicConfig={url:backendConfigured?url:'https://setup.invalid',key:key||'not-configured'};
