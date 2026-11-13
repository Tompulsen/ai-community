/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAdmin } from './admin.ts'
import { httpError } from './auth.ts'
import { readSiteSettings, validateSiteBranding } from './settings.ts'

const siteUrl = 'https://community.example'
const emptyAd = { enabled: false, title: '', imageUrl: '', linkUrl: '' }
const secondAd = { enabled: true, title: '第二广告位', imageUrl: 'https://images.example/ad.png', linkUrl: 'https://example.com/' }
const logoFile = { id: 'logo1', userId: 'root', storedInternal: true, isLink: false, isSensitive: false,
  type: 'image/png', accessKey: 'private-original-key', thumbnailAccessKey: 'private-thumb-key',
  webpublicAccessKey: 'private-web-key', webpublicType: 'image/webp' }

function fixture(options = {}) {
  const state = { row: { id: 'meta1', name: '旧站名称', iconUrl: 'https://images.example/legacy.png', disableRegistration: true,
    clientOptions: { communityAd2: secondAd, communityDefaultModels: { image: 'legacy-model' },
      communityPublicationMode: 'after', communityAutoBanEnabled: false, communityViolationThreshold: 8,
      uploadLimits: { image: 50, video: 60, audio: 70, document: 80, other: 90 }, custom: { preserved: true },
      ...options.clientOptions }, ...options.row } }
  const statements = []
  let snapshot, response
  const files = options.files ?? [logoFile]
  const user = options.user === undefined ? { id: 'root', isAdmin: true, isModerator: true } : options.user
  const query = async (sql, parameters = []) => {
    statements.push({ sql, parameters })
    if (sql === 'BEGIN') snapshot = structuredClone(state.row)
    else if (sql === 'ROLLBACK') state.row = snapshot
    else if (sql === 'COMMIT') snapshot = undefined
    else if (sql.includes('FROM meta')) {
      if (sql.includes('FOR UPDATE')) options.beforeLock?.(state.row)
      return { rows: [structuredClone(state.row)] }
    } else if (sql.includes('FROM drive_file')) {
      assert(sql.includes('AND "userId"=$2 AND "storedInternal" AND NOT "isLink" AND NOT "isSensitive"'))
      assert(sql.includes("AND type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif') FOR SHARE"))
      return { rows: files.filter(file => (sql.includes('WHERE id=$1') ? file.id === parameters[0]
        : [file.accessKey, file.thumbnailAccessKey, file.webpublicAccessKey].includes(parameters[0])) &&
        file.userId === parameters[1] && file.storedInternal && !file.isLink && !file.isSensitive &&
        ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) }
    } else if (sql.startsWith('UPDATE meta')) {
      assert(statements.some(item => item.sql.includes('FROM meta') && item.sql.includes('FOR UPDATE')))
      state.row.clientOptions = { ...state.row.clientOptions, ...JSON.parse(parameters[1]) }
      if (sql.includes('name=$3')) { state.row.name = parameters[2]; state.row.iconUrl = parameters[3] }
      if (sql.includes('"disableRegistration"=$5')) state.row.disableRegistration = parameters[4]
    } else if (sql.startsWith('INSERT INTO moderation_log')) {
      if (options.failAudit) throw new Error('Audit storage unavailable')
    } else assert.fail(`Unexpected query: ${sql}`)
    return { rows: [], rowCount: 1 }
  }
  const db = { query, async connect() { return { query, release() {} } } }
  const ctx = {
    db, config: { url: siteUrl }, body: {}, req: { method: 'GET' }, user, newId: () => 'audit1',
    requireUser() { if (!user) throw httpError(401, '请先登录。'); return user },
    requireAdmin() { const actor = this.requireUser(); if (!actor.isAdmin) throw httpError(403, '需要管理员权限。'); return actor },
    json(status, value) { assert.equal(status, 200); response = value },
  }
  return { state, statements, db, async request(path = '/api/admin/settings', method = 'GET', body = {}) {
    ctx.url = new URL(path, siteUrl); ctx.req.method = method; ctx.body = body
    response = undefined
    assert.equal(await handleAdmin(ctx), true)
    return response
  } }
}

