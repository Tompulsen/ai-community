/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import pg from 'pg'
import { accountSessionHash, readAccountSession, accountSessionVerifier } from './account-session.ts'
import { authServices, getUser, publicUser, roleCondition } from './auth.ts'
import { handleAccount } from './account.ts'
import { saveSession, removeSessionById, readSessionById } from './native-account/index.ts'

const opaque = 's'.repeat(43)
const config = { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } }
const request = (id = opaque) => ({ headers: { cookie: `community_session=private; octopus_new_api_session=${id}` } })
const envelope = (user = { id: 7, username: 'creator', display_name: 'Creator' }) =>
  new Response(JSON.stringify({ success: true, data: user }),
  { headers: { 'Content-Type': 'application/json' } })
const environment = {
  NODE_ENV: 'test', NEW_API_BASE_URL: 'https://native-accounts.test',
  NEW_API_PUBLIC_URL: 'https://accounts.test', NEW_API_SESSION_SECRET: 'native-account-fixture'.repeat(3),
  NEW_API_REDIS_URL: '',
}
const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]))
Object.assign(process.env, environment)
async function seedAccountSession() {
  const now = Date.now() / 1000
  await saveSession(opaque, { user: { id: 7, username: 'creator', display_name: 'Creator',
    quota: 1, used_quota: 0, request_count: 0, group: '' },
  accessToken: 'must-not-leak', refreshToken: 'must-not-leak', upstreamSessionId: 'must-not-leak',
  accessExpiresAt: now + 3600, createdAt: now, expiresAt: now + 3600, version: 1 })
}
beforeEach(seedAccountSession)
after(async () => {
  await removeSessionById(opaque)
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function logoutFixture() {
  const token = 'c'.repeat(43)
  const headers = {}
  const redis = {
    async get() { assert.fail('Legacy community session storage must not be read') },
    async del() { assert.fail('Legacy community session storage must not be required') },
  }
  const auth = authServices({ db: {}, redis, config })
  const ctx = {
    req: { method: 'POST', url: '/api/session/logout', headers: { cookie: `community_session=${token}; octopus_new_api_session=${opaque}` } },
    res: { getHeader: key => headers[key], setHeader: (key, value) => { headers[key] = value } },
    url: new URL('/api/session/logout', config.url),
    json(status, value) { assert.equal(status, 200); assert.deepEqual(value, { user: null }) },
  }
  return { auth, ctx, headers }
}

test('logout revokes the single native session and expires legacy cookies without using community session storage', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline fixture') })
  const fixture = logoutFixture()
  await fixture.auth.handleAuth(fixture.ctx)
  assert.equal(await readSessionById(opaque), null)
  assert.equal(fixture.headers['Set-Cookie'].length, 2)
  assert(fixture.headers['Set-Cookie'].every(value => value.includes('Max-Age=0')))
})

test('unavailable native session storage cannot clear the browser credentials needed to retry logout', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline fixture') })
  const fixture = logoutFixture()
  const secret = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = ''
  try {
    await assert.rejects(fixture.auth.handleAuth(fixture.ctx), /账号服务配置不完整/)
    assert.equal(fixture.headers['Set-Cookie'], undefined)
  } finally { process.env.NEW_API_SESSION_SECRET = secret }
  assert.notEqual(await readSessionById(opaque), null)
  await fixture.auth.handleAuth(fixture.ctx)
  assert.equal(await readSessionById(opaque), null)
})

test('account bridge reads the native sealed session and only sends account authentication upstream', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://native-accounts.test/api/user/self')
    assert.equal(options.headers.get('Cookie'), null)
    assert.equal(options.headers.get('Authorization'), 'Bearer must-not-leak')
    assert.equal(options.redirect, 'error')
    return envelope()
  })
  const account = await readAccountSession(config, request())
  assert.deepEqual(account, { binding: { issuer: 'https://accounts.test', subject: '7', sessionHash: accountSessionHash(request()) },
    username: 'creator', name: 'Creator' })
  assert.doesNotMatch(JSON.stringify(account), /must-not-leak|accessToken|refreshToken|selectedKey/)
})

test('account bridge rejects missing, duplicate and malformed normal cookies before making a request', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Untrusted cookies must not be forwarded'))
  for (const cookie of ['', `octopus_new_api_session=short`, `octopus_new_api_session=${opaque}; octopus_new_api_session=${opaque}`,
    `__Host-octopus-embed-${opaque}=${opaque}`]) {
    await assert.rejects(readAccountSession(config, { headers: { cookie } }),
      { statusCode: 401, code: 'NEW_API_LOGIN_REQUIRED' })
  }
})

