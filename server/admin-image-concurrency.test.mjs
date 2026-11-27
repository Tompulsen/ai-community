import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { handleAdmin } from './admin.ts'
import { readImageConcurrencySettings, validateImageConcurrencySettings } from './settings.ts'
import { IMAGE_CONCURRENCY_GLOBAL_MAX, IMAGE_CONCURRENCY_USER_MAX } from '../shared/studio/image-concurrency.ts'

const globalPath = '/api/admin/creation/image-concurrency'
const usersPath = `${globalPath}/users`
const allFilters = { query: '', status: 'all', mode: 'all' }
const userPath = id => `/api/admin/users/${id}/image-concurrency`
const actor = { id: 'root1', isAdmin: true }

function requestStore(t, value = '1') {
  const previous = process.env.COMMUNITY_REQUEST_STORE
  process.env.COMMUNITY_REQUEST_STORE = value
  t.after(() => { if (previous === undefined) delete process.env.COMMUNITY_REQUEST_STORE; else process.env.COMMUNITY_REQUEST_STORE = previous })
}

function request(db, user = actor, headers = { 'x-new-api-user': user?.id }) {
  return async (path = globalPath, method = 'GET', body = {}) => {
    let result
    const deny = statusCode => { throw Object.assign(new Error('Permission denied'), { statusCode }) }
    const ctx = { db, req: { method, headers }, url: new URL(path, 'https://community.test'), body, user,
      config: { url: 'https://community.test', id: 'aidx', newApiSso: { issuer: 'https://accounts.test' } },
      newId: () => randomBytes(10).toString('hex'),
      requireUser() { if (!user) deny(401); return user },
      requireAdmin() { if (!user) deny(401); if (!user.isAdmin) deny(403); return user },
      json(status, value) { assert.equal(status, 200); result = value } }
    assert.equal(await handleAdmin(ctx), true)
    return result
  }
}

test('image limits validate strict integer bounds and keep image counts separate from request counts', () => {
  assert.equal(IMAGE_CONCURRENCY_USER_MAX, 1000)
  assert.equal(IMAGE_CONCURRENCY_GLOBAL_MAX, 10000)
  const defaults = readImageConcurrencySettings(undefined)
  assert.equal(defaults.defaultLimit, 2)
  assert.equal(defaults.globalLimit, 10)
  assert.deepEqual(defaults.userOverrides, {})
  const valid = { defaultLimit: 1000, globalLimit: 1, userOverrides: { user1: 1000 } }
  assert.deepEqual(validateImageConcurrencySettings(valid), valid)
  for (const field of ['defaultLimit', 'globalLimit']) {
    const max = field === 'defaultLimit' ? IMAGE_CONCURRENCY_USER_MAX : IMAGE_CONCURRENCY_GLOBAL_MAX
    for (const value of [0, -1, 1.1, '2', null, undefined, NaN, Infinity, max + 1])
      assert.throws(() => validateImageConcurrencySettings({ ...defaults, [field]: value }), { statusCode: 400 })
  }
  for (const value of [0, 1.5, '2', null, 1001])
    assert.throws(() => validateImageConcurrencySettings({ ...defaults, userOverrides: { user1: value } }), { statusCode: 400 })
  for (const value of [null, [], {}, { ...defaults, extra: true }, { ...defaults, userOverrides: [] },
    { ...defaults, userOverrides: { 'bad/id': 1 } }])
    assert.throws(() => readImageConcurrencySettings(value), { statusCode: 400 })
})

test('saving limits requires the durable request service and never silently enables ineffective settings', async t => {
  requestStore(t, '0')
  const db = { query() { assert.fail('must not query') }, connect() { assert.fail('must not connect') } }
  await assert.rejects(request(db)(globalPath, 'PATCH', { defaultLimit: 4, globalLimit: 1000, version: 'a'.repeat(64) }), { statusCode: 503 })
  await assert.rejects(request(db)(userPath('user1'), 'PATCH', { overrideLimit: 4, version: 'a'.repeat(64) }), { statusCode: 503 })
  await assert.rejects(request(db)(usersPath, 'PATCH', { selection: { type: 'all' }, filters: allFilters, overrideLimit: 4, version: 'a'.repeat(64) }), { statusCode: 503 })
})

