/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { accountSessionHash, readAccountSession, accountSessionVerifier } from './account-session.ts'
import { authServices, hash, publicUser } from './auth.ts'
import { handleAccount } from './account.ts'
import { saveSession, removeSessionById } from './native-account/index.ts'

const opaque = 's'.repeat(43)
const config = { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } }
const request = (id = opaque) => ({ headers: { cookie: `community_session=private; octopus_new_api_session=${id}` } })
const envelope = (user = { id: 7, username: 'creator', display_name: 'Creator' }) =>
  new Response(JSON.stringify({ success: true, data: user }),
  { headers: { 'Content-Type': 'application/json' } })
const environment = {
  NODE_ENV: 'test', NEW_API_BASE_URL: 'https://native-accounts.test',
  NEW_API_PUBLIC_URL: 'https://accounts.test', NEW_API_SESSION_SECRET: 'native-account-fixture'.repeat(3),
  NEW_API_REDIS_URL: '',
}
const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]))
Object.assign(process.env, environment)
async function seedAccountSession() {
  const now = Date.now() / 1000
  await saveSession(opaque, { user: { id: 7, username: 'creator', display_name: 'Creator',
    quota: 1, used_quota: 0, request_count: 0, group: '' },
  accessToken: 'must-not-leak', refreshToken: 'must-not-leak', upstreamSessionId: 'must-not-leak',
  accessExpiresAt: now + 3600, createdAt: now, expiresAt: now + 3600, version: 1 })
}
beforeEach(seedAccountSession)
after(async () => {
  await removeSessionById(opaque)
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('account bridge reads the native sealed session and only sends account authentication upstream', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://native-accounts.test/api/user/self')
    assert.equal(options.headers.get('Cookie'), null)
    assert.equal(options.headers.get('Authorization'), 'Bearer must-not-leak')
    assert.equal(options.redirect, 'error')
    return envelope()
  })
  const account = await readAccountSession(config, request())
  assert.deepEqual(account, { binding: { issuer: 'https://accounts.test', subject: '7', sessionHash: accountSessionHash(request()) },
    username: 'creator', name: 'Creator' })
  assert.doesNotMatch(JSON.stringify(account), /must-not-leak|accessToken|refreshToken|selectedKey/)
})

test('account bridge rejects missing, duplicate and malformed normal cookies before making a request', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Untrusted cookies must not be forwarded'))
  for (const cookie of ['', `octopus_new_api_session=short`, `octopus_new_api_session=${opaque}; octopus_new_api_session=${opaque}`,
    `__Host-octopus-embed-${opaque}=${opaque}`]) {
    await assert.rejects(readAccountSession(config, { headers: { cookie } }),
      { statusCode: 401, code: 'NEW_API_LOGIN_REQUIRED' })
  }
})

test('account bridge requires an authenticated stable numeric user and a bounded JSON response', async t => {
  let response = () => envelope()
  t.mock.method(globalThis, 'fetch', () => response())
  for (const id of ['7', 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    response = () => envelope({ id, username: 'creator' })
    await assert.rejects(readAccountSession(config, request()), { statusCode: 502 })
  }
  response = () => new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 502 })
  response = () => new Response('{}', { status: 401 })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 401 })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 401 })
})

test('only successful account checks are cached and explicit session checks bypass the cache', async t => {
  let calls = 0, expired = false
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return expired ? new Response('{}', { status: 401 }) : envelope()
  })
  const verify = accountSessionVerifier(config)
  await verify(request())
  await verify(request())
  assert.equal(calls, 1)
  expired = true
  await assert.rejects(verify(request(), true), { statusCode: 401 })
  await assert.rejects(verify(request()), { statusCode: 401 })
  assert.equal(calls, 2, 'A revoked native session is not sent upstream again')
})

function authenticationFixture() {
  const stored = new Map(), deleted = []
  const user = { id: 'local123', username: 'creator', host: null, token: 'native-generation' }
  const communityToken = 'c'.repeat(43), sessionHash = hash(communityToken)
  stored.set(`community-next:session:${sessionHash}`, JSON.stringify({
    userId: user.id, tokenHash: hash(user.token),
    account: { issuer: 'https://accounts.test', subject: '7', sessionHash: accountSessionHash(request()) },
  }))
  const db = { async query(sql) {
    if (sql.includes('FROM "user" u JOIN')) return { rows: [user] }
    if (sql.startsWith('SELECT 1 FROM external_account')) return { rows: [{}] }
    if (sql.includes('FROM role') || sql.includes('FROM meta')) return { rows: [] }
    assert.fail('Unexpected auth query: ' + sql)
  } }
  const redis = { get: async key => stored.get(key) ?? null, async del(key) { deleted.push(key); stored.delete(key) } }
  return { auth: authServices({ db, redis, config }), user, stored, deleted, sessionHash,
    req: { url: '/api/session', headers: { cookie: `community_session=${communityToken}; octopus_new_api_session=${opaque}` } } }
}

