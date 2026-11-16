import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import test from 'node:test'
import { signCommunityRequest } from './community-wallet.ts'
import { parseCommunityWallet, formatPoints, formatCnyPoints, pointsInCny } from '../../shared/studio/community-wallet.ts'

const url = new URL('https://model.example/v1/images/edits?mode=test')
const secret = 'fixture-community-secret-'.repeat(2)
const wallet = { enabled: true, currency: 'CNY', pointsPerCny: 5000,
  charityPoints: '123456789012345678.123456', permanentPoints: '100.000001',
  legacyApiQuota: -2, paidApiQuota: 4, totalApiQuota: 2, charityExpiringAt: null }

test('paid CNY principal converts to points without floating-point rounding or product-unit assumptions', () => {
  for (const [money, points] of [['1', '5,000'], ['10.00', '50,000'], ['8.00', '40,000'],
    ['0.02', '100'], ['0.29', '1,450'], ['2.50', '12,500'], ['0', '0'],
    ['99999999999999.99', '499,999,999,999,999,950']]) assert.equal(formatCnyPoints(money), points)
  assert.equal(formatCnyPoints(10), '50,000')
  for (const invalid of ['', '-1', '1e3', '0.001', '01', 'Infinity', Number.NaN])
    assert.equal(formatCnyPoints(invalid), '—')
})

function configure(t, values = {}) {
  const config = { COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_SECRET: secret,
    COMMUNITY_WALLET_CLIENT_ID: 'https://community.example', NEW_API_BASE_URL: url.origin,
    NEW_API_IMAGE_BASE_URL: '', NEW_API_ASYNC_BASE_URL: '', ...values }
  for (const [key, value] of Object.entries(config)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
}

function expectedSignature(target, userId, headers, bytes) {
  const canonical = ['community-wallet-v1', headers.get('X-Community-Client'), String(userId),
    headers.get('X-Community-Timestamp'), headers.get('X-Community-Nonce'), 'POST',
    target.pathname + target.search, headers.get('Idempotency-Key'),
    createHash('sha256').update(bytes).digest('hex')].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

test('decimal balances preserve six fractional digits and exact CNY conversion beyond floating point precision', () => {
  assert.deepEqual(parseCommunityWallet(wallet), wallet)
  assert.equal(formatPoints(wallet.charityPoints), '123,456,789,012,345,678.123456')
  assert.equal(pointsInCny('100'), '0.02')
  assert.equal(pointsInCny('5000'), '1.00')
  assert.equal(pointsInCny('0.000001'), '0.0000000002')
  assert.equal(pointsInCny(wallet.charityPoints), '24691357802469.1356246912')
  assert.equal(formatPoints('1.010000'), '1.01')
  for (const invalid of ['-1', 'NaN', '1e3', '01', '1.0000001', 100]) {
    assert.throws(() => parseCommunityWallet({ ...wallet, charityPoints: invalid }))
  }
  for (const patch of [{ enabled: false }, { pointsPerCny: 100 }, { currency: 'USD' },
    { paidApiQuota: -1 }, { totalApiQuota: Number.MAX_SAFE_INTEGER + 1 }, { charityExpiringAt: -1 }]) {
    assert.throws(() => parseCommunityWallet({ ...wallet, ...patch }))
  }
})

test('JSON signature binds exact transmitted bytes, account, path/query and idempotency; browser headers are replaced', async t => {
  configure(t)
  const headers = new Headers({ 'Content-Type': 'application/json', 'Idempotency-Key': 'request_123456789',
    'X-Community-User': '999', 'X-Community-Signature': 'forged', 'X-Community-Extra': 'forged' })
  const body = JSON.stringify({ prompt: '中文\nimage', model: 'fixture' })
  const result = await signCommunityRequest(url, 17, headers, body)
  const wire = new Request(url, { method: 'POST', ...result })
  const bytes = Buffer.from(await wire.arrayBuffer())
  assert.equal(bytes.toString(), body)
  assert.equal(wire.headers.get('X-Community-User'), '17')
  assert.equal(wire.headers.get('X-Community-Extra'), null)
  assert.match(wire.headers.get('X-Community-Nonce'), /^[a-f0-9]{32}$/)
  const signature = wire.headers.get('X-Community-Signature')
  assert.equal(signature, expectedSignature(url, 17, wire.headers, bytes))
  assert.notEqual(signature, expectedSignature(url, 18, wire.headers, bytes))
  assert.notEqual(signature, expectedSignature(new URL('/v1/images/generations', url), 17, wire.headers, bytes))
  assert.notEqual(signature, expectedSignature(url, 17, wire.headers, Buffer.from(body + ' ')))
  assert.equal(headers.get('X-Community-User'), '999', 'caller headers remain untouched')
})

test('multipart signing freezes the boundary and uploaded bytes exactly once', async t => {
  configure(t)
  const form = new FormData()
  form.set('model', 'image-fixture')
  form.append('image', new Blob([new Uint8Array([0, 255, 1, 13, 10])], { type: 'image/png' }), 'fixture.png')
  const result = await signCommunityRequest(url, 17, new Headers({ 'Idempotency-Key': 'image-request-0001' }), form)
  form.set('model', 'changed-after-signing')
  const wire = new Request(url, { method: 'POST', ...result })
  const bytes = Buffer.from(await wire.clone().arrayBuffer())
  const parsed = await wire.formData()
  assert.match(wire.headers.get('content-type'), /^multipart\/form-data; boundary=/)
  assert.equal(parsed.get('model'), 'image-fixture')
  assert.deepEqual(Buffer.from(await parsed.get('image').arrayBuffer()), Buffer.from([0, 255, 1, 13, 10]))
  assert.equal(wire.headers.get('X-Community-Signature'), expectedSignature(url, 17, wire.headers, bytes))
})

test('disabled feature leaves the existing request body and removes untrusted payment headers', async t => {
  configure(t, { COMMUNITY_WALLET_ENABLED: 'false', COMMUNITY_WALLET_SECRET: '' })
  const form = new FormData()
  const result = await signCommunityRequest(url, 0, new Headers({ 'X-Community-User': '999' }), form)
  assert.equal(result.body, form)
  assert.deepEqual([...result.headers.keys()], [])
})

test('invalid signing configuration and unconfigured destinations fail before transmission', async t => {
  configure(t)
  const headers = new Headers({ 'Idempotency-Key': 'fixture-request-01' })
  for (const target of ['https://other.example/v1/chat/completions', 'https://user@model.example/v1/images/edits']) {
    await assert.rejects(signCommunityRequest(new URL(target), 17, headers, '{}'), { code: 'COMMUNITY_WALLET_CONFIG' })
  }
  await assert.rejects(signCommunityRequest(url, 0, headers, '{}'), { code: 'COMMUNITY_WALLET_CONFIG' })
  await assert.rejects(signCommunityRequest(url, 17, new Headers({ 'Idempotency-Key': 'too-short' }), '{}'), { code: 'COMMUNITY_WALLET_CONFIG' })
  await assert.rejects(signCommunityRequest(url, 17, new Headers(), '{}'), { code: 'COMMUNITY_WALLET_CONFIG' })
  process.env.COMMUNITY_WALLET_SECRET = 'short'
  await assert.rejects(signCommunityRequest(url, 17, headers, '{}'), { code: 'COMMUNITY_WALLET_CONFIG' })
})
