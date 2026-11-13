import assert from 'node:assert/strict'
import test from 'node:test'
import { handleNotifications, compareStreamIds } from './notification-inbox.ts'

const streamId = n => `${1794435800000 + n}-0`
const announcementId = n => `notice${String(n).padStart(3, '0')}`
function fixture() {
  const events = Array.from({ length: 75 }, (_, n) => [streamId(n + 1), ['data', JSON.stringify({ type: 'like', notifierId: 'peer' })]])
  const announcements = Array.from({ length: 65 }, (_, n) => ({ id: announcementId(n + 1), title: `公告 ${n + 1}`, text: '', updatedAt: null, userId: null, isActive: true }))
  const reads = {}, announcementReads = new Set(), statements = [], persisted = [], transactions = [], snapshots = new Map()
  let watermark = streamId(5), response, newId = 0
  const ctx = {
    config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } },
    requireUser: () => ({ id: 'owner' }), newId: () => `read${++newId}`,
    redis: {
      async xrevrange(...args) { assert.deepEqual(args, ['notificationTimeline:owner', '+', '-']); return [...events].reverse() },
      async get(key) { return key.startsWith('latestReadNotification:') ? watermark : snapshots.get(key) ?? null }, async hgetall() { return { ...reads } },
      async set(key, value, expiry, seconds) { assert.equal(expiry, 'EX'); assert.equal(seconds, 300); snapshots.set(key, value); return 'OK' },
      async persist(key) { persisted.push(key); return 1 },
      multi() {
        const operations = [], batch = {
          hset(key, ...values) { operations.push(() => { for (let i = 0; i < values.length; i += 2) reads[values[i]] = values[i + 1] }); return batch },
          persist(key) { operations.push(() => persisted.push(key)); return batch },
          hdel(key, ...ids) { operations.push(() => ids.forEach(id => delete reads[id])); return batch },
          async exec() { transactions.push(operations.length); operations.forEach(run => run()); return operations.map(() => [null, 1]) },
        }; return batch
      },
    },
    db: { async query(sql, values) {
      statements.push({ sql, values })
      if (sql.includes('FROM external_account')) return { rows: [] }
      if (sql.includes('FROM "user"')) {
        for (const guard of ['NOT "isDeleted"', 'NOT "isSuspended"', '"movedToUri" IS NULL', 'blocking', 'muting', '"expiresAt">NOW()']) assert(sql.includes(guard), guard)
        assert.equal(values[1], 'owner')
        return { rows: [{ id: 'peer', username: 'visible', name: 'Visible peer' }] }
      }
      assert(sql.includes('announcement'), sql)
      for (const guard of ['a."userId"=$1 OR a."userId" IS NULL', 'a."isActive"', 'a."autoArchiveAt">NOW()']) assert(sql.includes(guard), guard)
      assert.equal(values[0], 'owner')
      const visible = announcements.filter(a => (!a.userId || a.userId === 'owner') && a.isActive).sort((a, b) => b.id.localeCompare(a.id))
      if (sql.startsWith('INSERT')) {
        assert(sql.includes('ON CONFLICT'))
        for (const a of visible) if (values[2].includes(a.id)) announcementReads.add(a.id)
        return { rows: [] }
      }
      if (sql.includes('COUNT(*)')) { const unreadIds = visible.filter(a => !announcementReads.has(a.id)).map(a => a.id); return { rows: [{ unread: unreadIds.length, unreadIds }] } }
      if (sql.includes('a.id<=$2')) return { rows: visible.filter(a => a.id <= values[1] && !announcementReads.has(a.id)) }
      assert(sql.includes('ORDER BY a.id DESC LIMIT 31'))
      return { rows: visible.filter(a => !values[1] || a.id < values[1]).slice(0, 31).map(a => ({ ...a, readId: announcementReads.has(a.id) ? 'read' : null })) }
    } },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  return { events, announcements, reads, announcementReads, statements, persisted, transactions, ctx,
    setWatermark(value) { watermark = value },
    async request(path = '/api/notifications', body) {
      ctx.url = new URL(path, ctx.config.url); ctx.req = { method: body ? 'POST' : 'GET' }; ctx.body = body || {}
      assert.equal(await handleNotifications(ctx), true); return response
    },
  }
}