test('account bridge requires an authenticated stable numeric user and a bounded JSON response', async t => {
  let response = () => envelope()
  t.mock.method(globalThis, 'fetch', () => response())
  for (const id of ['7', 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    response = () => envelope({ id, username: 'creator' })
    await assert.rejects(readAccountSession(config, request()), { statusCode: 502 })
  }
  response = () => new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 502 })
  response = () => new Response('{}', { status: 401 })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 401 })
  await assert.rejects(readAccountSession(config, request()), { statusCode: 401 })
})

test('only successful account checks are cached and explicit session checks bypass the cache', async t => {
  let calls = 0, expired = false
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return expired ? new Response('{}', { status: 401 }) : envelope()
  })
  const verify = accountSessionVerifier(config)
  await verify(request())
  await verify(request())
  assert.equal(calls, 1)
  expired = true
  await assert.rejects(verify(request(), true), { statusCode: 401 })
  await assert.rejects(verify(request()), { statusCode: 401 })
  assert.equal(calls, 2, 'A revoked native session is not sent upstream again')
})

function authenticationFixture() {
  const snapshots = [], statements = []
  const mapping = { valid: true }
  const permissions = { admin: false, roles: [], assignedRoleIds: [], rootUserId: null }
  const user = { id: '7', username: 'creator', host: null, token: 'native-generation' }
  const sessionHash = accountSessionHash(request())
  const db = { async query(sql, values = []) {
    statements.push({ sql, values })
    if (sql.includes('FROM "user" u JOIN')) return { rows: [{ ...user,
      roles: permissions.admin ? [{ id: 'admin', target: 'conditional', condFormula: { type: 'isLocal' }, isAdministrator: true }] : permissions.roles,
      assignedRoleIds: permissions.assignedRoleIds, rootUserId: permissions.rootUserId }] }
    if (sql.startsWith('SELECT 1 FROM external_account')) return { rows: mapping.valid ? [{}] : [] }
    if (sql.startsWith('UPDATE external_account')) { snapshots.push(values); return { rows: [] } }
    if (sql.startsWith('SELECT id,target')) return { rows: permissions.admin
      ? [{ id: 'admin', target: 'conditional', condFormula: { type: 'isLocal' }, isAdministrator: true }] : [] }
    if (sql.includes('FROM role') || sql.includes('FROM meta')) return { rows: [] }
    assert.fail('Unexpected auth query: ' + sql)
  } }
  const redis = new Proxy({}, { get() { assert.fail('Community authentication must only use native session storage') } })
  return { auth: authServices({ db, redis, config }), user, snapshots, statements, mapping, permissions, sessionHash,
    req: { url: '/api/session', headers: { cookie: `octopus_new_api_session=${opaque}` } } }
}

test('community authentication retains identity only while the same real account session remains valid', async t => {
  let expired = false
  t.mock.method(globalThis, 'fetch', async () => expired ? new Response('{}', { status: 401 }) : envelope())
  const fixture = authenticationFixture()
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, fixture.user.id)
  expired = true
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
})

test('verified account number and username replace the private profile handle without changing ownership or roles', async t => {
  let username = 'root'
  t.mock.method(globalThis, 'fetch', async () => envelope({ id: 7, username }))
  const fixture = authenticationFixture()
  fixture.user.username = 'na_internal_profile'
  const first = (await fixture.auth.authenticate(fixture.req)).user
  assert.equal(first.id, fixture.user.id)
  assert.equal(first.accountId, '7')
  assert.equal(first.username, 'root')
  assert.equal(first.isAdmin, false, 'An upstream name must never grant the old root profile privileges')
  assert.equal(publicUser(first).accountId, '7')
  assert.doesNotMatch(JSON.stringify(publicUser(first)), /na_internal_profile|native-generation|sessionHash/)
  username = 'renamed-account'
  const refreshed = (await fixture.auth.authenticate(fixture.req)).user
  assert.equal(refreshed.id, first.id)
  assert.equal(refreshed.accountId, first.accountId)
  assert.equal(refreshed.username, username)
  assert.equal(fixture.user.username, 'na_internal_profile')
  assert.deepEqual(fixture.snapshots, [
    ['https://accounts.test', '7', '7', 'root'],
    ['https://accounts.test', '7', '7', 'renamed-account'],
  ])
})