test('image settings require an administrator, matching account and version before storage access', async () => {
  const db = { query() { assert.fail('must not query') }, connect() { assert.fail('must not connect') } }
  for (const user of [null, { id: 'member' }, { id: 'moderator', isModerator: true }]) {
    const call = request(db, user)
    for (const path of [globalPath, userPath('member'), usersPath])
      for (const method of ['GET', 'PATCH'])
        await assert.rejects(call(path, method), { statusCode: user ? 403 : 401 })
  }
  for (const headers of [{}, { 'x-new-api-user': 'different' }])
    await assert.rejects(request(db, actor, headers)(globalPath, 'PATCH', { defaultLimit: 2, globalLimit: 1000, version: 'a'.repeat(64) }), { statusCode: 409 })
  for (const version of [undefined, '', 'stale', 1, 'a'.repeat(63)])
    await assert.rejects(request(db)(globalPath, 'PATCH', { defaultLimit: 2, globalLimit: 1000, version }), { statusCode: 400 })
  for (const body of [{ defaultLimit: 2, globalLimit: '1000' }, { defaultLimit: 0, globalLimit: 1000 },
    { defaultLimit: 2, globalLimit: 10001 }, { defaultLimit: 2, globalLimit: 1000, role: 'admin' }])
    await assert.rejects(request(db)(globalPath, 'PATCH', { ...body, version: 'a'.repeat(64) }), { statusCode: 400 })
  for (const overrideLimit of [undefined, 0, '4', 4.5, 1001])
    await assert.rejects(request(db)(userPath('member'), 'PATCH', { overrideLimit, version: 'a'.repeat(64) }), { statusCode: 400 })
})

test('bulk image limits reject invalid scope, filter, version and account binding before storage access', async () => {
  const db = { query() { assert.fail('must not query') }, connect() { assert.fail('must not connect') } }
  const body = { selection: { type: 'all' }, filters: allFilters, overrideLimit: 4, version: 'a'.repeat(64) }
  for (const headers of [{}, { 'x-new-api-user': 'different' }])
    await assert.rejects(request(db, actor, headers)(usersPath, 'PATCH', body), { statusCode: 409 })
  for (const patch of [
    { selection: null }, { selection: { type: 'all', ids: ['user1'] } }, { selection: { type: 'filtered' } },
    { selection: { type: 'ids', ids: [] } }, { selection: { type: 'ids', ids: ['user1', 'user1'] } },
    { selection: { type: 'ids', ids: ['../user1'] } }, { selection: { type: 'ids', ids: [1] } },
    { filters: undefined }, { filters: { ...allFilters, role: 'admin' } }, { filters: { ...allFilters, status: 'remote' } },
    { filters: { ...allFilters, mode: 'inherit' } }, { filters: { ...allFilters, query: 'a'.repeat(121) } },
    { version: undefined }, { version: 'old' }, { overrideLimit: undefined }, { overrideLimit: '4' },
    { overrideLimit: 0 }, { overrideLimit: 1001 }, { overrideLimit: 1.5 }, { roleIds: [] },
  ]) await assert.rejects(request(db)(usersPath, 'PATCH', { ...body, ...patch }), { statusCode: 400 })
  for (const params of ['status=remote', 'mode=inherit', 'query=' + 'a'.repeat(121)])
    await assert.rejects(request(db)(usersPath + '?' + params), { statusCode: 400 })
})

async function initialize(db) {
  for (const sql of [
    'CREATE TABLE meta (id text PRIMARY KEY,"clientOptions" jsonb,"rootUserId" text,"disableRegistration" boolean,name text,"iconUrl" text)',
    'CREATE TABLE "user" (id varchar(32) PRIMARY KEY,username text,name text,host text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false)',
    'CREATE TABLE moderation_log (id varchar(32) PRIMARY KEY,"userId" varchar(32),type text,info jsonb)',
    'CREATE TABLE external_account (issuer text,subject text,username text,"userId" varchar(32))',
  ]) await db.query(sql)
}

