import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { defaultDailyLotteryPrizes, lotteryDay, lotteryPointsToCents } from '../shared/lottery-daily.ts'
import { defaultLotterySettings, chooseLotteryPrize } from './business/lottery.ts'
import { createLotteryService, validateLotterySettings, readPublicLotterySummary, invalidatePublicLotterySummary } from './lottery.ts'

const dailySettings = () => ({ ...defaultLotterySettings(), enabled: true, dailyLimit: 200, prizes: defaultDailyLotteryPrizes(5000) })

test('daily defaults allocate 200 places and exactly 600000 points, including the clown reward', () => {
  const settings = dailySettings()
  assert.equal(validateLotterySettings(settings), settings)
  assert.equal(settings.rewardValidityHours, 168)
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
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const before = process.env[key]
    process.env[key] = value
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before })
  }
  const control = new pg.Pool({ connectionString })
  assert.equal((await control.query("SELECT to_regnamespace('lottery_daily_test') AS existing")).rows[0].existing, null)
  await control.query('CREATE SCHEMA lottery_daily_test')
  const pool = new pg.Pool({ connectionString, options: '-c search_path=lottery_daily_test', max: 12 })
  t.after(async () => { await pool.end(); await control.query('DROP SCHEMA lottery_daily_test CASCADE'); await control.end() })
  await pool.query(`
    CREATE TABLE "user" (id text PRIMARY KEY,host text,name text,username text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text);
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
  const supportResponse = (url, patch = {}) => new Response(JSON.stringify({
    ready: true, client_id: 'https://community.test', user_id: Number(new URL(url).searchParams.get('user_id')),
    basis: 'support', has_support: true, support_cny_fen: 100,
    reward_kinds: ['balance', 'charity'], quota_per_point: 100, ...patch,
  }))
  let lookup = async url => supportResponse(url)
  // Delivery has separate receipt tests; prevent test draws from starting the real delivery worker.
  const db = { connect: () => pool.connect(), query: (sql, args) => sql.startsWith('SELECT id FROM community_lottery_draw') ? Promise.resolve({ rows: [] }) : pool.query(sql, args) }
  const service = createLotteryService({ db, config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 's'.repeat(32) } },
    now: () => new Date(clock), fetcher: async (url, options) => {
      assert.equal(options.method, 'GET')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.Authorization, `Bearer ${'s'.repeat(32)}`)
      if (!new URL(url).search) return new Response(JSON.stringify({ ready: true, client_id: 'https://community.test', reward_kinds: ['balance', 'charity'], quota_per_point: 100 }))
      assert.equal(new URL(url).searchParams.get('client_id'), 'https://community.test')
      assert.equal(new URL(url).searchParams.get('basis'), 'support')
      return lookup(url)
    } })
  async function reset(settings = dailySettings()) {
    invalidatePublicLotterySummary(db)
    clock = new Date('2026-11-18T03:00:00Z')
    lookup = async url => supportResponse(url)
    await pool.query('TRUNCATE community_lottery_config,community_lottery_account,community_lottery_draw,external_account,"user"')
    await pool.query('INSERT INTO community_lottery_config VALUES (\'default\',0,$1)', [settings])
    await pool.query(`INSERT INTO "user" (id) SELECT i::text FROM generate_series(1,205) i;
      INSERT INTO external_account SELECT 'https://accounts.test',id,id FROM "user";
      INSERT INTO community_lottery_account SELECT id,5,'{"invites":0,"followers":0,"likes":0,"works":{}}'::jsonb FROM "user";`)
  }
  const draw = (id, request = randomUUID(), count = 1) => service.draw(String(id), request, count)
  await t.test('legacy stored configuration migrates its threshold and old form saves retain the current value', async () => {
    const legacy = { ...dailySettings(), minConsumptionCnyFen: 129 }
    delete legacy.minSupportCnyFen
    delete legacy.rewardValidityHours
    await reset(legacy)
    const config = await service.getConfig()
    assert.equal(config.settings.minSupportCnyFen, 129)
    assert.equal(config.settings.rewardValidityHours, 168)
    assert.equal('minConsumptionCnyFen' in config.settings, false)
    delete config.settings.minSupportCnyFen
    config.settings.minConsumptionCnyFen = 1
    const updated = await service.updateConfig(config.version, config.settings)
    assert.equal(updated.settings.minSupportCnyFen, 129)
    assert.equal((await service.getConfig()).settings.minSupportCnyFen, 129)
    const stored = (await pool.query('SELECT settings FROM community_lottery_config')).rows[0].settings
    assert.equal(stored.minSupportCnyFen, 129)
    assert.equal('minConsumptionCnyFen' in stored, false)
  })
  await t.test('new rewards freeze the configured duration while old forms and request retries retain the original snapshots', async () => {
    await reset({ ...dailySettings(), rewardValidityHours: 24 })
    const empty = await readPublicLotterySummary(db)
    assert.deepEqual(empty.items, []); assert.equal(empty.totals.totalPoints, '0'); assert.equal(empty.totals.drawCount, '0')
    const key = randomUUID(), first = await draw(1, key)
    const summary = await readPublicLotterySummary(db)
    assert.equal(summary.items.length, 1); assert.equal(summary.items[0].drawCount, '1'); assert.equal(summary.items[0].pendingCount, '1')
    assert.equal(first.prizes[0].rewardKind, 'charity')
    assert.equal(first.prizes[0].validityHours, 24)
    assert.equal(first.prizes[0].points, null)
    assert.equal(first.prizes[0].expiresAt, null)
    assert.equal('legacyPoints' in first.prizes[0], false)
    const config = await service.getConfig()
    const updated = await service.updateConfig(config.version, { ...config.settings, rewardValidityHours: 72 })
    delete updated.settings.rewardValidityHours
    const compatible = await service.updateConfig(updated.version, updated.settings)
    assert.equal(compatible.settings.rewardValidityHours, 72)
    assert.equal((await draw(1, key)).id, first.id)
    assert.equal((await draw(1, key)).prizes[0].validityHours, 24)
    assert.equal((await draw(2)).prizes[0].validityHours, 72)
    const stored = (await pool.query('SELECT prizes FROM community_lottery_draw WHERE id=$1', [first.id])).rows[0].prizes[0]
    assert.equal(stored.rewardKind, 'charity')
    assert.equal(stored.validityHours, 24)
    assert.equal(stored.creditReceipt, undefined)
    assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 4)
  })
  await t.test('new draws fail before consuming chances when charity capability or point conversion is absent or incompatible', async () => {
    for (const patch of [{ reward_kinds: undefined }, { reward_kinds: ['balance'] }, { quota_per_point: undefined },
      { quota_per_point: 101 }, { quota_per_point: '100' }]) {
      await reset()
      lookup = async url => supportResponse(url, patch)
      const status = await service.status('1')
      assert.equal(status.creditReady, false)
      assert.equal(status.support.eligible, true)
      await assert.rejects(draw(1), /LOTTERY_UNAVAILABLE/)
      assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 5)
      assert.equal((await service.status()).daily.used, 0)
    }
  })
  await t.test('zero needs actual support; cumulative thresholds and earned tickets stay independent', async () => {
    for (const [minimum, hasSupport, fen, eligible] of [[0, false, 0, false], [0, true, 0, true], [0, true, 1, true], [1, true, 0, false], [129, true, 128, false], [129, true, 129, true], [129, true, 130, true]]) {
      await reset({ ...dailySettings(), minSupportCnyFen: minimum })
      lookup = async url => supportResponse(url, { has_support: hasSupport, support_cny_fen: fen })
      const status = await service.status('1')
      assert.deepEqual(status.support, { checked: true, eligible, amountCnyFen: fen })
      assert.equal('consumption' in status, false)
      assert.equal('subject' in status, false)
      if (eligible) await draw(1)
      else await assert.rejects(draw(1), /LOTTERY_SUPPORT_REQUIRED/)
      assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, eligible ? 4 : 5)
      assert.equal((await service.status()).daily.used, eligible ? 1 : 0)
    }
    await reset()
    await pool.query('UPDATE community_lottery_account SET balance=0 WHERE "userId"=\'1\'')
    const eligible = await service.status('1')
    assert.equal(eligible.support.eligible, true)
    assert.equal(eligible.balance, 0)
    await assert.rejects(draw(1), /LOTTERY_INSUFFICIENT/)
    assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 0)
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS count FROM community_lottery_draw')).rows[0].count, 0)
    assert.equal((await service.status()).daily.used, 0)
  })
  await t.test('old payment responses and untrusted support checks never consume a chance or daily place', async () => {
    for (const response of [
      async () => { throw new DOMException('Timed out', 'TimeoutError') },
      async () => new Response('{}', { status: 503 }),
      async () => new Response('invalid JSON'),
      async () => new Response(JSON.stringify({ ready: true, client_id: 'https://community.test', user_id: 1, has_support: true, support_cny_fen: 100 })),
      async url => supportResponse(url, { ready: false }),
      async url => supportResponse(url, { user_id: 2 }),
      async url => supportResponse(url, { user_id: '1' }),
      async url => supportResponse(url, { client_id: 'https://other.test' }),
      async url => supportResponse(url, { basis: 'consumption' }),
      async url => supportResponse(url, { basis: undefined }),
      async url => supportResponse(url, { has_support: 'true' }),
      async url => supportResponse(url, { has_support: false, support_cny_fen: 1 }),
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '100', null].map(support_cny_fen => async url => supportResponse(url, { support_cny_fen })),
    ]) {
      await reset(); lookup = response
      assert.deepEqual((await service.status('1')).support, { checked: false, eligible: false, amountCnyFen: null })
      await assert.rejects(draw(1), /LOTTERY_SUPPORT_UNAVAILABLE/)
      assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 5)
      assert.equal((await service.status()).daily.used, 0)
    }
  })
  await t.test('support lookup releases all pool locks and uses the current threshold and identity', async () => {
    for (const change of ['threshold', 'identity']) {
      await reset()
      let started, resume
      const checking = new Promise(resolve => { started = resolve })
      const waiting = new Promise(resolve => { resume = resolve })
      lookup = async url => { started(); await waiting; return supportResponse(url) }
      const drawing = draw(1)
      await checking
      const editor = await pool.connect()
      try {
        await editor.query('BEGIN')
        await editor.query('SET LOCAL lock_timeout = \'2s\'')
        if (change === 'threshold') await editor.query('UPDATE community_lottery_config SET settings=jsonb_set(settings,\'{minSupportCnyFen}\',\'101\')')
        else await editor.query('UPDATE external_account SET subject=\'2\' WHERE "userId"=\'1\'')
        await editor.query('COMMIT')
      } finally {
        await editor.query('ROLLBACK'); editor.release(); resume()
      }
      await assert.rejects(drawing, change === 'threshold' ? /LOTTERY_SUPPORT_REQUIRED/ : /LOTTERY_ACCOUNT_REQUIRED/)
      assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 5)
      assert.equal((await service.status()).daily.used, 0)
    }
  })
  await t.test('expired support verification cannot consume a chance after waiting for the pool', async t => {
    await reset()
    let checks = 0
    t.mock.method(Date, 'now', () => checks++ === 0 ? 1000 : 61001)
    await assert.rejects(draw(1), /LOTTERY_SUPPORT_UNAVAILABLE/)
    assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 5)
    assert.equal((await service.status()).daily.used, 0)
  })
  await t.test('committed and concurrent receipts survive refunds, threshold changes and support outages', async () => {
    await reset()
    let started, resume, lookups = 0
    const checking = new Promise(resolve => { started = resolve })
    const waiting = new Promise(resolve => { resume = resolve })
    lookup = async url => {
      lookups++
      if (lookups === 1) { started(); await waiting; throw new Error('Center unavailable') }
      return supportResponse(url)
    }
    const key = randomUUID(), pending = draw(1, key)
    await checking
    let completed
    try { completed = await draw(1, key) } finally { resume() }
    assert.equal((await pending).id, completed.id)
    await pool.query('UPDATE community_lottery_config SET settings=jsonb_set(settings,\'{minSupportCnyFen}\',\'1000\')')
    lookup = async () => { throw new Error('Refunded or center unavailable') }
    assert.equal((await draw(1, key)).id, completed.id)
    assert.equal(lookups, 2)
    assert.equal((await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=\'1\'')).rows[0].balance, 4)
    assert.equal((await service.status()).daily.used, 1)
    await assert.rejects(draw(2), /LOTTERY_SUPPORT_UNAVAILABLE/)
  })
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
    const expected = dailySettings()
    expected.invites.enabled = false
    assert.deepEqual((await service.getConfig()).settings, expected)
    assert.deepEqual((await pool.query('SELECT settings FROM community_lottery_config')).rows[0].settings, dailySettings())
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
