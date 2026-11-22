/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAdmin } from './admin.ts'
import { httpError } from './auth.ts'
import { readSiteSettings, validateSiteBranding } from './settings.ts'
import { defaultWelfareTasks } from '../shared/welfare-tasks.ts'

const siteUrl = 'https://community.example'
const welfarePath = '/api/admin/welfare/tasks'
const modelsPath = '/api/admin/models'

test('public welfare catalog defaults to three tasks and only exposes enabled display fields', async () => {
  const f = fixture({ user: null })
  assert.deepEqual(await f.request('/api/welfare/tasks'), { items: defaultWelfareTasks(), publication: null })
  const items = defaultWelfareTasks(); items[1].enabled = false
  f.state.row.clientOptions.communityWelfareTasks = items
  assert.deepEqual(await f.request('/api/welfare/tasks'), { items: [items[0], items[2]], publication: null })
  assert(!JSON.stringify(await f.request('/api/welfare/tasks')).includes('preserved'))
  f.state.row.clientOptions.communityWelfareTasks = { broken: true }
  assert.deepEqual((await f.request('/api/welfare/tasks')).items, defaultWelfareTasks())
})

test('welfare catalog requires admin privileges for both configuration reads and writes', async () => {
  for (const user of [null, { id: 'member' }, { id: 'moderator', isModerator: true }]) {
    const f = fixture({ user })
    for (const method of ['GET', 'PATCH']) await assert.rejects(f.request(welfarePath, method), { statusCode: user ? 403 : 401 })
    assert.equal(f.statements.length, 0)
  }
})

test('task edits preserve unrelated settings and reward rules, with ordering, audit and versioning', async () => {
  const f = fixture(), previous = structuredClone(f.state.row.clientOptions)
  const initial = await f.request(welfarePath)
  const items = initial.items.reverse()
  items[0].enabled = false; items[1].title = ' 创作分享 '; items[1].description = '参加社区创作'; items[1].buttonText = '去投稿'
  const result = await f.request(welfarePath, 'PATCH', { items, version: initial.version })
  assert.equal(result.items[1].title, '创作分享')
  assert.notEqual(result.version, initial.version)
  assert.deepEqual(await f.request(welfarePath), result)
  assert.deepEqual(f.state.row.clientOptions, { ...previous, communityWelfareTasks: result.items })
  assert.deepEqual((await f.request('/api/welfare/tasks')).items.map(item => item.id), ['publish', 'invite'])
  assert.equal(f.statements.find(item => item.sql.startsWith('INSERT INTO moderation_log')).parameters[2], 'updateCommunityWelfareTasks')
})

test('welfare edits require current version and check it inside the row lock', async () => {
  const f = fixture(), initial = await f.request(welfarePath)
  for (const version of [undefined, '', 'obsolete']) await assert.rejects(f.request(welfarePath, 'PATCH', { items: initial.items, version }), { statusCode: 409 })
  const race = fixture({ beforeLock(row) { const items = defaultWelfareTasks(); items[0].title = '其他管理员修改'; row.clientOptions.communityWelfareTasks = items } })
  const read = await race.request(welfarePath)
  await assert.rejects(race.request(welfarePath, 'PATCH', read), { statusCode: 409 })
  assert(!race.statements.some(item => item.sql.startsWith('UPDATE meta')))
})

test('task schema rejects unknown rewards, links, duplicate ids and out-of-bounds fields', async () => {
  const f = fixture(), initial = await f.request(welfarePath)
  const invalid = [[], initial.items.slice(0, 2), [...initial.items, initial.items[0]],
    [initial.items[0], initial.items[0], initial.items[2]],
    ...[{ title: '' }, { title: '  ' }, { title: '长'.repeat(41) }, { description: '长'.repeat(241) },
      { buttonText: '长'.repeat(25) }, { title: 'bad\0name' }, { enabled: 'true' }, { id: 'custom' },
      { points: 5000 }, { url: 'javascript:alert(1)' }].map(patch => [{ ...initial.items[0], ...patch }, ...initial.items.slice(1)]),
  ]
  for (const items of invalid) await assert.rejects(f.request(welfarePath, 'PATCH', { items, version: initial.version }), { statusCode: 400 })
  await assert.rejects(f.request(welfarePath, 'PATCH', { ...initial, reward: 5000 }), { statusCode: 400 })
  assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
})

