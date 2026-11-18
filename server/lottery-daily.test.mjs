import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { defaultDailyLotteryPrizes, lotteryDay, lotteryPointsToCents } from '../shared/lottery-daily.ts'
import { defaultLotterySettings, chooseLotteryPrize } from './business/lottery.ts'
import { createLotteryService, validateLotterySettings } from './lottery.ts'

const dailySettings = () => ({ ...defaultLotterySettings(), enabled: true, dailyLimit: 200, prizes: defaultDailyLotteryPrizes(5000) })

test('daily defaults allocate 200 places and exactly 600000 points, including the clown reward', () => {
  const settings = dailySettings()
  assert.equal(validateLotterySettings(settings), settings)
  assert.deepEqual(settings.prizes.map(p => [p.name, p.stock, p.amountCents * 50]), [
    ['一等奖', 40, 6000], ['二等奖', 50, 4000], ['三等奖', 50, 2000], ['🤡 非常遗憾', 60, 1000],
  ])
  assert.equal(settings.prizes.reduce((sum, p) => sum + p.stock * p.amountCents * 50, 0), 600000)
  const counts = {}
  for (let i = 0; i < 200; i++) {
    const prize = chooseLotteryPrize(settings.prizes)
    counts[prize.id] = (counts[prize.id] ?? 0) + 1
    prize.stock--; prize.weight = prize.stock
  }
  assert.deepEqual(Object.values(counts).sort((a, b) => a - b), [40, 50, 50, 60])
  assert.equal(chooseLotteryPrize(settings.prizes), null)
})

test('day boundaries use Beijing midnight regardless of the host timezone', () => {
  const before = lotteryDay(new Date('2026-11-18T15:59:59.999Z'))
  assert.equal(before.date, '2026-11-18')
  assert.equal(before.start.toISOString(), '2026-11-17T16:00:00.000Z')
  assert.equal(before.end.toISOString(), '2026-11-18T16:00:00.000Z')
  const after = lotteryDay(new Date('2026-11-18T16:00:00.000Z'))
  assert.equal(after.date, '2026-11-19')
  assert.equal(after.start.toISOString(), before.end.toISOString())
})

test('point edits reject nonrepresentable rewards and daily quotas cannot be unlimited or inconsistent', () => {
  assert.equal(lotteryPointsToCents(6000, 5000), 120)
  assert.equal(lotteryPointsToCents(6000, 10000), 60)
  for (const [points, rate] of [[6001, 5000], [0, 5000], [6000, 0], [NaN, 5000]]) assert.throws(() => lotteryPointsToCents(points, rate))
  for (const dailyLimit of [0, -1, 1.5, '200', NaN, 1000001]) assert.throws(() => validateLotterySettings({ ...dailySettings(), dailyLimit }), /LOTTERY_INVALID/)
  assert.throws(() => validateLotterySettings({ ...dailySettings(), dailyLimit: 199 }), /LOTTERY_DAILY_QUOTA_INVALID/)
  const settings = dailySettings(); settings.prizes[0].stock = -1
  assert.throws(() => validateLotterySettings(settings), /LOTTERY_INVALID/)
})

