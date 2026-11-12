/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleSocial } from './social.ts'

const issuer = 'https://accounts.example'
const people = [
  { id: 'bound17', username: 'na_internal17', name: null, avatarId: 'avatar17', chatScope: 'none' },
  { id: 'pending18', username: 'na_internal18', name: null, avatarId: null, chatScope: 'none' },
  { id: 'localroot', username: 'root', name: null, avatarId: null, chatScope: 'none' },
]
const mappings = [
  { userId: 'bound17', subject: '17', username: 'root' },
  { userId: 'pending18', subject: '18', username: null },
]

function fixture(path, options = {}) {
  const statements = []
  let response
  const user = { id: 'reader', username: 'reader' }
  const query = async (sql, parameters = []) => {
    statements.push({ sql, parameters })
    if (sql.includes('FROM external_account')) {
      assert.equal(parameters[0], issuer)
      return { rows: mappings.filter(row => parameters[1].includes(row.userId)), rowCount: 0 }
    }
    if (sql.includes('FROM announcement')) return { rows: [] }
    if (sql.includes('SELECT policies FROM meta')) return { rows: [{ policies: { chatAvailability: 'available' } }] }
    if (sql.includes('FROM role') || sql.includes('FROM role_assignment')) return { rows: [] }
    if (sql.includes('SELECT * FROM "user"')) return { rows: [{ id: user.id, host: null }] }
    if (sql.startsWith('SELECT 1 FROM blocking')) return { rows: [], rowCount: options.blocked ? 1 : 0 }
    if (sql.startsWith('SELECT 1 WHERE EXISTS (SELECT 1 FROM following')) return { rows: [], rowCount: 0 }
    if (sql.includes('WITH latest AS')) return { rows: people.map((person, index) => ({ ...person,
      messageId: `0000001${index}message`, fromUserId: user.id, toUserId: person.id, text: '', reads: [], unread: index + 1 })) }
    if (sql.startsWith('SELECT COUNT(*)::int AS "unreadCount"')) return { rows: [{ unreadCount: 6 }] }
    if (sql.includes('FROM chat_message')) return { rows: [] }
    if (sql.includes('SELECT id,username,name,"avatarId","chatScope"')) {
      return { rows: people.filter(person => person.id === parameters[0]) }
    }
    if (sql.includes('SELECT id,username,name,"avatarId"')) return { rows: people }
    assert.fail(`Unexpected social identity query: ${sql}`)
  }
  const ctx = {
    req: { method: 'GET' }, url: new URL(path, 'https://community.example'),
    config: { url: 'https://community.example', newApiSso: { issuer } },
    db: { query }, user, body: { accountId: '999', username: 'unverified-body-name' },
    requireUser() { return user },
    redis: {
      async xrevrange() { return people.map((person, index) => [`179443580000${index}-1`, ['data',
        JSON.stringify({ type: 'follow', notifierId: person.id })]]) },
      async get() { return null },
      async hgetall() { return {} },
    },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  return { ctx, statements, response: () => response }
}

function identityReads(statements) { return statements.filter(item => item.sql.includes('FROM external_account')) }

test('message threads batch public identities while retaining local IDs and sending restrictions', async () => {
  const { ctx, statements, response } = fixture('/api/messages/threads')
  await handleSocial(ctx)
  const items = response().items
  assert.deepEqual(items.map(item => item.user.id), ['bound17', 'pending18', 'localroot'])
  assert.deepEqual(items.map(item => item.user.username), ['root', '', 'root'])
  assert.deepEqual(items.map(item => item.user.accountId), ['17', '18', undefined])
  assert.equal(items[1].user.name, '章鱼用户')
  assert.equal(items[0].user.avatarUrl, '/legacy-files/avatar17?variant=thumbnail')
  assert.deepEqual(items.map(item => item.unread), [1, 2, 3])
  assert.equal(response().unreadCount, 6)
  assert(items.every(item => item.canSend === false))
  assert.equal(identityReads(statements).length, 1)
  assert.deepEqual(identityReads(statements)[0].parameters[1], people.map(person => person.id))
})

test('individual peer responses use verified identities and blocked conversations still stop before identity reads', async () => {
  const { ctx, statements, response } = fixture('/api/messages/pending18')
  await handleSocial(ctx)
  assert.equal(response().user.id, 'pending18')
  assert.equal(response().user.accountId, '18')
  assert.equal(response().user.username, '')
  assert.equal(response().user.name, '章鱼用户')
  assert.equal(identityReads(statements).length, 1)
  const blocked = fixture('/api/messages/bound17', { blocked: true })
  await assert.rejects(handleSocial(blocked.ctx), { statusCode: 403 })
  assert.equal(identityReads(blocked.statements).length, 0)
})

test('notification actor DTOs and fallback text share the public identity without changing destination IDs', async () => {
  const { ctx, statements, response } = fixture('/api/notifications')
  await handleSocial(ctx)
  const items = response().items
  const bound = items.find(item => item.actor.id === 'bound17')
  const pending = items.find(item => item.actor.id === 'pending18')
  const local = items.find(item => item.actor.id === 'localroot')
  assert.equal(bound.actor.username, 'root')
  assert.equal(bound.actor.accountId, '17')
  assert.equal(bound.text, 'root')
  assert.equal(bound.url, '/community?creator=bound17')
  assert.equal(pending.actor.username, '')
  assert.equal(pending.actor.accountId, '18')
  assert.equal(pending.text, '章鱼用户')
  assert.equal(local.actor.username, 'root')
  assert.equal(local.actor.accountId, undefined)
  assert.equal(identityReads(statements).length, 1)
  assert(!JSON.stringify(response()).includes('na_internal'))
})
