/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createLotteryService, handleLottery, packAdminLotteryDraw, packLotteryDraw, validateLotterySettings } from './lottery.ts'
import { defaultLotterySettings } from './business/lottery.ts'

test('settings reject invalid money, overflowing weight and duplicate prize ids', () => {
  const settings = { ...defaultLotterySettings(), enabled: true, prizes: [
    { id: 'usd', name: 'Credit', description: '', weight: 1, stock: -1, enabled: true, amountCents: 50, kind: 'balance' },
  ] }
  assert.equal(validateLotterySettings(settings), settings)
  for (const patch of [{ id: 1 }, { amountCents: 0 }, { amountCents: 0.5 }, { weight: 1000001 }, { stock: -2 }]) {
    assert.throws(() => validateLotterySettings({ ...settings, prizes: [{ ...settings.prizes[0], ...patch }] }), /LOTTERY_INVALID/)
  }
  assert.throws(() => validateLotterySettings({ ...settings, prizes: [settings.prizes[0], settings.prizes[0]] }), /LOTTERY_INVALID/)
})

test('public record never exposes delivery receipts, admin identity or blocked details', () => {
  const result = packLotteryDraw({ id: 'old-id', userId: 'owner', createdAt: new Date(), creditAttempts: 2,
    prizes: [{ name: 'Credit', status: 'fulfilled', amountCents: 50, creditReceipt: { id: 2 }, creditBlocked: true, fulfilledBy: 'admin' }] })
  assert.equal(result.id, 'old-id')
  assert.equal(result.prizes[0].amountCents, 50)
  assert.equal('creditReceipt' in result.prizes[0], false)
  assert.equal('creditBlocked' in result.prizes[0], false)
  assert.equal('fulfilledBy' in result.prizes[0], false)
  assert.equal('creditPending' in result, false)
  assert.equal('creditRetryAt' in result, false)
})

function recordedDraw(patch = {}) {
  return { id: 'recordedDraw', userId: 'owner', username: 'octopus', createdAt: '2026-11-14T00:00:00Z',
    requestId: 'private-request', creditIssuer: 'https://accounts.test', creditSubject: '17',
    creditAttempts: 1, creditPending: false, creditRetryAt: null,
    prizes: [{ name: 'Credit', status: 'fulfilled', amountCents: 50, fulfilledBy: 'private-admin',
      creditReceipt: { id: 8, quotaAdded: 250000, quotaPerUsd: '500000.000000000000000000000000000001', secret: 'private-secret' } }],
    ...patch }
}

test('admin records expose only a validated receipt and preserve the exact decimal conversion ratio', () => {
  const result = packAdminLotteryDraw(recordedDraw())
  assert.equal(result.prizes[0].reference, 'community_lottery_recordedDraw_0')
  assert.equal(result.prizes[0].receiptStatus, 'verified')
  assert.equal(result.prizes[0].amountMatches, true)
  assert.deepEqual(result.prizes[0].creditReceipt, { id: 8, quotaAdded: 250000, quotaPerUsd: '500000.000000000000000000000000000001' })
  assert.equal(result.prizes[0].deliveryStatus, 'fulfilled')
  assert.equal(result.creditAccountId, 17)
  assert.equal('fulfilledBy' in result.prizes[0], false)
  assert.equal('requestId' in result, false)
  assert.equal('creditIssuer' in result, false)
  assert.equal('creditSubject' in result, false)
  assert.equal(JSON.stringify(result).includes('private-'), false)
  const largeAccount = packAdminLotteryDraw(recordedDraw({ creditSubject: String(Number.MAX_SAFE_INTEGER) }))
  assert.equal(largeAccount.creditAccountId, Number.MAX_SAFE_INTEGER)
  assert.equal(largeAccount.prizes[0].receiptStatus, 'verified')
})

