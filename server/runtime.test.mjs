/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Readable } from 'node:stream'
import { authServices, getUser, hash, publicUser, readCookies, roleCondition } from './auth.ts'
import { compareStreamIds, createApplication, requireSameOrigin, staticPath } from './runtime.ts'

test('unexpected server failures hide internal codes and correlate with server logs', async t => {
  const logged = []
  t.mock.method(console, 'error', value => logged.push(JSON.parse(value)))
  const app = createApplication({ config: { url: 'https://community.example' }, filesRoot: 'unused',
    db: { async query() { throw Object.assign(new Error('private database detail'), { code: 'XX000' }) } },
    redis: { async ping() { return 'PONG' } },
  })
  t.after(() => app.close())
  const response = await app.inject('/healthz?private=query')
  assert.equal(response.statusCode, 500)
  const error = response.json().error
  assert.equal(error.code, 'INTERNAL_ERROR')
  assert.equal(error.message, '服务暂时不可用，请稍后重试。')
  assert.equal(typeof error.requestId, 'string')
  assert(error.requestId.length > 0)
  assert(!/private|XX000|stack/.test(response.body))
  assert.equal(logged[0].requestId, error.requestId)
  assert.equal(logged[0].code, 'XX000')
  assert.equal(logged[0].path, '/healthz')
})

test('a media stream rejected before its first chunk returns a bounded Retry-After', async t => {
  const app = createApplication({ config: { url: 'https://community.example' }, filesRoot: 'unused', db: {}, redis: {} })
  t.after(() => app.close())
  let retryAfter = 60
  app.get('/test-budget-stream', (_request, reply) => reply.header('Content-Type', 'video/mp4').header('Content-Length', '4')
    .send(Readable.fromWeb(new ReadableStream({ start(controller) {
      controller.error(Object.assign(new Error('video budget exhausted'), { statusCode: 429, retryAfter }))
    } }))))
  for (const seconds of [60, 0, -1, 1.5, Infinity]) {
    retryAfter = seconds
    const response = await app.inject('/test-budget-stream')
    assert.equal(response.statusCode, 429)
    assert.equal(response.headers['retry-after'], seconds === 60 ? '60' : undefined)
    assert.equal(response.json().error.message, 'video budget exhausted')
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body))
  }
})

test('visitor view keys use forwarded IPs only through trusted proxies', async t => {
  const origin = 'https://community.example'
  const keys = [], seen = new Set()
  let views = 0
  const app = createApplication({
    config: { url: origin }, filesRoot: path.resolve('files'),
    trustedProxies: ['loopback', '172.18.0.1'],
    db: { async query(sql) {
      if (sql.includes('UPDATE community_submission SET "viewsCount"')) return { rows: [{ viewsCount: ++views }] }
      return { rows: [{ id: 'work1', approvedNoteId: 'note1', viewsCount: views }] }
    } },
    redis: { async set(key) {
      keys.push(key)
      if (seen.has(key)) return null
      seen.add(key); return 'OK'
    } },
  })
  t.after(() => app.close())
  const cases = [
    ['127.0.0.1', '198.51.100.11', '198.51.100.11', 1],
    ['172.18.0.1', '203.0.113.99, 198.51.100.12', '198.51.100.12', 2],
    ['198.51.100.20', '203.0.113.1', '198.51.100.20', 3],
    ['198.51.100.20', '203.0.113.2', '198.51.100.20', 3],
  ]
  for (const [remoteAddress, forwarded, expected, count] of cases) {
    const response = await app.inject({ method: 'POST', url: '/api/works/work1/view', remoteAddress,
      headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': forwarded }, payload: {} })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().viewsCount, count)
    assert.equal(keys.at(-1), `community:view:work1:${hash(`ip:${expected}`)}`)
  }
})

test('community auth no longer exposes a separate session minting API', () => {
  const auth = authServices({ db: {}, redis: {}, config: { url: 'https://community.example' } })
  assert.equal(Object.hasOwn(auth, 'createSession'), false)
})

test('mutating requests require the exact site Origin and JSON', () => {
  assert.throws(() => requireSameOrigin({ method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' } }, 'https://community.example'), { statusCode: 403 })
  assert.throws(() => requireSameOrigin({ method: 'POST', headers: { origin: 'https://community.example', 'content-type': 'text/plain' } }, 'https://community.example'), { statusCode: 415 })
  requireSameOrigin({ method: 'POST', headers: { origin: 'https://community.example', 'content-type': 'application/json' } }, 'https://community.example')
})

test('static serving refuses encoded traversal, Windows paths and hidden files', () => {
  const root = path.resolve('dist')
  for (const value of ['/assets/%2e%2e/secret', '/%2eenv', '/a%5csecret', '/%00']) assert.throws(() => staticPath(root, value))
  assert.equal(staticPath(root, '/assets/app.js'), path.join(root, 'assets/app.js'))
})

test('public session never includes original credentials or token fingerprints', () => {
  const user = publicUser({ id: 'a', name: 'Creator', username: 'test', token: 'private', tokenHash: 'private', isAdmin: false, isModerator: false })
  assert.equal(JSON.stringify(user).includes('private'), false)
  assert.equal(readCookies('broken=%ZZ; community_session=valid').community_session, 'valid')
})

test('blocked users cannot regain privileges through role assignments', async () => {
  let queries = 0
  const user = await getUser({ query: async () => { queries++; return { rows: [{ id: 'blocked', host: null, isSuspended: true, token: 'secret' }] } } }, 'blocked')
  assert.equal(user, null)
  assert.equal(queries, 1)
  assert.equal(roleCondition({ type: 'unknown-grant-admin' }, {}, new Set()), false)
})

test('removed MFA management routes return 404 without reading or writing account data', async t => {
  const origin = 'https://community.example'
  const app = createApplication({
    db: { query() { assert.fail('Removed endpoints must not query account data') } }, redis: {},
    config: { url: origin }, filesRoot: path.resolve('files'),
  })
  t.after(() => app.close())
  for (const action of ['setup', 'confirm', 'disable', 'recovery']) {
    const response = await app.inject({ method: 'POST', url: `/api/security/mfa/${action}`,
      headers: { origin, 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(response.statusCode, 404)
  }
})

test('Redis notification read cursors compare numerically', () => {
  assert.equal(compareStreamIds('100-10', '100-9'), 1)
  assert.equal(compareStreamIds('99-2', '100-0'), -1)
})

test('logout expires legacy community cookies without depending on retired community storage', async t => {
  const origin = 'https://community.example'
  const token = 'c'.repeat(43)
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response('{}', { status: 502 }) })
  const app = createApplication({
    db: { query() { assert.fail('Logout must not depend on profile queries') } },
    redis: {
      async get() { assert.fail('Retired community sessions must not be read') },
      async del() { assert.fail('Retired community sessions must not be required for logout') },
    },
    config: { url: origin, newApiSso: { issuer: 'https://accounts.example' } }, filesRoot: path.resolve('files'),
  })
  t.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/session/logout',
    headers: { origin, 'content-type': 'application/json',
      cookie: `community_session=${token}; octopus_new_api_session=${'s'.repeat(43)}` }, payload: '{}' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { user: null })
  assert.equal(fetches, 0)
  const cookies = response.headers['set-cookie']
  assert(cookies.some(value => /^community_session=;.*Max-Age=0/.test(value)))
  assert(cookies.some(value => /^octopus_new_api_session=;.*Max-Age=0/.test(value)))
})
