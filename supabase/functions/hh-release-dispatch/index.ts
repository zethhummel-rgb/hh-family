import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {dispatchLiveRelease, makeReleaseHandler, releaseProject, verifyLiveRelease} from './handler.ts';

const project = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const githubToken = Deno.env.get('HH_RELEASE_GITHUB_TOKEN') ?? '';
const sessionOptions = {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false};

const serviceClient = project === releaseProject && serverKey
  ? createClient(project, serverKey, {auth: sessionOptions}) : null;

Deno.serve(makeReleaseHandler({
  project,
  githubToken,
  operatorId: Deno.env.get('HH_RELEASE_OPERATOR_ID') ?? '',
  workerKey: Deno.env.get('HH_RELEASE_WORKER_KEY') ?? '',
  enabled: Deno.env.get('HH_RELEASE_DISPATCH_ENABLED') === 'true' && !!serviceClient && !!publicKey,
}, {
  async admin(accessToken) {
    if (!publicKey) return null;
    const client = createClient(project, publicKey, {
      auth: sessionOptions,
      global: {headers: {Authorization: `Bearer ${accessToken}`}},
    });
    const {data: {user}, error: userError} = await client.auth.getUser(accessToken);
    if (userError || !user?.email_confirmed_at) return null;
    const {data, error} = await client.rpc('hh_admin_releases', {action: 'snapshot'});
    if (error?.code === '42501') return null;
    if (error) throw Error('Admin check failed.');
    return {id: user.id, canRelease: data?.can_release === true, releases: Array.isArray(data?.releases) ? data.releases : []};
  },
  async worker(action, payload) {
    if (!serviceClient) throw Error('Release database connection unavailable.');
    const {data, error} = await serviceClient.rpc('hh_release_worker', {action, payload});
    if (error || !data) throw Error('Release database step failed.');
    return data;
  },
  dispatch: (releaseId) => dispatchLiveRelease(githubToken, releaseId),
  verify: payload => verifyLiveRelease(payload),
}));
