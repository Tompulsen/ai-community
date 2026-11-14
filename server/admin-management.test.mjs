/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAdmin } from './admin.ts'

const issuer = 'https://accounts.example'
const managementRoles = [
  { id: 'adminrole', name: '管理员', target: 'manual', condFormula: null, isAdministrator: true, isModerator: false },
  { id: 'modrole', name: '审核员', target: 'manual', condFormula: null, isAdministrator: false, isModerator: true },
  { id: 'ordinary', name: '创作者', target: 'manual', condFormula: null, isAdministrator: false, isModerator: false },
]
function person(id, username = `internal${id}`) {
  return { id, username, name: null, host: null, createdAt: '2026-11-01T00:00:00Z',
    isSuspended: false, isDeleted: false, isLocked: false, isBot: false, isCat: false, isExplorable: true,
    followersCount: 0, followingCount: 0, notesCount: 0, communityViolationCount: 0, communityViolationBaseline: 0 }
}
function assignment(id, userId, roleId, expiresAt = null) { return { id, userId, roleId, expiresAt } }
function announcement(id, overrides = {}) {
  return { id, title: `Announcement ${id}`, text: 'Public text', userId: null, isActive: true,
    updatedAt: '2026-11-13T00:00:00.000Z', ...overrides }
}
function fixture(options = {}) {
  const state = {
    rootUserId: 'root1',
    people: [person('root1', 'root'), person('17'), person('18')],
    roles: structuredClone(managementRoles),
    assignments: [assignment('ra1', 'root1', 'adminrole'), assignment('ra2', '18', 'adminrole'), assignment('ra3', '17', 'ordinary')],
    identities: [{ userId: '17', subject: '17', username: 'octopus' }, { userId: '18', subject: '18', username: 'operator' }],
    announcements: [], audits: [], failAudit: false,
    ...structuredClone(options.state || {}),
  }
  const actor = Object.hasOwn(options, 'actor') ? options.actor : { id: 'root1', username: 'root', isAdmin: true, isModerator: true }
  const statements = []
  let snapshot, sequence = 100, clock = Date.parse('2026-11-14T08:00:00Z')
  const active = row => row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()
  const sorted = rows => [...rows].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  const matchesUser = (row, needle) => !needle || [row.id, row.username, row.name, ...state.identities
    .filter(identity => identity.userId === row.id).flatMap(identity => [identity.subject, identity.username])]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(needle.toLowerCase()))
  const query = async (sql, parameters = []) => {
    const statement = sql.trim()
    statements.push({ sql: statement, parameters: structuredClone(parameters) })
    if (statement === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] } }
    if (statement === 'COMMIT') { snapshot = undefined; return { rows: [] } }
    if (statement === 'ROLLBACK') { Object.assign(state, snapshot); snapshot = undefined; return { rows: [] } }
    if (statement.startsWith('SELECT subject,username,"userId" FROM external_account')) {
      assert.equal(parameters[0], issuer)
      return { rows: structuredClone(state.identities.filter(row => parameters[1].includes(row.userId))) }
    }
    if (statement.includes('FROM meta')) return { rows: [{ rootUserId: state.rootUserId }] }
    if (statement.startsWith('SELECT') && statement.includes('FROM role_assignment')) {
      return { rows: structuredClone(state.assignments.filter(row => parameters[0].includes(row.userId) && active(row))
        .sort((a, b) => a.id.localeCompare(b.id))) }
    }
    if (statement.startsWith('SELECT') && /\bFROM role(?:\s|$)/.test(statement)) {
      return { rows: structuredClone(state.roles.filter(row => row.isAdministrator || row.isModerator)
        .sort((a, b) => a.id.localeCompare(b.id))) }
    }
    if (statement.includes('FROM "user" u')) {
      const rows = state.people.filter(row => row.host === null && !row.isDeleted)
      return { rows: structuredClone(statement.includes('u.id=ANY')
        ? rows.filter(row => parameters[0].includes(row.id))
        : sorted(rows.filter(row => matchesUser(row, parameters[0]) && (!parameters[2] || row.id < parameters[2]))).slice(0, 31)) }
    }
    if (statement.includes('FROM announcement')) {
      const rows = state.announcements.filter(row => row.userId === null)
      return { rows: structuredClone(statement.includes('WHERE id=$1')
        ? rows.filter(row => row.id === parameters[0])
        : sorted(rows.filter(row => (!parameters[0] || `${row.title} ${row.text}`.toLowerCase().includes(parameters[0].toLowerCase()))
          && (parameters[2] === 'all' || row.isActive === (parameters[2] === 'active'))
          && (!parameters[3] || row.id < parameters[3]))).slice(0, 31)) }
    }
    if (statement.startsWith('INSERT INTO announcement')) {
      const row = announcement(parameters[0], { title: parameters[1], text: parameters[2], updatedAt: new Date(++clock).toISOString() })
      state.announcements.push(row)
      return { rows: [structuredClone(row)], rowCount: 1 }
    }
    if (statement.startsWith('UPDATE announcement')) {
      const row = state.announcements.find(item => item.id === parameters[0] && item.userId === null)
      if (!row) return { rows: [], rowCount: 0 }
      Object.assign(row, { title: parameters[1], text: parameters[2], isActive: parameters[3], updatedAt: new Date(++clock).toISOString() })
      return { rows: [structuredClone(row)], rowCount: 1 }
    }
    if (statement.startsWith('INSERT INTO moderation_log')) {
      if (state.failAudit) throw new Error('audit insert failed')
      state.audits.push({ id: parameters[0], userId: parameters[1], type: parameters[2], info: JSON.parse(parameters[3]) })
      return { rows: [], rowCount: 1 }
    }
    if (statement.includes('FROM moderation_log l')) {
      const rows = sorted(state.audits.filter(row => (!parameters[0] || row.type === parameters[0]) && (!parameters[1] || row.id < parameters[1])
        && (!parameters[2] || row.id === parameters[2] || row.type.includes(parameters[2])
          || matchesUser(state.people.find(item => item.id === row.userId) || { id: row.userId }, parameters[2]))))
      return { rows: structuredClone(rows.slice(0, 31).map(row => {
        const user = state.people.find(item => item.id === row.userId)
        return { ...row, actorId: user?.id ?? null, actorUsername: user?.username ?? null, actorName: user?.name ?? null }
      })) }
    }
    if (statement.startsWith('DELETE FROM role_assignment')) {
      state.assignments = state.assignments.filter(row => !(row.userId === parameters[0] && parameters[1].includes(row.roleId) && active(row)))
      return { rows: [], rowCount: 1 }
    }
    if (statement.startsWith('INSERT INTO role_assignment')) {
      const existing = state.assignments.find(row => row.userId === parameters[1] && row.roleId === parameters[2])
      if (existing) existing.expiresAt = null
      else state.assignments.push(assignment(parameters[0], parameters[1], parameters[2]))
      return { rows: [], rowCount: 1 }
    }
    assert.fail(`Unexpected management SQL: ${statement}`)
  }
  const db = { query, async connect() { return { query, release() {} } } }
  async function request(path, method = 'GET', body = {}) {
    let response
    const deny = statusCode => { throw Object.assign(new Error('Permission denied'), { statusCode }) }
    const ctx = {
      req: { method }, url: new URL(path, 'https://community.example'), config: { url: 'https://community.example', newApiSso: { issuer } },
      db, user: actor, body, newId: () => `generated${++sequence}`,
      requireUser() { if (!actor) deny(401); return actor },
      requireAdmin() { if (!actor) deny(401); if (!actor.isAdmin) deny(403); return actor },
      json(status, payload) { assert.equal(status, 200); response = payload },
    }
    assert.equal(await handleAdmin(ctx), true)
    return response
  }
  return { state, statements, actor, request }
}
async function roleUser(f, id) { return (await f.request(`/api/admin/roles?query=${id}`)).items.find(row => row.id === id) }
const writes = statements => statements.filter(item => /^(INSERT|UPDATE|DELETE)/.test(item.sql))