test('notification totals cover retained history and independent cursors exhaust both categories without duplicates', async () => {
  const f = fixture(); f.reads[streamId(10)] = '1'
  f.events.push([streamId(80), ['data', JSON.stringify({ type: 'message', notifierId: 'peer' })]],
    [streamId(81), ['data', JSON.stringify({ type: 'like', notifierId: 'hidden' })]], ['broken', ['data', '{']])
  f.announcements.push({ id: 'private', userId: 'someoneElse', isActive: true }, { id: 'inactive', isActive: false })
  const head = await f.request()
  assert.deepEqual(head.unreadCounts, { activity: 69, announcement: 65 })
  assert.equal(head.items.length, 60)
  assert.equal(head.readThrough.activity, streamId(75)); assert.match(head.readThrough.announcement, /^[a-f0-9]{32}$/)
  for (const [category, total] of [['activity', 75], ['announcement', 65]]) {
    const ids = head.items.filter(item => item.type === category).map(item => item.id)
    let cursor = head.nextCursors[category]
    while (cursor) {
      const page = await f.request(`/api/notifications?category=${category}&cursor=${cursor}`)
      assert(page.items.every(item => item.type === category))
      ids.push(...page.items.map(item => item.id)); cursor = page.nextCursors[category]
    }
    assert.equal(ids.length, total); assert.equal(new Set(ids).size, total)
  }
  assert(f.persisted.length > 0, 'existing read hashes must lose their old expiry even on a read')
})

test('category mark-all honors the captured boundary, leaves new arrivals and direct messages unread, and prunes only trimmed read markers', async () => {
  const f = fixture(), head = await f.request()
  f.reads['100-0'] = '1'
  f.reads[streamId(200)] = '1'
  f.events.push([streamId(76), ['data', JSON.stringify({ type: 'like', notifierId: 'peer' })]],
    [streamId(50) + '1', ['data', JSON.stringify({ type: 'message', notifierId: 'peer' })]])
  await f.request('/api/notifications/read-all', { category: 'activity', through: head.readThrough.activity })
  assert.equal(Object.hasOwn(f.reads, '100-0'), false)
  assert.equal(f.reads[streamId(76)], undefined)
  assert.equal(f.reads[streamId(50) + '1'], undefined)
  assert.equal(Object.keys(f.reads).length, 76)
  assert.equal(f.reads[streamId(200)], '1', 'a concurrent read newer than the stream snapshot must survive pruning')
  assert.equal(f.announcementReads.size, 0)
  assert.deepEqual((await f.request()).unreadCounts, { activity: 1, announcement: 65 })
  f.announcements.push({ id: announcementId(66), title: 'Later', isActive: true })
  f.announcements.push({ id: 'notice000z', title: 'Later but sorts below the snapshot maximum', isActive: true })
  await f.request('/api/notifications/read-all', { category: 'announcement', through: head.readThrough.announcement })
  assert.equal(f.announcementReads.size, 65)
  assert.deepEqual((await f.request()).unreadCounts, { activity: 1, announcement: 2 })
  await assert.rejects(f.request('/api/notifications/read-all', { category: 'announcement', through: 'expiredOrOtherAccountToken' }), { statusCode: 409 })
  assert.equal(f.transactions.length, 1)
})

test('individual reads validate IDs and cannot mark hidden actors or another account announcement', async () => {
  const f = fixture()
  f.events.push([streamId(80), ['data', JSON.stringify({ type: 'like', notifierId: 'hidden' })]])
  f.announcements.push({ id: 'private', userId: 'someoneElse', isActive: true })
  await f.request('/api/notifications/read', { ids: [`redis:${streamId(80)}`, `redis:${streamId(20)}`, 'private', announcementId(20)] })
  assert.deepEqual(Object.keys(f.reads), [streamId(20)])
  assert.deepEqual([...f.announcementReads], [announcementId(20)])
  for (const path of ['/api/notifications?category=unknown', '/api/notifications?cursor=12-1', '/api/notifications?category=activity&cursor=abc']) await assert.rejects(f.request(path), { statusCode: 400 })
  for (const body of [{ category: 'messages', through: '1-0' }, { category: 'activity', through: 'bad' }, { category: 'activity', through: '1-0', userId: 'other' }]) await assert.rejects(f.request('/api/notifications/read-all', body), { statusCode: 400 })
  await assert.rejects(f.request('/api/notifications/read', { ids: ['redis:bad'] }), { statusCode: 400 })
  f.ctx.requireUser = () => { throw Object.assign(new Error('Sign in'), { statusCode: 401 }) }
  await assert.rejects(f.request(), { statusCode: 401 })
  assert.equal(compareStreamIds('9007199254740993-10', '9007199254740993-9'), 1)
})