test('legacy community cookies cannot authenticate without a valid native account session', async () => {
  for (const cookie of [`community_session=${'c'.repeat(43)}`,
    `community_session=${'c'.repeat(43)}; octopus_new_api_session=${'b'.repeat(43)}`]) {
    const fixture = authenticationFixture()
    fixture.req.headers.cookie = cookie
    assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
    assert.deepEqual(fixture.snapshots, [])
  }
})

test('a native cookie alone authenticates with current community roles and suspension rules', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = authenticationFixture()
  assert.equal((await fixture.auth.authenticate(fixture.req)).sessionHash, fixture.sessionHash)
  fixture.user.isSuspended = true
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  fixture.user.isSuspended = false
  fixture.user.id = 'oldInternalId'
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
})

test('cached native account checks still reload community administrator permissions on every request', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return envelope() })
  const fixture = authenticationFixture()
  fixture.req.url = '/api/works'
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.isAdmin, false)
  fixture.permissions.admin = true
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.isAdmin, true)
  fixture.permissions.admin = false
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.isAdmin, false)
  assert.equal(calls, 1)
})

test('authenticated media requests keep fresh permissions within two local database reads', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = authenticationFixture()
  fixture.req.method = 'GET'
  fixture.req.url = '/legacy-files/file1'
  const result = await fixture.auth.authenticate(fixture.req)
  assert.equal(result.user.id, '7')
  assert.equal(result.user.isAdmin, false)
  assert.equal(fixture.statements.length, 2)
  assert.deepEqual(fixture.statements[1], {
    sql: 'SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3',
    values: ['https://accounts.test', '7', '7'],
  })
  assert.deepEqual(fixture.snapshots, [])
})

test('PostgreSQL user permissions use one read and retain role expiry, conditional assignments and blocked-user guards',
  { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  const url = new URL(connectionString)
  assert.equal(url.pathname, '/community_follow_test')
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const client = new pg.Client({ connectionString })
  t.after(() => client.end())
  await client.connect()
  await client.query(`CREATE TEMP TABLE "user" (
    id text PRIMARY KEY, username text, name text, host text, token text, "createdAt" timestamptz,
    "isSuspended" boolean DEFAULT false, "isDeleted" boolean DEFAULT false, "movedToUri" text,
    "isLocked" boolean DEFAULT false, "isBot" boolean DEFAULT false, "isCat" boolean DEFAULT false,
    "isExplorable" boolean DEFAULT true, "followersCount" integer DEFAULT 4,
    "followingCount" integer DEFAULT 2, "notesCount" integer DEFAULT 10, "avatarId" text, "bannerId" text
  );
  CREATE TEMP TABLE user_profile ("userId" text PRIMARY KEY, description text);
  CREATE TEMP TABLE role (
    id text PRIMARY KEY, target text, "condFormula" jsonb, "isAdministrator" boolean, "isModerator" boolean
  );
  CREATE TEMP TABLE role_assignment ("userId" text, "roleId" text, "expiresAt" timestamptz);
  CREATE TEMP TABLE meta ("rootUserId" text);
  INSERT INTO "user" (id,username,name,token,"createdAt") VALUES ('7','creator','Creator','private-token',NOW());
  INSERT INTO user_profile VALUES ('7','Profile')`)
  let queries = 0
  const db = { async query(...args) {
    queries++
    const result = await client.query(...args)
    assert(result.rows.length <= 1, 'Role assignments must not duplicate the user row')
    return result
  } }
  async function read(userId = '7') {
    queries = 0
    const user = await getUser(db, userId)
    assert.equal(queries, 1)
    return user
  }
  const first = await read()
  assert.equal(first.isAdmin, false)
  assert.equal(first.isModerator, false)
  assert.equal(first.bio, 'Profile')
  for (const key of ['roles', 'assignedRoleIds', 'rootUserId', 'token']) {
    assert.equal(Object.hasOwn(first, key), false, `${key} is private permission metadata`)
    assert.equal(Object.hasOwn(publicUser(first), key), false)
  }
  assert.equal(first.tokenHash.length, 64)
  await client.query(`INSERT INTO role VALUES
    ('manual-admin','manual',NULL,true,false),
    ('ordinary','manual',NULL,false,false),
    ('conditional-moderator','conditional',$1::jsonb,false,true)`, [JSON.stringify({ type: 'and', values: [
        { type: 'isLocal' }, { type: 'followersMoreThanOrEq', value: 4 },
        { type: 'roleAssignedTo', roleId: 'ordinary' },
      ] })])
  await client.query(`INSERT INTO role_assignment VALUES
    ('7','manual-admin',NOW()-INTERVAL '1 second'),
    ('7','ordinary',NOW()+INTERVAL '1 hour'),
    ('7','ordinary',NOW()+INTERVAL '1 hour')`)
  const conditional = await read()
  assert.equal(conditional.isAdmin, false, 'Expired manual administrator assignments cannot grant privileges')
  assert.equal(conditional.isModerator, true, 'Conditional roles can reference active nonprivileged assignments')
  await client.query(`UPDATE role_assignment SET "expiresAt"=NOW()-INTERVAL '1 second' WHERE "roleId"='ordinary'`)
  assert.equal((await read()).isModerator, false)
  await client.query(`UPDATE role_assignment SET "expiresAt"=NULL WHERE "roleId"='manual-admin'`)
  const manual = await read()
  assert.equal(manual.isAdmin, true)
  assert.equal(manual.isModerator, true)
  await client.query(`DELETE FROM role_assignment WHERE "roleId"='manual-admin'`)
  assert.equal((await read()).isAdmin, false)
  await client.query(`INSERT INTO meta VALUES ('7')`)
  const root = await read()
  assert.equal(root.isAdmin, true)
  assert.equal(root.isModerator, true)
  for (const [field, value, original] of [
    ['isSuspended', true, false], ['isDeleted', true, false], ['movedToUri', 'https://moved.test', null],
    ['host', 'remote.test', null], ['token', null, 'private-token'], ['token', '', 'private-token'],
  ]) {
    await client.query(`UPDATE "user" SET "${field}"=$1 WHERE id='7'`, [value])
    assert.equal(await read(), null, `${field} must prevent even root-user authentication`)
    await client.query(`UPDATE "user" SET "${field}"=$1 WHERE id='7'`, [original])
  }
  await client.query(`DELETE FROM user_profile WHERE "userId"='7'`)
  assert.equal(await read(), null)
  assert.equal(await read('missing'), null)
})

