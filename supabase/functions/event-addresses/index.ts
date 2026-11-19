import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {eventAddressHandler} from './handler.ts';

const project=Deno.env.get('SUPABASE_URL')!;
const test=project==='https://ybizqfghnplcxlmlhvyn.supabase.co';
const live=project==='https://njpdqiwrwgoothkstoql.supabase.co';
const admin=createClient(project,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});

// The two project caps total 8,550 requests even if they share a Google billing account.
Deno.serve(eventAddressHandler(admin,{
 origin:'https://zethhummel-rgb.github.io',
 apiKey:Deno.env.get('HH_GOOGLE_PLACES_API_KEY')||'',
 monthlyLimit:test?50:live?8500:0
}));
