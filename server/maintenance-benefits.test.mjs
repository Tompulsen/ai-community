import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { maintenanceInput } from '../shared/maintenance-benefits.ts'
import { createMaintenanceService, handleMaintenanceBenefits } from './maintenance-benefits.ts'

const definition = () => ({ title: '维护补偿', content: '感谢理解', credits: 88, rewardType: 'timed', rewardValidityDays: 30,
  startsAt: '2026-11-28T00:00:00Z', endsAt: '2026-12-28T00:00:00Z', popupMaxDisplays: 3, popupIntervalMinutes: 60 })
test('maintenance defaults are timed and reject invalid money, dates, expiry and popup limits', () => {
  const input = definition(); delete input.rewardType; delete input.rewardValidityDays
  assert.equal(maintenanceInput.parse(input).rewardType, 'timed'); assert.equal(maintenanceInput.parse(input).rewardValidityDays, 30)
  for (const patch of [{ credits: 0 }, { credits: 1.1 }, { credits: '88' }, { rewardType: 'permanent' }, { rewardValidityDays: 0 },
    { rewardValidityDays: 366 }, { endsAt: '2026-01-01T00:00:00Z' }, { startsAt: '2026-11-28T08:00' }, { popupMaxDisplays: 101 }, { popupIntervalMinutes: -1 }, { title: '' }]) {
    assert.equal(maintenanceInput.safeParse({ ...definition(), ...patch }).success, false, JSON.stringify(patch))
  }
})
test('maintenance routes enforce admin, login and expected account before database access', async () => {
  for (const path of ['/api/admin/maintenance-benefits', '/api/admin/maintenance-benefits/retry', '/api/maintenance-benefit', '/api/maintenance-benefit/claim', '/api/maintenance-benefit/display']) {
    const ctx = { req: { method: 'POST', headers: { 'x-new-api-user': 'other' } }, url: new URL(path, 'https://community.test'),
      requireUser: () => ({ id: '1' }), requireAdmin: () => ({ id: '1' }) }
    await assert.rejects(handleMaintenanceBenefits(ctx), /账号已切换/)
    ctx.requireUser = ctx.requireAdmin = () => { throw new Error('DENIED') }
    await assert.rejects(handleMaintenanceBenefits(ctx), /DENIED/)
  }
})