test('session reads expire stale community cookies without minting a replacement or changing the native identity', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = authenticationFixture()
  fixture.req.method = 'GET'
  fixture.req.headers.cookie += `; community_session=${'x'.repeat(43)}`
  const user = (await fixture.auth.authenticate(fixture.req)).user
  const headers = {}
  let response
  await fixture.auth.handleAuth({ req: fixture.req, url: new URL('/api/session', config.url), user,
    res: { getHeader: key => headers[key], setHeader: (key, value) => { headers[key] = value } },
    json(status, value) { assert.equal(status, 200); response = value } })
  assert.equal(response.user.id, '7')
  assert.equal(headers['Set-Cookie'].length, 1)
  assert.match(headers['Set-Cookie'][0], /^community_session=;.*Max-Age=0/)
  assert.notEqual(await readSessionById(opaque), null)
})

test('cached native identities stop immediately after native session revocation', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return envelope() })
  const fixture = authenticationFixture()
  fixture.req.url = '/api/works'
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, '7')
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, '7')
  assert.equal(calls, 1)
  await removeSessionById(opaque)
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  assert.equal(calls, 1)
})

test('cached native identities stop immediately after native session expiry', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return envelope() })
  const fixture = authenticationFixture()
  fixture.req.url = '/api/works'
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, '7')
  const session = await readSessionById(opaque)
  await saveSession(opaque, { ...session, expiresAt: Date.now() / 1000 - 1 })
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  assert.equal(calls, 1)
})

test('native account switching selects the new community profile instead of the previous identity', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = authenticationFixture()
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, '7')
  await saveSession('b'.repeat(43), { ...(await readSessionById(opaque)), user: { id: 8, username: 'other' } })
  fixture.req.headers.cookie = `octopus_new_api_session=${'b'.repeat(43)}`
  t.mock.method(globalThis, 'fetch', async () => envelope({ id: 8, username: 'other' }))
  fixture.user.id = '8'
  assert.equal((await fixture.auth.authenticate(fixture.req)).user.id, '8')
  await removeSessionById('b'.repeat(43))
})

test('missing exact account mappings cannot persist a verified username snapshot', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = authenticationFixture()
  fixture.mapping.valid = false
  assert.deepEqual(await fixture.auth.authenticate(fixture.req), { user: null, sessionHash: null })
  assert.deepEqual(fixture.snapshots, [])
})