test('management routes reject anonymous, regular and moderator callers before SQL', async () => {
  const routes = [
    ['/api/admin/announcements'], ['/api/admin/announcements', 'POST', { title: 'Title', text: 'Text' }],
    ['/api/admin/announcements/a1', 'PATCH', { title: 'Title', version: 'x' }],
    ['/api/admin/announcements/a1', 'DELETE'], ['/api/admin/audit'], ['/api/admin/roles'],
    ['/api/admin/users/17/roles', 'PATCH', { roleIds: ['modrole'], version: 'x' }],
  ]
  for (const actor of [null, { id: '17', isAdmin: false, isModerator: false }, { id: '17', isAdmin: false, isModerator: true }]) {
    for (const route of routes) {
      const f = fixture({ actor })
      await assert.rejects(f.request(...route), { statusCode: actor ? 403 : 401 })
      assert.equal(f.statements.length, 0)
    }
  }
})

test('announcement listing searches and pages only public announcements with version tokens', async () => {
  const rows = Array.from({ length: 32 }, (_, index) => announcement(`a${String(index + 1).padStart(3, '0')}`, { title: '100% news' }))
  rows.push(announcement('zprivate', { userId: '17', title: '100% private message' }))
  const f = fixture({ state: { announcements: rows } })
  const first = await f.request('/api/admin/announcements?query=100%25&status=active')
  assert.equal(first.items.length, 30)
  assert.equal(first.nextCursor, 'a003')
  assert(first.items.every(item => /^[a-f0-9]{64}$/.test(item.version) && !Object.hasOwn(item, 'userId')))
  const second = await f.request(`/api/admin/announcements?query=100%25&status=active&cursor=${first.nextCursor}`)
  assert.deepEqual(second.items.map(item => item.id), ['a002', 'a001'])
  assert.equal(second.nextCursor, null)
  assert.equal(f.statements[0].parameters[1], '%100\\%%')
  assert(f.statements[0].sql.includes('"userId" IS NULL'))
  assert(!f.statements[0].sql.includes('100%'))
})

