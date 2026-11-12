/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSecurity } from './security.ts'
import { builtinEmoji, notifyUser, handleSocial } from './social.ts'
import { authServices, hash } from './auth.ts'

function securityFixture(path = '/api/security/status') {
  const statements = [], deletedKeys = [], headers = {}, response = {}
  const user = { id: 'legacyUser' }
  async function query(sql) {
    statements.push(sql)
    assert.doesNotMatch(sql, /twoFactor|user_profile|SELECT\s+\*/i)
    if (/^(?:BEGIN|COMMIT|ROLLBACK|UPDATE |DELETE )/.test(sql)) return { rows: [], rowCount: 1 }
    assert.fail('Unexpected security query: ' + sql)
  }
  const ctx = { req: { method: path.endsWith('/status') ? 'GET' : 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    url: new URL(path, 'https://community.test'), body: {}, user, sessionHash: 'a'.repeat(64),
    config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } },
    requireUser() { assert(this.user); return this.user },
    db: { query, connect: async () => ({ query, release() {} }) },
    redis: { async del(...keys) { deletedKeys.push(...keys); return keys.length } },
    res: { getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value } },
    json(status, value) { response.status = status; response.value = value } }
  return { ctx, statements, deletedKeys, headers, response }
}

test('native password login and registration are closed without reading legacy credentials', async () => {
  const auth = authServices({ db: { query() { assert.fail('Legacy credentials must not be read') } }, redis: {},
    config: { url: 'https://community.test' } })
  for (const path of ['/api/session/login', '/api/session/register']) {
    await assert.rejects(auth.handleAuth({ req: { method: 'POST' }, url: new URL(path, 'https://community.test'),
      body: { login: 'legacy', password: 'old-password' } }), { statusCode: 410, code: 'ACCOUNT_LOGIN_REQUIRED' })
  }
  let response
  await auth.handleAuth({ req: { method: 'GET' }, url: new URL('/api/registration', 'https://community.test'),
    json: (_status, value) => { response = value } })
  assert.deepEqual(response, { enabled: false, authentication: 'zhangyu', accountUrl: 'https://zhangyuapi.com' })
})

test('security status points to account center without reading or changing legacy factors and passwords', async () => {
  const { ctx, response, statements } = securityFixture()
  await handleSecurity(ctx)
  assert.deepEqual(response.value, { external: true, hasPassword: false, emailReset: false, emailVerified: false,
    accountUrl: 'https://accounts.test' })
  assert.deepEqual(statements, [])
})

test('all local password reset and mutation routes are disabled even with a formerly valid reset link', async () => {
  for (const action of ['forgot', 'reset', '']) {
    const { ctx, statements } = securityFixture(`/api/security/password${action ? '/' + action : ''}`)
    ctx.user = null
    ctx.body = { resetToken: 'r'.repeat(43), newPassword: 'new-password' }
    await assert.rejects(handleSecurity(ctx), { statusCode: 410, code: 'ACCOUNT_LOGIN_REQUIRED' })
    assert.deepEqual(statements, [])
  }
})

test('legacy community device revocation directs both single and all-device requests to the authoritative account center', async () => {
  for (const body of [{ all: true }, { id: 'b'.repeat(64) }]) {
    const { ctx, deletedKeys, statements } = securityFixture('/api/security/sessions/revoke')
    ctx.body = body
    await assert.rejects(handleSecurity(ctx), { statusCode: 410, code: 'ACCOUNT_LOGIN_REQUIRED' })
    assert.deepEqual(deletedKeys, [])
    assert.deepEqual(statements, [])
  }
})

test('private messages accept builtin emoji without admitting arbitrary text or links', () => {
  for (const value of ['👍', '❤️', '👏', '🎉', '😊', '🙏', '🔥', '👀']) assert.equal(builtinEmoji(value), true)
  for (const value of ['hello', 'https://example.test', '👍 hello']) assert.equal(builtinEmoji(value), false)
})

test('notification following preference excludes an unrelated actor', async () => {
  let written = 0
  await notifyUser({ db: { query: async sql => sql.includes('notificationRecieveConfig')
    ? { rows: [{ notificationRecieveConfig: { reaction: { type: 'following' } } }] }
    : sql.includes('AS following') ? { rows: [{ following: false, follower: false, member: false }] } : { rowCount: 0, rows: [] } },
  redis: { xadd: async () => { written++ } }, newId: () => 'test' },
  { recipientId: 'owner', actorId: 'stranger', type: 'like', workId: 'work' })
  assert.equal(written, 0)
})

test('session mint rejects credentials from a revoked generation', async () => {
  const db = { query: async sql => {
    if (sql.includes('FROM "user" u JOIN')) return { rows: [{ id: 'u', username: 'u', host: null, token: 'current-token' }] }
    return { rows: [] }
  } }
  const auth = authServices({ db, redis: {}, config: { url: 'https://community.test' } })
  await assert.rejects(auth.createSession('u', {}, undefined, hash('old-token')), { statusCode: 409, code: 'CREDENTIAL_CHANGED' })
})

test('legacy note notifications resolve the retained work and reply destination', async () => {
  let response
  await handleSocial({ req: { method: 'GET' }, url: new URL('https://community.test/api/notifications'), requireUser: () => ({ id: 'reader' }),
    redis: { xrevrange: async () => [['1794435800000-1', ['data', JSON.stringify({ type: 'reply', notifierId: 'actor', noteId: 'reply' })]]],
      get: async () => null, hgetall: async () => ({}) },
    db: { query: async sql => ({ rows: sql.includes('FROM announcement') ? [] : sql.includes('FROM note n JOIN community_submission')
      ? [{ noteId: 'reply', workId: 'work', rootId: 'root' }] : [{ id: 'actor', username: 'actor', name: 'Actor' }] }) },
    json: (status, value) => { assert.equal(status, 200); response = value } })
  assert.equal(response.items[0].url, '/work/work#comment-reply')
  assert.equal(response.items[0].isRead, false)
})
