import {createClient} from '@supabase/supabase-js';
import {publicConfig} from './config';
export const supabase=createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'home-together-auth'}});