test('community authentication retains identity only while the same real account session remains valid', async t => {
  let expired = false
  t.mock.method(globalThis, 'fetch', async () => expired ? new Response('{}', { status: 401 }) : envelope())
  const fixture = authenticationFixture()
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, fixture.user.id)
  expired = true
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  assert.deepEqual(fixture.deleted, [`community-next:session:${fixture.sessionHash}`])
})

test('verified account number and username replace the private profile handle without changing ownership or roles', async t => {
  let username = 'root'
  t.mock.method(globalThis, 'fetch', async () => envelope({ id: 7, username }))
  const fixture = authenticationFixture()
  fixture.user.username = 'na_internal_profile'
  const first = (await fixture.auth.authenticate(fixture.req)).user
  assert.equal(first.id, fixture.user.id)
  assert.equal(first.accountId, '7')
  assert.equal(first.username, 'root')
  assert.equal(first.isAdmin, false, 'An upstream name must never grant the old root profile privileges')
  assert.equal(publicUser(first).accountId, '7')
  assert.doesNotMatch(JSON.stringify(publicUser(first)), /na_internal_profile|native-generation|sessionHash/)
  username = 'renamed-account'
  const refreshed = (await fixture.auth.authenticate(fixture.req)).user
  assert.equal(refreshed.id, first.id)
  assert.equal(refreshed.accountId, first.accountId)
  assert.equal(refreshed.username, username)
})

test('changing the account cookie or presenting a legacy unbound session immediately clears old community identity', async () => {
  for (const mode of ['changed', 'unbound']) {
    const fixture = authenticationFixture()
    if (mode === 'changed') fixture.req.headers.cookie = fixture.req.headers.cookie.replace(opaque, 'b'.repeat(43))
    else {
      const key = `community-next:session:${fixture.sessionHash}`
      const stored = JSON.parse(fixture.stored.get(key))
      delete stored.account
      fixture.stored.set(key, JSON.stringify(stored))
    }
    assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  }
})

function synchronizationFixture(existing = true) {
  const response = {}, sessions = [], inserts = [], queries = []
  const user = { id: existing ? 'existing123' : 'new123', username: 'creator', name: 'Creator', token: 'native-generation', password: 'retained-password' }
  async function query(sql, values = []) {
    queries.push(sql)
    if (sql.startsWith('SELECT "rootUserId"')) return { rows: [{ rootUserId: 'admin123' }] }
    if (sql.startsWith('SELECT "userId" FROM external_account')) return { rows: existing ? [{ userId: user.id }] : [] }
    if (sql.includes('FROM "user" u JOIN user_profile')) return { rows: [user] }
    if (sql.startsWith('SELECT 1 FROM "user" WHERE "usernameLower"')) return { rows: values[0] === 'creator' ? [{}] : [] }
    if (sql.startsWith('INSERT ')) { inserts.push({ sql, values }); return { rows: [] } }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
    assert.fail('Unexpected synchronization query: ' + sql)
  }
  const ctx = { req: { method: 'POST', ...request(), socket: { remoteAddress: '127.0.0.1' } },
    url: new URL('/api/account/session', config.url), body: { returnTo: '/create/image' }, config, user: null,
    db: { query, connect: async () => ({ query, release() {} }) }, redis: { eval: async () => 1 },
    newId: () => 'new123', async createSession(...args) { sessions.push(args); return { id: user.id, username: 'creator' } },
    json(status, value) { response.status = status; response.value = value } }
  return { ctx, response, sessions, inserts, queries, user }
}

test('existing external subject reuses the original local user and binds a credential-free community session', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const { ctx, response, sessions, inserts, user } = synchronizationFixture()
  assert.equal(await handleAccount(ctx), true)
  assert.equal(response.value.user.id, 'existing123')
  assert.equal(response.value.user.accountId, '7')
  assert.equal(response.value.user.username, 'creator')
  assert.equal(response.value.returnTo, '/create/image')
  assert.deepEqual(sessions, [[user.id, hash(user.token),
    { issuer: 'https://accounts.test', subject: '7', sessionHash: accountSessionHash(ctx.req) }]])
  assert.equal(inserts.some(item => item.sql.startsWith('INSERT INTO "user"')), false)
  assert.doesNotMatch(JSON.stringify(response.value), /native-generation|retained-password|must-not-leak/)
})

test('a new external subject never takes over an existing same-name community profile', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const { ctx, response, inserts } = synchronizationFixture(false)
  await handleAccount(ctx)
  const created = inserts.find(item => item.sql.startsWith('INSERT INTO "user"'))
  const binding = inserts.find(item => item.sql.startsWith('INSERT INTO external_account'))
  assert.equal(created.values[0], 'new123')
  assert.notEqual(created.values[1], 'creator')
  assert.deepEqual(binding.values, ['https://accounts.test', '7', 'new123'])
  assert.equal(response.value.user.id, 'new123')
  assert.equal(response.value.user.accountId, '7')
  assert.equal(response.value.user.username, 'creator')
})