test('legacy canonical branding is retained and four advertisement positions survive a full settings round trip', async () => {
  const f = fixture()
  const before = await f.request()
  assert.equal(before.settings.brand, '旧站名称')
  assert.equal(before.settings.logoUrl, 'https://images.example/legacy.png')
  assert.deepEqual(before.settings.ads, [emptyAd, secondAd, emptyAd, emptyAd])
  const saved = await f.request('/api/admin/settings', 'PATCH', before)
  assert.deepEqual(saved.settings.ads, before.settings.ads)
  assert.deepEqual(f.state.row.clientOptions.communityAd1, emptyAd)
  assert.deepEqual(f.state.row.clientOptions.communityAd2, secondAd)
  assert.equal(f.state.row.clientOptions.uploadLimits.audio, 70)
  assert.equal(f.state.row.disableRegistration, true)
  assert.equal(saved.version, before.version)
})

test('branding-only save synchronizes legacy meta fields while preserving all unrelated configuration', async () => {
  const f = fixture({ clientOptions: { communityLogoFileId: 'historicalLogo' } })
  const beforeOptions = structuredClone(f.state.row.clientOptions)
  const before = await f.request()
  const saved = await f.request('/api/admin/settings', 'PATCH', { settings: { brand: ' 新站名称 ' }, version: before.version })
  assert.equal(saved.settings.brand, '新站名称')
  assert.equal(f.state.row.name, '新站名称')
  assert.equal(f.state.row.iconUrl, before.settings.logoUrl)
  assert.equal(f.state.row.disableRegistration, true)
  assert.deepEqual(f.state.row.clientOptions, { ...beforeOptions, communityBrandName: '新站名称', communityLogoUrl: before.settings.logoUrl })
  assert.notEqual(saved.version, before.version)
  assert(!f.statements.some(item => item.sql.includes('FROM drive_file')))
})

test('site settings require a current version checked under the lock and rollback failed writes', async () => {
  for (const version of [undefined, null, 'stale-version']) {
    const f = fixture()
    await assert.rejects(f.request('/api/admin/settings', 'PATCH', { settings: { brand: 'changed' }, version }), { statusCode: 409 })
    assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
  }
  const concurrent = fixture({ beforeLock(row) { row.name = '另一位管理员' } })
  const stale = await concurrent.request()
  await assert.rejects(concurrent.request('/api/admin/settings', 'PATCH', { settings: { brand: 'changed' }, version: stale.version }), { statusCode: 409 })
  assert(!concurrent.statements.some(item => item.sql.startsWith('UPDATE meta')))
  const failed = fixture({ failAudit: true }), before = await failed.request()
  await assert.rejects(failed.request('/api/admin/settings', 'PATCH', { settings: { brand: 'changed' }, version: before.version }), /Audit storage unavailable/)
  assert.equal(failed.state.row.name, '旧站名称')
  assert(failed.statements.some(item => item.sql === 'ROLLBACK'))
})

test('community config and advertisement versions prevent stale updates while accepting existing unversioned clients', async () => {
  const f = fixture(), path = '/api/admin/community/config'
  const before = await f.request(path)
  assert.match(before.version, /^[a-f0-9]{64}$/)
  const saved = await f.request(path, 'PATCH', { communityPublicationMode: 'before', version: before.version })
  assert.equal(saved.config.communityPublicationMode, 'before')
  assert.notEqual(saved.version, before.version)
  await assert.rejects(f.request(path, 'PATCH', { communityAutoBanEnabled: true, version: before.version }), { statusCode: 409 })
  await f.request(path, 'PATCH', { communityAutoBanEnabled: true })
  assert.equal(f.state.row.clientOptions.communityAutoBanEnabled, true)
  const adsPath = '/api/admin/community/ads', priorAds = await f.request(adsPath)
  assert.equal(priorAds.items[1].title, '第二广告位')
  const next = await f.request(adsPath, 'PATCH', { items: [{ ...secondAd, id: 'communityAd2', title: '新版广告' }], version: priorAds.version })
  assert.equal(next.items[1].title, '新版广告')
  await assert.rejects(f.request(adsPath, 'PATCH', { items: priorAds.items, version: priorAds.version }), { statusCode: 409 })
  await f.request(adsPath, 'PATCH', { items: [{ ...emptyAd, id: 'communityAd4' }] })
  assert.equal(f.state.row.clientOptions.communityAd2.title, '新版广告')
  const publicAds = await f.request('/api/community/ads')
  assert.deepEqual(Object.keys(publicAds), ['items'])
  assert.equal(publicAds.items.length, 1)
})