// The CI-only database is disposable; the production database is never a test target.
test('daily lottery PostgreSQL concurrency and rollover', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const control = new pg.Pool({ connectionString })
  assert.equal((await control.query("SELECT to_regnamespace('lottery_daily_test') AS existing")).rows[0].existing, null)
  await control.query('CREATE SCHEMA lottery_daily_test')
  const pool = new pg.Pool({ connectionString, options: '-c search_path=lottery_daily_test', max: 12 })
  t.after(async () => { await pool.end(); await control.query('DROP SCHEMA lottery_daily_test CASCADE'); await control.end() })
  await pool.query(`
    CREATE TABLE "user" (id text PRIMARY KEY,host text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text);
    CREATE TABLE community_lottery_config (id text PRIMARY KEY,version integer NOT NULL,settings jsonb NOT NULL);
    CREATE TABLE community_lottery_account ("userId" text PRIMARY KEY,balance integer NOT NULL,progress jsonb NOT NULL);
    CREATE TABLE community_lottery_draw (id text PRIMARY KEY,"userId" text,"requestId" text,prizes jsonb,"createdAt" timestamptz,
      "creditIssuer" text,"creditSubject" text,"creditPending" boolean,"creditAttempts" integer,"creditRetryAt" timestamptz,UNIQUE("userId","requestId"));
    CREATE TABLE external_account (issuer text,"userId" text,subject text);
    CREATE TABLE community_lottery_referral ("inviterId" text);
    CREATE TABLE following ("followerId" text,"followeeId" text);
    CREATE TABLE community_submission (id text,"approvedNoteId" text,"authorId" text,status text,destination text);
    CREATE TABLE note (id text,visibility text);
    CREATE TABLE note_reaction (id text,"noteId" text,"userId" text,reaction text);
  `)
  let clock = new Date('2026-11-18T03:00:00Z')
  // Delivery has separate receipt tests; prevent test draws from starting the real delivery worker.
  const db = { connect: () => pool.connect(), query: (sql, args) => sql.startsWith('SELECT id FROM community_lottery_draw') ? Promise.resolve({ rows: [] }) : pool.query(sql, args) }
  const service = createLotteryService({ db, config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 's'.repeat(32) } },
    now: () => new Date(clock), fetcher: async () => new Response(JSON.stringify({ ready: true, client_id: 'https://community.test' })) })
  async function reset(settings = dailySettings()) {
    clock = new Date('2026-11-18T03:00:00Z')
    await pool.query('TRUNCATE community_lottery_config,community_lottery_account,community_lottery_draw,external_account,"user"')
    await pool.query('INSERT INTO community_lottery_config VALUES (\'default\',0,$1)', [settings])
    await pool.query(`INSERT INTO "user" (id) SELECT i::text FROM generate_series(1,205) i;
      INSERT INTO external_account SELECT 'https://accounts.test',id,id FROM "user";
      INSERT INTO community_lottery_account SELECT id,5,'{"invites":0,"followers":0,"likes":0,"works":{}}'::jsonb FROM "user";`)
  }
  const draw = (id, request = randomUUID(), count = 1) => service.draw(String(id), request, count)
  await t.test('same user competing requests consume one place and one ticket; retries return the receipt', async () => {
    await reset()
    const key = randomUUID()
    const same = await Promise.all([draw(1, key), draw(1, key)])
    assert.equal(same[0].id, same[1].id)
    const competing = await Promise.allSettled([draw(2), draw(2), draw(2)])
    assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1)
    assert(competing.filter(x => x.status === 'rejected').every(x => x.reason.message === 'LOTTERY_DAILY_USED'))
    assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'2\'')).rows[0].balance, 4)
    await assert.rejects(draw(3, randomUUID(), 3), /LOTTERY_DAILY_SINGLE/)
  })
  await t.test('200 concurrent users exhaust exact allocations and no extra user wins', async () => {
    await reset()
    const results = await Promise.allSettled(Array.from({ length: 205 }, (_, i) => draw(i + 1)))
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 200)
    assert(results.filter(x => x.status === 'rejected').every(x => x.reason.message === 'LOTTERY_DAILY_EXHAUSTED'))
    const rows = (await pool.query(`SELECT p->>'prizeId' AS id,count(*)::integer AS count FROM community_lottery_draw CROSS JOIN LATERAL jsonb_array_elements(prizes) p GROUP BY 1 ORDER BY 1`)).rows
    assert.deepEqual(rows.map(r => [r.id, r.count]), [['daily-first',40],['daily-fourth',60],['daily-second',50],['daily-third',50]])
    assert.equal((await service.status()).daily.remaining, 0)
    assert.deepEqual((await service.getConfig()).settings, dailySettings())
  })
  await t.test('next day resets availability; an old request replay does not use the new day', async () => {
    await reset()
    const key = randomUUID(), original = await draw(1, key)
    assert.equal((await service.status('1')).daily.participated, true)
    clock = new Date('2026-11-18T16:00:00Z')
    assert.equal((await draw(1, key)).id, original.id)
    assert.equal((await service.status('1')).daily.remaining, 200)
    assert.equal((await service.status('1')).daily.participated, false)
    await draw(1)
    assert.equal((await service.status('1')).daily.remaining, 199)
  })
  await t.test('configuration changes and failed delivery do not refund daily places', async () => {
    const settings = dailySettings(); settings.dailyLimit = 1; settings.prizes = [{ ...settings.prizes[0], stock: 1 }]
    await reset(settings); await draw(1)
    const config = await service.getConfig()
    config.settings.prizes = [{ ...config.settings.prizes[0], id: 'replacement', name: '改名', amountCents: 80 }]
    await service.updateConfig(config.version, config.settings)
    assert.equal((await service.status('1')).daily.participated, true)
    assert.equal((await service.status()).daily.remaining, 0)
    await assert.rejects(draw(2), /LOTTERY_DAILY_EXHAUSTED/)
    await assert.rejects(draw(1), /LOTTERY_DAILY_USED/)
  })
  await t.test('a request waiting on the config lock uses the day after it acquires the lock', async () => {
    await reset(); await draw(1)
    clock = new Date('2026-11-18T15:59:59.900Z')
    const blocker = await pool.connect()
    await blocker.query('BEGIN'); await blocker.query('SELECT * FROM community_lottery_config FOR UPDATE')
    const waiting = draw(1)
    try {
      let locked = false
      for (let attempt = 0; attempt < 100 && !locked; attempt++) {
        locked = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM community_lottery_config%' ")).rows.length > 0
        if (!locked) await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert(locked)
      clock = new Date('2026-11-18T16:00:00.100Z')
      await blocker.query('COMMIT')
    } finally { await blocker.query('ROLLBACK'); blocker.release() }
    assert.equal((await waiting).createdAt, clock.toISOString())
    assert.equal((await service.status()).daily.used, 1)
  })
})
