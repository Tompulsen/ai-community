import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { handleAdmin } from './admin.ts'
import { httpError } from './auth.ts'
import { createApplication } from './runtime.ts'

function fixture(user = { id: 'admin', isAdmin: true }) {
  const statements = [], logs = []; let response
  const ctx = {
    config: { url: 'https://community.test', id: 'aidx', newApiSso: { issuer: 'https://accounts.test' } }, req: { method: 'GET' },
    requireUser() { if (!user) throw httpError(401, 'Sign in'); return user },
    requireAdmin() { const u = this.requireUser(); if (!u.isAdmin) throw httpError(403, 'Admin only'); return u },
    db: { async query(sql, values = []) {
      statements.push({ sql, values })
      if (sql.includes('FROM community_submission')) return { rows: [{ pending: 135, published: 3240, rejected: 48, newWorks: 215 }] }
      if (sql.includes('FROM abuse_user_report')) return { rows: [{ open: 6 }] }
      if (sql.includes('FROM "user"')) return { rows: [{ count: 38 }] }
      if (sql.includes('FROM moderation_log')) return { rows: logs.filter(row => !values[1] || row.id < values[1]).slice(0, 31) }
      if (sql.includes('FROM external_account')) return { rows: [{ userId: 'operator', subject: '17', username: 'publicName' }] }
      assert.fail(sql)
    } },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  return { statements, logs, async request(url) { ctx.url = new URL(url, ctx.config.url); assert.equal(await handleAdmin(ctx), true); return response } }
}

test('overview aggregates the full dataset and pending revisions, with a bounded 7 or 30 day window', async () => {
  const f = fixture(), result = await f.request('/api/admin/overview?days=30')
  assert.deepEqual(result.counts, { pending: 135, published: 3240, rejected: 48, reports: 6 })
  assert.equal(result.period.newUsers, 38); assert.equal(result.period.newWorks, 215)
  assert.equal(Date.parse(result.period.to) - Date.parse(result.period.from), 30 * 86400000)
  const works = f.statements[0]
  assert(!works.sql.includes('LIMIT'))
  assert(works.sql.includes("s.status='pending' OR s.\"pendingRevision\" IS NOT NULL"))
  assert(works.sql.includes("s.status IN ('rejected','removed')"))
  assert.equal(f.statements[2].values[0], Date.parse(result.period.from))
  assert(f.statements[2].sql.includes('u.host IS NULL AND NOT u."isDeleted"'))
  await assert.rejects(f.request('/api/admin/overview?days=365'), { statusCode: 400 })
})

test('moderators can read workload counts but not user statistics or logs; ordinary and anonymous users cannot read either endpoint', async () => {
  const moderator = fixture({ id: 'mod', isModerator: true })
  const result = await moderator.request('/api/admin/overview')
  assert.equal(Object.hasOwn(result.period, 'newUsers'), false)
  assert.equal(moderator.statements.length, 2)
  await assert.rejects(moderator.request('/api/admin/logs'), { statusCode: 403 })
  for (const user of [{ id: 'ordinary' }, null]) {
    const f = fixture(user)
    for (const endpoint of ['overview', 'logs']) await assert.rejects(f.request(`/api/admin/${endpoint}`), { statusCode: user ? 403 : 401 })
    assert.equal(f.statements.length, 0)
  }
})

test('logs paginate with parameterized filters and expose only allowlisted summaries, never arbitrary configuration or tokens', async () => {
  const f = fixture(), stamp = (Date.now() - 946684800000).toString(36).padStart(8, '0')
  for (let n = 32; n > 0; n--) f.logs.push({ id: `${stamp}${String(n).padStart(4, '0')}`, userId: 'operator', name: null, username: 'na_internal',
    type: n === 32 ? 'communitySettings' : n === 31 ? 'adjustLotteryChances' : 'unknownType',
    info: { token: 'secret-token', settings: { brand: 'sensitive-config-value', password: 'secret-password' }, before: 2, after: 7, reason: '人工调整' } })
  const head = await f.request('/api/admin/logs?actor=public%25name&type=communitySettings')
  assert.equal(head.items.length, 30); assert.equal(head.nextCursor, f.logs[29].id)
  assert.deepEqual(head.items[0].details, [{ label: '变更项', value: '社区名称' }])
  assert.deepEqual(head.items[1].details, [{ label: '次数变化', value: '2 → 7' }, { label: '说明', value: '人工调整' }])
  assert.deepEqual(head.items[2].details, [])
  assert.equal(head.items[0].actor.username, 'publicName')
  assert(head.items[0].date)
  for (const secret of ['secret-token', 'sensitive-config-value', 'secret-password', 'na_internal']) assert(!JSON.stringify(head).includes(secret))
  assert.equal(f.statements[0].values[3], '%public\\%name%')
  assert(f.statements[0].sql.includes('e.issuer=$7'))
  assert(!f.statements[0].sql.includes('createdAt'))
  const older = await f.request(`/api/admin/logs?cursor=${head.nextCursor}`)
  assert.equal(older.items.length, 2); assert.equal(older.nextCursor, null)
  for (const suffix of ['type=token', 'cursor=bad%21', 'from=invalid', 'from=2020-01-01&to=2026-01-01']) await assert.rejects(f.request('/api/admin/logs?' + suffix), { statusCode: 400 })
})

test('announcement and role changes keep filterable safe summaries in the existing log DTO', async () => {
  for (const entry of [
    { type: 'updateAnnouncement', label: '修改公告',
      info: { announcementId: 'a1', fields: ['title', 'text', 'isActive', 'password', 'constructor'],
        title: 'private-title', text: 'private-body', reason: 'private-reason', token: 'secret-token' },
      details: [{ label: '公告编号', value: 'a1' }, { label: '变更项', value: '标题、正文、启用状态' }],
      target: { label: '公告管理', to: '/admin?tab=announcements' } },
    { type: 'updateCommunityRoles', label: '调整管理授权',
      info: { userId: '42', before: ['adminrole', 'invalid!', 1], after: ['modrole', 'bad/token', null],
        reason: 'private-reason', password: 'secret-password', token: 'secret-token' },
      details: [{ label: '用户编号', value: '42' }, { label: '原角色编号', value: 'adminrole' }, { label: '新角色编号', value: 'modrole' }],
      target: { label: '管理授权', to: '/admin?tab=roles' } },
  ]) {
    const f = fixture()
    f.logs.push({ id: `${(Date.now() - 946684800000).toString(36).padStart(8, '0')}0001`,
      userId: 'operator', name: null, username: 'na_internal', type: entry.type, info: entry.info })
    const result = await f.request(`/api/admin/logs?type=${entry.type}`)
    assert.equal(f.statements[0].values[0], entry.type)
    assert(result.types.some(option => option.value === entry.type && option.label === entry.label))
    assert.equal(result.items[0].label, entry.label)
    assert.deepEqual(result.items[0].details, entry.details)
    assert.deepEqual(result.items[0].target, entry.target)
    for (const secret of ['private-title', 'private-body', 'private-reason', 'secret-token', 'secret-password', 'invalid!', 'bad/token']) {
      assert(!JSON.stringify(result).includes(secret))
    }
  }
})

test('new HTTP routes reach authentication instead of falling through to 404', async t => {
  const origin = 'https://community.test'
  const app = createApplication({ db: { query() { assert.fail('Guests must not reach data') } }, redis: {}, config: { url: origin }, filesRoot: path.resolve('files') })
  t.after(() => app.close())
  for (const url of ['/api/admin/overview', '/api/admin/logs']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 401); assert.equal(response.json().error.code, 'AUTH_REQUIRED')
  }
  const response = await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { origin }, payload: { category: 'activity', through: '1-0' } })
  assert.equal(response.statusCode, 401)
})
