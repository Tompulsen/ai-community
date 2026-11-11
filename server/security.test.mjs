/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { newPassword } from './security.ts'
import { builtinEmoji, notifyUser, handleSocial } from './social.ts'
import { authServices, hash } from './auth.ts'

test('password length is bounded in bytes to avoid bcrypt truncation', () => {
  assert.equal(newPassword('long-enough'), 'long-enough')
  for (const value of ['', 'short', 'x'.repeat(73), '\u4e2d'.repeat(25)]) assert.throws(() => newPassword(value), { statusCode: 400 })
})
test('private messages accept builtin emoji without admitting arbitrary text or links', () => {
  for (const value of ['👍', '❤️', '👏', '🎉', '😊', '🙏', '🔥', '👀']) assert.equal(builtinEmoji(value), true)
  for (const value of ['hello', 'https://example.test', '👍 hello']) assert.equal(builtinEmoji(value), false)
})
test('notification following preference excludes an unrelated actor', async () => {
  let written = 0
  await notifyUser({
    db: { query: async sql => sql.includes('notificationRecieveConfig')
      ? { rows: [{ notificationRecieveConfig: { reaction: { type: 'following' } } }] }
      : sql.includes('AS following') ? { rows: [{ following: false, follower: false, member: false }] } : { rowCount: 0, rows: [] } },
    redis: { xadd: async () => { written++ } }, newId: () => 'test',
  }, { recipientId: 'owner', actorId: 'stranger', type: 'like', workId: 'work' })
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
  await handleSocial({
    req: { method: 'GET' }, url: new URL('https://community.test/api/notifications'), requireUser: () => ({ id: 'reader' }),
    redis: { xrevrange: async () => [['1794435800000-1', ['data', JSON.stringify({ type: 'reply', notifierId: 'actor', noteId: 'reply' })]]],
      get: async () => null, hgetall: async () => ({}) },
    db: { query: async sql => ({ rows: sql.includes('FROM announcement') ? [] : sql.includes('FROM note n JOIN community_submission')
      ? [{ noteId: 'reply', workId: 'work', rootId: 'root' }] : [{ id: 'actor', username: 'actor', name: 'Actor' }] }) },
    json: (status, value) => { assert.equal(status, 200); response = value },
  })
  assert.equal(response.items[0].url, '/work/work#comment-reply')
  assert.equal(response.items[0].isRead, false)
})