test('only fresh authenticated reads persist usernames and ordinary cached checks do not write', async t => {
  let username = 'first-name'
  t.mock.method(globalThis, 'fetch', async () => envelope({ id: 7, username }))
  const fixture = authenticationFixture()
  fixture.req.url = '/api/works'
  await fixture.auth.authenticate(fixture.req)
  assert.deepEqual(fixture.snapshots, [])
  fixture.req.url = '/api/session'
  username = 'current-name'
  await fixture.auth.authenticate(fixture.req)
  assert.deepEqual(fixture.snapshots, [['https://accounts.test', '7', '7', 'current-name']])
  fixture.req.url = '/api/works'
  await fixture.auth.authenticate(fixture.req)
  assert.equal(fixture.snapshots.length, 1)
})

test('numeric account IDs use the independent creation timestamp for age based roles', () => {
  const now = Date.now(), assigned = new Set()
  assert.equal(roleCondition({ type: 'createdLessThan', sec: 60 }, { id: '7', createdAt: new Date(now - 10_000) }, assigned), true)
  assert.equal(roleCondition({ type: 'createdMoreThan', sec: 3600 }, { id: '7', createdAt: new Date(now - 7200_000).toISOString() }, assigned), true)
  assert.equal(roleCondition({ type: 'createdMoreThan', sec: 3600 }, { id: '17' }, assigned), false)
  assert.equal(roleCondition({ type: 'createdLessThan', sec: 60 }, { id: '17', createdAt: 'invalid' }, assigned), false)
})

function synchronizationFixture(existing = true) {
  const response = {}, inserts = [], queries = [], snapshots = []
  const state = { numericIdOccupied: false, usernameOccupied: false, mappedUserId: '7' }
  const user = { id: '7', username: 'creator', name: 'Creator', host: null, token: 'native-generation', password: 'retained-password' }
  async function query(sql, values = []) {
    queries.push(sql)
    if (sql.startsWith('SELECT "rootUserId"')) return { rows: [{ rootUserId: 'admin123' }] }
    if (sql.includes('FROM "user" u JOIN user_profile')) return { rows: [{ ...user, roles: [], assignedRoleIds: [], rootUserId: 'admin123' }] }
    if (sql.includes('FROM role')) return { rows: [] }
    if (sql.startsWith('SELECT "userId" FROM external_account')) return { rows: existing ? [{ userId: state.mappedUserId }] : [] }
    if (sql.startsWith('SELECT id FROM "user" WHERE id=')) return { rows: state.numericIdOccupied ? [{ id: '7' }] : [] }
    if (sql.startsWith('SELECT 1 FROM "user" WHERE "usernameLower"')) return { rows: state.usernameOccupied ? [{}] : [] }
    if (sql.startsWith('UPDATE external_account')) { snapshots.push(values); return { rows: [] } }
    if (sql.startsWith('INSERT ')) { inserts.push({ sql, values }); return { rows: [] } }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
    assert.fail('Unexpected synchronization query: ' + sql)
  }
  const ctx = { req: { method: 'POST', ...request(), socket: { remoteAddress: '127.0.0.1' } },
    url: new URL('/api/account/session', config.url), body: { returnTo: '/create/image' }, config, user: null,
    db: { query, connect: async () => ({ query, release() {} }) }, redis: { eval: async () => 1 },
    newId: () => 'new123',
    json(status, value) { response.status = status; response.value = value } }
  return { ctx, response, inserts, queries, snapshots, user, state }
}

test('existing external subject reuses its profile without minting another session', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const { ctx, response, inserts, snapshots } = synchronizationFixture()
  assert.equal(await handleAccount(ctx), true)
  assert.equal(response.value.user.id, '7')
  assert.equal(response.value.user.accountId, '7')
  assert.equal(response.value.user.username, 'creator')
  assert.equal(response.value.returnTo, '/create/image')
  assert.equal(Object.hasOwn(ctx, 'createSession'), false)
  const audit = inserts.find(item => item.sql.startsWith('INSERT INTO signin'))
  assert.equal(JSON.parse(audit.values[3]).accountSessionHash, accountSessionHash(ctx.req))
  assert.equal(inserts.some(item => item.sql.startsWith('INSERT INTO "user"')), false)
  assert.deepEqual(snapshots, [['https://accounts.test', '7', '7', 'creator']])
  assert.doesNotMatch(JSON.stringify(response.value), /native-generation|retained-password|must-not-leak/)
})