test('welfare writes reject stale or missing account identity before touching storage', async () => {
  for (const headers of [{}, { 'x-new-api-user': 'differentAdmin' }]) {
    const f = fixture({ headers }), body = await f.request(welfarePath)
    f.statements.length = 0
    await assert.rejects(f.request(welfarePath, 'PATCH', body), { statusCode: 409 })
    assert.equal(f.statements.length, 0)
  }
})

test('publication reward edits are versioned and old clients cannot erase a configured rule', async () => {
  const f = fixture(), initial = await f.request(welfarePath)
  initial.items[1].publicationReward = { enabled: true, threshold: 3, tickets: 5 }
  const updated = await f.request(welfarePath, 'PATCH', initial)
  assert.deepEqual(updated.items[1].publicationReward, { enabled: true, threshold: 3, tickets: 5 })
  await assert.rejects(f.request(welfarePath, 'PATCH', initial), { statusCode: 409 })
  delete updated.items[1].publicationReward
  updated.items[1].title = '新标题'
  const compatible = await f.request(welfarePath, 'PATCH', updated)
  assert.deepEqual(compatible.items[1].publicationReward, { enabled: true, threshold: 3, tickets: 5 })
  const invalid = structuredClone(compatible); invalid.items[1].publicationReward.tickets = 0
  await assert.rejects(f.request(welfarePath, 'PATCH', invalid), { statusCode: 400 })
})

test('an audit failure rolls back task changes', async () => {
  const f = fixture({ failAudit: true }), previous = structuredClone(f.state.row)
  const initial = await f.request(welfarePath); initial.items[0].title = '邀请好友'
  await assert.rejects(f.request(welfarePath, 'PATCH', initial), /Audit storage unavailable/)
  assert.deepEqual(f.state.row, previous)
  assert(f.statements.some(item => item.sql === 'ROLLBACK'))
})
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
    } else if (sql.includes('FROM community_lottery_account')) return { rows: [] }
    else if (sql.includes('FROM drive_file')) {
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
    db, config: { url: siteUrl }, body: {}, req: { method: 'GET', headers: options.headers ?? { 'x-new-api-user': user?.id } }, user, newId: () => 'audit1',
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

test('model types persist through settings saves and support versioned removal without changing unrelated options', async () => {
  const f = fixture(), path = modelsPath
  const before = await f.request(path)
  assert.deepEqual(before.items, [])
  const modelTypes = [{ id: 'custom/alias', kind: 'image' }, { id: '__proto__', kind: 'video' }, { id: 'gpt-5', kind: 'text' }]
  const saved = await f.request(path, 'PATCH', { items: modelTypes, version: before.version })
  assert.deepEqual((await f.request(path)).items, modelTypes)
  assert.deepEqual(f.state.row.clientOptions.custom, { preserved: true })
  await assert.rejects(f.request(path, 'PATCH', { items: [], version: before.version }), { statusCode: 409 })
  await f.request('/api/admin/community/config', 'PATCH', { communityFeedMode: 'latest' })
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, modelTypes)
  const latest = await f.request(path)
  await f.request(path, 'PATCH', { items: [], version: latest.version })
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, [])
  assert.notEqual(saved.version, before.version)
})

