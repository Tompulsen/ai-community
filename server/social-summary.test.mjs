/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleSocial } from './social.ts'

const config = { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } }
const streamId = value => `17944358000${String(value).padStart(2, '0')}-1`
const entry = (value, type, actor = '91') => [streamId(value), ['data', JSON.stringify({ type, notifierId: actor })]]

test('notification categories count only visible unread items and exclude direct message notifications', async () => {
  let response
  const events = [
    entry(1, 'reply'), entry(2, 'mention'), entry(3, 'like'), entry(4, 'comment'),
    entry(5, 'mention'), entry(6, 'reaction'), entry(7, 'like'), entry(8, 'commentLike'),
    entry(9, 'follow'), entry(10, 'review'), entry(11, 'unknown'), entry(12, 'message'),
    entry(13, 'reply', '92'),
  ]
  const ctx = {
    req: { method: 'GET' }, url: new URL('/api/notifications', config.url), config,
    requireUser: () => ({ id: '17' }),
    redis: {
      async xrevrange(...args) {
        assert.deepEqual(args, ['notificationTimeline:17', '+', '-'])
        return events
      },
      async get(key) { assert.equal(key, 'latestReadNotification:17'); return streamId(3) },
      async hgetall(key) { assert.equal(key, 'community-next:notification-read:17'); return { [streamId(10)]: '1' } },
      async persist(key) { assert.equal(key, 'community-next:notification-read:17'); return 1 },
      async set() { return 'OK' },
    },
    db: { async query(sql, values) {
      if (sql.includes('FROM announcement')) {
        if (sql.includes('COUNT(*)')) { assert.deepEqual(values, ['17']); return { rows: [{ unread: 1, unreadIds: ['notice1'] }] } }
        assert.deepEqual(values, ['17', null])
        return { rows: [
          { id: 'notice1', title: 'System update', text: '', updatedAt: null, readId: null },
          { id: 'notice2', title: 'Already read', text: '', updatedAt: null, readId: 'read2' },
        ] }
      }
      if (sql.includes('FROM external_account')) return { rows: [] }
      assert(sql.includes('FROM "user"'))
      assert(sql.includes('NOT "isDeleted"') && sql.includes('NOT "isSuspended"') && sql.includes('"movedToUri" IS NULL'))
      assert(sql.includes('blocking'))
      assert.deepEqual(values[1], '17')
      return { rows: [{ id: '91', username: 'visible', name: 'Visible peer' }] }
    } },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  await handleSocial(ctx)
  assert.deepEqual(response.unreadCounts, { announcement: 1, activity: 7 })
  const item = value => response.items.find(notice => notice.id === `redis:${streamId(value)}`)
  assert.equal(item(1).type, 'activity')
  assert.equal(item(4).type, 'activity')
  assert.equal(item(5).type, 'activity')
  assert.equal(item(6).type, 'activity')
  assert.equal(item(8).type, 'activity')
  assert.equal(item(9).type, 'activity')
  assert.equal(item(11).type, 'activity')
  assert.equal(item(12), undefined)
  assert.equal(item(13), undefined)
  assert.equal(item(10).isRead, true)
  assert(response.items.filter(notice => !notice.id.startsWith('redis:')).every(notice => notice.type === 'announcement'))
  assert.equal(Object.hasOwn(response.unreadCounts, 'message'), false)
  assert.equal(Object.hasOwn(response.unreadCounts, 'messages'), false)
})

test('thread unread totals are account scoped and independent of the visible conversation page', async () => {
  let response
  const reads = []
  const me = { id: '17' }
  const ctx = {
    req: { method: 'GET' }, url: new URL('/api/messages/threads?cursor=oldMessage&userId=91', config.url),
    config, user: me, requireUser: () => me,
    db: { async query(sql, values = []) {
      reads.push({ sql, values })
      if (sql.includes('SELECT policies FROM meta')) return { rows: [{ policies: { chatAvailability: 'available' } }] }
      if (sql.includes('FROM role')) return { rows: [] }
      if (sql.includes('SELECT * FROM "user"')) return { rows: [{ id: '17', host: null }] }
      if (sql.startsWith('SELECT COUNT(*)::int AS "unreadCount"')) {
        for (const guard of ['m."toUserId"=$1', 'm."toRoomId" IS NULL', 'NOT ($1=ANY(m.reads))',
          'u.host IS NULL', 'NOT u."isDeleted"', 'NOT u."isSuspended"', 'u."movedToUri" IS NULL',
          'b."blockerId"=$1 AND b."blockeeId"=u.id', 'b."blockerId"=u.id AND b."blockeeId"=$1']) {
          assert(sql.includes(guard), guard)
        }
        assert.deepEqual(values, ['17'])
        assert(!sql.includes('LIMIT') && !sql.includes('following'))
        return { rows: [{ unreadCount: 27 }] }
      }
      if (sql.includes('WITH latest AS')) return { rows: [{
        id: '91', username: 'peer', name: 'Peer', avatarId: null, chatScope: 'none',
        messageId: '0000001bmessage', fromUserId: '91', toUserId: '17', text: '', reads: [], unread: 1,
      }] }
      if (sql.includes('FROM external_account')) return { rows: [] }
      if (sql.startsWith('SELECT 1 WHERE EXISTS (SELECT 1 FROM following')) return { rows: [], rowCount: 0 }
      assert.fail('Unexpected message summary query: ' + sql)
    } },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  await handleSocial(ctx)
  assert.equal(response.items[0].unread, 1)
  assert.equal(response.items[0].canSend, false)
  assert.equal(response.unreadCount, 27)
  assert.equal(reads.filter(read => read.sql.startsWith('SELECT COUNT(*)::int AS "unreadCount"')).length, 1)
})

test('unavailable chat permissions and anonymous callers cannot read unread summaries', async () => {
  let counted = false
  const ctx = {
    req: { method: 'GET' }, url: new URL('/api/messages/threads', config.url), config,
    requireUser: () => ({ id: '17' }),
    db: { async query(sql) {
      if (sql.includes('SELECT policies FROM meta')) return { rows: [{ policies: { chatAvailability: 'unavailable' } }] }
      if (sql.includes('FROM role')) return { rows: [] }
      if (sql.includes('SELECT * FROM "user"')) return { rows: [{ id: '17', host: null }] }
      counted = true
      assert.fail('Unavailable accounts must not read unread messages')
    } },
  }
  await assert.rejects(handleSocial(ctx), { statusCode: 403 })
  assert.equal(counted, false)
  for (const route of ['/api/messages/threads', '/api/notifications']) {
    ctx.url = new URL(route, config.url)
    ctx.requireUser = () => { throw Object.assign(new Error('Sign in required'), { statusCode: 401 }) }
    await assert.rejects(handleSocial(ctx), { statusCode: 401 })
  }
})
