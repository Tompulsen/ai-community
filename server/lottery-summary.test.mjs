import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { readPublicLotterySummary, invalidatePublicLotterySummary, handleLottery, createLotteryService, publicLotteryRange } from './lottery.ts'
import { lotteryPointUnits, lotteryPointsFromUnits } from '../shared/lottery-public.ts'

const prize = (patch = {}) => ({ name: '一等奖', status: 'fulfilled', amountCents: 50, rewardKind: 'charity', validityHours: 24,
  note: 'private-note', fulfilledBy: 'private-admin', creditReceipt: { id: 8, quotaAdded: 250000, quotaPerUsd: '500000',
    rewardKind: 'charity', validityHours: 24, creditedAt: 1795000000, expiresAt: 1795086400, points: '2500', quotaPerPoint: 100, lotId: 19 }, ...patch })
const draw = (patch = {}) => ({ id: 'draw001', userId: 'private-user', displayName: '创作用户', redacted: false,
  createdAt: '2026-11-21T10:00:00Z', creditAttempts: 0, creditSubject: '17', prizes: [prize()], ...patch })
function wallet(t) {
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const previous = process.env[key]; process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
}
function database(rows) {
  const state = { connects: 0, releases: 0, sql: [], fail: false }
  return { state, async connect() {
    state.connects++
    const snapshot = structuredClone(rows)
    return { async query(sql, args) {
      state.sql.push(sql)
      assert(!/UPDATE|INSERT|DELETE/.test(sql))
      if (sql.trim().startsWith('SELECT')) {
        if (state.fail) throw new Error('database unavailable')
        return { rows: snapshot.filter(row => !args[0] || row.id > args[0]).sort((a,b) => a.id.localeCompare(b.id)).slice(0,500) }
      }
      return { rows: [] }
    }, release() { state.releases++ } }
  } }
}

const statsNow = new Date('2026-11-22T12:00:00Z')
const query = value => new URLSearchParams(value)
const charityAt = value => {
  const creditedAt = Date.parse(value) / 1000
  return prize({ creditReceipt: { ...prize().creditReceipt, creditedAt, expiresAt: creditedAt + 86400 } })
}
test('date ranges include both endpoints, use Beijing midnight and reject malformed or unbounded queries before scanning', async () => {
  assert.deepEqual(publicLotteryRange(query('period=today'), statsNow), { period: 'today', start: '2026-11-22', end: '2026-11-22', days: 1, timezone: 'Asia/Shanghai' })
  assert.equal(publicLotteryRange(query('period=today'), new Date('2026-11-21T16:00:00Z')).start, '2026-11-22')
  assert.equal(publicLotteryRange(query('period=today'), new Date('2026-11-21T15:59:59Z')).start, '2026-11-21')
  assert.equal(publicLotteryRange(query('period=7d'), statsNow).start, '2026-11-16')
  assert.equal(publicLotteryRange(query('period=30d'), statsNow).start, '2026-10-24')
  assert.equal(publicLotteryRange(query('period=custom&start=2024-01-01&end=2024-12-31'), statsNow).days, 366)
  assert.equal(publicLotteryRange(query('period=custom&start=2024-02-29&end=2024-02-29'), statsNow).days, 1)
  const db = database([])
  for (const value of ['period=foo', 'period=', 'start=2026-01-01', 'period=today&period=7d', 'userId=secret',
    'period=custom', 'period=custom&start=2026-02-29&end=2026-03-01', 'period=custom&start=2026-11-23&end=2026-11-22',
    'period=custom&start=2026-11-22&end=2026-11-23', 'period=custom&start=2024-01-01&end=2025-01-01',
    'period=custom&start=2026-1-01&end=2026-11-22', 'period=custom&start=2026-01-01&start=2026-01-02&end=2026-01-03']) {
    await assert.rejects(readPublicLotterySummary(db, query(value), statsNow), /LOTTERY_INVALID/)
  }
  assert.equal(db.state.connects, 0)
})