test('maintenance persistence, account isolation and idempotent credit delivery', async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  let db, embedded, control
  if (connectionString) {
    assert.equal(new URL(connectionString).pathname, '/community_follow_test')
    control = new pg.Pool({ connectionString })
    const schema = 'maintenance_test_' + randomBytes(5).toString('hex')
    await control.query(`CREATE SCHEMA ${schema}`)
    db = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 16 })
    t.after(async () => { await db.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  } else {
    embedded = new PGlite()
    const query = async (sql, values) => { const result = values?.length ? await embedded.query(sql, values) : /;\s*\S/.test(sql.trim().replace(/;$/, '')) ? (await embedded.exec(sql)).at(-1) : await embedded.query(sql); return { ...result, rowCount: result.affectedRows } }
    db = { query, connect: async () => ({ query, release() {} }) }
    t.after(() => embedded.close())
  }
  await db.query(`CREATE TABLE "user" (id varchar(32) PRIMARY KEY,host text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text);
    CREATE TABLE external_account (issuer text,"userId" text,subject text);
    CREATE TABLE moderation_log (id text PRIMARY KEY,"userId" text,type text,info jsonb);`)
  const migration = await readFile(new URL('../migration/20261128-maintenance-benefits.up.sql', import.meta.url), 'utf8')
  await db.query(migration); await db.query(migration)
  let clock, failure, lost, corrupt
  const grants = new Map(), posts = []
  const service = createMaintenanceService({ db, config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 'x'.repeat(32) } },
    newId: () => randomBytes(16).toString('hex'), now: () => new Date(clock), fetcher: async (url, options) => {
      assert.equal(url.pathname, '/api/community-sso/lottery/charity'); assert.equal(options.redirect, 'error')
      const body = JSON.parse(options.body); posts.push(body)
      assert.equal(body.amount_cents, 0); assert.equal(body.reward_kind, 'charity'); assert.match(body.reference, /^community_lottery_[a-zA-Z0-9]{1,32}_[0-4]$/)
      if (failure) return new Response('{}', { status: failure })
      if (!grants.has(body.reference)) {
        const creditedAt = Math.floor(clock / 1000)
        grants.set(body.reference, { credited: true, reference: body.reference, user_id: body.user_id, amount_cents: 0,
          receipt: { id: grants.size + 1, quota_added: body.points * 100, quota_per_usd: '500000', reward_kind: 'charity',
            validity_hours: body.validity_hours, credited_at: creditedAt, expires_at: creditedAt + body.validity_hours * 3600,
            lot_id: grants.size + 1, points: String(body.points), requested_points: body.points, quota_per_point: 100 } })
      }
      if (lost) { lost = false; throw Error('Response lost after committing credit') }
      const value = structuredClone(grants.get(body.reference))
      if (corrupt) value.receipt.expires_at++
      return Response.json(value)
    } })
  async function reset() {
    await db.query('TRUNCATE community_maintenance_delivery,community_maintenance_benefit,external_account,"user",moderation_log')
    await db.query(`INSERT INTO "user" (id) VALUES ('1'),('2'),('3'); INSERT INTO external_account VALUES ('https://accounts.test','1','17'),('https://accounts.test','2','18'),('https://accounts.test','3','17');`)
    clock = Date.parse('2026-11-28T08:00:00Z'); failure = 0; lost = false; corrupt = false; grants.clear(); posts.length = 0
  }
  const save = (id = 'benefit1', version = 0, patch = {}, isActive = true) => service.save('1', { id, version, definition: { ...definition(), ...patch }, isActive })
  const display = (user = '1', version = 1) => service.display(user, 'benefit1', version)
  const claim = (user = '1', version = 1) => service.claim(user, 'benefit1', version)
  await t.test('activation is exclusive, edits are versioned and operations are audited', async () => {
    await reset(); await save(); await save('benefit2')
    const rows = (await service.list()).benefits
    assert.equal(rows.filter(r => r.isActive).length, 1)
    assert.equal(rows.find(r => r.id === 'benefit1').version, 2)
    await assert.rejects(save('benefit1', 1), /其他管理员修改/)
    assert.equal((await db.query('SELECT * FROM moderation_log')).rows.length, 2)
  })
  await t.test('server controls displays, interval, maximum and distinct account state', async () => {
    await reset(); await save()
    assert((await service.offer('1')).benefit); assert((await service.offer('1')).benefit)
    assert.equal((await service.list()).benefits[0].totalDisplays, 0)
    assert((await display()).benefit); assert.equal((await display('3')).benefit, null)
    assert((await display('2')).benefit); assert.equal((await service.offer('1')).benefit, null)
    clock += 3600000; assert((await display()).benefit)
    clock += 3600000; assert((await display()).benefit)
    clock += 3600000; assert.equal((await display()).benefit, null)
    const row = (await service.list()).benefits[0]; assert.equal(row.recipientCount, 2); assert.equal(row.totalDisplays, 4)
  })
  await t.test('one exact timed grant survives duplicate claims, aliases, editing and activity stop', async () => {
    await reset(); await save(); await display()
    const first = (await claim()).claim; assert.equal(first.status, 'fulfilled'); assert.equal(first.credits, 88)
    assert.equal(first.expiresAt, clock / 1000 + 30 * 86400)
    assert.deepEqual((await claim('3')).claim, first); assert.equal(posts.length, 1)
    await save('benefit1', 1, { credits: 999, rewardValidityDays: 1 }, false)
    assert.deepEqual((await claim()).claim, first); assert.deepEqual((await service.offer('1','benefit1')).claim, first)
    assert.equal((await service.list()).benefits[0].claimedCount, 1); assert.equal(grants.size, 1)
    assert.equal((await service.records('1')).items[0].claim.status,'fulfilled')
    assert.equal((await service.records('2')).items.length,0)
    assert.equal((await service.records('3')).items[0].claim.reference,first.reference)
  })
  await t.test('changed or expired offers cannot mint credits; suspended and relinked identities cannot collect', async () => {
    await reset(); await save(); await assert.rejects(claim(), /先打开/); await display()
    await save('benefit1', 1, { credits: 90 })
    await assert.rejects(claim(), /内容已更新/)
    await db.query(`UPDATE external_account SET subject='99' WHERE "userId"='1'`)
    await assert.rejects(claim('1',2), /绑定已变化/)
    await db.query(`UPDATE "user" SET "isSuspended"=true WHERE id='2'`)
    await assert.rejects(display('2',2), /有效的统一积分账号/)
    clock = Date.parse('2026-12-28T00:00:00Z'); assert.equal((await service.offer('3')).benefit,null)
    await assert.rejects(claim('3',2), /已结束/); assert.equal(grants.size,0)
  })
  await t.test('lost successful response retries frozen parameters and original expiry after disabling campaign', async () => {
    await reset(); await save(); await display(); lost = true
    assert.equal((await claim()).claim.status,'pending'); assert.equal(grants.size,1)
    await save('benefit1',1,{ credits: 777, rewardValidityDays: 1 },false)
    clock += 120000; await service.processPending()
    const receipt = (await service.offer('1','benefit1')).claim
    assert.equal(receipt.status,'fulfilled'); assert.equal(receipt.credits,88); assert.equal(receipt.rewardValidityDays,30)
    assert.equal(grants.size,1); assert.deepEqual(posts[0],posts[1])
  })
  await t.test('invalid receipts block automatic retries; administrator retries the original grant', async () => {
    await reset(); await save(); await display(); corrupt = true
    assert.equal((await claim()).claim.status,'blocked')
    clock += 900000; await service.processPending(); assert.equal(posts.length,1)
    corrupt = false; await service.retry('1','benefit1'); await service.processPending()
    assert.equal((await service.offer('1','benefit1')).claim.status,'fulfilled'); assert.equal(grants.size,1)
  })
  await t.test('temporary outages have bounded automatic retries with a persistent pending record', async () => {
    await reset(); await save(); await display(); failure = 503
    assert.equal((await claim()).claim.status,'pending')
    for(let n=0;n<4;n++){ clock+=300000; await service.processPending() }
    assert.equal(posts.length,3); assert.equal((await service.offer('1','benefit1')).claim.status,'blocked')
    assert.equal((await service.list()).benefits[0].pendingCount,1)
    failure=0; await service.retry('1','benefit1'); await service.processPending()
    assert.equal(grants.size,1)
  })
  await t.test('parallel tabs, alias claims and administrators serialize on real PostgreSQL', { skip: !connectionString }, async () => {
    await reset(); await save()
    const shown=await Promise.all(Array.from({length:12},(_,i)=>display(i%2?'1':'3')))
    assert.equal(shown.filter(x=>x.benefit).length,1)
    const claims=await Promise.all(Array.from({length:12},(_,i)=>claim(i%2?'1':'3')))
    assert.equal(new Set(claims.map(x=>x.claim.reference)).size,1); assert.equal(grants.size,1)
    await Promise.all([save('benefit2'),save('benefit3')]); assert.equal((await service.list()).benefits.filter(x=>x.isActive).length,1)
  })
})
