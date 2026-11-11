/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { authenticateFactor, getUser, publicUser, readCookies, roleCondition } from './auth.ts'
import { compareStreamIds, requireSameOrigin, staticPath } from './runtime.ts'

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

test('MFA stays required and a consumed recovery code cannot be replayed', async () => {
  const profile = { userId: 'u', twoFactorEnabled: true, twoFactorBackupSecret: ['one-use-code'] }
  await assert.rejects(authenticateFactor({}, {}, profile, ''), { statusCode: 401, code: 'MFA_REQUIRED' })
  let calls = 0
  const db = { query: async () => ({ rowCount: ++calls === 1 ? 1 : 0 }) }
  await authenticateFactor(db, {}, profile, 'one-use-code')
  await assert.rejects(authenticateFactor(db, {}, profile, 'one-use-code'), { statusCode: 401 })
})

test('Redis notification read cursors compare numerically', () => {
  assert.equal(compareStreamIds('100-10', '100-9'), 1)
  assert.equal(compareStreamIds('99-2', '100-0'), -1)
})