test('admin records distinguish absent, invalid, blocked and empty evidence without inventing an amount match', () => {
  const row = recordedDraw({ creditPending: true, creditAttempts: 3, creditRetryAt: '2026-11-14T00:03:00Z', prizes: [
    { status: 'fulfilled', amountCents: 50, name: 'Legacy credit' },
    { status: 'pending', amountCents: 50, name: 'Mismatch', creditBlocked: true, creditReceipt: { id: 8, quotaAdded: 249999, quotaPerUsd: '500000' } },
    { status: 'pending', amountCents: 50, name: 'Retry exhausted' },
    { status: 'empty', amountCents: 0, name: 'Empty', creditReceipt: { id: 9, quotaAdded: 1, quotaPerUsd: '1' } },
  ] })
  const result = packAdminLotteryDraw(row)
  assert.equal(result.creditPending, true)
  assert.equal(result.creditRetryAt, new Date(row.creditRetryAt).toISOString())
  assert.deepEqual(result.prizes.map(prize => prize.receiptStatus), ['missing', 'invalid', 'missing', 'not-required'])
  assert.deepEqual(result.prizes.map(prize => prize.creditReceipt), [null, null, null, null])
  assert.deepEqual(result.prizes.map(prize => prize.amountMatches), [null, null, null, null])
  assert.deepEqual(result.prizes.map(prize => prize.deliveryStatus), ['fulfilled', 'blocked', 'blocked', 'empty'])
  assert.deepEqual(result.prizes.map(prize => prize.blockedReason), [null, 'UPSTREAM_REJECTED_OR_INVALID_RECEIPT', 'RETRY_LIMIT', null])
  for (const subject of [null, '0', '-1', '17.5', 'not-an-account', '9007199254740992']) {
    const invalid = packAdminLotteryDraw(recordedDraw({ creditSubject: subject })).prizes[0]
    assert.equal(invalid.receiptStatus, 'invalid')
    assert.equal(invalid.creditReceipt, null)
    assert.equal(packAdminLotteryDraw(recordedDraw({ creditSubject: subject })).creditAccountId, null)
  }
})

test('admin records combine parameterized user, award status and cursor filters with pagination', async () => {
  const calls = []
  const db = { async query(sql, args) {
    calls.push({ sql, args })
    return { rows: Array.from({ length: 21 }, (_, index) => recordedDraw({ id: `draw${index}` })) }
  } }
  const api = createLotteryService({ db, config: { url: 'https://community.test/' } })
  const result = await api.records('admin', true, 'oldCursor', null, { userId: 'owner', status: 'blocked' })
  assert.equal(result.items.length, 20)
  assert.equal(result.nextCursor, 'draw19')
  assert.equal(result.items[0].prizes[0].receiptStatus, 'verified')
  assert.deepEqual(calls[0].args, ['owner', 'oldCursor'])
  assert.match(calls[0].sql, /d\."userId"=\$1/)
  assert.match(calls[0].sql, /d\.id<\$2/)
  assert.match(calls[0].sql, /jsonb_array_elements\(d\.prizes\)/)
  assert.match(calls[0].sql, /award->>'status'='pending'/)
  assert.match(calls[0].sql, /award->>'creditBlocked'='true' OR d\."creditAttempts">=3/)
  assert.match(calls[0].sql, /ORDER BY d\.id DESC LIMIT 21$/)
  for (const status of ['fulfilled', 'pending', 'empty', 'all']) {
    await api.records('admin', true, null, null, { status })
    const sql = calls.at(-1).sql
    if (status === 'all') assert.equal(sql.includes('jsonb_array_elements'), false)
    else assert.match(sql, new RegExp(`award->>'status'='${status}'`))
    if (status === 'pending') assert.match(sql, /NOT COALESCE\(award->>'creditBlocked'='true',false\) AND d\."creditAttempts"<3/)
  }
  const count = calls.length
  await assert.rejects(api.records('admin', true, null, null, { status: 'unknown' }), /LOTTERY_INVALID/)
  await assert.rejects(api.records('admin', true, null, null, { userId: "owner' OR true" }), /LOTTERY_INVALID/)
  assert.equal(calls.length, count)
  const publicResult = await api.records('owner', false, null, null, { userId: 'other', status: 'blocked' })
  assert.deepEqual(calls.at(-1).args, ['owner'])
  assert.equal(calls.at(-1).sql.includes('jsonb_array_elements'), false)
  assert.equal('creditReceipt' in publicResult.items[0].prizes[0], false)
  assert.equal('receiptStatus' in publicResult.items[0].prizes[0], false)
})