test('model interfaces, automatic parameters and private remarks round-trip through versioned admin configuration', async () => {
  const f = fixture(), path = modelsPath, before = await f.request(path)
  const communityModelTypes = [
    { id: 'chat-model', name: '对话模型', tags: ['推理', '文本'], kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' }, remark: 'private chat routing note' },
    { id: 'image-model', kind: 'image', apiFormat: 'images', protocol: 'async',
      image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '16:9', autoBackground: 'transparent' }, remark: 'private image routing note' },
    { id: 'video-model', kind: 'video', apiFormat: 'openai', protocol: 'sync',
      video: { autoResolution: '720p', resolutions: ['720p', '1080p'], autoAspectRatio: '9:16', parameterFormat: 'xai' }, remark: 'private video routing note' },
  ]
  const saved = await f.request(path, 'PATCH', { items: communityModelTypes, version: before.version })
  assert.deepEqual(saved.items, communityModelTypes)
  assert.deepEqual((await f.request(path)).items, communityModelTypes)
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, communityModelTypes)
  assert.deepEqual(f.state.row.clientOptions.custom, { preserved: true })
  assert(!JSON.stringify(await f.request('/api/site')).includes('private'))
  await assert.rejects(f.request(path, 'PATCH', { items: [], version: before.version }), { statusCode: 409 })
  const community = await f.request('/api/admin/community/config')
  await f.request('/api/admin/community/config', 'PATCH', { communityFeedMode: 'latest', version: community.version })
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, communityModelTypes)
})

test('model and community versions are independent and the community endpoint cannot overwrite models', async () => {
  const f = fixture(), models = await f.request(modelsPath), path = '/api/admin/community/config'
  const before = await f.request(path)
  assert(!Object.hasOwn(before.config, 'communityModelTypes'))
  const community = await f.request(path, 'PATCH', { communityFeedMode: 'latest', version: before.version })
  const items = [{ id: 'custom-image', kind: 'image', name: '图像模型', tags: ['编辑'] }]
  const saved = await f.request(modelsPath, 'PATCH', { items, version: models.version })
  assert.equal((await f.request(path)).version, community.version)
  await f.request(path, 'PATCH', { communityPullToRefresh: false, version: community.version })
  assert.deepEqual(await f.request(modelsPath), saved)
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, items)
  await assert.rejects(f.request(path, 'PATCH', { communityModelTypes: [], version: community.version }), { statusCode: 400 })
  await assert.rejects(f.request(modelsPath, 'PATCH', { ...saved, communityFeedMode: 'shuffle' }), { statusCode: 400 })
  assert.equal(f.state.row.clientOptions.communityFeedMode, 'latest')
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, items)
})

test('model edits require their current version under the row lock and reject stale account identity', async () => {
  const f = fixture(), before = await f.request(modelsPath), items = [{ id: 'custom-image', kind: 'image' }]
  for (const version of [undefined, null, '', 'obsolete']) {
    await assert.rejects(f.request(modelsPath, 'PATCH', { items, version }), { statusCode: 409 })
  }
  assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
  const race = fixture({ beforeLock(row) { row.clientOptions.communityModelTypes = [{ id: 'other-model', kind: 'text' }] } })
  const read = await race.request(modelsPath)
  await assert.rejects(race.request(modelsPath, 'PATCH', { items, version: read.version }), { statusCode: 409 })
  assert(!race.statements.some(item => item.sql.startsWith('UPDATE meta')))
  for (const headers of [{}, { 'x-new-api-user': 'differentAdmin' }]) {
    const stale = fixture({ headers })
    stale.statements.length = 0
    await assert.rejects(stale.request(modelsPath, 'PATCH', { items, version: before.version }), { statusCode: 409 })
    assert.equal(stale.statements.length, 0)
  }
})

test('model display fields are normalized and auditing remains atomic', async () => {
  const f = fixture(), before = await f.request(modelsPath)
  const saved = await f.request(modelsPath, 'PATCH', {
    items: [{ id: 'custom-image', name: ' 图像模型 ', tags: [' 图像 ', 'Edit'], kind: 'image' }], version: before.version,
  })
  assert.deepEqual(saved.items, [{ id: 'custom-image', name: '图像模型', tags: ['图像', 'Edit'], kind: 'image' }])
  assert.deepEqual(await f.request(modelsPath), saved)
  assert.equal(f.statements.find(item => item.sql.startsWith('INSERT INTO moderation_log')).parameters[2], 'updateCommunityModels')
  const failed = fixture({ failAudit: true }), previous = structuredClone(failed.state.row)
  const initial = await failed.request(modelsPath)
  await assert.rejects(failed.request(modelsPath, 'PATCH', { items: saved.items, version: initial.version }), /Audit storage unavailable/)
  assert.deepEqual(failed.state.row, previous)
  assert(failed.statements.some(item => item.sql === 'ROLLBACK'))
})