test('daily totals use verified delivery dates, delayed awards and actual multi-draw dates without inventing historical dates', async t => {
  wallet(t)
  const permanent = prize({ rewardKind: undefined, fulfilledAt: '2026-11-22T10:00:00+08:00', creditReceipt: { id: 9, quotaAdded: 1, quotaPerUsd: '2' } })
  const db = database([
    draw({ createdAt: '2026-11-21T15:59:58Z', prizes: [charityAt('2026-11-21T15:59:59Z'), charityAt('2026-11-21T16:00:00Z'), permanent] }),
    draw({ id: 'draw002', userId: 'second', createdAt: '2026-11-21T16:00:00Z', prizes: [prize({ status: 'pending' }), prize({ status: 'pending' }),
      prize({ status: 'empty' }), prize({ creditReceipt: undefined }), { ...permanent, fulfilledAt: null }] }),
  ])
  const today = await readPublicLotterySummary(db, query('period=today'), statsNow)
  assert.equal(today.totals.totalPoints, '2500.01'); assert.equal(today.totals.drawCount, '5')
  assert.equal(today.totals.participantCount, '2'); assert.equal(today.totals.fulfilledCount, '2')
  assert.equal(today.items[0].drawCount, '0'); assert.equal(today.items[0].totalPoints, '2500.01')
  assert.equal(today.items[1].pendingCount, '2'); assert.equal(today.items[1].unverifiedCount, '1')
  assert.deepEqual(today.daily, [{ date: '2026-11-22', totalPoints: '2500.01', charityPoints: '2500', permanentPoints: '0.01', drawCount: '5', fulfilledCount: '2' }])
  const all = await readPublicLotterySummary(db)
  assert.equal(all.totals.totalPoints, '5000.02'); assert.equal(all.totals.undatedPoints, '0.01')
  assert.equal(all.daily.reduce((sum, day) => sum + lotteryPointUnits(day.totalPoints), 0n) + lotteryPointUnits(all.totals.undatedPoints), lotteryPointUnits(all.totals.totalPoints))
  const week = await readPublicLotterySummary(db, query('period=7d'), statsNow)
  assert.equal(week.daily.length, 7); assert.equal(week.daily[6].date, '2026-11-16'); assert.equal(week.daily[6].totalPoints, '0')
  assert.equal(week.totals.totalPoints, '5000.01'); assert.equal(week.totals.drawCount, '8')
  assert.equal(week.items.reduce((sum, item) => sum + lotteryPointUnits(item.totalPoints), 0n), lotteryPointUnits(week.totals.totalPoints))
  assert.equal(db.state.connects, 1, 'different ranges share one snapshot')
  assert.doesNotMatch(JSON.stringify(week), /private-|userId|creditSubject|creditReceipt|createdAt|一等奖/)
})

test('missing, timezone-free or invalid permanent delivery dates stay outside daily totals', async t => {
  wallet(t)
  const permanent = prize({ rewardKind: undefined, creditReceipt: { id: 9, quotaAdded: 1, quotaPerUsd: '2' } })
  const db = database([draw({ prizes: [undefined, '2026-11-22T10:00:00', '2026-02-30T10:00:00Z', 'invalid'].map(fulfilledAt => ({ ...permanent, fulfilledAt })) })])
  const all = await readPublicLotterySummary(db)
  assert.equal(all.totals.totalPoints, '0.04'); assert.equal(all.totals.undatedPoints, '0.04')
  const today = await readPublicLotterySummary(db, query('period=today'), statsNow)
  assert.deepEqual(today.items, []); assert.equal(today.daily[0].totalPoints, '0')
})