test('announcement creation validates text and commits the content together with its audit', async () => {
  const f = fixture()
  const response = await f.request('/api/admin/announcements', 'POST', { title: '  Updates  ', text: '  Public text  ' })
  assert.equal(response.id, response.announcement.id)
  assert.equal(response.announcement.title, 'Updates')
  assert.equal(response.announcement.text, 'Public text')
  assert.equal(response.announcement.isActive, true)
  assert.deepEqual(f.state.audits.map(row => row.type), ['createAnnouncement'])
  assert.deepEqual(f.state.audits[0].info, { announcementId: response.id })
  assert.equal(f.statements.at(-1).sql, 'COMMIT')
  for (const body of [{ title: '', text: 'body' }, { title: 'x'.repeat(101), text: 'body' }, { title: 'Title', text: 'x'.repeat(8193) }, { title: 'Title', text: 'body', userId: '17' }]) {
    const invalid = fixture()
    await assert.rejects(invalid.request('/api/admin/announcements', 'POST', body), { statusCode: 400 })
    assert.equal(writes(invalid.statements).length, 0)
  }
})

test('announcement updates require optimistic versions, lock rows, reject stale saves and support updatedAt', async () => {
  const f = fixture({ state: { announcements: [announcement('a1')] } })
  const previous = (await f.request('/api/admin/announcements')).items[0]
  await assert.rejects(f.request('/api/admin/announcements/a1', 'PATCH', { text: 'New' }), { statusCode: 400 })
  const changed = await f.request('/api/admin/announcements/a1', 'PATCH', { text: 'New text', isActive: false, version: previous.version })
  assert.notEqual(changed.announcement.version, previous.version)
  assert.equal(changed.announcement.isActive, false)
  assert.deepEqual(f.state.audits[0].info.fields, ['text', 'isActive'])
  const count = writes(f.statements).length
  await assert.rejects(f.request('/api/admin/announcements/a1', 'PATCH', { title: 'Stale', version: previous.version }), { statusCode: 409 })
  assert.equal(writes(f.statements).length, count)
  assert.equal(f.state.announcements[0].title, previous.title)
  assert.equal(f.statements.at(-1).sql, 'ROLLBACK')
  const latest = await f.request('/api/admin/announcements/a1', 'PATCH', { title: 'Latest', updatedAt: changed.announcement.updatedAt })
  assert.equal(latest.announcement.title, 'Latest')
  assert(f.statements.some(item => item.sql.includes('FROM announcement') && item.sql.includes('FOR UPDATE')))
})

