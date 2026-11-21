import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { defaultWelfareTasks, publicationCooldownMs, welfareTasksSchema } from '../shared/welfare-tasks.ts'
import { emptyLotteryProgress, defaultLotterySettings, lotteryCredits } from './business/lottery.ts'
import { publicationStatus, readPublicationStatus, rewardPublication } from './publication-reward.ts'

test('publication rewards validate integers and are confined to the publishing task', () => {
  for (const patch of [{ threshold: 0 }, { threshold: 1.5 }, { threshold: 1000001 }, { tickets: 0 }, { tickets: 1001 }, { tickets: '1' }, { enabled: 1 }, { cooldown: 0 }]) {
    const items = defaultWelfareTasks(); Object.assign(items[1].publicationReward, patch)
    assert.equal(welfareTasksSchema.safeParse(items).success, false)
  }
  const items = defaultWelfareTasks(); items[0].publicationReward = items[1].publicationReward
  assert.equal(welfareTasksSchema.safeParse(items).success, false)
})

test('cooldown is exactly 24 elapsed hours and legacy lottery synchronization preserves publication progress', () => {
  const progress = { count: 2, rewardedAt: '2026-11-22T05:30:00.000Z', rewardTickets: 3 }
  assert.equal(publicationStatus(progress, new Date('2026-11-23T05:29:59.999Z')).resetsAt, '2026-11-23T05:30:00.000Z')
  assert.equal(publicationStatus(progress, new Date('2026-11-23T05:30:00.000Z')).resetsAt, null)
  assert.equal(publicationStatus(progress, new Date('2026-11-23T05:30:00.000Z')).count, 0)
  const account = { ...emptyLotteryProgress(), publication: progress }
  assert.deepEqual(lotteryCredits(account, { invites: 0, followers: 0, works: [] }, defaultLotterySettings()).progress.publication, progress)
})

test('public task progress is read-only and never trusts a requested target user', async () => {
  let calls = 0
  const db = { async query(sql, args) { calls++; assert.match(sql, /^SELECT/); assert.deepEqual(args, ['member']); return { rows: [] } } }
  assert.equal(await readPublicationStatus(db), null)
  assert.equal(calls, 0)
  assert.equal((await readPublicationStatus(db, 'member')).count, 0)
  assert.equal(calls, 1)
})

