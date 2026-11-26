import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { defaultWelfareTasks, welfareTasksSchema } from '../shared/welfare-tasks.ts'
import { lotteryDay } from '../shared/lottery-daily.ts'
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

test('legacy awarded tasks reset at the same Beijing midnight as the lottery', () => {
  const progress = { count: 2, rewardedAt: '2026-11-22T05:30:00.000Z', rewardTickets: 3 }
  const before = new Date('2026-11-22T15:59:59.999Z')
  assert.deepEqual(publicationStatus(progress, before), { ...progress, date: '2026-11-22', resetsAt: lotteryDay(before).end.toISOString(), serverTime: before.toISOString() })
  const after = publicationStatus(progress, new Date('2026-11-22T16:00:00.000Z'))
  assert.equal(after.date, '2026-11-23')
  assert.equal(after.count, 0)
  assert.equal(after.rewardedAt, null)
  assert.equal(after.rewardTickets, 0)
  assert.equal(after.resetsAt, '2026-11-23T16:00:00.000Z')
  assert.equal(publicationStatus(progress, new Date('2026-11-23T05:29:59.999Z')).rewardedAt, null)
  const account = { ...emptyLotteryProgress(), publication: progress }
  assert.deepEqual(lotteryCredits(account, { invites: 0, followers: 0, works: [] }, defaultLotterySettings()).progress.publication, progress)
})

test('unfinished progress and awards use Beijing calendar days, including month and year boundaries', () => {
  for (const [date, midnight, nextDate] of [
    ['2026-11-26', '2026-11-26T16:00:00.000Z', '2026-11-27'],
    ['2026-11-30', '2026-11-30T16:00:00.000Z', '2026-12-01'],
    ['2026-12-31', '2026-12-31T16:00:00.000Z', '2027-01-01'],
  ]) {
    const before = new Date(Date.parse(midnight) - 1)
    const progress = { date, count: 2, rewardedAt: null, rewardTickets: 0 }
    assert.equal(publicationStatus(progress, before).count, 2)
    assert.equal(publicationStatus(progress, before).resetsAt, midnight)
    const after = publicationStatus(progress, new Date(midnight))
    assert.equal(after.date, nextDate)
    assert.equal(after.count, 0)
    assert.equal(after.rewardedAt, null)
    assert.equal(publicationStatus({ ...progress, rewardedAt: before.toISOString(), rewardTickets: 3 }, new Date(midnight)).rewardedAt, null)
  }
  // Undated unfinished records cannot prove a current-day contribution.
  assert.equal(publicationStatus({ count: 5, rewardedAt: null, rewardTickets: 0 }).count, 0)
})

test('public task progress is read-only and never trusts a requested target user', async () => {
  let calls = 0
  const db = { async query(sql, args) { calls++; assert.match(sql, /^SELECT/); assert.deepEqual(args, ['member']); return { rows: [] } } }
  assert.equal(await readPublicationStatus(db), null)
  assert.equal(calls, 0)
  assert.equal((await readPublicationStatus(db, 'member')).count, 0)
  assert.equal(calls, 1)
})

test('publication rewards PostgreSQL atomicity, history and Beijing daily rollover', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
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
  await t.test('post-reward works never carry forward and Beijing midnight permits fresh publications', async () => {
    await rule()
    clock = new Date(lotteryDay(clock).end.getTime() - 1)
    await publish('cooldown'); assert.equal((await account()).balance, 1)
    clock = new Date(clock.getTime() + 1)
    await publish('cooldown'); assert.equal((await account()).balance, 1)
    await publish('next'); assert.equal((await account()).balance, 2)
    assert.equal((await account()).progress.publication.rewardedAt, clock.toISOString())
    assert.equal((await account()).progress.publication.date, lotteryDay(clock).date)
    const log = (await pool.query(`SELECT info FROM moderation_log WHERE type='communityPublicationReward' AND info->>'submissionId'='next'`)).rows[0].info
    assert.equal(log.resetsAt, lotteryDay(clock).end.toISOString())
  })
  await t.test('unfinished daily progress expires and concurrent next-day works award only once', async () => {
    await rule({ threshold: 3, tickets: 2 })
    await publish('partial1', 'partial'); await publish('partial2', 'partial')
    assert.equal((await account('partial')).progress.publication.count, 2)
    clock = lotteryDay(clock).end
    await publish('partial3', 'partial')
    assert.equal((await account('partial')).balance, 0)
    assert.equal((await account('partial')).progress.publication.count, 1)
    await Promise.all(Array.from({ length: 12 }, (_, i) => publish(`dailyParallel${i}`, 'partial')))
    assert.equal((await account('partial')).balance, 2)
    assert.equal((await account('partial')).progress.publication.count, 3)
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM moderation_log WHERE type='communityPublicationReward' AND "userId"='partial'`)).rows[0].count, 1)
  })
  await t.test('legacy awarded records use the new boundary without changing existing ticket balances', async () => {
    await rule()
    const day = lotteryDay(clock)
    await pool.query('INSERT INTO community_lottery_account VALUES ($1,7,$2)', ['legacy', { ...emptyLotteryProgress(), publication: { count: 1, rewardedAt: new Date(day.start.getTime() - 1000).toISOString(), rewardTickets: 1 } }])
    await publish('legacyToday', 'legacy')
    assert.equal((await account('legacy')).balance, 8)
    await publish('legacyTodayExtra', 'legacy')
    assert.equal((await account('legacy')).balance, 8)
  })
  await t.test('configuration changes preserve same-day progress and awards; paused publications stay excluded', async () => {
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
    const midnight = lotteryDay(clock).end
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
    clock = midnight
    await blocker.query('COMMIT'); blocker.release(); await pending
    assert.equal((await account('clock')).balance, 2)
    assert.equal((await account('clock')).progress.publication.rewardedAt, clock.toISOString())
    const before = await account('clock'); await readPublicationStatus(pool, 'clock'); assert.deepEqual(await account('clock'), before)
  })
})
