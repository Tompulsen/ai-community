/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readPublicIdentities, rememberPublicIdentity } from './public-identity.ts'

const issuer = 'https://accounts.test'
const config = { url: 'https://community.test', newApiSso: { issuer } }
const identity = { issuer, subject: '7', userId: 'local123', username: 'root' }

test('verified public snapshots use a parameterized exact mapping update without credentials or internal usernames', async () => {
  const calls = []
  const db = { async query(sql, values) {
    calls.push({ sql, values })
    return { rows: [] }
  } }
  await rememberPublicIdentity(db, { ...identity, accessToken: 'private-access', password: 'private-password' })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /^UPDATE external_account SET username=\$4/)
  assert.match(calls[0].sql, /WHERE issuer=\$1 AND subject=\$2 AND "userId"=\$3 AND username IS DISTINCT FROM \$4/)
  assert.deepEqual(calls[0].values, [issuer, '7', 'local123', 'root'])
  assert.doesNotMatch(JSON.stringify(calls), /private-access|private-password|UPDATE "user"/)
})

test('renames change only the exact public snapshot and identical or mismatching identities do not write', async () => {
  const internalUser = Object.freeze({ id: identity.userId, username: 'na_internal_profile' })
  const mapping = { ...identity, username: 'old-name' }
  let writes = 0
  const db = { async query(sql, values) {
    const [accountIssuer, subject, userId, username] = values
    assert.match(sql, /username IS DISTINCT FROM \$4/)
    if (accountIssuer === mapping.issuer && subject === mapping.subject && userId === mapping.userId && username !== mapping.username) {
      mapping.username = username
      writes++
    }
    return { rows: [] }
  } }
  await rememberPublicIdentity(db, identity)
  await rememberPublicIdentity(db, identity)
  for (const mismatch of [{ issuer: 'https://other.test' }, { subject: '8' }, { userId: 'other123' }]) {
    await rememberPublicIdentity(db, { ...identity, ...mismatch, username: 'attacker-name' })
  }
  assert.equal(writes, 1)
  assert.equal(mapping.username, 'root')
  assert.deepEqual(internalUser, { id: 'local123', username: 'na_internal_profile' })
})

test('malformed remembered subjects, origins and usernames are refused before any database request', async () => {
  const db = { query() { assert.fail('Invalid snapshots must not reach the database') } }
  for (const invalid of [
    { issuer: 'https://accounts.test/' }, { issuer: 'http://accounts.test' }, { issuer: 'https://secret@accounts.test' },
    { subject: 7 }, { subject: '0' }, { subject: '07' }, { subject: '-1' }, { subject: '7e1' },
    { subject: '9007199254740992' }, { username: null }, { username: '' }, { username: 'x'.repeat(129) },
    { username: 'root\n' }, { username: 'root\u0085' }, { userId: '' },
  ]) await assert.rejects(rememberPublicIdentity(db, { ...identity, ...invalid }), { statusCode: 502, code: 'SSO_IDENTITY' })
})

test('public reads batch and deduplicate IDs within the configured issuer and reveal only public fields', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Public identity reads must never call an account service'))
  const calls = []
  const db = { async query(sql, values) {
    calls.push({ sql, values })
    assert.match(sql, /^SELECT subject,username,"userId" FROM external_account WHERE issuer=\$1 AND "userId"=ANY\(\$2::varchar\[\]\)$/)
    assert.deepEqual(values, [issuer, ['local123', 'old123', 'invalid123', 'unbound123']])
    return { rows: [
      { userId: 'local123', subject: '7', username: 'root', accessToken: 'private-access', password: 'private-password' },
      { userId: 'old123', subject: '8', username: null },
      { userId: 'invalid123', subject: '9', username: 'x'.repeat(129) },
      { userId: 'unrequested123', subject: '10', username: 'other' },
    ] }
  } }
  const identities = await readPublicIdentities({ db, config }, ['local123', 'old123', 'local123', 'invalid123', 'unbound123'])
  assert.equal(calls.length, 1)
  assert.deepEqual([...identities], [
    ['local123', { accountId: '7', username: 'root' }],
    ['old123', { accountId: '8', username: '' }],
    ['invalid123', { accountId: '9', username: '' }],
  ])
  assert.equal(identities.has('unbound123'), false)
  assert.doesNotMatch(JSON.stringify([...identities]), /private-access|private-password|accessToken|na_/)
})

test('public reads reject malformed numeric subjects and preserve only safe username snapshots', async () => {
  const rows = [
    { userId: 'zero', subject: '0', username: 'name' },
    { userId: 'leading', subject: '07', username: 'name' },
    { userId: 'coerced', subject: 7, username: 'name' },
    { userId: 'unsafe', subject: '9007199254740992', username: 'name' },
    { userId: 'control', subject: '7', username: 'name\n' },
    { userId: 'valid', subject: '8', username: '中文用户名' },
  ]
  const db = { async query() { return { rows } } }
  const result = await readPublicIdentities({ db, config }, rows.map(row => row.userId))
  assert.deepEqual([...result], [
    ['control', { accountId: '7', username: '' }],
    ['valid', { accountId: '8', username: '中文用户名' }],
  ])
})

test('empty public batches perform no read or write', async () => {
  const db = { query() { assert.fail('An empty identity batch must not query the database') } }
  assert.equal((await readPublicIdentities({ db, config }, [])).size, 0)
})
