import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { handleFollowing, needsFollowApproval } from './following.ts'

const defaultPrivacy = { isLocked: false, autoAcceptFollowed: false, followApprovalLocalSeconds: null, followingVisibility: 'public', followersVisibility: 'public', carefulBot: false }
test('approval uses joining time, explicit locking and reciprocal-follow exemption', () => {
  const now = Date.parse('2026-11-14T12:00:00Z'), actor = { createdAt: new Date(now - 3600000), isBot: false }
  assert.equal(needsFollowApproval(defaultPrivacy, actor, false, now), false)
  assert.equal(needsFollowApproval({ ...defaultPrivacy, isLocked: true }, actor, false, now), true)
  assert.equal(needsFollowApproval({ ...defaultPrivacy, followApprovalLocalSeconds: 7200 }, actor, false, now), true)
  assert.equal(needsFollowApproval({ ...defaultPrivacy, followApprovalLocalSeconds: 3600 }, actor, false, now), false)
  assert.equal(needsFollowApproval({ ...defaultPrivacy, isLocked: true, autoAcceptFollowed: true }, actor, true, now), false)
  assert.equal(needsFollowApproval({ ...defaultPrivacy, carefulBot: true }, { ...actor, isBot: true }, false, now), true)
})

function context(db, path, body = {}, actor = '41', method = 'POST', expectedAccount = actor) {
  const result = {}, notices = []
  return { db, req: { method, headers: { 'x-new-api-user': expectedAccount } }, body,
    url: new URL(path, 'https://community.test'), user: actor ? { id: actor, accountId: actor } : null,
    config: { url: 'https://community.test', newApiSso: { issuer: 'https://account.test' } }, result, notices,
    redis: { xadd: async (...args) => { notices.push(JSON.parse(args.at(-1))); return '1-0' } },
    newId: () => `test${String(++sequence).padStart(12, '0')}`,
    requireUser() { if (!this.user) throw Object.assign(new Error('请先登录'), { statusCode: 401 }); return this.user },
    json(status, payload) { result.status = status; result.payload = payload },
  }
}
let sequence = 0
test('anonymous writes and cross-tab account mismatch fail before querying', async () => {
  const db = { query() { assert.fail('must reject before DB access') }, connect() { assert.fail('must reject before transaction') } }
  for (const [path, body, method] of [
    ['/api/users/25/follow', { active: true }, 'POST'], ['/api/users/25/remove-follower', {}, 'POST'],
    ['/api/follow-requests/request1', { action: 'accept' }, 'POST'], ['/api/account/privacy', defaultPrivacy, 'PATCH'],
  ]) {
    await assert.rejects(handleFollowing(context(db, path, body, null, method)), { statusCode: 401 })
    await assert.rejects(handleFollowing(context(db, path, body, '41', method, '25')), { statusCode: 409 })
    await assert.rejects(handleFollowing(context(db, path, body, '41', method, '')), { statusCode: 409 })
  }
})