test('model configuration rejects incompatible interfaces, credentials, invalid defaults and oversized remarks', async () => {
  const invalid = [
    { kind: 'text', apiFormat: 'images' }, { kind: 'text', protocol: 'sync' },
    { kind: 'image', apiFormat: 'responses' }, { kind: 'image', apiFormat: 'chat-completions', protocol: 'async' },
    { kind: 'video', apiFormat: 'gemini' }, { kind: 'video', protocol: 'plugin' },
    { kind: 'image', image: { autoResolution: '8k' } }, { kind: 'image', image: { autoQuality: 'standard' } },
    { kind: 'image', image: { autoAspectRatio: '0:1' } }, { kind: 'image', image: { autoBackground: 'red' } },
    { kind: 'image', image: { headers: { authorization: 'secret' } } },
    { kind: 'text', text: { autoReasoningEffort: 'unbounded' } }, { kind: 'text', text: { model: 'another' } },
    { kind: 'image', text: {} }, { kind: 'video', image: {} }, { kind: 'text', video: {} },
    { kind: 'video', video: { parameterFormat: 'plugin' } }, { kind: 'video', video: { autoAspectRatio: 'javascript:1' } },
    { kind: 'image', apiFormat: 'https://untrusted.example/generate' }, { kind: 'image', apiKey: 'secret' },
    { kind: 'text', remark: 'x'.repeat(2001) }, { kind: 'text', remark: 'private\0note' },
    ...[{ name: '' }, { name: ' ' }, { name: 'x'.repeat(121) }, { name: 'bad\nname' }, { name: null },
      { tags: 'tag' }, { tags: [''] }, { tags: [' '] }, { tags: ['x'.repeat(33)] }, { tags: ['bad\0tag'] },
      { tags: ['same', 'Same'] }, { tags: ['same', ' same '] }, { tags: [1] },
      { tags: Array.from({ length: 13 }, (_, index) => String(index)) }].map(item => ({ kind: 'text', ...item })),
  ]
  const f = fixture(), before = await f.request(modelsPath)
  for (const item of invalid) {
    await assert.rejects(f.request(modelsPath, 'PATCH', {
      items: [{ id: 'configured-model', ...item }], version: before.version,
    }), { statusCode: 400 })
  }
  assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
})

test('video resolution settings persist with model types and accept automatic upstream resolution', async () => {
  const f = fixture(), path = modelsPath, before = await f.request(path)
  const videoSettings = [{}, { autoResolution: 'auto' }, { autoResolution: '1p' }, { autoResolution: '65535p' },
    { autoResolution: '4k' }, { autoResolution: '480p', resolutions: ['480p', '720p'] },
    { resolutions: ['720p'] }, { autoResolution: 'auto', resolutions: ['4k'] },
    { resolutions: Array.from({ length: 16 }, (_, index) => `${index + 1}p`) }]
  const communityModelTypes = videoSettings.map((video, index) => ({ id: `video-${index}`, kind: 'video', video }))
  const saved = await f.request(path, 'PATCH', { items: communityModelTypes, version: before.version })
  assert.deepEqual(saved.items, communityModelTypes)
  assert.deepEqual((await f.request(path)).items, communityModelTypes)
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, communityModelTypes)
  assert.deepEqual(f.state.row.clientOptions.custom, { preserved: true })
  assert.notEqual(saved.version, before.version)
  await assert.rejects(f.request(path, 'PATCH', { items: [], version: before.version }), { statusCode: 409 })
})

