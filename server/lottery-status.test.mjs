/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { defaultLotterySettings, emptyLotteryProgress } from './business/lottery.ts'
import { createLotteryService } from './lottery.ts'

function fixture(settings = defaultLotterySettings(), progress = emptyLotteryProgress(), balance = 5) {
  const queries = [], account = { userId: '1', balance, progress }, counts = { followers: 0, works: [] }
  const client = { async query(sql, values = []) {
    queries.push({ sql, values })
    if (sql.startsWith('SELECT id FROM "user"')) return { rows: [{ id: '1' }] }
    if (sql.startsWith('SELECT * FROM community_lottery_config')) return { rows: [{ id: 'default', version: 0, settings: structuredClone(settings) }] }
    if (sql.startsWith('SELECT * FROM community_lottery_account')) return { rows: [structuredClone(account)] }
    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: sql.includes('FROM following') ? counts.followers : 0 }] }
    if (sql.startsWith('SELECT s.id,COUNT')) return { rows: counts.works }
    if (sql.startsWith('UPDATE community_lottery_account')) Object.assign(account, { balance: values[1], progress: JSON.parse(values[2]) })
    return { rows: [] }
  }, release() {} }
  const service = createLotteryService({ db: { connect: async () => client }, config: { url: 'https://community.test' } })
  return { service, queries, account, counts }
}

test('unchanged status reads retain a per-user lock without global locks or storage writes', async () => {
  const f = fixture()
  for (let repeat = 0; repeat < 2; repeat++) {
    f.queries.length = 0
    assert.equal((await f.service.status('1')).balance, 5)
    assert.equal(f.queries.length, 8)
    assert(f.queries.some(({ sql }) => sql === 'SELECT * FROM community_lottery_account WHERE "userId"=$1 FOR UPDATE'))
    assert.equal(f.queries.some(({ sql }) => /community_lottery_config.*FOR UPDATE/.test(sql)), false)
    assert.deepEqual(f.queries.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql)), [])
  }
  f.queries.length = 0
  await f.service.getConfig()
  assert.deepEqual(f.queries.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql)), [])
})

test('zero-credit progress changes persist once and keep unrelated publication progress', async () => {
  const progress = { ...emptyLotteryProgress(), publication: { count: 2, rewardedAt: null, rewardTickets: 0 } }
  const f = fixture({ ...defaultLotterySettings(), enabled: true }, progress)
  f.counts.works = [{ id: 'work1', likes: 10 }]
  assert.equal((await f.service.status('1')).balance, 5)
  assert.deepEqual(f.account.progress, { ...progress, works: { work1: 0 } })
  assert.equal(f.queries.filter(({ sql }) => sql.startsWith('UPDATE community_lottery_account')).length, 1)
  f.queries.length = 0
  await f.service.status('1')
  assert.deepEqual(f.queries.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql)), [])
})

test('an overflowing credit leaves both balance and recorded progress unchanged', async () => {
  const settings = { ...defaultLotterySettings(), enabled: true, followers: { enabled: true, threshold: 1, tickets: 1 } }
  const f = fixture(settings, emptyLotteryProgress(), 2147483647)
  f.counts.followers = 1
  assert.equal((await f.service.status('1')).balance, 2147483647)
  assert.deepEqual(f.account.progress, emptyLotteryProgress())
  assert.deepEqual(f.queries.filter(({ sql }) => sql.startsWith('UPDATE community_lottery_account')), [])
})