test('saving unchanged legacy upload limits preserves the effective restrictions', async () => {
  const f = fixture({ clientOptions: { communityUploadLimits: { image: 2, video: 8, resource: 3, other: 4 } } })
  delete f.state.row.clientOptions.uploadLimits
  const path = '/api/admin/community/config'
  const before = await f.request(path)
  const expected = { image: 2, video: 8, audio: 20, document: 3, other: 4 }
  assert.deepEqual(before.config.uploadLimits, expected)
  const saved = await f.request(path, 'PATCH', { ...before.config, version: before.version })
  assert.deepEqual(saved.config.uploadLimits, expected)
  assert.deepEqual(f.state.row.clientOptions.uploadLimits, expected)
  assert.equal(saved.version, before.version)
})

test('admin limits match upload policy precedence and validation for mixed old and new values', async () => {
  const f = fixture({ clientOptions: {
    communityUploadLimits: { image: 2, video: 8, audio: 7, resource: 3, other: 4 },
    uploadLimits: { image: 5, video: null, document: 6, other: '9' },
  } })
  assert.deepEqual((await f.request('/api/admin/community/config')).config.uploadLimits,
    { image: 5, video: 8, audio: 7, document: 6, other: 20 })
  f.state.row.clientOptions.uploadLimits = { image: 0, video: 10241, audio: 1.5, document: -1, other: 10240 }
  assert.deepEqual((await f.request('/api/admin/community/config')).config.uploadLimits,
    { image: 20, video: 20, audio: 20, document: 20, other: 10240 })
})

test('public site metadata contains only branding and every configuration route enforces administrator access', async () => {
  const anonymous = fixture({ user: null })
  assert.deepEqual(await anonymous.request('/api/site'), { brand: '旧站名称', logoUrl: 'https://images.example/legacy.png' })
  for (const actor of [null, { id: 'mod1', isAdmin: false, isModerator: true }, { id: 'user1', isAdmin: false, isModerator: false }]) {
    for (const path of ['/api/admin/settings', '/api/admin/community/config', '/api/admin/community/ads']) {
      const f = fixture({ user: actor })
      await assert.rejects(f.request(path), { statusCode: actor ? 403 : 401 })
      await assert.rejects(f.request(path, 'PATCH', {}), { statusCode: actor ? 403 : 401 })
      assert.equal(f.statements.length, 0)
    }
  }
})

test('branding accepts controlled local image paths and safe HTTPS URLs while rejecting URL and path tricks', () => {
  for (const logoUrl of ['', 'https://images.example/logo.png', '/assets/branding/logo.png', '/legacy-files/logo1',
    '/legacy-files/logo1?variant=web', '/legacy-files/logo1?variant=thumbnail', '/files/photo-key.png']) {
    assert.equal(validateSiteBranding({ brand: '站点', logoUrl }, siteUrl).logoUrl, logoUrl)
  }
  assert.equal(validateSiteBranding({ brand: '站点', logoUrl: `${siteUrl}/legacy-files/logo1` }, siteUrl).logoUrl, '/legacy-files/logo1')
  for (const logoUrl of ['//evil.example/logo.png', 'http://evil.example/logo.png', 'javascript:alert(1)', 'data:image/png;base64,AA',
    'https://user:password@images.example/logo.png', '/api/private', `${siteUrl}/api/private`, '/assets/../api/private',
    '/assets/%2e%2e/api/private', '/assets/../../private', '/assets/logo\\evil.png', '/files/key?token=private',
    '/legacy-files/logo1?variant=web&token=secret', '/files/%2fsecret', '/assets/logo.png#fragment', 'https://images.example/\nlogo.png']) {
    assert.throws(() => validateSiteBranding({ brand: '站点', logoUrl }, siteUrl), { statusCode: 400 }, logoUrl)
  }
})

