/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { accountSessionHash, readStudioAccount, studioAccountVerifier } from './account-session.ts'
import { authServices, hash } from './auth.ts'
import { handleAccount } from './account.ts'

const opaque = 's'.repeat(43)
const config = { url: 'https://community.test', communityStudioUpstream: 'http://studio:3000',
  newApiSso: { issuer: 'https://accounts.test' } }
const request = (id = opaque) => ({ headers: { cookie: `community_session=private; octopus_new_api_session=${id}` } })
const envelope = (user = { id: 7, username: 'creator', display_name: 'Creator' }) =>
  new Response(JSON.stringify({ success: true, data: { authenticated: true, user,
    accessToken: 'must-not-leak', refreshToken: 'must-not-leak', selectedKey: 'must-not-leak' } }),
  { headers: { 'Content-Type': 'application/json' } })

test('account bridge forwards only the normal HttpOnly cookie and keeps upstream credentials private', async () => {
  const account = await readStudioAccount(config, request(), async (url, options) => {
    assert.equal(url.href, 'http://studio:3000/studio/api/new-api/session')
    assert.equal(options.headers.Cookie, `octopus_new_api_session=${opaque}`)
    assert.equal(options.headers.Origin, config.url)
    assert.equal(options.redirect, 'error')
    return envelope()
  })
  assert.deepEqual(account, { binding: { issuer: 'https://accounts.test', subject: '7', sessionHash: accountSessionHash(request()) },
    username: 'creator', name: 'Creator' })
  assert.doesNotMatch(JSON.stringify(account), /must-not-leak|accessToken|refreshToken|selectedKey/)
})

test('account bridge rejects missing, duplicate and malformed normal cookies before making a request', async () => {
  for (const cookie of ['', `octopus_new_api_session=short`, `octopus_new_api_session=${opaque}; octopus_new_api_session=${opaque}`,
    `__Host-octopus-embed-${opaque}=${opaque}`]) {
    await assert.rejects(readStudioAccount(config, { headers: { cookie } }, () => assert.fail('Untrusted cookies must not be forwarded')),
      { statusCode: 401, code: 'NEW_API_LOGIN_REQUIRED' })
  }
})

test('account bridge requires an authenticated stable numeric user and a bounded JSON response', async () => {
  for (const id of ['7', 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readStudioAccount(config, request(), async () => envelope({ id, username: 'creator' })),
      { statusCode: 502, code: 'SSO_IDENTITY' })
  }
  await assert.rejects(readStudioAccount(config, request(), async () => new Response('{"success":true,"data":{"authenticated":false}}',
    { headers: { 'Content-Type': 'application/json' } })), { statusCode: 401 })
  await assert.rejects(readStudioAccount(config, request(), async () => new Response('x'.repeat(65537),
    { headers: { 'Content-Type': 'application/json' } })), { statusCode: 502 })
  await assert.rejects(readStudioAccount(config, request(), async () => new Response('{}', { status: 401 })), { statusCode: 401 })
})

test('only successful account checks are cached and explicit session checks bypass the cache', async t => {
  let calls = 0, expired = false
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return expired ? new Response('{}', { status: 401 }) : envelope()
  })
  const verify = studioAccountVerifier(config)
  await verify(request())
  await verify(request())
  assert.equal(calls, 1)
  expired = true
  await assert.rejects(verify(request(), true), { statusCode: 401 })
  await assert.rejects(verify(request()), { statusCode: 401 })
  assert.equal(calls, 3)
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

test('changing the Studio cookie or presenting a legacy unbound session immediately clears old community identity', async () => {
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
})
