/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getUser, hash, publicUser, readCookies, roleCondition } from './auth.ts'
import { compareStreamIds, createApplication, requireSameOrigin, staticPath } from './runtime.ts'

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

test('logout clears local and Studio cookies and the community record even while Studio is unavailable', async t => {
  const origin = 'https://community.example'
  const token = 'c'.repeat(43), sessionHash = hash(token), removed = [], sorted = []
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response('{}', { status: 502 }) })
  const app = createApplication({
    db: { query() { assert.fail('Logout must not depend on profile queries') } },
    redis: {
      get: async key => key === `community-next:session:${sessionHash}` ? JSON.stringify({ userId: 'creator123' }) : null,
      async del(key) { removed.push(key) },
      async zrem(...args) { sorted.push(args) },
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
  assert.deepEqual(removed, [`community-next:session:${sessionHash}`])
  assert.deepEqual(sorted, [['community-next:sessions:creator123', sessionHash]])
  const cookies = response.headers['set-cookie']
  assert(cookies.some(value => /^community_session=;.*Max-Age=0/.test(value)))
  assert(cookies.some(value => /^octopus_new_api_session=;.*Max-Age=0/.test(value)))
})
