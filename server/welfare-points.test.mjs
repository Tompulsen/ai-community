import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { defaultLotterySettings } from './business/lottery.ts'
import { createLotteryService, validateLotterySettings, handleLottery, readPublicLotteryRecords, readPublicLotterySummary, invalidatePublicLotterySummary } from './lottery.ts'

const defaults = () => ({ ...defaultLotterySettings(), enabled: true, welfarePointsReady: true, rewardValidityHours: 24, dailyLimit: 200,
  prizes: [{ id: 'daily', name: '福利', description: '', kind: 'balance', amountCents: 20, weight: 200, stock: 200, enabled: true }] })

test('check-in and shared budget settings reject invalid ranges and non-integer amounts', () => {
  for (const checkin of [null, { enabled: 'yes', minPoints: 500, maxPoints: 700 }, { enabled: true, minPoints: 0, maxPoints: 700 },
    { enabled: true, minPoints: 700, maxPoints: 500 }, { enabled: true, minPoints: 500.5, maxPoints: 700 }, { enabled: true, minPoints: 1, maxPoints: 1000001 }]) {
    assert.throws(() => validateLotterySettings({ ...defaults(), checkin }), /LOTTERY_INVALID/)
  }
  for (const dailyBudgetPoints of [0, -1, 0.5, '600000', 1000000001]) assert.throws(() => validateLotterySettings({ ...defaults(), dailyBudgetPoints }), /LOTTERY_INVALID/)
  assert.doesNotThrow(() => validateLotterySettings(defaults()))
})

test('new welfare routes enforce login and account binding before database work', async () => {
  for (const [path, method] of [['/api/lottery/welfare', 'GET'], ['/api/lottery/checkin', 'POST']]) {
    const ctx = { req: { method, headers: { 'x-new-api-user': '2' } }, url: new URL(path, 'https://community.test'),
      config: {}, db: {}, requireUser: () => ({ id: '1' }) }
    await assert.rejects(handleLottery(ctx), /LOTTERY_ACCOUNT_CHANGED/)
    ctx.requireUser = () => { throw new Error('UNAUTHORIZED') }
    await assert.rejects(handleLottery(ctx), /UNAUTHORIZED/)
  }
})

