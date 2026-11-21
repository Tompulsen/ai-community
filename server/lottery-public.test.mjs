import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { readPublicLotteryRecords, handleLottery } from './lottery.ts'

const prize = (patch = {}) => ({ name: '一等奖', status: 'fulfilled', amountCents: 50, rewardKind: 'charity', validityHours: 24,
  description: 'private-description', note: 'private-note', fulfilledBy: 'private-admin', creditBlocked: false,
  creditReceipt: { id: 8, quotaAdded: 250000, quotaPerUsd: '500000', rewardKind: 'charity', validityHours: 24,
    creditedAt: 1795000000, expiresAt: 1795000000 + 86400, points: '2500', quotaPerPoint: 100, lotId: 19 }, ...patch })
const draw = (patch = {}) => ({ id: 'draw025', userId: 'private-owner', displayName: '创作用户', redacted: false,
  username: 'private-login', createdAt: '2026-11-21T10:00:00Z', creditAttempts: 1, creditSubject: '17',
  creditIssuer: 'https://private-account.test', requestId: 'private-request', totalDrawCount: '12', prizes: [prize()], ...patch })
function database(rows) { return { async query(sql) { assert(!/UPDATE|INSERT|DELETE/.test(sql)); return { rows: sql.startsWith('SELECT id') ? rows.map(row => ({ id: row.id })).slice(0, 1) : rows } } } }

test('public result projection verifies receipts, counts actual draws and never exposes account details', async () => {
  const row = draw({ prizes: [prize(), prize({ status: 'pending' }), prize({ creditReceipt: undefined })] })
  const page = await readPublicLotteryRecords(database([row]), new URLSearchParams())
  assert.deepEqual(page, { snapshot: 'draw025', nextCursor: null, items: [{
    id: 'draw025', participant: '创***', createdAt: '2026-11-21T10:00:00.000Z', drawCount: 3, totalDrawCount: '12',
    prizes: [
      { name: '一等奖', status: 'fulfilled', points: '2500', rewardKind: 'charity' },
      { name: '一等奖', status: 'pending', points: null, rewardKind: 'charity' },
      { name: '一等奖', status: 'fulfilled', points: null, rewardKind: 'charity' },
    ],
  }] })
  assert.doesNotMatch(JSON.stringify(page), /private-|credit|receipt|userId|lotId|账户余额/)
  for (const patch of [{ redacted: true }, { displayName: null, userId: null, totalDrawCount: null }]) {
    assert.equal((await readPublicLotteryRecords(database([draw(patch)]), new URLSearchParams())).items[0].participant, '匿名用户')
  }
  const invalid = await readPublicLotteryRecords(database([draw({ prizes: [prize({ creditReceipt: { ...prize().creditReceipt, points: '9999' } })] })]), new URLSearchParams())
  assert.equal(invalid.items[0].prizes[0].points, null)
})

test('public feed is anonymous, bounded and rejects filters that could expose private user records', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => draw({ id: `draw${String(25 - index).padStart(3, '0')}` }))
  const page = await readPublicLotteryRecords(database(rows), new URLSearchParams())
  assert.equal(page.items.length, 20); assert.equal(page.nextCursor, 'draw006')
  for (const params of ['cursor=draw001', 'snapshot=bad%27', 'snapshot=draw001&cursor=draw002', 'snapshot=x&snapshot=y', 'userId=private-owner', 'limit=100000', 'snapshot=', 'cursor=x&cursor=y']) {
    await assert.rejects(readPublicLotteryRecords({ query() { assert.fail('Invalid input must not query the database') } }, new URLSearchParams(params)), /LOTTERY_INVALID/)
  }
  const ctx = { db: database(rows), url: new URL('https://community.test/api/lottery/public-records'), req: { method: 'GET' }, user: null,
    requireUser() { assert.fail('Public feed cannot require login') }, json(status, body) { assert.equal(status, 200); assert.equal(body.items.length, 20) } }
  assert.equal(await handleLottery(ctx), true)
  assert.deepEqual(await readPublicLotteryRecords(database([]), new URLSearchParams()), { items: [], nextCursor: null, snapshot: null })
})

test('public lottery pagination and per-user draw counts on real PostgreSQL', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const control = new pg.Pool({ connectionString })
  const schema = 'lottery_public_test'
  assert.equal((await control.query('SELECT to_regnamespace($1) AS existing', [schema])).rows[0].existing, null)
  await control.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` })
  t.after(async () => { await pool.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  await pool.query(`CREATE TABLE "user" (id text PRIMARY KEY,name text,username text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false);
    CREATE TABLE community_lottery_draw (id text PRIMARY KEY,"userId" text,prizes jsonb,"createdAt" timestamptz,"creditSubject" text,"creditAttempts" integer DEFAULT 0);
    CREATE INDEX ON community_lottery_draw ("userId",id);
    INSERT INTO "user" (id,name,username) VALUES ('u1','甲创作者','first-login'),('u2',NULL,'second-login');`)
  for (let index = 1; index <= 25; index++) {
    await pool.query('INSERT INTO community_lottery_draw (id,"userId",prizes,"createdAt","creditSubject") VALUES ($1,$2,$3,$4,$5)',
      [`draw${String(index).padStart(3, '0')}`, index % 2 ? 'u1' : 'u2', JSON.stringify(index === 1 ? [prize(), prize(), prize()] : [prize()]), '2026-11-21T10:00:00.123456Z', '17'])
  }
  const first = await readPublicLotteryRecords(pool, new URLSearchParams())
  assert.equal(first.items.length, 20); assert.equal(first.snapshot, 'draw025'); assert.equal(first.nextCursor, 'draw006')
  assert.equal(first.items[0].participant, '甲***'); assert.equal(first.items[0].totalDrawCount, '15')
  assert.equal(first.items[1].totalDrawCount, '12')
  assert(first.items.every(row => row.prizes[0].points === '2500'))
  // New draws between pages must neither move existing records nor alter this round's counts.
  await pool.query('INSERT INTO community_lottery_draw (id,"userId",prizes,"createdAt","creditSubject") VALUES ($1,$2,$3,NOW(),$4)', ['draw026', 'u1', JSON.stringify([prize()]), '17'])
  const next = await readPublicLotteryRecords(pool, new URLSearchParams({ snapshot: first.snapshot, cursor: first.nextCursor }))
  assert.equal(next.items.length, 5); assert.equal(next.nextCursor, null)
  assert.equal(next.items[0].totalDrawCount, '15')
  assert.equal(new Set([...first.items, ...next.items].map(row => row.id)).size, 25)
  assert.equal(next.items.at(-1).drawCount, 3)
  const refreshed = await readPublicLotteryRecords(pool, new URLSearchParams())
  assert.equal(refreshed.snapshot, 'draw026'); assert.equal(refreshed.items[0].totalDrawCount, '16')
})