test('video resolution settings reject unsafe, conflicting and oversized configuration before writing', async () => {
  const invalid = [null, [], { autoResolution: '' }, { autoResolution: '0p' }, { autoResolution: '65536p' },
    { autoResolution: '0720p' }, { autoResolution: '720P' }, { autoResolution: 720 }, { autoResolution: 'https://model.example' },
    { resolutions: [] }, { resolutions: ['auto'] }, { resolutions: ['720p', '720p'] }, { resolutions: ['65536p'] },
    { resolutions: Array.from({ length: 17 }, (_, index) => `${index + 1}p`) },
    { autoResolution: '1080p', resolutions: ['720p'] }, { autoResolution: '720p', duration: 8 },
    { headers: { authorization: 'secret' } }]
  const modelTypes = invalid.map(video => [{ id: 'video-model', kind: 'video', video }])
  modelTypes.push([{ id: 'image-model', kind: 'image', video: {} }], [{ id: 'chat-model', kind: 'text', video: {} }])
  for (const communityModelTypes of modelTypes) {
    const f = fixture()
    await assert.rejects(f.request(modelsPath, 'PATCH', { items: communityModelTypes }), { statusCode: 400 })
    assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
  }
})

test('review settings save their own fields atomically without changing uploads, models or existing submissions', async () => {
  const f = fixture({ clientOptions: { communityModelTypes: [{ id: 'keep-model', kind: 'video' }], communityFeedWeights: { interest: 50, fresh: 30, explore: 20 } } })
  const path = '/api/admin/community/config', before = await f.request(path)
  const patch = { communityPublicationMode: 'before', communityAutoBanEnabled: true, communityViolationThreshold: 5,
    communityFeedMode: 'latest', communityFeedPoolSize: 300, communityPullToRefresh: false,
    communityFeedWeights: before.config.communityFeedWeights, version: before.version }
  const saved = await f.request(path, 'PATCH', patch)
  assert.equal(saved.config.communityPublicationMode, 'before')
  assert.equal(saved.config.communityViolationThreshold, 5)
  assert.deepEqual(f.state.row.clientOptions.communityModelTypes, [{ id: 'keep-model', kind: 'video' }])
  assert.deepEqual(saved.config.uploadLimits, before.config.uploadLimits)
  assert.deepEqual(saved.config.communityFeedWeights, before.config.communityFeedWeights)
  assert(!f.statements.some(item => /^(UPDATE|DELETE|INSERT INTO) (community_submission|"user"|community_violation)/.test(item.sql)))
  await assert.rejects(f.request(path, 'PATCH', { ...patch, communityPublicationMode: 'after' }), { statusCode: 409 })
  for (const threshold of [0, 1001, 1.5, '3', null]) {
    await assert.rejects(f.request(path, 'PATCH', { communityViolationThreshold: threshold, version: saved.version }), { statusCode: 400 })
  }
  assert.equal((await f.request(path)).config.communityViolationThreshold, 5)
})

test('model type settings reject duplicates, invalid types, control characters and oversized input before writing', async () => {
  for (const communityModelTypes of [
    null, {}, [{ id: '', kind: 'image' }], [{ id: ' alias ', kind: 'image' }],
    [{ id: 'a\nb', kind: 'image' }], [{ id: 'a'.repeat(201), kind: 'image' }],
    [{ id: 'alias', kind: 'auto' }], [{ id: 'alias', kind: 'image', extra: true }],
    [{ id: 'alias', kind: 'image' }, { id: 'alias', kind: 'video' }],
    Array.from({ length: 501 }, (_, index) => ({ id: String(index), kind: 'text' })),
  ]) {
    const f = fixture()
    await assert.rejects(f.request(modelsPath, 'PATCH', { items: communityModelTypes }), { statusCode: 400 })
    assert(!f.statements.some(item => item.sql.startsWith('UPDATE meta')))
  }
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
    for (const path of [modelsPath, '/api/admin/settings', '/api/admin/community/config', '/api/admin/community/ads']) {
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
