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
  for (const minConsumptionCnyFen of [-1, 0.1, '100', null, NaN, Infinity, 100000001, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateLotterySettings({ ...settings, minConsumptionCnyFen }), /LOTTERY_INVALID/)
  }
  for (const minConsumptionCnyFen of [undefined, 0, 129, 100000000]) {
    assert.doesNotThrow(() => validateLotterySettings({ ...settings, minConsumptionCnyFen }))
  }
  for (const rewardValidityHours of [0, -1, 1.5, '168', null, NaN, Infinity, 8761, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => validateLotterySettings({ ...settings, rewardValidityHours }), /LOTTERY_INVALID/)
  }
  for (const rewardValidityHours of [undefined, 1, 168, 8760]) {
    assert.doesNotThrow(() => validateLotterySettings({ ...settings, rewardValidityHours }))
  }
})

function charityWallet(t) {
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const before = process.env[key]
    process.env[key] = value
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before })
  }
}

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

test('public community reward points use verified delivered quota and never invent missing historical credit', t => {
  for (const [key, value] of Object.entries({ COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_QUOTA_PER_CNY: '500000' })) {
    const before = process.env[key]
    process.env[key] = value
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before })
  }
  const row = recordedDraw()
  const prize = packLotteryDraw(row).prizes[0]
  assert.equal(prize.legacyPoints, '2500.000000')
  assert.equal('creditReceipt' in prize, false)
  assert.equal('fulfilledBy' in prize, false)
  for (const patch of [{ creditReceipt: undefined }, { creditReceipt: { ...row.prizes[0].creditReceipt, quotaAdded: 1 } },
    { status: 'pending' }]) {
    assert.equal(packLotteryDraw({ ...row, prizes: [{ ...row.prizes[0], ...patch }] }).prizes[0].legacyPoints, null)
  }
  assert.equal(packLotteryDraw({ ...row, creditSubject: null }).prizes[0].legacyPoints, null)
  assert.doesNotMatch(JSON.stringify(prize), /private-|permanent|charity/)
})

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

function charityCredit(body, patch = {}) {
  const creditedAt = 1795000000
  return { credited: true, reference: body.reference, user_id: body.user_id, amount_cents: body.amount_cents,
    receipt: { id: 8, quota_added: 250000, quota_per_usd: '500000', reward_kind: 'charity', validity_hours: body.validity_hours,
      credited_at: creditedAt, expires_at: creditedAt + body.validity_hours * 3600, points: '2500', quota_per_point: 100, lot_id: 19, ...patch } }
}

test('public and admin charity records use frozen evidence after local conversion settings change', t => {
  charityWallet(t)
  const creditedAt = 1795000000
  const receipt = { id: 8, quotaAdded: 250000, quotaPerUsd: '500000', rewardKind: 'charity', validityHours: 48,
    creditedAt, expiresAt: creditedAt + 48 * 3600, points: '2500', quotaPerPoint: 100, lotId: 19 }
  const row = recordedDraw({ prizes: [{ ...recordedDraw().prizes[0], rewardKind: 'charity', validityHours: 48, creditReceipt: receipt }] })
  process.env.COMMUNITY_WALLET_ENABLED = 'false'
  process.env.COMMUNITY_WALLET_QUOTA_PER_CNY = 'unavailable'
  const publicPrize = packLotteryDraw(row).prizes[0]
  assert.equal(publicPrize.rewardKind, 'charity')
  assert.equal(publicPrize.validityHours, 48)
  assert.equal(publicPrize.points, '2500')
  assert.equal(publicPrize.expiresAt, receipt.expiresAt)
  assert.equal('legacyPoints' in publicPrize, false)
  assert.equal('creditReceipt' in publicPrize, false)
  assert.equal('lotId' in publicPrize, false)
  const adminPrize = packAdminLotteryDraw(row).prizes[0]
  assert.equal(adminPrize.receiptStatus, 'verified')
  assert.deepEqual(adminPrize.creditReceipt, receipt)
  assert.equal(adminPrize.points, '2500')
  for (const creditReceipt of [undefined, { ...receipt, points: '2501' }, { ...receipt, expiresAt: receipt.expiresAt + 1 }, { ...receipt, rewardKind: undefined }]) {
    const invalidRow = { ...row, prizes: [{ ...row.prizes[0], creditReceipt }] }
    assert.equal(packLotteryDraw(invalidRow).prizes[0].points, null)
    assert.equal(packLotteryDraw(invalidRow).prizes[0].expiresAt, null)
    assert.equal(packAdminLotteryDraw(invalidRow).prizes[0].receiptStatus, creditReceipt ? 'invalid' : 'missing')
  }
})