test('shared welfare pool, check-in delivery and Beijing rollover on PostgreSQL', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const before = process.env[key]; process.env[key] = value
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before })
  }
  const control = new pg.Pool({ connectionString })
  assert.equal((await control.query("SELECT to_regnamespace('welfare_points_test') AS existing")).rows[0].existing, null)
  await control.query('CREATE SCHEMA welfare_points_test')
  const pool = new pg.Pool({ connectionString, options: '-c search_path=welfare_points_test', max: 16 })
  t.after(async () => { await pool.end(); await control.query('DROP SCHEMA welfare_points_test CASCADE'); await control.end() })
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
  let clock, support, capability, afterGet, deliveryError, lostResponse
  const grants = new Map(), posts = []
  // Exercise delivery explicitly so no background worker races test assertions.
  const db = { connect: () => pool.connect(), query: (sql, args) => sql.startsWith('SELECT id FROM community_lottery_draw') ? Promise.resolve({ rows: [] }) : pool.query(sql, args) }
  const service = createLotteryService({ db, config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 's'.repeat(32) } },
    now: () => new Date(clock), logger: { warn() {} }, fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error')
      if (options.method === 'GET') {
        if (afterGet) await afterGet()
        const user = new URL(url).searchParams.get('user_id')
        return Response.json({ ready: true, client_id: 'https://community.test', reward_kinds: ['balance', 'charity'],
          quota_per_point: 100, quota_per_usd: 500000, exact_points: true, ...capability,
          ...(user ? { user_id: Number(user), basis: 'support', has_support: support, support_cny_fen: support ? 100 : 0 } : {}) })
      }
      const body = JSON.parse(options.body); posts.push(body)
      assert.equal(body.reward_kind, 'charity')
      if (deliveryError) return new Response('{}', { status: deliveryError })
      if (!grants.has(body.reference)) {
        const creditedAt = Math.floor(clock.getTime() / 1000), points = body.points ?? body.amount_cents * 50
        grants.set(body.reference, { credited: true, reference: body.reference, user_id: body.user_id, amount_cents: body.amount_cents,
          receipt: { id: grants.size + 1, quota_added: points * 100, quota_per_usd: '500000', reward_kind: 'charity',
            validity_hours: body.validity_hours, credited_at: creditedAt, expires_at: creditedAt + body.validity_hours * 3600,
            lot_id: grants.size + 1, points: String(points), quota_per_point: 100, ...(body.points === undefined ? {} : { requested_points: body.points }) } })
      }
      if (lostResponse) { lostResponse = false; throw new Error('response lost after upstream commit') }
      return Response.json(grants.get(body.reference))
    } })
  async function reset(settings = defaults()) {
    invalidatePublicLotterySummary(db); grants.clear(); posts.length = 0
    clock = new Date('2026-11-26T03:00:00Z'); support = true; capability = {}; afterGet = null; deliveryError = 0; lostResponse = false
    await pool.query('TRUNCATE community_lottery_config,community_lottery_account,community_lottery_draw,external_account,"user"')
    await pool.query("INSERT INTO community_lottery_config VALUES ('default',0,$1)", [settings])
    await pool.query(`INSERT INTO "user" (id) SELECT i::text FROM generate_series(1,100) i;
      INSERT INTO external_account SELECT 'https://accounts.test',id,id FROM "user";
      INSERT INTO community_lottery_account SELECT id,5,'{"invites":0,"followers":0,"likes":0,"works":{}}'::jsonb FROM "user";`)
  }
  const claim = (id, key = randomUUID()) => service.checkin(String(id), key)
  const draw = (id, key = randomUUID()) => service.draw(String(id), key, 1)
  const balance = async id => (await pool.query('SELECT balance FROM community_lottery_account WHERE "userId"=$1', [String(id)])).rows[0].balance
  const state = () => service.welfare('1')

  await t.test('daily defaults grant 500–700 integer points without support or spending lottery chances', async () => {
    await reset(); support = false
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => claim(i + 1)))
    for (const result of results) {
      const award = result.prizes[0]
      assert.equal(result.source, 'checkin'); assert.equal(award.validityHours, 24); assert.equal(award.rewardKind, 'charity')
      assert(Number.isInteger(award.rewardPoints) && award.rewardPoints >= 500 && award.rewardPoints <= 700)
      assert.equal(await balance(result.userId), 5)
    }
    assert.equal((await service.status('1')).daily.used, 0)
    assert.equal((await state()).pool.reserved, results.reduce((sum, r) => sum + r.prizes[0].rewardPoints, 0))
    assert.equal((await readPublicLotteryRecords(db, new URLSearchParams())).items.length, 0)
    assert.equal((await readPublicLotterySummary(db)).totals.drawCount, '0')
  })
  await t.test('same request, competing requests and alias accounts all receive one daily award', async () => {
    await reset()
    // Establish the persisted request ID before racing alternative IDs for the daily award.
    const key = randomUUID(), sameRequest = await Promise.all([claim(1, key), claim(1, key)])
    const results = [...sameRequest, ...await Promise.all([claim(1), claim(1)])]
    assert.equal(new Set(results.map(r => r.id)).size, 1)
    await pool.query("UPDATE external_account SET subject='1' WHERE \"userId\"='2'")
    assert.equal((await claim(2)).id, results[0].id)
    assert.equal((await state()).pool.claimed, results[0].prizes[0].rewardPoints)
    await assert.rejects(draw(1, key), /LOTTERY_CONFLICT/)
    const drawn = await draw(3, key)
    await assert.rejects(claim(3, key), /LOTTERY_CONFLICT/)
    assert.notEqual(drawn.id, results[0].id)
  })
  await t.test('617 points deliver exactly once with 24h expiry and a lost response retains its reservation', async () => {
    await reset({ ...defaults(), checkin: { enabled: true, minPoints: 617, maxPoints: 617 } })
    const key = randomUUID(), result = await claim(1, key)
    lostResponse = true
    assert.equal((await service.deliver(result.id)).prizes[0].status, 'pending')
    assert.equal((await state()).pool.reserved, 617); assert.equal(grants.size, 1)
    await pool.query('UPDATE community_lottery_draw SET "creditRetryAt"=NULL')
    const delivered = await service.deliver(result.id)
    assert.equal(delivered.prizes[0].points, '617'); assert.equal(delivered.prizes[0].expiresAt, Math.floor(clock.getTime() / 1000) + 86400)
    assert.deepEqual(posts.map(body => [body.amount_cents, body.points, body.validity_hours]), [[0, 617, 24], [0, 617, 24]])
    assert.equal(grants.size, 1)
    await service.deliver(result.id); assert.equal(posts.length, 2)
    assert.equal((await claim(1, key)).id, result.id)
    assert.equal((await state()).pool.claimed, 617); assert.equal((await state()).pool.reserved, 0)
  })
  await t.test('lottery debit is shared: 600000 becomes 599000 and pending credits are reserved', async () => {
    await reset(); const result = await draw(1)
    assert.equal(result.prizes[0].rewardPoints, 1000)
    assert.equal((await state()).pool.remaining, 599000)
    await service.deliver(result.id)
    assert.equal((await state()).pool.remaining, 599000); assert.equal((await state()).pool.delivered, 1000)
    assert.equal(posts[0].amount_cents, 0); assert.equal(posts[0].points, 1000)
  })
  await t.test('simultaneous draws and check-ins never exceed the pool and rejection consumes no chance', async () => {
    await reset({ ...defaults(), dailyBudgetPoints: 10000, checkin: { enabled: true, minPoints: 500, maxPoints: 500 } })
    const results = await Promise.allSettled(Array.from({ length: 60 }, (_, i) => i % 2 ? claim(i + 1) : draw(i + 1)))
    assert.equal((await state()).pool.remaining, 0); assert.equal((await state()).pool.claimed, 10000)
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') { assert.match(result.reason.message, /WELFARE_POOL_EXHAUSTED/); assert.equal(await balance(i + 1), 5) }
      else assert.equal(await balance(i + 1), i % 2 ? 5 : 4)
    }
    await assert.rejects(claim(99), /WELFARE_POOL_EXHAUSTED/)
  })
  await t.test('insufficient minimum and empty-only lottery leave eligibility intact', async () => {
    await reset({ ...defaults(), dailyBudgetPoints: 499 })
    await assert.rejects(claim(1), /WELFARE_POOL_EXHAUSTED/)
    assert.equal((await state()).checkin.claimed, false)
    const config = await service.getConfig()
    await service.updateConfig(config.version, { ...config.settings, dailyBudgetPoints: 550 })
    const result = await claim(1)
    assert(result.prizes[0].rewardPoints <= 550)
    await reset({ ...defaults(), dailyBudgetPoints: 500, dailyLimit: 201, prizes: [...defaults().prizes,
      { id: 'empty', name: '未中奖', description: '', amountCents: 0, kind: 'empty', stock: 1, weight: 1, enabled: true }] })
    await assert.rejects(draw(1), /WELFARE_POOL_EXHAUSTED/)
    assert.equal(await balance(1), 5); assert.equal((await service.status('1')).daily.used, 0)
  })
  await t.test('blocked delivery stays reserved and cannot reopen a depleted budget', async () => {
    await reset({ ...defaults(), dailyBudgetPoints: 617, checkin: { enabled: true, minPoints: 617, maxPoints: 617 } })
    const result = await claim(1); deliveryError = 409
    await service.deliver(result.id)
    assert.equal((await state()).pool.reserved, 617)
    await assert.rejects(claim(2), /WELFARE_POOL_EXHAUSTED/)
    assert.equal((await claim(1)).id, result.id)
  })
  await t.test('Beijing midnight resets allocations while old request recovery and late delivery retain yesterday', async () => {
    await reset({ ...defaults(), dailyBudgetPoints: 500, checkin: { enabled: true, minPoints: 500, maxPoints: 500 } })
    clock = new Date('2026-11-26T15:59:59Z')
    const key = randomUUID(), before = await claim(1, key)
    clock = new Date('2026-11-26T16:00:00Z')
    assert.equal((await state()).pool.date, '2026-11-27'); assert.equal((await state()).pool.remaining, 500)
    assert.equal((await claim(1, key)).id, before.id)
    await service.deliver(before.id); assert.equal((await state()).pool.remaining, 500)
    assert.notEqual((await claim(1)).id, before.id)
  })
  await t.test('request waiting for the allocation lock takes the day after the lock is acquired', async () => {
    await reset(); clock = new Date('2026-11-26T15:59:59Z')
    const lock = await pool.connect(); await lock.query('BEGIN'); await lock.query('SELECT * FROM community_lottery_config FOR UPDATE')
    let observed; const lookedUp = new Promise(resolve => { observed = resolve }); afterGet = async () => observed()
    const pending = claim(1); await lookedUp
    clock = new Date('2026-11-26T16:00:00Z')
    await lock.query('COMMIT'); lock.release()
    assert.equal((await pending).createdAt, clock.toISOString())
    assert.equal((await state()).pool.date, '2026-11-27')
  })
  await t.test('legacy receipts count toward activation; unknown old allocations block it; admin cannot toggle the gate', async () => {
    await reset({ ...defaults(), welfarePointsReady: false })
    const legacy = await draw(1)
    assert.equal(legacy.prizes[0].rewardPoints, undefined)
    await assert.rejects(service.activateWelfare(), /WELFARE_UNVERIFIED_LEGACY_AWARDS/)
    const config = await service.getConfig()
    assert.equal((await service.updateConfig(config.version, { ...config.settings, welfarePointsReady: true })).settings.welfarePointsReady, false)
    await assert.rejects(claim(1), /WELFARE_CHECKIN_DISABLED/)
    await service.deliver(legacy.id)
    const activated = await service.activateWelfare()
    assert.equal(activated.pool.remaining, 599000)
    const activeConfig = await service.getConfig()
    assert.equal((await service.updateConfig(activeConfig.version, { ...activeConfig.settings, welfarePointsReady: false })).settings.welfarePointsReady, true)
    await pool.query(`UPDATE community_lottery_draw SET prizes=jsonb_set(prizes,'{0,creditReceipt,quotaAdded}','1')`)
    assert.equal((await state()).pool.ready, false)
    await assert.rejects(claim(2), /WELFARE_UNAVAILABLE/)
  })
  await t.test('disabled, unsupported and suspended users never get new rewards; current receipts still recover', async () => {
    await reset(); const key = randomUUID(), result = await claim(1, key)
    const config = await service.getConfig()
    await service.updateConfig(config.version, { ...config.settings, checkin: { enabled: false, minPoints: 500, maxPoints: 700 } })
    assert.equal((await claim(1, key)).id, result.id)
    await assert.rejects(claim(2), /WELFARE_CHECKIN_DISABLED/)
    await reset(); capability = { exact_points: false }
    await assert.rejects(claim(1), /WELFARE_UNAVAILABLE/)
    capability = {}; await pool.query('UPDATE "user" SET "isSuspended"=true WHERE id=\'1\'')
    await assert.rejects(claim(1), /LOTTERY_FORBIDDEN/)
  })
  await t.test('reminders hide exhausted prize ranges and anonymous status respects the shared pool', async () => {
    await reset({ ...defaults(), dailyLimit: 1, prizes: [{ ...defaults().prizes[0], stock: 1, weight: 1 }] })
    await draw(1)
    const reminder = await service.welfare('2')
    assert.equal(reminder.lottery.maxPoints, null)
    await reset({ ...defaults(), dailyBudgetPoints: 500 })
    assert((await service.status()).settings.prizes.every(prize => prize.stock === 0))
    assert.equal((await service.welfare('1')).lottery.maxPoints, null)
  })
})