test('PostgreSQL status reads avoid global contention and retain atomic rewards, configuration changes and draws',
  { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  const url = new URL(connectionString)
  assert.equal(url.pathname, '/community_follow_test')
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const schema = `lottery_status_test_${randomBytes(6).toString('hex')}`
  const control = new pg.Pool({ connectionString })
  await control.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 12 })
  t.after(async () => { await pool.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  await pool.query(`CREATE TABLE "user" (id text PRIMARY KEY,host text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text);
    CREATE TABLE community_lottery_config (id text PRIMARY KEY,version integer NOT NULL,settings jsonb NOT NULL);
    CREATE TABLE community_lottery_account ("userId" text PRIMARY KEY,balance integer NOT NULL,progress jsonb NOT NULL);
    CREATE TABLE community_lottery_draw (id text PRIMARY KEY,"userId" text,"requestId" text,prizes jsonb,"createdAt" timestamptz,
      "creditIssuer" text,"creditSubject" text,"creditPending" boolean,"creditAttempts" integer,"creditRetryAt" timestamptz,UNIQUE("userId","requestId"));
    CREATE TABLE external_account (issuer text,"userId" text,subject text);
    CREATE TABLE community_lottery_referral ("inviterId" text);
    CREATE TABLE following ("followerId" text,"followeeId" text);
    CREATE TABLE community_submission (id text,"approvedNoteId" text,"authorId" text,status text,destination text);
    CREATE TABLE note (id text,visibility text);
    CREATE TABLE note_reaction (id text,"noteId" text,"userId" text,reaction text)`)
  const queries = []
  function database(lockTimeout = '3s') {
    return {
      async connect() {
        const client = await pool.connect()
        await client.query(`SET lock_timeout='${lockTimeout}'`)
        return { async query(sql, values) { queries.push({ sql, values }); return client.query(sql, values) }, release: () => client.release() }
      },
      query: (sql, values) => sql.startsWith('SELECT id FROM community_lottery_draw') ? Promise.resolve({ rows: [] }) : pool.query(sql, values),
    }
  }
  function service(lockTimeout) {
    return createLotteryService({ db: database(lockTimeout),
      config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 's'.repeat(32) } },
      fetcher: async (url, options) => {
        assert.equal(options.method, 'GET', 'The regression must never submit a real reward')
        return Response.json({ ready: true, client_id: 'https://community.test',
          user_id: Number(new URL(url).searchParams.get('user_id')), basis: 'support', has_support: true, support_cny_fen: 1,
          reward_kinds: ['balance', 'charity'], quota_per_point: 100 })
      } })
  }
  const api = service()
  const settings = () => ({ ...defaultLotterySettings(), enabled: true,
    likes: { enabled: false, threshold: 1, tickets: 1 }, followers: { enabled: true, threshold: 1, tickets: 1 },
    prizes: [{ id: 'empty', name: 'Empty', description: '', kind: 'empty', amountCents: 0, weight: 1, stock: 1, enabled: true }] })
  async function reset(config = settings(), { balance = 5, progress = emptyLotteryProgress() } = {}) {
    await pool.query('TRUNCATE "user",community_lottery_config,community_lottery_account,community_lottery_draw,external_account,community_lottery_referral,following,community_submission,note,note_reaction')
    await pool.query(`INSERT INTO "user" (id) SELECT i::text FROM generate_series(1,8) i;
      INSERT INTO external_account SELECT 'https://accounts.test',id,id FROM "user"`)
    if (config) await pool.query(`INSERT INTO community_lottery_config VALUES ('default',0,$1)`, [config])
    await pool.query('INSERT INTO community_lottery_account SELECT id,$1,$2::jsonb FROM "user"', [balance, JSON.stringify(progress)])
    queries.length = 0
  }
  async function waitForAccountLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await control.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM community_lottery_account%' AND query LIKE '%FOR UPDATE'`)
      if (waiting.rows.length) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('Status did not wait on the blocked user account')
  }
  const stored = async id => (await pool.query('SELECT balance,progress,xmin::text AS revision FROM community_lottery_account WHERE "userId"=$1', [id])).rows[0]
  const draw = (id, requestId = randomUUID()) => api.draw(id, requestId, 1)

  await t.test('unchanged reads do not create new account row versions', async () => {
    await reset()
    const before = await stored('1')
    await Promise.all(Array.from({ length: 8 }, () => api.status('1')))
    assert.deepEqual(await stored('1'), before)
    assert.deepEqual(queries.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql)), [])
  })
  await t.test('waiting on one user leaves other users and draw configuration locks available', async () => {
    await reset()
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT * FROM community_lottery_account WHERE "userId"=\'1\' FOR UPDATE')
    const pending = api.status('1').then(value => ({ value }), error => ({ error }))
    try {
      await waitForAccountLock()
      const other = service('200ms')
      assert.equal((await other.status('2')).balance, 5)
      assert.equal((await other.draw('2', randomUUID(), 1)).prizes.length, 1)
    } finally { await blocker.query('ROLLBACK'); blocker.release() }
    const settled = await pending
    if (settled.error) throw settled.error
    assert.equal(settled.value.balance, 5)
    assert.equal((await stored('2')).balance, 4)
  })
  await t.test('competing status requests credit each entitlement once and retain publication data', async () => {
    const progress = { ...emptyLotteryProgress(), publication: { count: 2, rewardedAt: null, rewardTickets: 0 } }
    await reset(settings(), { balance: 0, progress })
    await pool.query(`INSERT INTO following VALUES ('3','1'),('4','1'),('5','1')`)
    const results = await Promise.all(Array.from({ length: 12 }, () => api.status('1')))
    assert(results.every(result => result.balance === 3))
    assert.deepEqual((await stored('1')).progress, { ...progress, followers: 3 })
    assert.equal(queries.filter(({ sql }) => sql.startsWith('UPDATE community_lottery_account SET balance=$2,progress=')).length, 1)
  })
  await t.test('new account and default configuration creation remain safe under concurrent first visits', async () => {
    await reset(null)
    await pool.query('DELETE FROM community_lottery_account WHERE "userId"=\'1\'')
    const results = await Promise.all(Array.from({ length: 8 }, () => api.status('1')))
    assert(results.every(result => result.balance === 0))
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM community_lottery_config')).rows[0].count, 1)
    assert.deepEqual((await stored('1')).progress, emptyLotteryProgress())
  })
  await t.test('a waiting old snapshot and the updated rule cannot duplicate credits or bypass stock', async () => {
    const config = settings(); config.followers.threshold = 2
    await reset(config, { balance: 0 })
    await pool.query(`INSERT INTO following VALUES ('3','1'),('4','1')`)
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT * FROM community_lottery_account WHERE "userId"=\'1\' FOR UPDATE')
    const pending = api.status('1').then(value => ({ value }), error => ({ error }))
    try {
      await waitForAccountLock()
      config.followers.threshold = 1
      await service('200ms').updateConfig(0, config)
    } finally { await blocker.query('ROLLBACK'); blocker.release() }
    const settled = await pending
    if (settled.error) throw settled.error
    assert.equal(settled.value.balance, 1)
    assert.equal((await api.status('1')).balance, 2)
    assert.equal((await api.status('1')).balance, 2)
    const key = randomUUID(), receipt = await draw('1', key)
    assert.equal((await draw('1', key)).id, receipt.id)
    await assert.rejects(draw('1'), /LOTTERY_UNAVAILABLE/)
    assert.equal((await stored('1')).balance, 1)
    assert.equal((await stored('1')).progress.followers, 2)
    assert.equal((await api.getConfig()).settings.prizes[0].stock, 0)
  })
  await t.test('simultaneous status and repeated draws cannot lose earned chances or double consume stock', async () => {
    await reset(settings(), { balance: 0 })
    await pool.query(`INSERT INTO following VALUES ('3','1')`)
    const key = randomUUID()
    const results = await Promise.all([
      draw('1', key), ...Array.from({ length: 8 }, () => api.status('1')), draw('1', key),
    ])
    assert.equal(results[0].id, results.at(-1).id)
    assert.equal((await stored('1')).balance, 0)
    assert.equal((await stored('1')).progress.followers, 1)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM community_lottery_draw')).rows[0].count, 1)
    assert.equal((await api.getConfig()).settings.prizes[0].stock, 0)
    await assert.rejects(draw('2'), /LOTTERY_UNAVAILABLE/)
    assert.equal((await stored('2')).balance, 0)
  })
})