async function reset(db) {
  await db.query('TRUNCATE meta,"user",moderation_log,external_account')
  await db.query('INSERT INTO meta VALUES ($1,$2::jsonb,$3,false,$4,NULL)',
    ['meta1', JSON.stringify({ preserved: { privateToken: 'must-not-leak' } }), 'root1', '社区'])
  await db.query(`INSERT INTO "user" (id,username,host,"isDeleted") VALUES
    ('root1','root',NULL,false),('user1','first',NULL,false),('user2','second',NULL,false),
    ('admin25','admin',NULL,false),('remote1','remote','remote.test',false),('deleted1','deleted',NULL,true)`)
  await db.query(`INSERT INTO external_account VALUES ('https://accounts.test','1','root','root1'),('https://accounts.test','25','admin','admin25')`)
}

async function runPersistenceSuite(t, db) {
  const call = request(db)
  const row = async () => (await db.query('SELECT "clientOptions" FROM meta')).rows[0].clientOptions
  const saveGlobal = async (defaultLimit, globalLimit) => call(globalPath, 'PATCH', { defaultLimit, globalLimit, version: (await call()).version })
  const saveUser = async (id, overrideLimit) => call(userPath(id), 'PATCH', { overrideLimit, version: (await call(userPath(id))).version })
  const scenario = async (name, action) => t.test(name, async () => { await reset(db); await action() })
  await scenario('persistent defaults and user overrides survive independent reads without exposing the map', async () => {
    assert.deepEqual(Object.keys(await call()).sort(), ['defaultLimit', 'globalLimit', 'version'])
    const saved = await saveGlobal(4, 1000)
    assert.deepEqual(await request(db)(), saved)
    const user = await saveUser('user1', 7)
    assert.equal(user.overrideLimit, 7); assert.equal(user.effectiveLimit, 7); assert.equal(user.canEdit, true)
    assert.deepEqual(await request(db)(userPath('user1')), user)
    assert.equal((await call(userPath('user2'))).effectiveLimit, 4)
    assert.deepEqual(await row(), { preserved: { privateToken: 'must-not-leak' }, communityImageConcurrency: { defaultLimit: 4, globalLimit: 1000, userOverrides: { user1: 7 } } })
    for (const value of [saved, user, await call('/api/admin/settings'), await call('/api/admin/community/config'), await request(db, null)('/api/site')])
      assert(!/must-not-leak|userOverrides|privateToken/.test(JSON.stringify(value)))
    assert.deepEqual(await request(db, null)('/api/site'), { brand: '社区', logoUrl: '' })
  })
  await scenario('null removes an override and inherits future defaults while preserving other users', async () => {
    await saveUser('user1', 4); await saveUser('user2', 6)
    const resetUser = await saveUser('user1', null)
    assert.equal(resetUser.overrideLimit, null); assert.equal(resetUser.effectiveLimit, 2)
    await saveGlobal(3, 1000)
    assert.equal((await call(userPath('user1'))).effectiveLimit, 3)
    assert.equal((await call(userPath('user2'))).effectiveLimit, 6)
    assert.deepEqual((await row()).communityImageConcurrency.userOverrides, { user2: 6 })
  })
  await scenario('versions reject overwritten user or global data without conflating different users', async () => {
    const initialGlobal = await call(), initialUser = await call(userPath('user1')), otherUser = await call(userPath('user2'))
    await saveUser('user1', 9)
    assert.equal((await call()).version, initialGlobal.version)
    await assert.rejects(call(userPath('user1'), 'PATCH', { overrideLimit: 8, version: initialUser.version }), { statusCode: 409 })
    await call(userPath('user2'), 'PATCH', { overrideLimit: 8, version: otherUser.version })
    await call(globalPath, 'PATCH', { defaultLimit: 1000, globalLimit: 1, version: initialGlobal.version })
    await assert.rejects(call(globalPath, 'PATCH', { defaultLimit: 2, globalLimit: 1000, version: initialGlobal.version }), { statusCode: 409 })
    await assert.rejects(call(userPath('user2'), 'PATCH', { overrideLimit: null, version: otherUser.version }), { statusCode: 409 })
    assert.deepEqual((await row()).communityImageConcurrency, { defaultLimit: 1000, globalLimit: 1, userOverrides: { user1: 9, user2: 8 } })
  })
  await scenario('local self and administrator targets are editable by local id without role mutation', async () => {
    for (const id of ['root1', 'admin25']) {
      const saved = await saveUser(id, 4)
      assert.equal(saved.canEdit, true); assert.equal(saved.effectiveLimit, 4)
    }
    for (const id of ['1', '25', 'missing', 'deleted1'])
      await assert.rejects(call(userPath(id)), { statusCode: 404 })
    const remote = await call(userPath('remote1'))
    assert.equal(remote.canEdit, false)
    await assert.rejects(call(userPath('remote1'), 'PATCH', { overrideLimit: 4, version: remote.version }), { statusCode: 404 })
    await assert.rejects(call(userPath('deleted1'), 'PATCH', { overrideLimit: 4, version: remote.version }), { statusCode: 404 })
  })
  await scenario('successful edits are audited once with safe visible details; failed audit rolls back settings', async () => {
    await saveGlobal(4, 1000); await saveUser('user1', 6); await saveUser('user1', 6)
    const logs = (await call('/api/admin/audit')).items
    assert.equal(logs.length, 2)
    assert.deepEqual(logs.find(item => item.type === 'updateUserImageConcurrency').details, { userId: 'user1', before: null, after: 6 })
    assert.equal(logs.find(item => item.type === 'updateImageConcurrency').label, '调整图片并发默认设置')
    await db.query(`UPDATE moderation_log SET info=info||'{"prompt":"must-not-leak","userOverrides":{"private":6},"apiKey":"must-not-leak"}'::jsonb`)
    assert(!/must-not-leak|userOverrides|apiKey|prompt/.test(JSON.stringify(await call('/api/admin/audit'))))
    const before = await row()
    await db.query("ALTER TABLE moderation_log ADD CONSTRAINT reject_image_audit CHECK (type NOT IN ('updateImageConcurrency','updateUserImageConcurrency')) NOT VALID")
    try {
      await assert.rejects(saveUser('user1', 8))
      await assert.rejects(saveGlobal(5, 1000))
      assert.deepEqual(await row(), before)
    } finally { await db.query('ALTER TABLE moderation_log DROP CONSTRAINT reject_image_audit') }
  })
  await scenario('older site and community config writes preserve image settings', async () => {
    await saveGlobal(4, 1000); await saveUser('user1', 7)
    const before = (await row()).communityImageConcurrency
    const settings = await call('/api/admin/settings')
    settings.settings.brand = '新站点'
    await call('/api/admin/settings', 'PATCH', settings)
    const config = await call('/api/admin/community/config')
    await call('/api/admin/community/config', 'PATCH', { communityPublicationMode: 'after', version: config.version })
    assert.deepEqual((await row()).communityImageConcurrency, before)
    assert.equal((await request(db, null)('/api/site')).brand, '新站点')
  })
  const list = (filters = allFilters, after) => call(usersPath + '?' + new URLSearchParams({ ...filters, ...(after ? { cursor: after } : {}) }))
  const batch = (page, selection, overrideLimit) => call(usersPath, 'PATCH', { selection, filters: page.filters, overrideLimit, version: page.selectionVersion })
  const addMany = async () => db.query(`INSERT INTO "user" (id,username,"isSuspended")
    SELECT 'batch'||lpad(n::text,3,'0'),'batch-name-'||n,n%2=0 FROM generate_series(1,35) n`)
  await scenario('bulk list searches community and unified ids, usernames and names with strict local editable scope', async () => {
    await db.query(`UPDATE "user" SET name='特别昵称' WHERE id='user1'`)
    await db.query(`UPDATE "user" SET "isSuspended"=true WHERE id='user2'`)
    await db.query(`INSERT INTO external_account VALUES ('https://accounts.test','42','unified-name','user1'),('https://wrong.test','88','wrong-name','user2')`)
    await saveUser('user1', 4)
    const all = await list()
    assert.equal(all.total, 4); assert.equal(all.nextCursor, null)
    assert.deepEqual(all.items.map(item => item.id).sort(), ['admin25', 'root1', 'user1', 'user2'])
    assert(all.items.every(item => item.canEdit && item.userId === item.id && /^[a-f0-9]{64}$/.test(item.version)))
    const first = all.items.find(item => item.id === 'user1')
    assert.equal(first.username, 'unified-name'); assert.equal(first.accountId, '42'); assert.equal(first.name, '特别昵称')
    assert.equal(first.overrideLimit, 4); assert.equal(first.effectiveLimit, 4)
    for (const query of ['user1', '42', 'first', 'unified-name', '特别昵称'])
      assert.deepEqual((await list({ ...allFilters, query })).items.map(item => item.id), ['user1'])
    for (const query of ['88', 'wrong-name', '%', '_', 'missing']) assert.equal((await list({ ...allFilters, query })).total, 0)
    assert.equal((await list({ ...allFilters, status: 'active' })).total, 3)
    assert.deepEqual((await list({ ...allFilters, status: 'suspended' })).items.map(item => item.id), ['user2'])
    assert.deepEqual((await list({ ...allFilters, mode: 'override' })).items.map(item => item.id), ['user1'])
    assert.equal((await list({ ...allFilters, mode: 'default' })).total, 3)
    assert(!/userOverrides|privateToken|must-not-leak/.test(JSON.stringify(all)))
  })
  await scenario('cursor binds every page to the same filter and full matching snapshot', async () => {
    await addMany()
    const filters = { ...allFilters, query: 'batch' }, first = await list(filters), second = await list(filters, first.nextCursor)
    assert.equal(first.total, 35); assert.equal(first.items.length, 30); assert.equal(second.items.length, 5)
    assert.equal(second.nextCursor, null); assert.equal(first.selectionVersion, second.selectionVersion)
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 35)
    await assert.rejects(list({ ...filters, status: 'active' }, first.nextCursor), { statusCode: 409 })
    for (const value of ['bad@cursor', Buffer.from(JSON.stringify({ id: 'missing', version: first.selectionVersion })).toString('base64url')])
      await assert.rejects(list(filters, value), { statusCode: 400 })
    await db.query(`INSERT INTO "user" (id,username) VALUES ('batch036','batch-name-36')`)
    await assert.rejects(list(filters, first.nextCursor), { statusCode: 409 })
    await assert.rejects(batch(first, { type: 'all' }, 8), { statusCode: 409 })
    assert.equal((await db.query('SELECT count(*)::int AS count FROM moderation_log')).rows[0].count, 0)
  })
  await scenario('bulk selection edits protected administrators by local id without changing account or role data', async () => {
    const usersBefore = (await db.query('SELECT * FROM "user" ORDER BY id')).rows
    const accountsBefore = (await db.query('SELECT * FROM external_account ORDER BY subject')).rows
    const saved = await batch(await list(), { type: 'ids', ids: ['root1', 'admin25', 'user1'] }, 7)
    assert.deepEqual(saved, { selectedCount: 3, updatedCount: 3 })
    assert.deepEqual((await row()).communityImageConcurrency.userOverrides, { root1: 7, admin25: 7, user1: 7 })
    assert.equal((await call(userPath('user2'))).effectiveLimit, 2)
    assert.deepEqual((await db.query('SELECT * FROM "user" ORDER BY id')).rows, usersBefore)
    assert.deepEqual((await db.query('SELECT * FROM external_account ORDER BY subject')).rows, accountsBefore)
    const logs = (await call('/api/admin/audit')).items
    assert.equal(logs.length, 1); assert.equal(logs[0].type, 'updateUserImageConcurrencyBatch')
    assert.deepEqual(logs[0].details, { selectionType: 'ids', selectedCount: 3, updatedCount: 3, after: 7 })
    const changes = (await db.query('SELECT info FROM moderation_log')).rows[0].info.changes
    assert.equal(changes.length, 3); assert(changes.every(change => change.before === null && change.after === 7))
  })
  await scenario('all filtered results include later pages and never touch unmatched users', async () => {
    await addMany()
    const filters = { ...allFilters, query: 'batch' }, page = await list(filters)
    assert.deepEqual(await batch(page, { type: 'all' }, 6), { selectedCount: 35, updatedCount: 35 })
    assert.equal(Object.keys((await row()).communityImageConcurrency.userOverrides).length, 35)
    assert.equal((await call(userPath('user1'))).overrideLimit, null)
    const active = await list({ ...filters, status: 'active', mode: 'override' })
    assert.deepEqual(await batch(active, { type: 'all' }, null), { selectedCount: 18, updatedCount: 18 })
    assert.equal(Object.keys((await row()).communityImageConcurrency.userOverrides).length, 17)
    assert.equal((await list({ ...filters, mode: 'default' })).total, 18)
  })
  await scenario('bulk no-op avoids writes and audit while clearing overrides preserves defaults and other users', async () => {
    await saveUser('user1', 7); await saveUser('user2', 9)
    const page = await list(), before = await row(), logs = (await db.query('SELECT * FROM moderation_log ORDER BY id')).rows
    assert.deepEqual(await batch(page, { type: 'ids', ids: ['user1'] }, 7), { selectedCount: 1, updatedCount: 0 })
    assert.equal((await list()).selectionVersion, page.selectionVersion)
    assert.deepEqual(await row(), before); assert.deepEqual((await db.query('SELECT * FROM moderation_log ORDER BY id')).rows, logs)
    assert.deepEqual(await batch(page, { type: 'ids', ids: ['root1', 'user1'] }, null), { selectedCount: 2, updatedCount: 1 })
    assert.deepEqual((await row()).communityImageConcurrency, { defaultLimit: 2, globalLimit: 10, userOverrides: { user2: 9 } })
    await saveGlobal(4, 500)
    assert.equal((await call(userPath('user1'))).effectiveLimit, 4)
  })
  await scenario('missing, remote, deleted or out-of-filter batch targets roll back the whole selection', async () => {
    const page = await list(), before = await row()
    for (const id of ['1', '25', 'missing', 'remote1', 'deleted1'])
      await assert.rejects(batch(page, { type: 'ids', ids: ['user1', id] }, 8), { statusCode: 409 })
    const narrow = await list({ ...allFilters, query: 'user1' })
    await assert.rejects(batch(narrow, { type: 'ids', ids: ['user1', 'user2'] }, 8), { statusCode: 409 })
    const empty = await list({ ...allFilters, query: 'missing' })
    await assert.rejects(batch(empty, { type: 'all' }, 8), { statusCode: 400 })
    assert.deepEqual(await row(), before)
    assert.equal((await db.query('SELECT count(*)::int AS count FROM moderation_log')).rows[0].count, 0)
  })
  await scenario('stale matching status, deletion, user amount and defaults never overwrite concurrent edits', async () => {
    for (const change of [
      () => db.query(`UPDATE "user" SET "isSuspended"=true WHERE id='user1'`),
      () => db.query(`UPDATE "user" SET "isDeleted"=true WHERE id='user1'`),
      () => saveUser('user1', 9), () => saveGlobal(4, 500),
    ]) {
      await reset(db)
      const page = await list()
      await change()
      const before = await row()
      await assert.rejects(batch(page, { type: 'all' }, 8), { statusCode: 409 })
      assert.deepEqual(await row(), before)
    }
  })
  await scenario('failed bulk audit atomically rolls back every edited amount and retains unrelated settings', async () => {
    const page = await list(), before = await row()
    await db.query("ALTER TABLE moderation_log ADD CONSTRAINT reject_bulk_audit CHECK (type <> 'updateUserImageConcurrencyBatch') NOT VALID")
    try {
      await assert.rejects(batch(page, { type: 'all' }, 8))
      assert.deepEqual(await row(), before)
      assert.equal((await db.query('SELECT count(*)::int AS count FROM moderation_log')).rows[0].count, 0)
    } finally { await db.query('ALTER TABLE moderation_log DROP CONSTRAINT reject_bulk_audit') }
  })
}

