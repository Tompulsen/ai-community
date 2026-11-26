import assert from 'node:assert/strict'
import test from 'node:test'
import { requestDatabase, environment } from './test-database.mjs'
import { checkRequestSchema, registerDurableRequest, readDurableRequest, dispatchDurableRequest,
  saveDurableRequest, savePreparingRequest, claimDurablePoll, nativeRequestsEnabled } from './request-store.ts'

test('PostgreSQL enforces one request owner, dispatch fencing and persistent terminal tombstones', async t => {
  const db = await requestDatabase(t), key = 'account:request'
  const record = { kind: 'image', deadline: Date.now() + 60000, result: { status: 'pending' } }
  const contenders = await Promise.all(Array.from({ length: 8 }, () => registerDurableRequest(db, key, 'intent-hash', record, 2)))
  assert.equal(contenders.filter(item => item.inserted).length, 1)
  const owner = contenders.find(item => item.inserted).row
  const sent = await dispatchDurableRequest(db, owner, { group: 'images', tokenId: 17 }, record)
  await assert.rejects(dispatchDurableRequest(db, owner, {}, record), /ownership/)
  await saveDurableRequest(db, sent, { ...record, result: { status: 'succeeded', outputs: [{ text: 'saved' }] } }, null)
  const retry = await registerDurableRequest(db, key, 'different-hash', record, 1)
  assert.equal(retry.inserted, false)
  assert.equal(retry.row.fingerprint, 'intent-hash')
  assert.equal(retry.row.context.group, 'images')
  assert.equal(retry.row.state, 'succeeded')
  assert.equal(await claimDurablePoll(db, retry.row), undefined)
})

test('a reclaimed expired preparation fences its original dispatcher and cannot be sent', async t => {
  const db = await requestDatabase(t)
  const record = { kind: 'text', deadline: Date.now() - 1, result: { status: 'pending' } }
  const { row } = await registerDurableRequest(db, 'expired', 'hash', record)
  const claimed = await claimDurablePoll(db, row)
  assert.ok(claimed)
  await assert.rejects(dispatchDurableRequest(db, row, {}, record), /ownership/)
  await saveDurableRequest(db, claimed, { ...record, result: { status: 'failed' } }, null, true)
  assert.equal((await readDurableRequest(db, 'expired')).state, 'failed_before_dispatch')
})

test('stage updates retain preparing state and expired ownership cannot advance it', async t => {
  const db = await requestDatabase(t)
  const record = { kind: 'image', deadline: Date.now() + 60000, result: { status: 'pending', stage: 'preparing' } }
  const { row } = await registerDurableRequest(db, 'stage', 'hash', record)
  await savePreparingRequest(db, row, { ...record, result: { status: 'pending', stage: 'queued' } })
  assert.equal(row.state, 'preparing'); assert.equal(row.record.result.stage, 'queued')
  await db.query('UPDATE community_creation_request SET next_poll=0 WHERE key=$1', [row.key])
  await assert.rejects(savePreparingRequest(db, row, record), /ownership/)
  await assert.rejects(dispatchDurableRequest(db, row, {}, record), /ownership/)
})

test('rollout requires schema and migration acknowledgement; zero means disabled', async t => {
  const db = await requestDatabase(t)
  environment(t, { COMMUNITY_REQUEST_STORE: '0', COMMUNITY_REQUEST_V2: '0', COMMUNITY_REQUEST_V2_ACCOUNTS: '', COMMUNITY_CREDENTIAL_MIGRATION_CONFIRMED: '0' })
  await checkRequestSchema(db)
  process.env.COMMUNITY_REQUEST_V2 = '1'
  await assert.rejects(checkRequestSchema(db), /STORE/)
  process.env.COMMUNITY_REQUEST_STORE = '1'
  await assert.rejects(checkRequestSchema(db), /provenance/)
  process.env.COMMUNITY_CREDENTIAL_MIGRATION_CONFIRMED = '1'
  await checkRequestSchema(db)
  process.env.COMMUNITY_REQUEST_V2 = '0'; process.env.COMMUNITY_REQUEST_V2_ACCOUNTS = '17,18'
  assert.equal(nativeRequestsEnabled(17), true)
  assert.equal(nativeRequestsEnabled(19), false)
  await assert.rejects(checkRequestSchema({ query() { throw new Error('missing table') } }), /missing table/)
})