test('one row per identity with verified point totals, actual multi-draw counts, redaction and field allowlist', async t => {
  wallet(t)
  const permanent = prize({ rewardKind: undefined, creditReceipt: { id: 9, quotaAdded: 1, quotaPerUsd: '2' } })
  const db = database([
    draw(), draw({ id: 'draw002', prizes: [permanent, prize({ status: 'pending' }), prize({ creditReceipt: undefined }),
      prize({ creditReceipt: { ...prize().creditReceipt, points: '9999' } }), prize({ status: 'empty', amountCents: 0 })] }),
    draw({ id: 'draw003', userId: 'private-other', displayName: '创作同名用户', prizes: [prize(), prize(), prize()] }),
    draw({ id: 'draw004', userId: 'suspended', redacted: true }),
    draw({ id: 'draw005', userId: null }), draw({ id: 'draw006', userId: null }),
  ])
  const result = await readPublicLotterySummary(db)
  assert.equal(result.items.length, 4)
  assert.deepEqual(result.items[0], { id: 'draw001', participant: '创***', drawCount: '6', totalPoints: '2500.01', charityPoints: '2500',
    permanentPoints: '0.01', fulfilledCount: '2', pendingCount: '1', unverifiedCount: '2', emptyCount: '1' })
  assert.equal(result.items[1].participant, '创***'); assert.equal(result.items[1].drawCount, '3'); assert.equal(result.items[1].totalPoints, '7500')
  assert.equal(result.items[2].participant, '匿名用户'); assert.equal(result.items[3].participant, '已注销用户（合计）')
  assert.equal(result.items[3].drawCount, '2')
  assert.doesNotMatch(JSON.stringify(result), /private-|userId|creditSubject|creditReceipt|createdAt|一等奖/)
  assert.equal(db.state.sql[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(db.state.sql.at(-1), 'COMMIT'); assert.equal(db.state.releases, 1)
})

test('fixed point aggregation preserves six decimals and totals beyond the safe integer range', async t => {
  wallet(t)
  const large = prize({ amountCents: 100, creditReceipt: { ...prize().creditReceipt, points: '9007199254740991',
    quotaAdded: 9007199254740991, quotaPerUsd: '9007199254740991', quotaPerPoint: 1 } })
  const small = prize({ rewardKind: undefined, creditReceipt: { id: 9, quotaAdded: 1, quotaPerUsd: '2' } })
  const result = await readPublicLotterySummary(database([draw({ prizes: [large, large, small, small] })]))
  assert.equal(result.items[0].totalPoints, '18014398509481982.02')
  const legacy = prize({ amountCents: 100, rewardKind: undefined,
    creditReceipt: { id: 9, quotaAdded: 9007199254740991, quotaPerUsd: '9007199254740991' } })
  assert.equal((await readPublicLotterySummary(database([draw({ prizes: [legacy] })]))).items[0].permanentPoints, '90071992547409.91')
  process.env.COMMUNITY_WALLET_QUOTA_PER_CNY = '2000000000'
  assert.equal((await readPublicLotterySummary(database([draw({ prizes: [small] })]))).items[0].permanentPoints, '0.000003')
  assert.equal(lotteryPointsFromUnits(lotteryPointUnits('9007199254740993.123456') + lotteryPointUnits('0.000001')), '9007199254740993.123457')
  for (const bad of ['-1', '1e3', 'NaN', '01', '1.0000001']) assert.throws(() => lotteryPointUnits(bad))
})

test('batch scans, cache sharing, expiration, invalidation and transaction failure release resources', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rows = Array.from({ length: 501 }, (_, index) => draw({ id: `draw${String(index).padStart(4,'0')}` }))
  const db = database(rows)
  const first = readPublicLotterySummary(db), shared = readPublicLotterySummary(db)
  assert.deepEqual(await first, await shared); assert.equal((await first).items[0].drawCount, '501')
  assert.equal(db.state.sql.filter(sql => sql.trim().startsWith('SELECT')).length, 2)
  assert.equal(db.state.connects, 1)
  t.mock.timers.tick(30_000)
  await readPublicLotterySummary(db); assert.equal(db.state.connects, 2)
  invalidatePublicLotterySummary(db); db.state.fail = true
  await assert.rejects(readPublicLotterySummary(db), /database unavailable/)
  assert.equal(db.state.sql.at(-1), 'ROLLBACK'); assert.equal(db.state.releases, 3)
  db.state.fail = false
  await readPublicLotterySummary(db); assert.equal(db.state.connects, 4)
})

test('invalidating an in-flight snapshot never repopulates the cache with old totals', async () => {
  let resume
  const wait = new Promise(resolve => { resume = resolve })
  const rows = [draw()], base = database(rows)
  let first = true
  const db = { async connect() { const client = await base.connect(); if (first) { first = false; await wait }; return client } }
  const old = readPublicLotterySummary(db)
  invalidatePublicLotterySummary(db)
  rows.push(draw({ id: 'draw002' }))
  const fresh = readPublicLotterySummary(db)
  const concurrent = Array.from({ length: 12 }, () => readPublicLotterySummary(db))
  assert.equal(base.state.connects, 1)
  resume(); assert.equal((await old).items[0].drawCount, '1')
  assert.equal((await fresh).items[0].drawCount, '2')
  for (const result of await Promise.all(concurrent)) assert.equal(result.items[0].drawCount, '2')
  assert.equal(base.state.connects, 2)
  assert.deepEqual(await readPublicLotterySummary(db), await fresh)
})

test('anonymous summary route does not initialize lottery accounts and rejects unexpected query fields', async () => {
  const db = database([])
  const ctx = { db, url: new URL('https://community.test/api/lottery/public-summary'), req: { method: 'GET' },
    requireUser() { assert.fail('anonymous route') }, json(status, value) { assert.equal(status, 200); assert.deepEqual(value.items, []); assert.equal(value.range.period, 'all'); assert.equal(value.totals.totalPoints, '0') } }
  assert.equal(await handleLottery(ctx), true)
  ctx.url.search = '?userId=private-user'
  await assert.rejects(handleLottery(ctx), /LOTTERY_INVALID/)
  assert.equal(db.state.connects, 1)
})

test('delivery commits invalidate the summary so pending rewards become verified totals', async () => {
  const row = draw({ creditPending: true, creditRetryAt: null, creditIssuer: 'https://accounts.test', prizes: [prize({ status: 'pending' })] })
  let reads = 0
  const db = { async connect() { return { async query(sql, args) {
    if (sql.trim().startsWith('SELECT d.id')) { reads++; return { rows: [structuredClone(row)] } }
    if (sql.startsWith('SELECT * FROM community_lottery_draw')) return { rows: [structuredClone(row)] }
    if (sql.startsWith('UPDATE community_lottery_draw')) Object.assign(row, { prizes: JSON.parse(args[1]), creditPending: args[2], creditAttempts: args[3], creditRetryAt: args[4] })
    return { rows: [] }
  }, release() {} } } }
  assert.equal((await readPublicLotterySummary(db)).items[0].pendingCount, '1')
  const service = createLotteryService({ db, config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 'x'.repeat(32) } },
    fetcher: async (_url, options) => { const body = JSON.parse(options.body); return new Response(JSON.stringify({ credited: true, ...body,
      receipt: { id: 8, quota_added: 250000, quota_per_usd: '500000', reward_kind: 'charity', validity_hours: 24,
        credited_at: 1795000000, expires_at: 1795086400, points: '2500', quota_per_point: 100, lot_id: 19 } })) } })
  await service.deliver(row.id)
  const result = await readPublicLotterySummary(db)
  assert.equal(reads, 2); assert.equal(result.items[0].pendingCount, '0'); assert.equal(result.items[0].totalPoints, '2500')
})