// A disposable PostgreSQL database runs the SQL, constraints and competing transactions.
// Never point this at an application database; the name and empty schema are both checked.
test('following PostgreSQL regressions', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const db = new pg.Pool({ connectionString, max: 8 })
  t.after(() => db.end())
  assert.equal((await db.query("SELECT to_regclass('public.user') AS existing")).rows[0].existing, null, 'database must be empty')
  await db.query(`
    CREATE TABLE "user" (id varchar(32) PRIMARY KEY, username text NOT NULL, name text, "avatarId" varchar(32), host text,
      "isDeleted" boolean NOT NULL DEFAULT false, "isSuspended" boolean NOT NULL DEFAULT false, "movedToUri" text,
      "isLocked" boolean NOT NULL DEFAULT false, "isBot" boolean NOT NULL DEFAULT false, "createdAt" timestamptz NOT NULL DEFAULT now(),
      "followersCount" int NOT NULL DEFAULT 0, "followingCount" int NOT NULL DEFAULT 0);
    CREATE TABLE user_profile ("userId" varchar(32) PRIMARY KEY REFERENCES "user", "autoAcceptFollowed" boolean NOT NULL DEFAULT false,
      "carefulBot" boolean NOT NULL DEFAULT false, "followApprovalLocalSeconds" int,
      "followingVisibility" text NOT NULL DEFAULT 'public', "followersVisibility" text NOT NULL DEFAULT 'public',
      "notificationRecieveConfig" jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE following (id varchar(32) PRIMARY KEY, "followerId" varchar(32) REFERENCES "user", "followeeId" varchar(32) REFERENCES "user", UNIQUE("followerId","followeeId"));
    CREATE TABLE follow_request (LIKE following INCLUDING ALL);
    CREATE TABLE blocking ("blockerId" varchar(32), "blockeeId" varchar(32));
    CREATE TABLE muting ("muterId" varchar(32), "muteeId" varchar(32), "expiresAt" timestamptz);
    CREATE TABLE external_account (issuer text, subject text, "userId" varchar(32), username text);
  `)
  async function reset(locked = false) {
    await db.query('TRUNCATE following,follow_request,blocking,muting,external_account,user_profile,"user" CASCADE')
    await db.query(`INSERT INTO "user" (id,username) SELECT id,id FROM unnest(ARRAY['25','41','42','43']) id;
      INSERT INTO user_profile ("userId") SELECT id FROM "user"`)
    await db.query('UPDATE "user" SET "isLocked"=$1 WHERE id=\'25\'', [locked])
  }
  async function call(path, body = {}, actor = '41', method = 'POST') {
    const ctx = context(db, path, body, actor, method)
    assert.equal(await handleFollowing(ctx), true)
    return ctx
  }
  const follow = (active = true, actor = '41', target = '25') => call(`/api/users/${target}/follow`, { active }, actor)
  const counts = async () => (await db.query('SELECT id,"followersCount","followingCount" FROM "user" ORDER BY id')).rows
  await t.test('concurrent duplicate follow/unfollow updates counts and notifications only once', async () => {
    await reset()
    const results = await Promise.all(Array.from({ length: 5 }, () => follow()))
    assert.equal(results.reduce((n, ctx) => n + ctx.notices.length, 0), 1)
    assert.equal((await counts())[0].followersCount, 1)
    assert.equal((await counts())[1].followingCount, 1)
    assert(results.every(ctx => ctx.result.payload.followed && !ctx.result.payload.requested))
    await Promise.all(Array.from({ length: 5 }, () => follow(false)))
    assert((await counts()).every(row => row.followersCount === 0 && row.followingCount === 0))
  })
  await t.test('locked accounts request, cancel and approve with ownership checks', async () => {
    await reset(true)
    const pending = await follow()
    assert.equal(pending.result.payload.requested, true)
    assert.equal(pending.result.payload.followed, false)
    assert.equal((await counts())[0].followersCount, 0)
    assert.equal((await follow()).notices.length, 0)
    let request = (await db.query('SELECT id FROM follow_request')).rows[0].id
    await assert.rejects(call(`/api/follow-requests/${request}`, { action: 'accept' }, '42'), { statusCode: 404 })
    await assert.rejects(call(`/api/follow-requests/${request}`, { action: 'cancel' }, '25'), { statusCode: 404 })
    await follow(false)
    await assert.rejects(call(`/api/follow-requests/${request}`, { action: 'accept' }, '25'), { statusCode: 404 })
    await follow()
    const fresh = (await db.query('SELECT id FROM follow_request')).rows[0].id
    assert.notEqual(fresh, request)
    const accepted = await call(`/api/follow-requests/${fresh}`, { action: 'accept' }, '25')
    assert.equal(accepted.result.payload.followsYou, true)
    assert.equal(accepted.notices[0].type, 'followRequestAccepted')
    assert.equal((await counts())[0].followersCount, 1)
    assert.equal((await db.query('SELECT * FROM follow_request')).rowCount, 0)
  })
  await t.test('reject/cancel and remove-follower affect only the requested direction', async () => {
    await reset(true)
    await follow(); let request = (await db.query('SELECT id FROM follow_request')).rows[0].id
    await call(`/api/follow-requests/${request}`, { action: 'reject' }, '25')
    await follow(); request = (await db.query('SELECT id FROM follow_request')).rows[0].id
    await call(`/api/follow-requests/${request}`, { action: 'cancel' })
    await db.query('UPDATE "user" SET "isLocked"=false')
    await follow(); await follow(true, '25', '41')
    const removed = await call('/api/users/41/remove-follower', {}, '25')
    assert.equal(removed.result.payload.followed, true)
    assert.equal(removed.result.payload.followsYou, false)
    assert.equal(removed.result.payload.viewerFollowersCount, 0)
    assert.equal(removed.result.payload.viewerFollowingCount, 1)
  })
  await t.test('approval/cancellation race leaves counts consistent and no orphan request', async () => {
    await reset(true); await follow()
    const request = (await db.query('SELECT id FROM follow_request')).rows[0].id
    const actions = await Promise.allSettled([call(`/api/follow-requests/${request}`, { action: 'accept' }, '25'), follow(false)])
    for (const action of actions) if (action.status === 'rejected') assert.equal(action.reason.statusCode, 404)
    assert((await counts()).every(row => row.followersCount === 0 && row.followingCount === 0))
    assert.equal((await db.query('SELECT * FROM follow_request')).rowCount, 0)
  })
  await t.test('self, blocked, unavailable and malformed actions leave no writes', async () => {
    await reset()
    await assert.rejects(follow(true, '25'), { statusCode: 400 })
    await assert.rejects(call('/api/users/25/follow', { active: 'true' }), { statusCode: 400 })
    await db.query('INSERT INTO blocking VALUES (\'25\',\'41\')')
    await assert.rejects(follow(), { statusCode: 403 })
    await db.query('DELETE FROM blocking; UPDATE "user" SET "isSuspended"=true WHERE id=\'25\'')
    await assert.rejects(follow(), { statusCode: 404 })
    assert.equal((await db.query('SELECT * FROM following')).rowCount, 0)
  })
  await t.test('privacy validation, stale version and unlock preserve pending requests', async () => {
    await reset(true); await follow()
    const first = (await call('/api/account/privacy', {}, '25', 'GET')).result.payload
    const input = { ...first.settings, version: first.version, isLocked: false, followersVisibility: 'private' }
    await assert.rejects(call('/api/account/privacy', { ...input, admin: true }, '25', 'PATCH'), { statusCode: 400 })
    await assert.rejects(call('/api/account/privacy', { ...input, followApprovalLocalSeconds: -1 }, '25', 'PATCH'), { statusCode: 400 })
    await call('/api/account/privacy', input, '25', 'PATCH')
    await assert.rejects(call('/api/account/privacy', input, '25', 'PATCH'), { statusCode: 409 })
    assert.equal((await db.query('SELECT * FROM follow_request')).rowCount, 1)
    assert.equal((await db.query('SELECT * FROM following')).rowCount, 0)
  })
  await t.test('newcomer approval and auto-accept follow production columns', async () => {
    await reset(); await db.query('UPDATE user_profile SET "followApprovalLocalSeconds"=86400 WHERE "userId"=\'25\'')
    assert.equal((await follow()).result.payload.requested, true)
    await follow(false); await follow(true, '25', '41')
    await db.query('UPDATE user_profile SET "autoAcceptFollowed"=true WHERE "userId"=\'25\'')
    assert.equal((await follow()).result.payload.followed, true)
  })
  await t.test('follow waiting for privacy save reads the newly committed approval rule', async () => {
    await reset()
    const privacy = await db.connect()
    let pending
    try {
      await privacy.query('BEGIN')
      await privacy.query('SELECT id FROM "user" WHERE id=\'25\' FOR UPDATE')
      await privacy.query('UPDATE user_profile SET "followApprovalLocalSeconds"=86400 WHERE "userId"=\'25\'')
      pending = follow()
      let waiting = false
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows.length > 0
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert(waiting, 'follow must wait for the privacy transaction')
      await privacy.query('COMMIT')
    } finally { await privacy.query('ROLLBACK'); privacy.release() }
    const result = await pending
    assert.equal(result.result.payload.requested, true)
    assert.equal(result.result.payload.followed, false)
  })
  await t.test('request lists paginate and exclude blocked and other-owner requests', async () => {
    await reset(true)
    await db.query(`INSERT INTO "user" (id,username) SELECT 'extra'||i,'creator'||i FROM generate_series(1,32) i;
      INSERT INTO follow_request (id,"followerId","followeeId") SELECT 'r'||lpad(i::text,4,'0'),'extra'||i,'25' FROM generate_series(1,32) i;
      INSERT INTO blocking VALUES ('25','extra32')`)
    const first = (await call('/api/follow-requests', {}, '25', 'GET')).result.payload
    assert.equal(first.total, 31); assert.equal(first.items.length, 30); assert(first.nextCursor)
    const next = (await call(`/api/follow-requests?cursor=${first.nextCursor}`, {}, '25', 'GET')).result.payload
    assert.equal(next.items.length, 1); assert.equal(next.nextCursor, null)
    assert.equal((await call('/api/follow-requests', {}, '41', 'GET')).result.payload.total, 0)
    assert.equal((await call('/api/follow-requests?direction=sent', {}, 'extra1', 'GET')).result.payload.total, 1)
  })
})
