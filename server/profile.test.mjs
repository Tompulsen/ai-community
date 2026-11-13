/* SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict'
import test from 'node:test'
import { authServices } from './auth.ts'

function fixture({ sensitive = false, policy = true, roles = [], assigned = [], available = true, failUpdate = false } = {}) {
  const calls = [], response = {}
  const user = { id: '17', username: 'creator', name: '旧名字', bio: '', avatarId: null, bannerId: null, host: null }
  async function query(sql, values = []) {
    calls.push({ sql, values })
    if (sql.includes('FROM drive_file')) return { rows: available ? [{ id: 'picture1', isSensitive: sensitive }] : [], rowCount: available ? 1 : 0 }
    if (sql.includes('FROM meta')) return { rows: [{ policies: { canUpdateBioMedia: policy } }] }
    if (sql.includes('FROM role_assignment')) return { rows: assigned.map(roleId => ({ roleId })) }
    if (sql.includes('FROM role')) return { rows: roles }
    if (failUpdate && sql.startsWith('UPDATE user_profile')) throw new Error('database unavailable')
    return { rows: [], rowCount: 1 }
  }
  const db = { query, connect: async () => ({ query, release() {} }) }
  const ctx = { req: { method: 'PATCH' }, url: new URL('https://community.test/api/profile'),
    body: { name: '新的名字', bio: '简介', avatarId: 'picture1' }, user,
    requireUser: () => user, json: (status, value) => Object.assign(response, { status, value }) }
  const auth = authServices({ db, redis: {}, config: { url: 'https://community.test' } })
  return { ctx, calls, response, run: () => auth.handleAuth(ctx) }
}

test('sensitive pictures cannot become publicly visible profile media', async () => {
  const f = fixture({ sensitive: true })
  await assert.rejects(f.run(), { statusCode: 400 })
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK')
})

test('old role policy still prevents changing profile pictures', async () => {
  const f = fixture({ policy: false })
  await assert.rejects(f.run(), { statusCode: 403 })
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
})

test('profile writes reject identity, privilege and unknown fields', async () => {
  for (const field of ['id', 'accountId', 'username', 'isAdmin', 'unexpected']) {
    const f = fixture(); f.ctx.body[field] = 'changed'
    await assert.rejects(f.run(), { statusCode: 400 })
    assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
  }
})

test('valid profile changes commit together and return the saved public profile', async () => {
  const f = fixture()
  await f.run()
  assert.equal(f.response.status, 200)
  assert.equal(f.response.value.user.name, '新的名字')
  assert.equal(f.response.value.user.avatarId, 'picture1')
  assert.equal(f.calls.at(-1).sql, 'COMMIT')
  const media = f.calls.find(call => call.sql.includes('FROM drive_file'))
  assert.deepEqual(media.values, ['picture1', '17'])
  assert(media.sql.includes('"userId"=$2') && media.sql.includes('type IN') && media.sql.includes('FOR SHARE'))
})

test('missing, foreign or non-image media cannot update any profile field', async () => {
  const f = fixture({ available: false })
  await assert.rejects(f.run(), { statusCode: 400 })
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
})

test('restricted users can remove media, keep existing media and edit their text', async () => {
  for (const avatarId of [null, 'existing1']) {
    const f = fixture({ policy: false })
    f.ctx.user.avatarId = 'existing1'
    f.ctx.body.avatarId = avatarId
    await f.run()
    assert.equal(f.response.value.user.avatarId, avatarId)
    assert.equal(f.calls.some(call => call.sql.includes('FROM drive_file')), false)
  }
})

test('manual and conditional role policies honor assignment and priority', async () => {
  const role = (id, priority, value, extra = {}) => ({ id, target: 'manual', policies: { canUpdateBioMedia: { priority, value } }, ...extra })
  const allowed = fixture({ policy: false, roles: [role('allowed', 2, true), role('blocked', 1, false)], assigned: ['allowed', 'blocked'] })
  await allowed.run()
  const blocked = fixture({ roles: [role('blocked', 2, false), role('allowed', 1, true)], assigned: ['allowed', 'blocked'] })
  await assert.rejects(blocked.run(), { statusCode: 403 })
  const unassigned = fixture({ roles: [role('blocked', 2, false)] })
  await unassigned.run()
  const conditional = fixture({ roles: [role('local', 1, false, { target: 'conditional', condFormula: { type: 'isLocal' } })] })
  await assert.rejects(conditional.run(), { statusCode: 403 })
  assert(conditional.calls.some(call => call.sql.includes('"expiresAt">NOW()')))
  const tied = fixture({ roles: [role('allow', 1, true), role('deny', 1, false)], assigned: ['allow', 'deny'] })
  await tied.run()
  const fallback = fixture({ policy: false, roles: [{ ...role('default', 2, true), policies: { canUpdateBioMedia: { priority: 2, useDefault: true } } }], assigned: ['default'] })
  await assert.rejects(fallback.run(), { statusCode: 403 })
})

test('invalid profile text and IDs fail before starting a transaction', async () => {
  for (const patch of [{ name: 'bad\u0000name' }, { bio: 'bad\u0000bio' }, { avatarId: '../other' }, { bio: 5 }]) {
    const f = fixture(); Object.assign(f.ctx.body, patch)
    await assert.rejects(f.run(), { statusCode: 400 })
    assert.equal(f.calls.length, 0)
  }
})

test('profile storage failure rolls back the entire change', async () => {
  const f = fixture({ failUpdate: true })
  await assert.rejects(f.run(), /database unavailable/)
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(f.calls.some(call => call.sql === 'COMMIT'), false)
})