test('image concurrency persistence, permissions and audit use real PostgreSQL SQL via PGlite', async t => {
  requestStore(t)
  const storage = new PGlite()
  const db = { query: (sql, parameters) => storage.query(sql, parameters),
    async connect() { return { query: db.query, release() {} } } }
  t.after(() => storage.close())
  await initialize(db)
  await runPersistenceSuite(t, db)
})

test('image concurrency PostgreSQL transactions retain concurrent administrator changes', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  requestStore(t)
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const schema = `image_limits_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Pool({ connectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 2000, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
  await initialize(db)
  await runPersistenceSuite(t, db)
  await t.test('different users merge while competing writes to the same user conflict', async () => {
    await reset(db)
    const call = request(db), first = await call(userPath('user1')), second = await call(userPath('user2'))
    await Promise.all([
      call(userPath('user1'), 'PATCH', { overrideLimit: 4, version: first.version }),
      call(userPath('user2'), 'PATCH', { overrideLimit: 8, version: second.version }),
    ])
    assert.equal((await call(userPath('user1'))).effectiveLimit, 4)
    assert.equal((await call(userPath('user2'))).effectiveLimit, 8)
    const current = await call(userPath('user1'))
    const outcomes = await Promise.allSettled([5, 6].map(overrideLimit => call(userPath('user1'), 'PATCH', { overrideLimit, version: current.version })))
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.statusCode, 409)
    const logs = await db.query('SELECT count(*)::int AS count FROM moderation_log')
    assert.equal(logs.rows[0].count, 3)
  })
  await t.test('concurrent batches and single-user edits serialize and reject an obsolete whole-filter snapshot', async () => {
    await reset(db)
    const call = request(db), page = await call(usersPath)
    const outcomes = await Promise.allSettled([5, 6].map(overrideLimit => call(usersPath, 'PATCH', {
      selection: { type: 'all' }, filters: page.filters, overrideLimit, version: page.selectionVersion,
    })))
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.statusCode, 409)
    const values = (await db.query('SELECT "clientOptions" FROM meta')).rows[0].clientOptions.communityImageConcurrency.userOverrides
    assert.equal(Object.keys(values).length, 4); assert.equal(new Set(Object.values(values)).size, 1)
    assert.equal((await db.query('SELECT count(*)::int AS count FROM moderation_log')).rows[0].count, 1)
    const stale = await call(usersPath), target = await call(userPath('user1'))
    await call(userPath('user1'), 'PATCH', { overrideLimit: 10, version: target.version })
    await assert.rejects(call(usersPath, 'PATCH', { selection: { type: 'all' }, filters: stale.filters, overrideLimit: 8, version: stale.selectionVersion }), { statusCode: 409 })
    assert.equal((await call(userPath('user1'))).effectiveLimit, 10)
  })
  await t.test('batch holds target account locks until commit so concurrent suspension cannot enter midway', async () => {
    await reset(db)
    let reached, release
    const ready = new Promise(resolve => { reached = resolve }), gate = new Promise(resolve => { release = resolve })
    const wrapped = { query: db.query.bind(db), async connect() {
      const client = await db.connect()
      return { release: () => client.release(), async query(sql, parameters) {
        if (sql.startsWith('INSERT INTO moderation_log')) { reached(); await gate }
        return client.query(sql, parameters)
      } }
    } }
    const call = request(wrapped), page = await call(usersPath), other = await db.connect()
    try {
      const saving = call(usersPath, 'PATCH', { selection: { type: 'ids', ids: ['user1', 'user2'] }, filters: page.filters, overrideLimit: 8, version: page.selectionVersion })
      await ready
      await other.query('BEGIN')
      await other.query("SET LOCAL lock_timeout='100ms'")
      await assert.rejects(other.query(`UPDATE "user" SET "isSuspended"=true WHERE id='user1'`), { code: '55P03' })
      await other.query('ROLLBACK')
      release()
      assert.deepEqual(await saving, { selectedCount: 2, updatedCount: 2 })
      await other.query(`UPDATE "user" SET "isSuspended"=true WHERE id='user1'`)
      assert.equal((await db.query(`SELECT "isSuspended" FROM "user" WHERE id='user1'`)).rows[0].isSuspended, true)
    } finally { release(); await other.query('ROLLBACK'); other.release() }
  })
})
