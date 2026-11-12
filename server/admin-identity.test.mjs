/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAdmin } from './admin.ts'

const issuer = 'https://accounts.example'
const people = [
  { id: 'bound17', username: 'na_internal17', name: null },
  { id: 'pending18', username: 'na_internal18', name: null },
  { id: 'localroot', username: 'root', name: null },
].map(person => ({ ...person, host: null, isSuspended: false, isDeleted: false, isLocked: false, isBot: false,
  isCat: false, isExplorable: true, followersCount: 2, followingCount: 3, notesCount: 4,
  communityViolationCount: 1, communityViolationBaseline: 0 }))
const mappings = [
  { userId: 'bound17', subject: '17', username: 'root' },
  { userId: 'pending18', subject: '18', username: null },
]

function fixture(path, method = 'GET', body = {}) {
  const statements = []
  let response
  const user = { id: 'localroot', username: 'root', isAdmin: true, isModerator: true }
  const report = { id: 'report1', targetUserId: 'bound17', reporterId: 'pending18', assigneeId: null,
    resolved: false, resolvedAs: null, comment: 'A report', contentKey: null, contentSnapshot: null, moderationNote: '',
    targetUsername: 'na_internal17', reporterUsername: 'na_internal18' }
  const query = async (sql, parameters = []) => {
    statements.push({ sql, parameters })
    if (sql.includes('FROM external_account')) {
      assert.equal(parameters[0], issuer)
      return { rows: mappings.filter(row => parameters[1].includes(row.userId)) }
    }
    if (sql.includes('FROM meta')) return { rows: [{ rootUserId: 'localroot' }] }
    if (sql.includes('FROM role') || sql.includes('FROM role_assignment')) return { rows: [] }
    if (sql.includes('FROM "user" u')) return { rows: sql.includes('FOR UPDATE')
      ? people.filter(person => person.id === parameters[0]).map(person => ({ ...person })) : people.map(person => ({ ...person })) }
    if (sql.includes('FROM abuse_user_report')) return { rows: [{ ...report }] }
    if (/^(BEGIN|COMMIT|ROLLBACK|UPDATE |INSERT INTO moderation_log)/.test(sql)) return { rows: [], rowCount: 1 }
    assert.fail(`Unexpected admin identity query: ${sql}`)
  }
  const db = { query, async connect() { return { query, release() {} } } }
  const ctx = {
    req: { method }, url: new URL(path, 'https://community.example'),
    config: { url: 'https://community.example', newApiSso: { issuer } },
    db, user, body, newId: () => 'audit1',
    requireUser() { return user },
    requireAdmin() { assert.equal(user.isAdmin, true); return user },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  return { ctx, statements, response: () => response }
}

function identityReads(statements) { return statements.filter(item => item.sql.includes('FROM external_account')) }

test('admin user DTOs batch public names without changing local root protection or merging a same-name external account', async () => {
  const { ctx, statements, response } = fixture('/api/admin/users')
  await handleAdmin(ctx)
  const items = response().items
  assert.deepEqual(items.map(item => item.id), ['bound17', 'pending18', 'localroot'])
  assert.deepEqual(items.map(item => item.username), ['root', '', 'root'])
  assert.deepEqual(items.map(item => item.accountId), ['17', '18', undefined])
  assert.equal(items[1].name, '章鱼用户')
  assert.deepEqual(items.map(item => item.isProtected), [false, false, true])
  assert.equal(identityReads(statements).length, 1)
  assert(!JSON.stringify(response()).includes('na_internal'))
  const originalFilter = statements.find(item => item.sql.includes('ORDER BY u.id DESC'))
  assert(originalFilter.sql.includes('host IS NULL AND NOT "isDeleted"'))
  assert(originalFilter.sql.includes('u.username ILIKE $2'))
})

test('admin mutation replies use public identities while updates and protection retain internal account IDs', async () => {
  const { ctx, statements, response } = fixture('/api/admin/users/bound17', 'PATCH', { isSuspended: true, reason: 'Test moderation' })
  await handleAdmin(ctx)
  assert.equal(response().user.id, 'bound17')
  assert.equal(response().user.accountId, '17')
  assert.equal(response().user.username, 'root')
  assert.equal(response().user.isSuspended, true)
  assert.deepEqual(statements.find(item => item.sql.startsWith('UPDATE "user"')).parameters, ['bound17', true])
  const own = fixture('/api/admin/users/localroot', 'PATCH', { isSuspended: true, reason: 'Must remain protected' })
  await assert.rejects(handleAdmin(own.ctx), { statusCode: 403 })
  assert(!own.statements.some(item => item.sql.startsWith('UPDATE "user"')))
  const spoof = fixture('/api/admin/users/bound17', 'PATCH', { isSuspended: true, reason: 'Test', username: 'spoofed', accountId: '999' })
  await assert.rejects(handleAdmin(spoof.ctx), { statusCode: 400 })
  assert.equal(identityReads(spoof.statements).length, 0)
})

test('report list and decision DTOs project both actors in one batch while preserving moderation references', async () => {
  for (const method of ['GET', 'PATCH']) {
    const { ctx, statements, response } = fixture(method === 'GET' ? '/api/admin/reports' : '/api/admin/reports/report1',
      method, method === 'PATCH' ? { resolvedAs: 'reject', moderationNote: 'Reviewed' } : {})
    await handleAdmin(ctx)
    const report = method === 'GET' ? response().items[0] : response().report
    assert.equal(report.targetUserId, 'bound17')
    assert.equal(report.reporterId, 'pending18')
    assert.equal(report.targetUsername, 'root')
    assert.equal(report.targetAccountId, '17')
    assert.equal(report.reporterUsername, '')
    assert.equal(report.reporterAccountId, '18')
    assert.equal(identityReads(statements).length, 1)
    assert.deepEqual(identityReads(statements)[0].parameters[1], ['bound17', 'pending18'])
    if (method === 'PATCH') {
      assert.equal(report.assigneeId, 'localroot')
      assert.deepEqual(statements.find(item => item.sql.startsWith('UPDATE abuse_user_report')).parameters,
        ['report1', 'reject', 'localroot', 'Reviewed'])
    }
  }
})