test('enabling charity rewards requires current capability and matching point conversion; old forms retain duration', async t => {
  charityWallet(t)
  const current = { id: 'default', version: 4, settings: { ...defaultLotterySettings(), rewardValidityHours: 72 } }
  const client = {
    async query(sql, args) {
      if (sql.startsWith('SELECT * FROM community_lottery_config')) return { rows: [structuredClone(current)] }
      if (sql.startsWith('UPDATE community_lottery_config')) { current.version++; current.settings = JSON.parse(args[1]) }
      return { rows: [] }
    },
    release() {},
  }
  let health = { ready: true, client_id: 'https://community.test', reward_kinds: ['balance', 'charity'], quota_per_point: 100 }
  const api = createLotteryService({ db: { connect: async () => client },
    config: { url: 'https://community.test/', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 'x'.repeat(32) } },
    fetcher: async (url, options) => {
      assert.equal(new URL(url).pathname, '/api/community-sso/lottery')
      assert.equal(options.method, 'GET')
      return new Response(JSON.stringify(health))
    } })
  const input = { ...defaultLotterySettings(), enabled: true, prizes: [
    { id: 'credit', name: 'Credit', description: '', weight: 1, stock: -1, enabled: true, amountCents: 50, kind: 'balance' },
  ] }
  delete input.rewardValidityHours
  const supported = { ...health }
  for (const patch of [{ reward_kinds: undefined }, { reward_kinds: ['balance'] }, { quota_per_point: undefined }, { quota_per_point: 101 },
    { quota_per_point: '100' }, { ready: false }, { client_id: 'https://other.test' }]) {
    health = { ...supported, ...patch }
    await assert.rejects(api.updateConfig(4, input), /LOTTERY_UNAVAILABLE/)
    assert.equal(current.version, 4)
  }
  health = supported
  process.env.COMMUNITY_WALLET_ENABLED = 'false'
  await assert.rejects(api.updateConfig(4, input), /LOTTERY_UNAVAILABLE/)
  process.env.COMMUNITY_WALLET_ENABLED = 'true'
  const saved = await api.updateConfig(4, input)
  assert.equal(saved.settings.rewardValidityHours, 72)
  assert.equal(current.settings.rewardValidityHours, 72)
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
  assert.equal(calls.some(sql => sql.includes('FOR UPDATE')), false)
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
        assert.equal('reward_kind' in body, false)
        assert.equal('validity_hours' in body, false)
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

function pendingDelivery(fetcher, patch = {}) {
  const row = { id: 'five-prize-draw', userId: 'owner', createdAt: new Date(), creditAttempts: 0,
    creditPending: true, creditRetryAt: null, creditIssuer: 'https://accounts.test', creditSubject: '7',
    prizes: Array.from({ length: 5 }, () => ({ status: 'pending', amountCents: 50, name: 'Credit' })), ...patch }
  const client = {
    async query(sql, args) {
      if (sql.startsWith('SELECT * FROM community_lottery_draw')) return { rows: [structuredClone(row)] }
      if (sql.startsWith('UPDATE community_lottery_draw')) Object.assign(row, {
        prizes: JSON.parse(args[1]), creditPending: args[2], creditAttempts: args[3], creditRetryAt: args[4],
      })
      return { rows: [] }
    },
    release() {},
  }
  return { row, api: createLotteryService({
    db: { connect: async () => client }, fetcher, logger: { warn() {} },
    config: { url: 'https://community.test/', newApiSso: { issuer: 'https://accounts.test/', lotterySecret: 'x'.repeat(32) } },
  }) }
}

test('charity delivery replays its frozen receipt after response loss without extending expiry or depending on current capability', async t => {
  charityWallet(t)
  const receipts = new Map(), requests = []
  let loseResponse = true
  const { row, api } = pendingDelivery(async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/community-sso/lottery/charity')
    assert.equal(options.method, 'POST')
    const body = JSON.parse(options.body)
    requests.push(body)
    assert.equal(body.reward_kind, 'charity')
    assert.equal(body.validity_hours, 48)
    if (!receipts.has(body.reference)) receipts.set(body.reference, charityCredit(body))
    if (loseResponse) { loseResponse = false; throw new Error('Lost successful response') }
    return new Response(JSON.stringify(receipts.get(body.reference)))
  }, { prizes: [{ status: 'pending', amountCents: 50, name: 'Credit', rewardKind: 'charity', validityHours: 48 }] })
  await api.deliver(row.id)
  assert.equal(row.prizes[0].status, 'pending')
  assert.equal(row.creditAttempts, 1)
  process.env.COMMUNITY_WALLET_ENABLED = 'false'
  process.env.COMMUNITY_WALLET_QUOTA_PER_CNY = 'changed'
  row.creditRetryAt = null
  const delivered = await api.deliver(row.id)
  assert.equal(receipts.size, 1)
  assert.deepEqual(requests[1], requests[0])
  assert.equal(row.prizes[0].status, 'fulfilled')
  assert.equal(row.prizes[0].creditReceipt.validityHours, 48)
  assert.equal(delivered.prizes[0].expiresAt, receipts.values().next().value.receipt.expires_at)
  assert.equal(delivered.prizes[0].points, '2500')
  assert.equal(row.creditAttempts, 0)
  assert.equal(row.creditPending, false)
  assert.equal(row.creditRetryAt, null)
  await api.deliver(row.id)
  assert.equal(requests.length, 2)
})

