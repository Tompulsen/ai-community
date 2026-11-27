import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { requestDatabase, transactionalFixture } from './test-database.mjs'
import { registerImageRequest, registerDurableRequest, saveDurableRequest, readDurableRequest } from './request-store.ts'

const namespace = account => createHash('sha256').update(account).digest('hex')
const requestKey = (account, id) => `community-next:creation:request:${namespace(account)}:${id}`
const pending = () => ({ kind: 'image', deadline: Date.now() + 60000, result: { status: 'pending' } })
const admit = (db, account, id, count = 1, userId = account) =>
  registerImageRequest(db, requestKey(account, id), 'fingerprint', pending(), userId, namespace(account), count)
async function initialize(db, concurrent = false) {
  await db.query('CREATE TABLE meta (id text PRIMARY KEY,"clientOptions" jsonb NOT NULL)')
  await db.query('INSERT INTO meta VALUES ($1,$2)', ['site', JSON.stringify({})])
  const migration = await readFile(new URL('../../migration/20261127-image-concurrency.up.sql', import.meta.url), 'utf8')
  await db.query(concurrent ? migration : migration.replace(' CONCURRENTLY', ''))
}
async function reset(db, defaultLimit = 4, globalLimit = 10, userOverrides = {}) {
  await db.query('DELETE FROM community_creation_request')
  await db.query('UPDATE meta SET "clientOptions"=$1', [JSON.stringify({ communityImageConcurrency: { defaultLimit, globalLimit, userOverrides } })])
}
async function suite(t, db) {
  await t.test('batch images consume user slots while each batch consumes one global request', async () => {
    await reset(db, 4, 2)
    const first = await admit(db, 'one', 'batch', 4)
    assert.equal(first.row.record.imageCount, 4)
    await assert.rejects(admit(db, 'one', 'fifth'), { code: 'IMAGE_CONCURRENCY_LIMIT', statusCode: 429, notAccepted: true })
    await admit(db, 'two', 'batch', 4)
    await assert.rejects(admit(db, 'three', 'full'), { code: 'IMAGE_GLOBAL_LIMIT', statusCode: 429, notAccepted: true })
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM community_creation_request')).rows[0].count), 2)
  })
  await t.test('community IDs choose overrides and prototype properties cannot bypass defaults', async () => {
    await reset(db, 1, 10, { localuser: 3, '17': 1 })
    await admit(db, '17', 'one', 3, 'localuser')
    await assert.rejects(admit(db, '17', 'two', 1, 'localuser'), { code: 'IMAGE_CONCURRENCY_LIMIT' })
    await admit(db, 'other', 'one', 1, 'constructor')
    await assert.rejects(admit(db, 'other', 'two', 1, 'constructor'), { code: 'IMAGE_CONCURRENCY_LIMIT' })
  })
  await t.test('canonical retries return the original owner even at full limits', async () => {
    await reset(db, 1, 1)
    const first = await admit(db, 'one', 'same')
    const retry = await registerImageRequest(db, first.row.key, 'different-intent', pending(), 'one', namespace('one'), 2)
    assert.equal(retry.inserted, false)
    assert.equal(retry.row.owner, first.row.owner)
    assert.equal(retry.row.fingerprint, 'fingerprint')
    assert.equal(retry.row.record.imageCount, 1)
  })
  await t.test('pending and uncertain requests retain slots by generation deadline, independent of poll leases', async () => {
    await reset(db, 2, 10)
    const first = await admit(db, 'one', 'pending')
    await db.query('UPDATE community_creation_request SET next_poll=0 WHERE key=$1', [first.row.key])
    const second = await admit(db, 'one', 'uncertain')
    await saveDurableRequest(db, second.row, { ...second.row.record, result: { status: 'indeterminate' } }, null)
    await assert.rejects(admit(db, 'one', 'third'), { code: 'IMAGE_CONCURRENCY_LIMIT' })
    await db.query(`UPDATE community_creation_request SET record=jsonb_set(record,'{deadline}',$2::jsonb),next_poll=$3 WHERE key=$1`,
      [second.row.key, String(Date.now() - 1), Date.now() + 999999])
    await admit(db, 'one', 'after-deadline')
  })
  await t.test('explicit success and failure release capacity immediately despite future deadlines', async () => {
    await reset(db, 1, 1)
    for (const status of ['succeeded', 'failed']) {
      const accepted = await admit(db, 'one', status)
      await saveDurableRequest(db, accepted.row, { ...accepted.row.record, result: { status } }, null)
    }
    await admit(db, 'one', 'replacement')
  })
  await t.test('legacy async records retain their resolved image count across fresh connections', async () => {
    await reset(db, 4, 10)
    const original = await registerDurableRequest(db, requestKey('one', 'legacy'), 'legacy', pending())
    await db.query(`UPDATE community_creation_request SET context=$2 WHERE key=$1`, [original.row.key, JSON.stringify({ resolved: { n: 4 } })])
    await assert.rejects(admit(db, 'one', 'after-restart'), { code: 'IMAGE_CONCURRENCY_LIMIT' })
    await admit(db, 'two', 'isolated', 4)
  })
  await t.test('lowering limits affects new work without changing accepted records', async () => {
    await reset(db, 4, 10)
    const first = await admit(db, 'one', 'active', 4)
    await db.query('UPDATE meta SET "clientOptions"=$1', [JSON.stringify({ communityImageConcurrency: { defaultLimit: 1, globalLimit: 1, userOverrides: {} } })])
    await assert.rejects(admit(db, 'one', 'new'), { code: 'IMAGE_CONCURRENCY_LIMIT' })
    assert.equal((await readDurableRequest(db, first.row.key)).record.result.status, 'pending')
    await saveDurableRequest(db, first.row, { ...first.row.record, result: { status: 'failed' } }, null)
    await admit(db, 'one', 'allowed')
  })
  await t.test('malformed configuration rolls back without registering or dispatching', async () => {
    await reset(db)
    await db.query('UPDATE meta SET "clientOptions"=$1', [JSON.stringify({ communityImageConcurrency: { defaultLimit: 0 } })])
    await assert.rejects(admit(db, 'one', 'invalid'), { statusCode: 400 })
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM community_creation_request')).rows[0].count), 0)
    await assert.rejects(registerImageRequest(db, requestKey('one', 'mismatch'), 'hash', pending(), 'one', namespace('two'), 1), /Invalid/)
  })
  await t.test('a configured one-thousand request limit accepts the thousandth and rejects only the next', async () => {
    await reset(db, 4, 1000)
    await db.query(`INSERT INTO community_creation_request(key,fingerprint,state,owner,record,next_poll)
      SELECT 'other-account:'||item,'fixture','running','fixture',$1::jsonb,$2 FROM generate_series(1,999) item`,
      [JSON.stringify({ ...pending(), imageCount: 1 }), Date.now() + 60000])
    await admit(db, 'one', 'thousandth')
    await assert.rejects(admit(db, 'two', 'thousand-and-one'), { code: 'IMAGE_GLOBAL_LIMIT' })
  })
}

