/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createLotteryService, packLotteryDraw, validateLotterySettings } from './lottery.ts'
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