test('publication rewards PostgreSQL atomicity, history and rolling cooldown', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const schema = `publication_${randomUUID().replaceAll('-', '')}`
  const control = new pg.Pool({ connectionString })
  await control.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 12 })
  t.after(async () => { await pool.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  await pool.query(`CREATE TABLE meta(id text PRIMARY KEY,"clientOptions" jsonb);
    CREATE TABLE community_submission(id text PRIMARY KEY,"authorId" text,destination text DEFAULT 'community',status text DEFAULT 'pending',"approvedNoteId" text,"submittedAt" timestamptz DEFAULT NOW());
    CREATE TABLE community_lottery_account("userId" text PRIMARY KEY,balance integer NOT NULL,progress jsonb NOT NULL);
    CREATE TABLE moderation_log(id text PRIMARY KEY,"userId" text,type text,info jsonb);
    INSERT INTO meta VALUES ('meta','{}');
    INSERT INTO community_submission(id,"authorId",status,"approvedNoteId") VALUES ('historic','u','published','note'),('removed','u','removed',NULL),('removedDraft','u','draft',NULL),('pending','u','pending',NULL);
    INSERT INTO moderation_log VALUES ('remove','admin','communityReview','{"submissionId":"removedDraft","action":"remove"}');`)
  const migration = await readFile(new URL('../migration/20261122-publication-reward.up.sql', import.meta.url), 'utf8')
  await pool.query(migration)
  let clock = new Date('2026-11-22T05:30:00.000Z')
  const now = () => new Date(clock)
  const rule = async (patch = {}) => {
    const items = defaultWelfareTasks(); Object.assign(items[1].publicationReward, patch)
    await pool.query('UPDATE meta SET "clientOptions"=$1', [{ communityWelfareTasks: items }])
  }
  const publish = async (id, user = 'u', auditId = randomUUID) => {
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      await db.query('INSERT INTO community_submission(id,"authorId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, user])
      await rewardPublication(db, id, user, auditId, now)
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error }
    finally { db.release() }
  }
  const account = async (user = 'u') => (await pool.query('SELECT * FROM community_lottery_account WHERE "userId"=$1', [user])).rows[0]
  await t.test('migration excludes previous public/removal history, keeps pending eligibility and is repeatable', async () => {
    await pool.query(migration)
    for (const id of ['historic', 'removed', 'removedDraft']) await publish(id)
    assert.equal(await account(), undefined)
    await publish('pending')
    assert.equal((await account()).balance, 1)
    await publish('pending'); assert.equal((await account()).balance, 1)
  })
  await t.test('parallel first publications award only once and retain unrelated chance adjustments', async () => {
    await rule({ threshold: 2, tickets: 3 })
    await Promise.all(Array.from({ length: 20 }, (_, i) => publish(`parallel${i}`, 'parallel')))
    assert.equal((await account('parallel')).balance, 3)
    assert.equal((await account('parallel')).progress.publication.count, 2)
    await Promise.all([publish('parallelExtra', 'parallel'), pool.query('UPDATE community_lottery_account SET balance=balance+7 WHERE "userId"=$1', ['parallel'])])
    assert.equal((await account('parallel')).balance, 10)
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM moderation_log WHERE type='communityPublicationReward' AND "userId"='parallel'`)).rows[0].count, 1)
  })
  await t.test('cooldown works never carry forward and exact expiry starts with fresh publications', async () => {
    await rule()
    clock = new Date(clock.getTime() + publicationCooldownMs - 1)
    await publish('cooldown'); assert.equal((await account()).balance, 1)
    clock = new Date(clock.getTime() + 1)
    await publish('cooldown'); assert.equal((await account()).balance, 1)
    await publish('next'); assert.equal((await account()).balance, 2)
    assert.equal((await account()).progress.publication.rewardedAt, clock.toISOString())
  })
  await t.test('configuration changes preserve progress and earned cooldown; paused publications stay excluded', async () => {
    await rule({ threshold: 3, tickets: 2 }); await publish('adjust1', 'adjust')
    assert.equal((await account('adjust')).progress.publication.count, 1)
    await rule({ threshold: 2, tickets: 5 }); await publish('adjust2', 'adjust')
    assert.equal((await account('adjust')).balance, 5)
    await rule({ enabled: false }); await publish('paused', 'paused')
    assert.equal(await account('paused'), undefined)
    await rule({ tickets: 9 }); await publish('paused', 'paused'); await publish('adjust3', 'adjust')
    assert.equal(await account('paused'), undefined)
    assert.equal((await account('adjust')).balance, 5)
  })
  await t.test('audit failure and overflow roll back both balance and first-publication marker', async () => {
    await rule()
    await assert.rejects(publish('auditFailure', 'fail', () => 'remove'), error => error.code === '23505')
    assert.equal(await account('fail'), undefined)
    assert.equal((await pool.query('SELECT id FROM community_submission WHERE id=$1', ['auditFailure'])).rows.length, 0)
    await pool.query('INSERT INTO community_lottery_account VALUES ($1,2147483647,$2)', ['overflow', emptyLotteryProgress()])
    await assert.rejects(publish('overflowWork', 'overflow'), { statusCode: 409 })
    assert.equal((await account('overflow')).balance, 2147483647)
  })
  await t.test('clock is sampled after a blocked account lock and status reads do not award', async () => {
    await publish('clockFirst', 'clock')
    const first = clock.getTime()
    const blocker = await pool.connect(); await blocker.query('BEGIN')
    await blocker.query('SELECT 1 FROM community_lottery_account WHERE "userId"=$1 FOR UPDATE', ['clock'])
    let sampled = false
    const pending = (async () => {
      const db = await pool.connect()
      try {
        await db.query('BEGIN'); await db.query('INSERT INTO community_submission(id,"authorId") VALUES (\'clockNext\',\'clock\')')
        await rewardPublication(db, 'clockNext', 'clock', randomUUID, () => { sampled = true; return now() })
        await db.query('COMMIT')
      } finally { db.release() }
    })()
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(sampled, false)
    clock = new Date(first + publicationCooldownMs)
    await blocker.query('COMMIT'); blocker.release(); await pending
    assert.equal((await account('clock')).balance, 2)
    assert.equal((await account('clock')).progress.publication.rewardedAt, clock.toISOString())
    const before = await account('clock'); await readPublicationStatus(pool, 'clock'); assert.deepEqual(await account('clock'), before)
  })
})
