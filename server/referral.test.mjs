import assert from 'node:assert/strict'
import test from 'node:test'
import { handleReferral } from './referral.ts'
import { createLotteryService } from './lottery.ts'
import { defaultLotterySettings } from './business/lottery.ts'

const config = { version: 1, enabled: true, inviterPoints: 5000, inviteePoints: 5000, inviterQuota: 500000, inviteeQuota: 500000, minTopupCny: 10, updatedAt: 0 }
const code = 'aB12'
const overview = { config, code, invited: 0, credited: 0, pending: 0, waiting: 0, earnedPoints: 0, earnedQuota: 0, legacyInvited: 0, asInvitee: null, items: [], nextCursor: 0 }
function fixture(path = '/api/referrals/status', user = { id: 'community-17', isAdmin: false }) {
  const reads = [], replies = []
  return { reads, replies, req: { method: 'GET' }, url: new URL(path, 'https://community.test'), user,
    config: { url: 'https://community.test/', newApiSso: { issuer: 'https://accounts.test', lotterySecret: 'test-secret-'.repeat(4) } },
    body: {}, db: { async query(sql, values) { reads.push({ sql, values }); return { rows: [{ subject: '17' }] } } },
    requireAdmin() { if (!user?.isAdmin) throw Object.assign(new Error('FORBIDDEN'), { statusCode: 403 }) },
    json(status, body) { replies.push({ status, body }) },
  }
}
const response = value => new Response(JSON.stringify(value))

test('referrals use only the authenticated external account and filter upstream private fields', async () => {
  const ctx = fixture('/api/referrals/status?user_id=99&cursor=20')
  await handleReferral(ctx, async (url, options) => {
    assert.equal(String(url), 'https://accounts.test/api/community-sso/referrals')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer ' + ctx.config.newApiSso.lotterySecret)
    assert.deepEqual(JSON.parse(options.body), { action: 'status', cursor: 20, user_id: 17, client_id: 'https://community.test' })
    return response({ ...overview, secret: 'must-not-leak', config: { ...config, updatedBy: 25 } })
  })
  assert.deepEqual(ctx.reads[0].values, ['https://accounts.test', 'community-17'])
  assert.equal(ctx.replies[0].body.inviteUrl, 'https://community.test/activities?aff=' + code)
  assert.doesNotMatch(JSON.stringify(ctx.replies), /must-not-leak|updatedBy|test-secret/)
})

test('guests get public rules; admin reads and writes require an administrator', async () => {
  const guest = fixture('/api/referrals/status', null)
  await handleReferral(guest, async (_, options) => {
    assert.equal(JSON.parse(options.body).user_id, 0)
    return response({ ...overview, code: '' })
  })
  assert.equal(guest.replies[0].body.inviteUrl, '')
  assert.equal(guest.reads.length, 0)
  for (const user of [null, { id: '17', isAdmin: false }]) for (const method of ['GET', 'PATCH']) {
    const ctx = fixture('/api/admin/referrals/config', user); ctx.req.method = method
    await assert.rejects(handleReferral(ctx, () => assert.fail('must not call upstream')), { statusCode: 403 })
  }
})

test('admin configuration is read from the account center and legacy writes are rejected', async () => {
  const ctx = fixture('/api/admin/referrals/config', { id: 'community-25', isAdmin: true })
  ctx.body = { ...config, inviterPoints: 6000, inviteePoints: 7000, enabled: false, user_id: 999 }
  await handleReferral(ctx, async (_, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(body, { action: 'config', cursor: 0, client_id: 'https://community.test', user_id: 17 })
    return response(config)
  })
  assert.deepEqual(ctx.replies[0].body, config)
  ctx.req.method = 'PATCH'
  await assert.rejects(handleReferral(ctx, () => assert.fail('centralized settings must not be written')), { code: 'REFERRAL_CONFIG_CENTRALIZED', statusCode: 405 })
})

test('sites share canonical codes and records while keeping their own invitation URL', async () => {
  const record = { inviteeId: 20, inviterId: 17, configVersion: 0, inviterPoints: 0.25, inviteePoints: 0, minTopupCny: 9.99, boundAt: 10, state: 'waiting_topup', creditedAt: 0 }
  for (const inviteCode of ['aB12', '001234', 'wf' + 'a'.repeat(24)]) {
    for (const origin of ['https://community.test', 'https://other-community.test']) {
      const ctx = fixture(); ctx.config.url = origin
      await handleReferral(ctx, async (_, options) => {
        const body = JSON.parse(options.body)
        assert.equal(body.user_id, 17)
        assert.equal(body.client_id, origin)
        return response({
          ...overview, code: inviteCode, config: { ...config, inviterPoints: 0, inviteePoints: 0.25, inviterQuota: 0, inviteeQuota: 25 },
          invited: 8, waiting: 1, legacyInvited: 7, earnedPoints: 0.25, earnedQuota: 25, asInvitee: record, items: [record],
        })
      })
      const result = ctx.replies[0].body
      assert.equal(result.inviteUrl, `${origin}/activities?aff=${inviteCode}`)
      assert.equal(result.waiting, 1)
      assert.equal(result.legacyInvited, 7)
      assert.equal(result.config.inviterPoints, 0)
      assert.deepEqual(result.items, [record])
    }
  }
})

test('invalid account mappings and malformed or oversized service responses fail closed', async () => {
  const ctx = fixture()
  for (const subject of ['', '0', '-1', '1.5', '9999999999999999']) {
    ctx.db.query = async () => ({ rows: [{ subject }] })
    await assert.rejects(handleReferral(ctx, () => assert.fail('must not call upstream')), { code: 'REFERRAL_ACCOUNT_REQUIRED' })
  }
  ctx.db.query = async () => ({ rows: [{ subject: '17' }] })
  for (const body of [
    'broken JSON', 'x'.repeat(65537), JSON.stringify({ ...overview, code: '../escape' }),
    JSON.stringify({ ...overview, config: { ...config, minTopupCny: -1 } }),
    JSON.stringify({ ...overview, config: { ...config, inviterQuota: 0.5 } }),
  ]) {
    await assert.rejects(handleReferral(ctx, () => new Response(body)), { code: 'REFERRAL_UNAVAILABLE' })
  }
  ctx.url.searchParams.set('cursor', '-1')
  await assert.rejects(handleReferral(ctx, () => assert.fail()), { code: 'REFERRAL_INVALID' })
})

test('legacy invitation ticket rewards are disabled without deleting existing settings', async () => {
  const settings = defaultLotterySettings(); settings.invites.enabled = true
  const db = { async connect() { return { query: this.query, release() {} } }, async query(sql) {
    return { rows: sql.startsWith('SELECT') ? [{ version: 7, settings }] : [] }
  } }
  const service = createLotteryService({ db, config: { url: 'https://community.test' } })
  const result = await service.getConfig()
  assert.equal(result.settings.invites.enabled, false)
  assert.equal(result.version, 7)
  assert.deepEqual(result.settings.prizes, settings.prizes)
})