test('announcement DELETE remains an idempotent deactivation and never edits private notifications', async () => {
  const f = fixture({ state: { announcements: [announcement('a1'), announcement('private1', { userId: '17' })] } })
  const response = await f.request('/api/admin/announcements/a1', 'DELETE')
  assert.equal(response.ok, true)
  assert.equal(response.announcement.isActive, false)
  await f.request('/api/admin/announcements/a1', 'DELETE')
  assert.equal(f.state.announcements.length, 2)
  assert.equal(f.state.audits.length, 1)
  await assert.rejects(f.request('/api/admin/announcements/private1', 'PATCH', { title: 'Forbidden', version: response.announcement.version }), { statusCode: 404 })
  assert.equal(f.state.announcements[1].isActive, true)
  assert(!writes(f.statements).some(item => item.sql.startsWith('DELETE FROM announcement')))
})

test('audit listing redacts historical settings and private text and batches public actor identities', async () => {
  const audits = [
    { id: 'du1000040000000000000000', userId: '17', type: 'communitySettings', info: { settings: { brand: 'Public', apiKey: 'old-secret', mailPassword: 'mail-secret' }, accessToken: 'outer-secret' } },
    { id: 'du1000030000000000000000', userId: '17', type: 'communityReview', info: { submissionId: 'work1', action: 'reject', version: 3, reason: 'user@example.com bearer-secret' } },
    { id: 'du1000020000000000000000', userId: '17', type: 'legacyPrivateAction', info: { password: 'private-secret', token: 'token-secret' } },
    { id: 'du1000010000000000000000', userId: '17', type: 'constructor', info: { text: 'prototype-secret' } },
  ]
  const f = fixture({ state: { audits } })
  const response = await f.request('/api/admin/audit')
  assert.equal(response.items.length, 4)
  assert.deepEqual(response.items[0].details, { fields: ['brand'] })
  assert.deepEqual(response.items[1].details, { submissionId: 'work1', action: 'reject', version: 3 })
  assert.deepEqual(response.items[2].details, {})
  assert.equal(response.items[3].label, '管理操作')
  assert.deepEqual(response.items[0].actor, { id: '17', username: 'octopus', name: 'octopus', accountId: '17' })
  assert.equal(f.statements.filter(item => item.sql.startsWith('SELECT subject,username')).length, 1)
  assert(!JSON.stringify(response).includes('secret'))
  assert(!JSON.stringify(response).includes('user@example.com'))
  assert(!JSON.stringify(response).includes('internal17'))
  assert(response.items.every(item => item.date && Number.isFinite(Date.parse(item.date))))
  const statement = f.statements.find(item => item.sql.includes('FROM moderation_log l')).sql
  assert(!statement.includes('info::text'))
  assert(!statement.includes('info->'))
  assert(response.typeOptions.some(item => item.value === 'updateCommunityRoles'))
})

test('audit filters and next cursors do not load an unbounded log or search private payloads', async () => {
  const audits = Array.from({ length: 33 }, (_, index) => ({
    id: `audit${String(index).padStart(3, '0')}`, userId: '17', type: 'suspend', info: { userId: '18', reason: 'private-only-search' },
  }))
  const f = fixture({ state: { audits } })
  const response = await f.request('/api/admin/audit?query=octopus&type=suspend')
  assert.equal(response.items.length, 30)
  assert.equal(response.nextCursor, 'audit003')
  const next = await f.request(`/api/admin/audit?type=suspend&cursor=${response.nextCursor}`)
  assert.deepEqual(next.items.map(item => item.id), ['audit002', 'audit001', 'audit000'])
  const hidden = await f.request('/api/admin/audit?query=private-only-search')
  assert.equal(hidden.items.length, 0)
  await assert.rejects(f.request('/api/admin/audit?type=invalid%27type'), { statusCode: 400 })
})