test('new local logo selections only accept owned non-sensitive raster files and publish an ID reference', async () => {
  for (const [input, expected] of [
    ['/legacy-files/logo1', '/legacy-files/logo1'], ['/legacy-files/logo1?variant=thumbnail', '/legacy-files/logo1?variant=thumbnail'],
    ['/legacy-files/logo1?variant=web', '/legacy-files/logo1?variant=web'], ['/files/private-original-key', '/legacy-files/logo1'],
    ['/files/private-thumb-key', '/legacy-files/logo1?variant=thumbnail'], ['/files/private-web-key', '/legacy-files/logo1?variant=web'],
  ]) {
    const f = fixture(), before = await f.request()
    const saved = await f.request('/api/admin/settings', 'PATCH', { settings: { logoUrl: input }, version: before.version })
    assert.equal(saved.settings.logoUrl, expected)
    assert.equal(f.state.row.clientOptions.communityLogoFileId, 'logo1')
    assert.equal(f.state.row.iconUrl, expected)
    assert(!JSON.stringify(saved).includes('private-'))
  }
  for (const denied of [{ userId: 'anotherAdmin' }, { isSensitive: true }, { isLink: true }, { storedInternal: false },
    { type: 'image/svg+xml' }, { type: 'text/html' }, { accessKey: null, thumbnailAccessKey: null, webpublicAccessKey: null }]) {
    const f = fixture({ files: [{ ...logoFile, ...denied }] }), before = await f.request()
    await assert.rejects(f.request('/api/admin/settings', 'PATCH', { settings: { logoUrl: '/legacy-files/logo1' }, version: before.version }), { statusCode: 400 })
    assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
  }
  const webOnly = fixture({ files: [{ ...logoFile, accessKey: null, thumbnailAccessKey: null }] }), before = await webOnly.request()
  const saved = await webOnly.request('/api/admin/settings', 'PATCH', { settings: { logoUrl: '/legacy-files/logo1' }, version: before.version })
  assert.equal(saved.settings.logoUrl, '/legacy-files/logo1?variant=web')
})

test('unrelated changes preserve historical logos while clearing or replacing removes the selected file reference', async () => {
  const f = fixture({ row: { iconUrl: 'http://legacy.example/files/previous-logo' }, clientOptions: { communityLogoFileId: 'previousLogo' } })
  const before = await f.request()
  const changed = await f.request('/api/admin/settings', 'PATCH', { settings: { brand: '新版名称' }, version: before.version })
  assert.equal(changed.settings.logoUrl, before.settings.logoUrl)
  assert.equal(f.state.row.clientOptions.communityLogoFileId, 'previousLogo')
  const cleared = await f.request('/api/admin/settings', 'PATCH', { settings: { logoUrl: '' }, version: changed.version })
  assert.equal(cleared.settings.logoUrl, '')
  assert.equal(f.state.row.iconUrl, null)
  assert.equal(f.state.row.clientOptions.communityLogoFileId, null)
  const explicitEmpty = fixture({ clientOptions: { communityBrandName: '新品牌', communityLogoUrl: '' } })
  assert.equal((await readSiteSettings(explicitEmpty.db, siteUrl)).logoUrl, '')
  assert.equal((await readSiteSettings(fixture({ row: { name: '' } }).db, siteUrl)).brand, '章鱼社区')
  const remote = fixture({ clientOptions: { communityLogoFileId: 'previousLogo' } }), remoteBefore = await remote.request()
  await remote.request('/api/admin/settings', 'PATCH', { settings: { logoUrl: 'https://images.example/new.png' }, version: remoteBefore.version })
  assert.equal(remote.state.row.clientOptions.communityLogoFileId, null)
})
