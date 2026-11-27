import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from './runtime.ts';
import { saveSession, removeSessionById } from './native-account/index.ts';

test('real HTTP multipart precheck authenticates, inspects transient bytes, and never creates works or files', async t => {
  const env = { NODE_ENV: 'test', NEW_API_BASE_URL: 'https://native-accounts.test', NEW_API_PUBLIC_URL: 'https://accounts.test',
    NEW_API_SESSION_SECRET: 'moderation-precheck-fixture'.repeat(3), NEW_API_REDIS_URL: '' };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const session = 'm'.repeat(43), now = Date.now() / 1000;
  t.after(async () => { await removeSessionById(session); for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  await saveSession(session, { user: { id: 7, username: 'creator', display_name: 'Creator', quota: 1, used_quota: 0, request_count: 0, group: '' },
    accessToken: 'fixture-only', refreshToken: 'fixture-only', upstreamSessionId: 'fixture-only', accessExpiresAt: now + 3600, createdAt: now, expiresAt: now + 3600, version: 1 });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: true, data: { id: 7, username: 'creator' } }), { headers: { 'Content-Type': 'application/json' } }));
  const queries = [], state = { count: 0, enabled: true };
  const db = { async query(sql) {
    queries.push(sql);
    if (sql.includes('SELECT u.')) return { rows: [{ id: '7', username: 'creator', host: null, token: 'fixture-only', roles: [], assignedRoleIds: [] }] };
    if (sql.includes('FROM meta')) return { rows: [{ clientOptions: { communityModeration: { enabled: state.enabled, sensitiveWords: ['blocked'] } } }] };
    if (sql.includes('FROM external_account')) return { rows: [{}] };
    return { rows: [], rowCount: 0 };
  } };
  const app = createApplication({ db, redis: { incr: async () => ++state.count, expire: async () => 1 },
    config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } }, filesRoot: 'unused' });
  t.after(() => app.close());
  const headers = { origin: 'https://community.test', 'content-type': 'multipart/form-data; boundary=inspection',
    cookie: `octopus_new_api_session=${session}`, 'x-new-api-user': '7' };
  const payload = text => Buffer.from(`--inspection\r\nContent-Disposition: form-data; name="file"; filename="creation.md"\r\nContent-Type: text/markdown\r\n\r\n${text}\r\n--inspection--\r\n`);
  const submit = (text, extra = {}) => app.inject({ method: 'POST', url: '/api/works/precheck', headers: { ...headers, ...extra }, payload: payload(text) });
  let response = await submit('safe generated content');
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().state, 'passed');
  response = await submit('safe text followed by BLOCKED'); assert.equal(response.json().state, 'rejected');
  response = await submit('safe', { 'x-new-api-user': '8' }); assert.equal(response.statusCode, 409);
  response = await submit('safe', { cookie: '' }); assert.equal(response.statusCode, 401);
  response = await submit('safe', { origin: 'https://evil.test' }); assert.equal(response.statusCode, 403);
  state.count = 30; response = await submit('safe'); assert.equal(response.json().state, 'unavailable');
  state.enabled = false; response = await submit('blocked'); assert.equal(response.json().state, 'disabled');
  assert(!queries.some(sql => /(?:INSERT|UPDATE|DELETE).*\b(?:community_submission|drive_file|note)\b/.test(sql)));
});