test('only the authorized admin records route selects the admin receipt projection', async () => {
  const db = { async query() { return { rows: [recordedDraw()] } } }
  const results = []
  let adminChecks = 0
  const context = path => ({
    url: new URL(path, 'https://community.test'), req: { method: 'GET' }, body: {},
    config: { url: 'https://community.test/' }, db,
    requireUser() { return { id: 'owner' } },
    requireAdmin() { adminChecks++; return { id: 'admin' } },
    json(_status, body) { results.push(body) },
  })
  await handleLottery(context('/api/lottery/records'))
  assert.equal(adminChecks, 0)
  assert.equal('creditReceipt' in results[0].items[0].prizes[0], false)
  await handleLottery(context('/api/admin/lottery/records?userId=owner&status=fulfilled'))
  assert.equal(adminChecks, 1)
  assert.equal(results[1].items[0].prizes[0].receiptStatus, 'verified')
  await assert.rejects(handleLottery({ ...context('/api/admin/lottery/records'), requireAdmin() { throw new Error('FORBIDDEN') } }), /FORBIDDEN/)
  assert.equal(results.length, 2)
})

test('same draw request returns original receipt without consuming chances or stock again', async () => {
  const calls = []
  const old = { id: 'original-draw', userId: 'owner', createdAt: new Date(), creditAttempts: 0,
    prizes: [{ status: 'fulfilled', amountCents: 50, name: 'Credit' }] }
  const client = {
    async query(sql) {
      calls.push(sql)
      if (sql.startsWith('SELECT id FROM "user"')) return { rows: [{ id: 'owner' }] }
      if (sql.startsWith('SELECT * FROM community_lottery_config')) return { rows: [{ id: 'default', version: 4, settings: defaultLotterySettings() }] }
      if (sql.startsWith('SELECT * FROM community_lottery_draw')) return { rows: [old] }
      return { rows: [] }
    },
    release() {},
  }
  const api = createLotteryService({ db: { connect: async () => client }, config: { url: 'https://community.test/' } })
  const receipt = await api.draw('owner', 'same-request-1234', 1)
  assert.equal(receipt.id, old.id)
  assert.equal(calls.some(sql => sql.startsWith('UPDATE community_lottery_account')), false)
  assert.equal(calls.some(sql => sql.startsWith('INSERT INTO community_lottery_draw')), false)
  assert(calls.findIndex(sql => sql.includes('FOR UPDATE')) < calls.findIndex(sql => sql.startsWith('SELECT * FROM community_lottery_draw')))
  await assert.rejects(api.draw('owner', 'same-request-1234', 3), /LOTTERY_CONFLICT/)
  assert.equal(calls.at(-1), 'ROLLBACK')
})

test('delivery validates the exact configured quota receipt before marking an award fulfilled', async () => {
  const writes = []
  const original = { id: 'legacy-draw', userId: 'owner', createdAt: new Date(), creditAttempts: 0,
    creditPending: true, creditRetryAt: null, creditIssuer: 'https://accounts.test', creditSubject: '7',
    prizes: [{ status: 'pending', amountCents: 50, name: 'Credit' }] }
  const make = response => {
    const client = {
      async query(sql, args) {
        if (sql.startsWith('SELECT * FROM community_lottery_draw')) return { rows: [structuredClone(original)] }
        if (sql.startsWith('UPDATE community_lottery_draw')) writes.push(args)
        return { rows: [] }
      },
      release() {},
    }
    return createLotteryService({
      db: { connect: async () => client }, config: { url: 'https://community.test/', newApiSso: { issuer: 'https://accounts.test/', lotterySecret: 'x'.repeat(32) } },
      fetcher: async (_url, options) => {
        const body = JSON.parse(options.body)
        assert.equal(body.reference, 'community_lottery_legacy-draw_0')
        assert.equal(body.client_id, 'https://community.test')
        assert.equal(body.amount_cents, 50)
        return new Response(JSON.stringify({ credited: true, reference: body.reference, user_id: 7, amount_cents: 50,
          receipt: { id: 1, quota_added: response, quota_per_usd: '500000' } }))
      },
      logger: { warn() {} },
    })
  }
  const paid = await make(250000).deliver(original.id)
  assert.equal(paid.prizes[0].status, 'fulfilled')
  assert.equal(writes[0][2], false)
  const blocked = await make(249999).deliver(original.id)
  assert.equal(blocked.prizes[0].status, 'pending')
  assert.equal(writes[1][2], true)
  assert.equal(writes[1][3], 3)
  assert.equal(JSON.parse(writes[1][1])[0].creditBlocked, true)
})