test('role lists expose manual management options, public usernames and root/self protection only', async () => {
  const f = fixture()
  const response = await f.request('/api/admin/roles')
  assert.equal(response.canAssign, true)
  assert.deepEqual(response.roles.map(role => role.id), ['adminrole', 'modrole'])
  const root = response.items.find(user => user.id === 'root1'), operator = response.items.find(user => user.id === '18')
  assert.equal(root.canEdit, false)
  assert.equal(root.isRoot, true)
  assert.equal(root.isSelf, true)
  assert.equal(operator.canEdit, true)
  assert.equal(operator.isProtected, false)
  assert.equal(operator.username, 'operator')
  assert.deepEqual(operator.roleIds, ['adminrole'])
  assert.match(operator.version, /^[a-f0-9]{64}$/)
  const publicSearch = await f.request('/api/admin/roles?query=octopus')
  assert.deepEqual(publicSearch.items.map(user => user.id), ['17'])
  assert.deepEqual(publicSearch.items[0].roleIds, [])
})

test('role user search is paged and protected accounts remain distinguishable', async () => {
  const f = fixture({ state: { people: [person('root1', 'root'), ...Array.from({ length: 33 }, (_, index) => person(`u${String(index).padStart(3, '0')}`))] } })
  const first = await f.request('/api/admin/roles')
  assert.equal(first.items.length, 30)
  assert.equal(first.nextCursor, 'u003')
  const next = await f.request(`/api/admin/roles?cursor=${first.nextCursor}`)
  assert.deepEqual(next.items.map(user => user.id), ['u002', 'u001', 'u000', 'root1'])
})

test('management role changes revive expired assignments, preserve other roles and reject stale versions', async () => {
  const f = fixture()
  f.state.assignments.push(assignment('expired1', '17', 'modrole', '2000-01-01T00:00:00Z'))
  const previous = await roleUser(f, '17')
  const response = await f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: ['modrole'], version: previous.version })
  assert.deepEqual(response.user.roleIds, ['modrole'])
  assert.notEqual(response.user.version, previous.version)
  assert.equal(f.state.assignments.find(row => row.id === 'expired1').expiresAt, null)
  assert(f.state.assignments.some(row => row.userId === '17' && row.roleId === 'ordinary'))
  const count = writes(f.statements).length
  await assert.rejects(f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: ['adminrole'], version: previous.version }), { statusCode: 409 })
  assert.equal(writes(f.statements).length, count)
  assert.deepEqual((await roleUser(f, '17')).roleIds, ['modrole'])
  await f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: [], version: response.user.version })
  assert(f.state.assignments.some(row => row.userId === '17' && row.roleId === 'ordinary'))
  assert(!f.state.assignments.some(row => row.userId === '17' && row.roleId === 'modrole'))
  assert.deepEqual(f.state.audits.map(row => row.info), [
    { userId: '17', before: [], after: ['modrole'] }, { userId: '17', before: ['modrole'], after: [] },
  ])
  assert(f.statements.some(item => item.sql.includes('FROM meta') && item.sql.endsWith('FOR UPDATE')))
  assert(f.statements.some(item => item.sql.includes('FROM "user" u') && item.sql.endsWith('FOR UPDATE')))
  assert(f.statements.some(item => item.sql.includes('FROM role') && item.sql.endsWith('FOR SHARE')))
  assert(f.statements.some(item => item.sql.startsWith('INSERT INTO role_assignment') && item.sql.includes('ON CONFLICT ("userId","roleId")')))
})

