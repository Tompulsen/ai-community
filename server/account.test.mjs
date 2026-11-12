/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { accountHash, bindExternalAccount, handleAccount, newApiIdentity, newApiOrigin, newApiReturnPath, readAccountBalance, readFlowCookie, verifyStudioBearer } from './account.ts'

test('issuer permits only an HTTPS origin without credentials, path or query', () => {
  assert.equal(newApiOrigin('https://accounts.test/'), 'https://accounts.test')
  for (const input of ['http://accounts.test', 'https://secret@accounts.test', 'https://accounts.test/other', 'https://accounts.test?x=1', 'https://accounts.test/#x']) {
    assert.throws(() => newApiOrigin(input), /SSO_CONFIG/)
  }
})

test('identity requires an explicit stable numeric subject, never an email or coerced number', () => {
  const identity = { sub: '7', preferred_username: 'creator', name: 'Creator' }
  assert.deepEqual(newApiIdentity(identity), identity)
  for (const sub of [7, '', '00', '7e1', '-1', 'person@example.test']) assert.throws(() => newApiIdentity({ ...identity, sub }), /SSO_IDENTITY/)
})

test('return path and flow cookie reject open redirects, duplicate cookies and malformed state', () => {
  assert.equal(newApiReturnPath('/create/image?remix=old123'), '/create/image?remix=old123')
  assert.equal(newApiReturnPath('//other.test'), '/account')
  const cookie = `__Host-community-next-oauth=${'a'.repeat(43)}`
  assert.equal(readFlowCookie(cookie), 'a'.repeat(43))
  assert.equal(readFlowCookie(`${cookie}; ${cookie}`), null)
  assert.equal(readFlowCookie('__Host-community-next-oauth=short'), null)
})

test('return paths preserve only current SPA destinations and their own query parameters', () => {
  for (const path of ['/discover', '/work/old123', '/create', '/create/text', '/create/image', '/create/video',
    '/library', '/activities', '/community', '/account', '/messages', '/messages/creator123',
    '/discover?kind=image&q=%E7%AB%A0%E9%B1%BC+AI&tag=Skill&sort=latest',
    '/create?from=old123', '/create/video?remix=old123', '/library?tab=saved&publish=1',
    '/community?creator=creator123&tab=creators', '/community?tab=announcements',
    '/account?tab=security', '/messages?peer=creator123', '/activities?invite=inviter123']) assert.equal(newApiReturnPath(path), path)
  for (const path of [null, {}, 'https://other.test/discover', '//other.test/discover', '/\\other.test',
    '/discover#//other.test', '/discover/../account', '/%64iscover', '/work/%2e%2e', '/work/old_123',
    '/account/authorize', '/admin', '/community/lottery', '/discover?redirect=https://other.test',
    '/discover?returnTo=%2Faccount', '/discover?kind=unknown', '/discover?kind=image&kind=video',
    '/discover?creator=creator123', '/library?tab=unknown', '/account?reset=secret', '/account?newapi=complete',
    '/create?remix=old/123', '/discover?q=%', '/discover?q=%FF', '/discover?q=%5C',
    '/discover?q=%00', '/activities?invite=inviter123%0A', '/discover?constructor=anything',
    '/discover?q=' + 'x'.repeat(2048)]) assert.equal(newApiReturnPath(path), '/account', String(path))
})

test('Studio bearer comparison requires the configured secret and exact prefix', () => {
  const secret = 'x'.repeat(32)
  assert.equal(verifyStudioBearer(`Bearer ${secret}`, secret), true)
  assert.equal(verifyStudioBearer(`Basic ${secret}`, secret), false)
  assert.equal(verifyStudioBearer('Bearer short', secret), false)
  assert.equal(verifyStudioBearer('Bearer x', ''), false)
})

test('binding refuses to reassign an existing external identity and rolls back', async () => {
  const statements = []
  const user = { id: 'local-owner', username: 'owner', token: 'native-token-1234', password: 'hash' }
  const client = { async query(sql) {
    statements.push(sql)
    if (sql.includes('FROM "user" u JOIN user_profile')) return { rows: [user] }
    if (sql.startsWith('SELECT issuer,subject')) return { rows: [{ issuer: 'https://accounts.test', subject: '7', userId: 'other-owner' }] }
    return { rows: [] }
  }, release() {} }
  const ctx = { db: { connect: async () => client }, user: { id: user.id }, sessionHash: 'current-session' }
  const proof = { userId: user.id, sessionHash: ctx.sessionHash, tokenHash: accountHash(user.token), credentialHash: accountHash(user.password) }
  await assert.rejects(bindExternalAccount(ctx, 'https://accounts.test', '7', proof), /SSO_LINK_CONFLICT/)
  assert.equal(statements.at(-1), 'ROLLBACK')
  assert.equal(statements.some(sql => sql.startsWith('INSERT INTO external_account')), false)
  assert.equal(statements.filter(sql => sql.includes('pg_advisory_xact_lock')).length, 2)
})

test('balance uses the authoritative configured ratio and refuses another account session', async () => {
  const ctx = { config: { url: 'https://community.test/', communityStudioUpstream: 'http://studio:3000/' },
    req: { headers: { cookie: `community_session=must-not-forward; octopus_new_api_session=${'x'.repeat(43)}` } } }
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Cookie.includes('community_session'), false)
    return new Response(JSON.stringify({ success: true, data: url.pathname.endsWith('/session')
      ? { authenticated: true, user: { id: 7, quota: 1250000 } } : { quotaPerUnit: 250000, currencySymbol: '$' } }))
  }
  assert.deepEqual(await readAccountBalance(ctx, '7', fetcher), { balance: 5, quota: 1250000, quotaPerUnit: 250000, currencySymbol: '$' })
  assert.equal(await readAccountBalance(ctx, '8', fetcher), null)
})

test('Studio launch cannot be exchanged after its community session was revoked', async () => {
  const secret = 's'.repeat(32), code = 'a'.repeat(43)
  const ctx = { req: { method: 'POST', headers: { authorization: `Bearer ${secret}` }, socket: { remoteAddress: '127.0.0.1' } },
    url: new URL('https://community.test/api/newapi/studio/exchange'), body: { code },
    config: { url: 'https://community.test/', newApiSso: { issuer: 'https://accounts.test/', studioSecret: secret } },
    redis: { eval: async () => 1, get: async () => JSON.stringify({ issuer: 'https://accounts.test', studio: 'https://community.test', sessionHash: 'revoked' }), exists: async () => 0 },
    db: { query() { assert.fail('Revoked launches must not read credentials') } } }
  await assert.rejects(handleAccount(ctx), /STUDIO_ACCOUNT/)
})

test('obsolete popup and OAuth completion endpoints cannot bypass the unified account login', async () => {
  for (const path of ['/api/account/connect', '/api/newapi/start', '/api/account/finish', '/api/newapi/finish']) {
    await assert.rejects(handleAccount({
      req: { method: 'POST' }, url: new URL(path, 'https://community.test'),
      db: { query() { assert.fail('Disabled login paths must not query accounts') } },
    }), { statusCode: 410, code: 'ACCOUNT_LOGIN_REQUIRED' })
  }
})
