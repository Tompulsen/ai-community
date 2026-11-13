/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { accountHash, bindExternalAccount, handleAccount, newApiIdentity, newApiOrigin, newApiReturnPath, readAccountBalance, readFlowCookie } from './account.ts'

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
    '/account?tab=security', '/messages?peer=creator123', '/activities?invite=inviter123',
    '/messages?tab=messages', '/messages?tab=announcement', '/messages?tab=activity']) assert.equal(newApiReturnPath(path), path)
  for (const path of [null, {}, 'https://other.test/discover', '//other.test/discover', '/\\other.test',
    '/discover#//other.test', '/discover/../account', '/%64iscover', '/work/%2e%2e', '/work/old_123',
    '/account/authorize', '/admin', '/community/lottery', '/discover?redirect=https://other.test',
    '/discover?returnTo=%2Faccount', '/discover?kind=unknown', '/discover?kind=image&kind=video',
    '/discover?creator=creator123', '/library?tab=unknown', '/account?reset=secret', '/account?newapi=complete',
    '/create?remix=old/123', '/messages?tab=unknown', '/messages?tab=activity&tab=announcement',
    '/discover?q=%', '/discover?q=%FF', '/discover?q=%5C',
    '/discover?q=%00', '/activities?invite=inviter123%0A', '/discover?constructor=anything',
    '/discover?q=' + 'x'.repeat(2048)]) assert.equal(newApiReturnPath(path), '/account', String(path))
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
  const ctx = { config: { url: 'https://community.test/' },
    req: { headers: { cookie: `community_session=must-not-forward; octopus_new_api_session=${'x'.repeat(43)}` } } }
  const paths = []
  const fetcher = async (url, options) => {
    assert.equal(url.origin, 'https://community.test')
    assert(['/api/new-api/session', '/api/new-api/status'].includes(url.pathname))
    paths.push(url.pathname)
    assert.equal(options.headers.Cookie, `octopus_new_api_session=${'x'.repeat(43)}`)
    return new Response(JSON.stringify({ success: true, data: url.pathname.endsWith('/session')
      ? { authenticated: true, user: { id: 7, quota: 1250000 } } : { quotaPerUnit: 250000, currencySymbol: '$' } }))
  }
  assert.deepEqual(await readAccountBalance(ctx, '7', fetcher), { balance: 5, quota: 1250000, quotaPerUnit: 250000, currencySymbol: '$' })
  assert.equal(await readAccountBalance(ctx, '8', fetcher), null)
  assert.deepEqual(paths, ['/api/new-api/session', '/api/new-api/status', '/api/new-api/session', '/api/new-api/status'])
})

test('retired Studio launch, exchange and embed endpoints reject requests before reading credentials', async () => {
  for (const endpoint of ['start', 'exchange', 'context', 'validate']) {
    for (const method of ['GET', 'POST']) {
      await assert.rejects(handleAccount({
        req: { method }, url: new URL(`/api/newapi/studio/${endpoint}`, 'https://community.test'),
        db: { query() { assert.fail('Retired Studio routes must not read accounts') } },
        redis: { get() { assert.fail('Retired Studio routes must not read sessions') } },
      }), { statusCode: 410, code: 'STUDIO_EMBED_REMOVED' })
    }
  }
})

test('obsolete popup and OAuth completion endpoints cannot bypass the unified account login', async () => {
  for (const path of ['/api/account/connect', '/api/newapi/start', '/api/account/finish', '/api/newapi/finish']) {
    await assert.rejects(handleAccount({
      req: { method: 'POST' }, url: new URL(path, 'https://community.test'),
      db: { query() { assert.fail('Disabled login paths must not query accounts') } },
    }), { statusCode: 410, code: 'ACCOUNT_LOGIN_REQUIRED' })
  }
})