test('PostgreSQL login audit accepts varchar account IDs and records each session once', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const client = new pg.Client({ connectionString })
  t.after(() => client.end())
  await client.connect()
  await client.query(`CREATE TEMP TABLE signin (
    id varchar(32) PRIMARY KEY, "userId" varchar(32) NOT NULL, ip varchar(128),
    headers jsonb NOT NULL, success boolean NOT NULL
  )`)
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const { ctx, inserts } = synchronizationFixture()
  await handleAccount(ctx)
  const audit = inserts.find(item => item.sql.startsWith('INSERT INTO signin'))
  assert(audit)
  assert.equal((await client.query(audit.sql, audit.values)).rowCount, 1)
  assert.equal((await client.query(audit.sql, audit.values)).rowCount, 0)
  assert.equal((await client.query('SELECT COUNT(*)::integer AS count FROM signin')).rows[0].count, 1)
  const nextSession = [...audit.values]
  nextSession[0] = 'next123'
  nextSession[4] = accountSessionHash(request('t'.repeat(43)))
  nextSession[3] = JSON.stringify({ ...JSON.parse(nextSession[3]), accountSessionHash: nextSession[4] })
  assert.equal((await client.query(audit.sql, nextSession)).rowCount, 1)
  assert.equal((await client.query('SELECT COUNT(*)::integer AS count FROM signin')).rows[0].count, 2)
})

test('a first login creates the user with the verified numeric subject and exact account username', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const { ctx, response, inserts, snapshots } = synchronizationFixture(false)
  ctx.body.username = 'body-must-not-be-trusted'
  ctx.body.accountId = '999'
  await handleAccount(ctx)
  const created = inserts.find(item => item.sql.startsWith('INSERT INTO "user"'))
  const binding = inserts.find(item => item.sql.startsWith('INSERT INTO external_account'))
  assert.equal(created.values[0], '7')
  assert.equal(created.values[1], 'creator')
  assert.equal(created.values[4], 'Creator')
  assert.deepEqual(binding.values, ['https://accounts.test', '7', '7'])
  assert.deepEqual(snapshots, [['https://accounts.test', '7', '7', 'creator']])
  assert.equal(response.value.user.id, '7')
  assert.equal(response.value.user.accountId, '7')
  assert.equal(response.value.user.username, 'creator')
  assert.doesNotMatch(JSON.stringify(response.value), /body-must-not-be-trusted|native-generation|retained-password|must-not-leak/)
})

test('returning account logins preserve the local nickname even when upstream display name changes', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope({ id: 7, username: 'creator', display_name: '账户中心新名称' }))
  const fixture = synchronizationFixture()
  fixture.user.name = '章鱼小白'
  await handleAccount(fixture.ctx)
  assert.equal(fixture.response.value.user.name, '章鱼小白')
  assert.equal(fixture.response.value.user.accountId, '7')
  assert.equal(fixture.response.value.user.username, 'creator')
  assert.equal(fixture.user.name, '章鱼小白')
  assert(!fixture.queries.some(sql => /^UPDATE "user"/.test(sql)))
  assert(!fixture.inserts.some(item => item.sql.startsWith('INSERT INTO "user"')))
})

test('a same-name or occupied numeric account is refused instead of adopting it or inventing another identity', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  for (const [field, code] of [['usernameOccupied', 'ACCOUNT_USERNAME_CONFLICT'], ['numericIdOccupied', 'ACCOUNT_ID_CONFLICT']]) {
    const fixture = synchronizationFixture(false)
    fixture.state[field] = true
    await assert.rejects(handleAccount(fixture.ctx), { statusCode: 409, code })
    assert.equal(fixture.queries.at(-1), 'ROLLBACK')
    assert.deepEqual(fixture.inserts, [])
    assert.deepEqual(fixture.snapshots, [])
  }
})

test('existing unmigrated random IDs are refused rather than retained behind the numeric identity', async t => {
  t.mock.method(globalThis, 'fetch', async () => envelope())
  const fixture = synchronizationFixture()
  fixture.state.mappedUserId = 'oldInternal123'
  await assert.rejects(handleAccount(fixture.ctx), { statusCode: 409, code: 'ACCOUNT_ID_MIGRATION_REQUIRED' })
  assert.deepEqual(fixture.snapshots, [])
})