test('summary groups real PostgreSQL records across batches in a read-only repeatable snapshot', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const control = new pg.Pool({ connectionString }), schema = 'lottery_summary_test'
  assert.equal((await control.query('SELECT to_regnamespace($1) AS existing', [schema])).rows[0].existing, null)
  await control.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` })
  t.after(async () => { await pool.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  await pool.query(`CREATE TABLE "user" (id text PRIMARY KEY,name text,username text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false);
    CREATE TABLE community_lottery_draw (id text PRIMARY KEY,"userId" text,prizes jsonb,"createdAt" timestamptz,"creditSubject" text,"creditAttempts" integer DEFAULT 0);
    INSERT INTO "user" (id,name,username) VALUES ('u1','甲创作者','first'),('u2','甲同名','second');`)
  await pool.query(`INSERT INTO community_lottery_draw (id,"userId",prizes,"createdAt","creditSubject")
    SELECT 'draw'||lpad(i::text,4,'0'),CASE WHEN i%2=1 THEN 'u1' ELSE 'u2' END,$1::jsonb,'2026-11-21T10:00:00Z','17' FROM generate_series(1,501) i`, [JSON.stringify(Array.from({ length: 3 }, () => charityAt('2026-11-22T00:00:00Z')))])
  let reads = 0
  const db = { async connect() { const client = await pool.connect(); return { async query(sql,args) {
    const result = await client.query(sql,args)
    if (sql.trim().startsWith('SELECT d.id')) {
      assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on')
      assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read')
      if (++reads === 1) await pool.query('INSERT INTO community_lottery_draw (id,"userId",prizes,"createdAt","creditSubject") VALUES ($1,$2,$3,NOW(),$4)', ['draw0502','u1',JSON.stringify([prize()]),'17'])
    }
    return result
  }, release() { client.release() } } } }
  const first = await readPublicLotterySummary(db)
  assert.equal(first.items.length, 2); assert.equal(first.items[0].drawCount, '753'); assert.equal(first.items[1].drawCount, '750')
  assert.equal(first.items[0].totalPoints, '1882500'); assert.equal(first.items[1].totalPoints, '1875000')
  const today = await readPublicLotterySummary(db, query('period=today'), statsNow)
  assert.equal(today.totals.drawCount, '0'); assert.equal(today.totals.fulfilledCount, '1503')
  assert.equal(today.totals.totalPoints, '3757500'); assert.equal(today.daily[0].totalPoints, today.totals.totalPoints)
  assert.equal(reads, 2, 'date filters share the same two-batch PostgreSQL snapshot')
  invalidatePublicLotterySummary(db)
  assert.equal((await readPublicLotterySummary(db)).items[0].drawCount, '754')
})
