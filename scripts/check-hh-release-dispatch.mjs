import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = readFileSync(new URL('../supabase/functions/hh-release-dispatch/handler.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
vm.runInNewContext(compiled, {exports, Request, Response, Headers, AbortSignal, TextEncoder, URL, crypto, fetch});
const {makeReleaseHandler, dispatchLiveRelease, releaseOrigin, legacyReleaseBase, releaseProject, verifyLiveRelease} = exports;

const operator = '11111111-1111-4111-8111-111111111111';
const releaseId = '22222222-2222-4222-8222-222222222222';
const key = 'fixture-release-worker-key-00000000000000000000000';
const config = {project: releaseProject, enabled: true, operatorId: operator, workerKey: key, githubToken: 'fixture'};
const queue = [];
const dispatches = [];
let rejectStep = false;
let rejectDispatch = false;
let verifyHost = false;
const services = {
  async admin(token) {
    if (token === 'owner-session') return {id: operator, canRelease: true, releases: [{id: releaseId, status: 'verified'}]};
    if (token === 'other-admin') return {id: releaseId, canRelease: true, releases: []};
    return null;
  },
  async worker(action, payload) {
    queue.push({action, payload: {...payload}});
    if (rejectStep) throw Error('Private database details');
    return {release: {id: releaseId}, claimed: action === 'claim'};
  },
  async dispatch(id) {
    dispatches.push(id);
    if (rejectDispatch) throw Error('Private API details');
    return 'https://github.com/zethhummel-rgb/hh-family/actions/runs/12345';
  },
  async verify() { return verifyHost; },
};
const handler = makeReleaseHandler(config, services);

function request(body, {handle = handler, token = 'owner-session', origin = releaseOrigin, method = 'POST'} = {}) {
  const headers = new Headers({'Content-Type': 'application/json'});
  if (origin) headers.set('Origin', origin);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return handle(new Request('https://fixture.invalid/releases', {
    method, headers, ...(method === 'POST' ? {body: JSON.stringify(body)} : {}),
  }));
}

const status = body => request(body).then(response => response.status);
const reviewedAt = '2026-11-26T22:00:00.000Z';
const start = {action: 'release', release_id: releaseId, expected_updated_at: reviewedAt};
const claim = {action: 'worker', worker_action: 'claim', payload: {release_id: releaseId}};
const check = (handle, expected) => request({action: 'availability'}, {handle}).then(async response => {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {dispatch_ready: expected, target: 'LIVE'});
});

assert.equal((await request({}, {method: 'OPTIONS'})).headers.get('access-control-allow-origin'), releaseOrigin);
assert.equal((await request(start, {handle: makeReleaseHandler({...config, project: 'https://ybizqfghnplcxlmlhvyn.supabase.co'}, services)})).status, 404);
assert.equal((await request(start, {origin: 'https://test.hhfamily.ca'})).status, 403);
assert.equal((await request(start, {origin: null})).status, 403);
assert.equal((await request(start, {token: null})).status, 401);
assert.equal((await request(start, {token: 'ordinary-member'})).status, 403);
assert.equal((await request(start, {token: 'other-admin'})).status, 403);
assert.equal((await request(start, {handle: makeReleaseHandler({...config, enabled: false}, services)})).status, 503);
assert.equal(await status({...start, release_id: 'main'}), 400);
assert.equal((await request(claim, {token: key})).status, 403);
assert.equal((await request(claim, {token: 'wrong-key', origin: null})).status, 403);
assert.equal((await request({...claim, worker_action: 'queue'}, {token: key, origin: null})).status, 400);
assert.equal(queue.length, 0);
assert.equal(dispatches.length, 0);

await check(handler, true);
await check(makeReleaseHandler({...config, githubToken: ''}, services), false);
assert.equal((await (await request({action: 'availability'}, {token: 'other-admin'})).json()).dispatch_ready, false);
assert.deepEqual(await (await request(claim, {token: key, origin: null})).json(), {release: {id: releaseId}, claimed: true});
assert.equal(queue.at(-1).action, 'claim');
const verify = {...claim, worker_action: 'verified'};
assert.equal((await request(verify, {token: key, origin: null})).status, 409);
assert.equal(queue.at(-1).action, 'claim');
verifyHost = true;
assert.equal((await request(verify, {token: key, origin: null})).status, 200);
assert.equal(queue.at(-1).action, 'verified');
assert.deepEqual(await (await request({...start, repository: 'untrusted', ref: 'feature'})).json(), {
  ok: true, run_url: 'https://github.com/zethhummel-rgb/hh-family/actions/runs/12345',
});
assert.deepEqual(queue.at(-1), {action: 'queue', payload: {release_id: releaseId, actor_id: operator, expected_updated_at: reviewedAt}});
assert.deepEqual(dispatches, [releaseId]);
assert.equal(await status({action: 'retry_announcement', release_id: releaseId}), 200);
assert.deepEqual(queue.at(-1), {action: 'retry_publish', payload: {release_id: releaseId}});
assert.equal(dispatches.length, 1);
verifyHost = false;
assert.equal(await status({action: 'retry_announcement', release_id: releaseId}), 409);
verifyHost = true;
assert.equal(await status({...start, expected_updated_at: null}), 400);

rejectStep = true;
assert.equal(await status(start), 409);
assert.equal(dispatches.length, 1);
rejectStep = false;
rejectDispatch = true;
const failed = await request(start);
assert.equal(failed.status, 502);
assert.doesNotMatch(await failed.text(), /Private/);
assert.equal(dispatches.length, 2);

assert.equal(await dispatchLiveRelease('token', releaseId, async (url, options) => {
  assert.equal(url, 'https://api.github.com/repos/zethhummel-rgb/hh-family/actions/workflows/hh-release.yml/dispatches');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), {ref: 'main', inputs: {action: 'release', release_id: releaseId}});
  return Response.json({html_url: 'https://untrusted.invalid'});
}), undefined);
assert.equal(await dispatchLiveRelease('token', releaseId, async () => new Response(null, {status: 204})), undefined);
await assert.rejects(dispatchLiveRelease('token', releaseId, async () => new Response(null, {status: 404})));
const receipt = {id: releaseId, version: 'V2.3', commit_sha: 'a'.repeat(40)};
const marker = {target: 'live', repository: 'zethhummel-rgb/hh-family', id: releaseId, version: receipt.version, commit_sha: receipt.commit_sha};
assert.equal(await verifyLiveRelease(receipt, async (url, options) => {
  const address = url.origin === releaseOrigin ? releaseOrigin+'/' : legacyReleaseBase;
  assert.equal(url.origin+url.pathname, address+'hh-release.json');
  assert.ok(url.searchParams.get('check'));
  assert.equal(options.redirect, 'error');
  return Response.json(marker, {headers: url.origin === releaseOrigin ? {'X-Robots-Tag': 'noindex, nofollow, noarchive'} : undefined});
}), true);
assert.equal(await verifyLiveRelease(receipt, async () => Response.json(marker)), false);
assert.equal(await verifyLiveRelease(receipt, async url => url.origin === releaseOrigin
  ? Response.json(marker, {headers: {'X-Robots-Tag': 'noindex'}})
  : Response.json({...marker, version:'V2.2'})), false);
assert.equal(await verifyLiveRelease(receipt, async () => Response.json({...marker, version: 'V2.2'}, {headers: {'X-Robots-Tag': 'noindex'}})), false);
console.log('HH release dispatch checks passed: live/TEST isolation, exact operator, scoped worker, fixed workflow, served-build verification and retry.');
