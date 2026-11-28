export const releaseProject = 'https://njpdqiwrwgoothkstoql.supabase.co';
export const releaseOrigin = 'https://app.hhfamily.ca';
export const legacyReleaseBase = 'https://zethhummel-rgb.github.io/hh-family/';
export const releaseRepository = 'zethhummel-rgb/hh-family';
export const releaseWorkflow = 'hh-release.yml';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const commitSha = /^[0-9a-f]{40}$/;
const versionTag = /^V(0|[1-9][0-9]{0,5})\.[0-9]$/;
const workerActions = new Set(['register', 'claim', 'verified', 'failed', 'publish']);
const maxRequest = 8_192;

export type ReleaseConfig = {
  project: string;
  enabled: boolean;
  operatorId: string;
  workerKey: string;
  githubToken: string;
};

type ReleaseServices = {
  admin: (token: string) => Promise<{id: string; canRelease: boolean; releases: unknown[]} | null>;
  worker: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  dispatch: (releaseId: string) => Promise<string | undefined>;
  verify: (payload: Record<string, unknown>) => Promise<boolean>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validWorkerKey(key: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(key);
}

async function matchesWorkerKey(token: string, expected: string): Promise<boolean> {
  if (!validWorkerKey(token) || !validWorkerKey(expected)) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([token, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const actual = new Uint8Array(hashes[0]);
  const target = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ target[i];
  return difference === 0;
}

export function makeReleaseHandler(config: ReleaseConfig, services: ReleaseServices) {
  const dispatchConfigured = config.enabled && uuid.test(config.operatorId) && validWorkerKey(config.workerKey)
    && config.githubToken.trim().length > 0;

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({'Cache-Control': 'no-store', 'Vary': 'Origin'});
    if (origin === releaseOrigin) {
      headers.set('Access-Control-Allow-Origin', releaseOrigin);
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    const json = (data: unknown, status = 200) => Response.json(data, {status, headers});

    if (config.project !== releaseProject) return json({error: 'This release connection is for live HH.'}, 404);
    if (origin !== null && origin !== releaseOrigin) return json({error: 'Open the live HH Admin Dashboard to continue.'}, 403);
    if (request.method === 'OPTIONS' && origin === releaseOrigin) return new Response(null, {status: 204, headers});
    if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);

    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return json({error: 'Sign in again to use Releases.'}, 401);
    if (Number(request.headers.get('content-length')) > maxRequest) return json({error: 'Release request is too large.'}, 413);
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > maxRequest) return json({error: 'Release request is too large.'}, 413);
      body = JSON.parse(raw);
    } catch {
      return json({error: 'Invalid release request.'}, 400);
    }
    if (!isObject(body)) return json({error: 'Invalid release request.'}, 400);

    if (body.action === 'worker') {
      if (origin !== null || !await matchesWorkerKey(bearer, config.workerKey)) {
        return json({error: 'Release worker authentication required.'}, 403);
      }
      if (typeof body.worker_action !== 'string' || !workerActions.has(body.worker_action) || !isObject(body.payload)) {
        return json({error: 'Unsupported release worker step.'}, 400);
      }
      try {
        if (body.worker_action === 'verified' && !await services.verify(body.payload)) {
          return json({error: 'The published live HH build could not be verified.'}, 409);
        }
        return json(await services.worker(body.worker_action, body.payload));
      } catch {
        return json({error: 'The release worker could not save this step.'}, 409);
      }
    }

    if (origin !== releaseOrigin) return json({error: 'Open the live HH Admin Dashboard to continue.'}, 403);
    let admin;
    try {
      admin = await services.admin(bearer);
    } catch {
      return json({error: 'HH could not check your release access. Try again.'}, 503);
    }
    if (!admin?.canRelease) return json({error: 'HH Admin access is required.'}, 403);
    const isOperator = admin.id === config.operatorId;
    if (body.action === 'availability') return json({dispatch_ready: dispatchConfigured && isOperator, target: 'LIVE'});
    if (body.action !== 'release' && body.action !== 'release_quietly' && body.action !== 'retry_announcement') {
      return json({error: 'Unsupported release action.'}, 400);
    }
    if (!isOperator) return json({error: 'Release approval is limited to the designated live HH operator.'}, 403);
    if (!dispatchConfigured) return json({error: 'The live HH release connection is not configured.'}, 503);
    if (typeof body.release_id !== 'string' || !uuid.test(body.release_id)) return json({error: 'Choose a prepared release.'}, 400);

    try {
      if (body.action === 'retry_announcement') {
        const release = admin.releases.find(row => isObject(row) && row.id === body.release_id);
        if (isObject(release) && release.status === 'published') return json({ok: true});
        if (!isObject(release) || release.status !== 'verified' || !await services.verify(release)) {
          return json({error: 'This build is not verified on live HH. Your announcement is still saved.'}, 409);
        }
        await services.worker('retry_publish', {release_id: body.release_id});
        return json({ok: true});
      }
      if (typeof body.expected_updated_at !== 'string' || body.expected_updated_at.length > 64
        || !Number.isFinite(Date.parse(body.expected_updated_at))) return json({error: 'Refresh the release and review its draft.'}, 400);
      await services.worker(body.action === 'release_quietly' ? 'queue_quiet' : 'queue', {
        release_id: body.release_id, actor_id: admin.id, expected_updated_at: body.expected_updated_at,
      });
    } catch {
      return json({error: 'HH could not start this step. Refresh the release and check its status.'}, 409);
    }

    try {
      const runUrl = await services.dispatch(body.release_id);
      return json({ok: true, run_url: runUrl});
    } catch {
      return json({error: 'GitHub did not confirm the start. Your draft is saved. Refresh the release before retrying.'}, 502);
    }
  };
}

export async function verifyLiveRelease(payload: Record<string, unknown>, send = fetch) {
  const {id, version, commit_sha} = payload;
  if (typeof id !== 'string' || !uuid.test(id) || typeof version !== 'string' || !versionTag.test(version)
    || typeof commit_sha !== 'string' || !commitSha.test(commit_sha)) return false;
  async function checkSite(base: string, requireHeader: boolean) {
    const url = new URL('hh-release.json', base);
    url.searchParams.set('check', crypto.randomUUID());
    const response = await send(url, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8_000),
      headers: {'Accept': 'application/json', 'Cache-Control': 'no-cache'},
    });
    if (!response.ok || (requireHeader && !/(^|[,\s])noindex([,\s]|$)/i.test(response.headers.get('X-Robots-Tag') ?? ''))) return false;
    const marker: unknown = await response.json().catch(() => null);
    return isObject(marker) && marker.target === 'live' && marker.repository === releaseRepository
      && marker.id === id && marker.version === version && marker.commit_sha === commit_sha;
  }
  return (await Promise.all([checkSite(releaseOrigin+'/', true), checkSite(legacyReleaseBase, false)])).every(Boolean);
}

export async function dispatchLiveRelease(githubToken: string, releaseId: string, send = fetch) {
  const response = await send(
    `https://api.github.com/repos/${releaseRepository}/actions/workflows/${releaseWorkflow}/dispatches`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'HH-Live-Releases',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ref: 'main', inputs: {action: 'release', release_id: releaseId}}),
    },
  );
  if (!response.ok) throw Error('GitHub did not confirm the release.');
  if (response.status === 204) return undefined;
  const data: unknown = await response.json().catch(() => null);
  const url = isObject(data) && typeof data.html_url === 'string' ? data.html_url : '';
  return /^https:\/\/github\.com\/zethhummel-rgb\/hh-family\/actions\/runs\/\d+$/.test(url) ? url : undefined;
}
