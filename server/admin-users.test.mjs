import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { handleAdmin } from './admin.ts'

function request(db, actor = { id: 'root1', isAdmin: true }) {
  return async (path, method = 'GET', body = {}) => {
    let result
    const deny = statusCode => { throw Object.assign(new Error('Permission denied'), { statusCode }) }
    const ctx = { db, req: { method }, url: new URL(path, 'https://community.test'), body, user: actor,
      config: { url: 'https://community.test', id: 'aidx', newApiSso: { issuer: 'https://accounts.test' } },
      newId: () => randomBytes(10).toString('hex'),
      requireUser() { if (!actor) deny(401); return actor },
      requireAdmin() { if (!actor) deny(401); if (!actor.isAdmin) deny(403); return actor },
      json(status, value) { assert.equal(status, 200); result = value } }
    assert.equal(await handleAdmin(ctx), true)
    return result
  }
}

test('user management denies nonadministrators and malformed filters before reading private data', async () => {
  const db = { query() { assert.fail('must not query') } }
  for (const actor of [null, { id: 'u1', isAdmin: false, isModerator: true }]) {
    const call = request(db, actor)
    for (const path of ['/api/admin/users', '/api/admin/users/u1', '/api/admin/users/u1/logins']) await assert.rejects(call(path), { statusCode: actor ? 403 : 401 })
    for (const section of ['note', 'media']) await assert.rejects(call(`/api/admin/users/u1/${section}`, 'PATCH', {}), { statusCode: actor ? 403 : 401 })
  }
  const call = request(db)
  for (const query of ['sort=unsafe', 'origin=bad', 'status=bad', 'cursor=not-json']) await assert.rejects(call(`/api/admin/users?${query}`), { statusCode: 400 })
  for (const body of [{ moderationNote: 'x' }, { moderationNote: 'x'.repeat(8193), version: 'a'.repeat(64) }, { moderationNote: 'x', version: 'a'.repeat(64), password: 'forbidden' }]) await assert.rejects(call('/api/admin/users/u1/note', 'PATCH', body), { statusCode: 400 })
  await assert.rejects(call('/api/admin/users/u1/media', 'PATCH', { clear: 'all', version: 'a'.repeat(64) }), { statusCode: 400 })
})