test('durable image admission counts lifecycle records using the actual PostgreSQL schema', async t => {
  const database = await requestDatabase(t), db = transactionalFixture(database)
  await initialize(db)
  await suite(t, db)
})

test('real PostgreSQL serializes competing image admissions and live configuration', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const schema = `image_admission_${randomBytes(6).toString('hex')}`, admin = new pg.Pool({ connectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
  await db.query(await readFile(new URL('../../migration/20261125-account-requests.up.sql', import.meta.url), 'utf8'))
  await initialize(db, true)
  await suite(t, db)
  await t.test('twenty simultaneous requests admit exactly four user images', async () => {
    await reset(db, 4, 100)
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, id) => admit(db, 'one', `race-${id}`)))
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 4)
    assert(outcomes.filter(item => item.status === 'rejected').every(item => item.reason.code === 'IMAGE_CONCURRENCY_LIMIT'))
  })
  await t.test('different accounts cannot exceed the shared request limit', async () => {
    await reset(db, 4, 3)
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, id) => admit(db, `user${id}`, 'race', 4)))
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 3)
    assert(outcomes.filter(item => item.status === 'rejected').every(item => item.reason.code === 'IMAGE_GLOBAL_LIMIT'))
  })
  await t.test('same-ID races reserve and insert exactly once', async () => {
    await reset(db, 1, 1)
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => admit(db, 'one', 'same')))
    assert.equal(outcomes.filter(item => item.inserted).length, 1)
    assert.equal(new Set(outcomes.map(item => item.row.owner)).size, 1)
  })
  await t.test('a committed lower setting is read after the administrator releases the meta lock', async () => {
    await reset(db, 4, 10)
    const client = await db.connect()
    await client.query('BEGIN')
    await client.query('UPDATE meta SET "clientOptions"=$1', [JSON.stringify({ communityImageConcurrency: { defaultLimit: 1, globalLimit: 1, userOverrides: {} } })])
    const pending = Promise.allSettled(Array.from({ length: 8 }, (_, id) => admit(db, 'one', `after-save-${id}`)))
    await client.query('COMMIT'); client.release()
    assert.equal((await pending).filter(item => item.status === 'fulfilled').length, 1)
  })
})