test('only manual management roles can be assigned and extra identity fields cannot be smuggled', async () => {
  const f = fixture()
  f.state.roles.push({ id: 'conditional', name: 'Automatic admin', target: 'conditional', condFormula: { type: 'isRemote' }, isAdministrator: true, isModerator: false })
  const previous = await roleUser(f, '17')
  for (const roleIds of [['ordinary'], ['conditional'], ['missing'], ['modrole', 'modrole'], ['../admin']]) {
    await assert.rejects(f.request('/api/admin/users/17/roles', 'PATCH', { roleIds, version: previous.version }), { statusCode: 400 })
  }
  await assert.rejects(f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: ['modrole'], version: previous.version, isRoot: true }), { statusCode: 400 })
  assert.equal(writes(f.statements).length, 0)
})

test('root and self cannot be changed while a different administrator can be revoked', async () => {
  const f = fixture()
  const root = await roleUser(f, 'root1')
  await assert.rejects(f.request('/api/admin/users/root1/roles', 'PATCH', { roleIds: [], version: root.version }), { statusCode: 403 })
  const other = await roleUser(f, '18')
  const revoked = await f.request('/api/admin/users/18/roles', 'PATCH', { roleIds: [], version: other.version })
  assert.equal(revoked.user.isProtected, false)
  assert.deepEqual(revoked.user.roleIds, [])
  const operator = fixture({ actor: { id: '18', username: 'operator', isAdmin: true, isModerator: true } })
  const protectedRoot = await roleUser(operator, 'root1')
  await assert.rejects(operator.request('/api/admin/users/root1/roles', 'PATCH', { roleIds: [], version: protectedRoot.version }), { statusCode: 403 })
  const self = await roleUser(operator, '18')
  assert.equal(self.isRoot, false)
  assert.equal(self.isSelf, true)
  await assert.rejects(operator.request('/api/admin/users/18/roles', 'PATCH', { roleIds: [], version: self.version }), { statusCode: 403 })
})

test('role mutation rechecks administrator permissions inside its transaction', async () => {
  const f = fixture({ actor: { id: '18', username: 'operator', isAdmin: true, isModerator: true } })
  const target = await roleUser(f, '17')
  f.state.assignments = f.state.assignments.filter(row => row.userId !== '18')
  await assert.rejects(f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: ['modrole'], version: target.version }), { statusCode: 403 })
  assert.equal(writes(f.statements).length, 0)
  assert.equal(f.statements.at(-1).sql, 'ROLLBACK')
})

test('missing manual management roles are reported without inventing a role schema', async () => {
  const f = fixture({ state: { roles: [{ ...managementRoles[0], id: 'conditional', target: 'conditional', condFormula: { type: 'isRemote' } }] } })
  const response = await f.request('/api/admin/roles')
  assert.deepEqual(response.roles, [])
  assert.equal(response.canAssign, false)
  assert(response.message.includes('手动'))
  assert(response.items.every(user => !user.canEdit))
  const target = response.items.find(user => user.id === '17')
  await assert.rejects(f.request('/api/admin/users/17/roles', 'PATCH', { roleIds: [], version: target.version }), { statusCode: 409 })
  assert.equal(writes(f.statements).length, 0)
})

test('audit write failures roll back permission and announcement changes', async () => {
  const roles = fixture()
  const target = await roleUser(roles, '17')
  roles.state.failAudit = true
  await assert.rejects(roles.request('/api/admin/users/17/roles', 'PATCH', { roleIds: ['modrole'], version: target.version }), /audit insert failed/)
  assert.deepEqual((await roleUser(roles, '17')).roleIds, [])
  const notices = fixture({ state: { announcements: [announcement('a1')] } })
  const previous = (await notices.request('/api/admin/announcements')).items[0]
  notices.state.failAudit = true
  await assert.rejects(notices.request('/api/admin/announcements/a1', 'PATCH', { text: 'Must roll back', version: previous.version }), /audit insert failed/)
  assert.equal(notices.state.announcements[0].text, previous.text)
  assert.equal(notices.state.audits.length, 0)
})