test('user management PostgreSQL pagination, private details, protected mutations and conflict rollback', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const schema = `admin_users_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Pool({ connectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
  await db.query(`CREATE TABLE "user" (id varchar(32) PRIMARY KEY,username text,name text,host text,"createdAt" timestamptz,"lastActiveDate" timestamptz,
    "updatedAt" timestamptz,"avatarId" varchar(32),"bannerId" varchar(32),"isSuspended" boolean DEFAULT false,"isDeleted" boolean DEFAULT false,
    "isLocked" boolean DEFAULT false,"isBot" boolean DEFAULT false,"isCat" boolean DEFAULT false,"isExplorable" boolean DEFAULT true,
    "followersCount" int DEFAULT 0,"followingCount" int DEFAULT 0,"notesCount" int DEFAULT 0,"communityViolationCount" int DEFAULT 4,"communityViolationBaseline" int DEFAULT 1);
    CREATE TABLE user_profile ("userId" varchar(32) PRIMARY KEY,"moderationNote" varchar(8192) NOT NULL DEFAULT '',password text DEFAULT 'private-password',email text);
    CREATE TABLE meta ("rootUserId" varchar(32));
    CREATE TABLE role (id varchar(32),target text,"condFormula" jsonb,"isAdministrator" boolean,"isModerator" boolean);
    CREATE TABLE role_assignment ("userId" varchar(32),"roleId" varchar(32),"expiresAt" timestamptz);
    CREATE TABLE external_account (issuer text,subject text,username text,"userId" varchar(32));
    CREATE TABLE signin (id varchar(32),"userId" varchar(32),ip text,headers jsonb,success boolean);
    CREATE TABLE moderation_log (id varchar(32),"userId" varchar(32),type text,info jsonb);
    INSERT INTO meta VALUES ('root1');
    INSERT INTO "user" (id,username,"createdAt","lastActiveDate") SELECT 'u'||lpad(i::text,3,'0'),'internal'||i,
      '2026-11-21T01:00:00Z'::timestamptz+i*interval '1 microsecond',CASE WHEN i>31 THEN NULL ELSE '2026-11-20T01:00:00Z'::timestamptz+i*interval '1 microsecond' END FROM generate_series(1,65) i;
    INSERT INTO "user" (id,username,host,"createdAt") VALUES ('root1','root',NULL,'2026-10-01'),('remote1','remote','remote.test','2026-10-01');
    INSERT INTO user_profile ("userId") SELECT id FROM "user";
    INSERT INTO external_account VALUES ('https://accounts.test','17','public-renamed','u001'),('https://other.test','999','wrong-issuer','u001');
    INSERT INTO signin VALUES ('a000000000000001','u001','192.0.2.1','{"user-agent":"Test Browser","accountSessionHash":"secret-session","cookie":"secret-cookie"}',true);
    UPDATE "user" SET "avatarId"='image1',"bannerId"='image2' WHERE id='u001';`)
  const call = request(db)
  await t.test('all four sorts page with microseconds, ties and nulls without omissions', async () => {
    for (const sort of ['created-desc', 'created-asc', 'active-desc', 'active-asc']) {
      const ids = [], times = []; let cursor
      for (let page = 0; page < 5; page++) {
        const result = await call(`/api/admin/users?sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`)
        ids.push(...result.items.map(row => row.id)); times.push(...result.items.map(row => sort.startsWith('created') ? row.createdAt : row.lastActiveDate))
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      assert.equal(ids.length, 66, sort); assert.equal(new Set(ids).size, 66, sort); assert(!ids.includes('remote1'))
      if (sort.startsWith('active')) { const firstNull = times.indexOf(null); assert(firstNull > 0); assert(times.slice(firstNull).every(value => value === null)) }
    }
    const first = await call('/api/admin/users')
    await assert.rejects(call(`/api/admin/users?status=active&cursor=${first.nextCursor}`), { statusCode: 400 })
    await db.query('DELETE FROM "user" WHERE id=$1', [first.items.at(-1).id])
    assert((await call(`/api/admin/users?cursor=${first.nextCursor}`)).items.length > 0)
  })
  await t.test('filters use mapped public identity and keep source boundaries', async () => {
    for (const query of ['public-renamed', '17']) {
      const result = await call(`/api/admin/users?query=${query}`)
      assert(result.items.some(row => row.id === 'u001' && row.username === 'public-renamed' && row.accountId === '17'))
    }
    assert.equal((await call('/api/admin/users?query=wrong-issuer')).items.length, 0)
    assert.deepEqual((await call('/api/admin/users?origin=remote&host=remote.test')).items.map(row => row.id), ['remote1'])
    await db.query('UPDATE "user" SET "isSuspended"=true WHERE id=\'u002\'')
    assert.deepEqual((await call('/api/admin/users?status=suspended')).items.map(row => row.id), ['u002'])
  })
  await t.test('details and login records expose only allowed private fields', async () => {
    const detail = (await call('/api/admin/users/u001')).user
    assert.equal(detail.accountId, '17'); assert.equal(detail.canEditNote, true); assert.equal(detail.violationCount, 4)
    assert.equal((await call('/api/admin/users/remote1')).user.canEditNote, false)
    const logins = await call('/api/admin/users/u001/logins')
    assert.equal(logins.items[0].ip, '192.0.2.1'); assert.equal(logins.items[0].userAgent, 'Test Browser')
    assert(!/secret-|password|headers|accountSessionHash/.test(JSON.stringify({ detail, logins })))
  })
  await t.test('notes are versioned, audited and transactionally rolled back on audit failure', async () => {
    const before = (await call('/api/admin/users/u001')).user
    const saved = await call('/api/admin/users/u001/note', 'PATCH', { moderationNote: '管理员内部笔记', version: before.noteVersion })
    assert.equal(saved.moderationNote, '管理员内部笔记')
    await assert.rejects(call('/api/admin/users/u001/note', 'PATCH', { moderationNote: 'stale', version: before.noteVersion }), { statusCode: 409 })
    await db.query("ALTER TABLE moderation_log ADD CONSTRAINT reject_note_audit CHECK (type <> 'updateUserModerationNote') NOT VALID")
    await assert.rejects(call('/api/admin/users/u001/note', 'PATCH', { moderationNote: 'must rollback', version: saved.noteVersion }))
    assert.equal((await call('/api/admin/users/u001')).user.moderationNote, saved.moderationNote)
    await db.query('ALTER TABLE moderation_log DROP CONSTRAINT reject_note_audit')
  })
  await t.test('suspension and media protect admins, reject stale changes and preserve history', async () => {
    await db.query(`INSERT INTO role VALUES ('admin','manual',NULL,true,false); INSERT INTO role_assignment VALUES ('u003','admin',NULL)`)
    for (const id of ['root1', 'u003']) {
      const target = (await call(`/api/admin/users/${id}`)).user
      assert(target.isProtected)
      await assert.rejects(call(`/api/admin/users/${id}`, 'PATCH', { isSuspended: true, reason: 'protected', version: target.statusVersion }), { statusCode: 403 })
      await assert.rejects(call(`/api/admin/users/${id}/media`, 'PATCH', { clear: 'avatar', version: target.mediaVersion }), { statusCode: 403 })
    }
    const before = (await call('/api/admin/users/u001')).user
    const banned = (await call('/api/admin/users/u001', 'PATCH', { isSuspended: true, reason: '违规', version: before.statusVersion })).user
    await assert.rejects(call('/api/admin/users/u001', 'PATCH', { isSuspended: false, version: before.statusVersion }), { statusCode: 409 })
    const restored = (await call('/api/admin/users/u001', 'PATCH', { isSuspended: false, version: banned.statusVersion })).user
    assert.equal(restored.violationCount, 4); assert.equal(restored.violationBaseline, 4)
    const cleared = (await call('/api/admin/users/u001/media', 'PATCH', { clear: 'avatar', version: before.mediaVersion })).user
    assert.equal(cleared.avatarUrl, null); assert(cleared.bannerUrl.includes('image2'))
    await assert.rejects(call('/api/admin/users/u001/media', 'PATCH', { clear: 'banner', version: before.mediaVersion }), { statusCode: 409 })
    await assert.rejects(call('/api/admin/users/remote1/note', 'PATCH', { moderationNote: 'remote', version: before.noteVersion }), { statusCode: 404 })
    assert.equal((await db.query('SELECT count(*)::int AS count FROM moderation_log WHERE type=\'clearUserProfileMedia\'')).rows[0].count, 1)
  })
})