test('charity delivery rejects permanent, altered or missing receipts and never falls back to the legacy endpoint', async () => {
  for (const patch of [{ reward_kind: 'balance' }, { validity_hours: 168 }, { points: '2499' }, { lot_id: 0 }, { credited_at: undefined }, null]) {
    const { row, api } = pendingDelivery(async (url, options) => {
      assert.equal(new URL(url).pathname, '/api/community-sso/lottery/charity')
      const body = JSON.parse(options.body)
      return patch === null ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(charityCredit(body, patch)))
    }, { prizes: [{ status: 'pending', amountCents: 50, name: 'Credit', rewardKind: 'charity', validityHours: 48 }] })
    await api.deliver(row.id)
    assert.equal(row.prizes[0].status, 'pending')
    assert.equal(row.prizes[0].creditBlocked, true)
    assert.equal(row.creditAttempts, 3)
    assert.equal(row.creditPending, true)
  }
})

test('five slow successful awards keep their retry budget and eventually all arrive', async t => {
  const budgets = new WeakMap(), sent = [], credited = []
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 8000)
    const controller = new AbortController()
    budgets.set(controller.signal, { controller, remaining: milliseconds })
    return controller.signal
  })
  const { row, api } = pendingDelivery(async (_url, { body, signal }) => {
    const request = JSON.parse(body), budget = budgets.get(signal)
    sent.push(request.reference)
    if (budget.remaining < 5000) {
      budget.controller.abort()
      throw signal.reason
    }
    budget.remaining -= 5000
    credited.push(request.reference)
    return new Response(JSON.stringify({ credited: true, reference: request.reference, user_id: 7, amount_cents: 50,
      receipt: { id: credited.length, quota_added: 250000, quota_per_usd: '500000' } }))
  })
  for (let round = 0; round < 5; round++) {
    row.creditRetryAt = null
    await api.deliver(row.id)
    assert.equal(row.prizes.filter(prize => prize.status === 'fulfilled').length, round + 1)
    assert.equal(row.creditAttempts, 0)
  }
  assert.equal(row.creditPending, false)
  assert.equal(row.creditRetryAt, null)
  assert.deepEqual(credited, Array.from({ length: 5 }, (_, index) => `community_lottery_${row.id}_${index}`))
  assert.deepEqual(sent, [credited[0], credited[1], credited[1], credited[2], credited[2], credited[3], credited[3], credited[4], credited[4]])
})

test('delivery still stops after three consecutive failures without progress', async () => {
  let calls = 0
  const { row, api } = pendingDelivery(async () => { calls++; throw new Error('Temporary upstream failure') })
  for (let round = 0; round < 5; round++) {
    row.creditRetryAt = null
    await api.deliver(row.id)
  }
  assert.equal(calls, 3)
  assert.equal(row.creditAttempts, 3)
  assert.equal(row.creditPending, true)
  assert(row.prizes.every(prize => prize.status === 'pending'))
})
