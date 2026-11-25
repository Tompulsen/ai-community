import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import { AccountRequest } from './http.ts'
import { saveSession, removeSessionById } from './session.ts'
import { resolveModelGroup, resolveSystemAutoToken, initializeLoginAuto } from './model-groups.ts'
import { requestDatabase, environment } from '../creation/test-database.mjs'
import { readAccountModelCatalogue } from './model-catalogue.ts'
import { resolveRelayCredentials } from './relay.ts'

const systemName = '\u7cfb\u7edf\u521b\u5efa'
let nextUser = 5000

test('a single-group account catalogue reads only account metadata and rejects unauthorized groups', async t => {
  const f = await fixture(t, [], { respond(call, { ok }) {
    if (call.path === '/api/user/models') return ok(['gpt-image-2'])
  } })
  const catalogue = await readAccountModelCatalogue(f.request, 'images')
  assert.deepEqual(catalogue.items, [{ id: 'gpt-image-2', groups: ['images'] }])
  assert.equal(f.calls.filter(call => call.path === '/api/user/models').length, 1)
  assert.equal(f.calls.filter(call => call.path.startsWith('/api/token')).length, 0)
  await assert.rejects(readAccountModelCatalogue(f.request, 'unavailable'), error => error.status === 403)
  assert.equal(f.writes().length, 0)
})

test('native credentials retain PostgreSQL provenance across concurrency, cache loss and uncertain writes', async t => {
  const db = await requestDatabase(t)
  environment(t, { COMMUNITY_REQUEST_STORE: '1', COMMUNITY_REQUEST_V2: '1' })
  await t.test('eight first sends create once, survive Redis loss, and ignore manual session selections', async t => {
    const f = await fixture(t, [{ id: 40, name: 'manual', group: 'manual' }], { selected: 40 })
    f.request.database = db
    const ids = await Promise.all(Array.from({ length: 8 }, () => resolveModelGroup(f.request, 'images')))
    assert.equal(new Set(ids).size, 1)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
    globalThis.__octopusModelGroups.clear()
    const next = new AccountRequest(f.request); next.database = db
    const reads = f.calls.filter(call => call.path === `/api/token/${ids[0]}`).length
    assert.equal(await resolveModelGroup(next, 'images'), ids[0])
    next.headers.set('x-new-api-token', String(ids[0])); next.headers.set('x-new-api-group', 'images')
    assert.equal((await resolveRelayCredentials(next, 'v1/images/generations')).tokenId, ids[0])
    assert.equal(f.calls.filter(call => call.path === `/api/token/${ids[0]}`).length - reads, 1)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
    assert.equal(f.items.find(item => item.id === 40).name, 'manual')
  })
  await t.test('a system name cannot prove provenance', async t => {
    const f = await fixture(t, [{ id: 41 }]); f.request.database = db
    await assert.rejects(resolveModelGroup(f.request, 'images'), error => error.code === 'NEW_API_CREDENTIAL_VERIFICATION_REQUIRED')
    assert.equal(f.writes().length, 0)
  })
  await t.test('a lost create response only reconciles GET after restarting the resolver', async t => {
    let ambiguous = true
    const f = await fixture(t, [], { respond(call) {
      if (call.method === 'POST' && call.path === '/api/token/' && ambiguous) throw new Error('lost creation response')
    } }); f.request.database = db
    await assert.rejects(resolveModelGroup(f.request, 'images'), /不会重复创建/)
    ambiguous = false
    globalThis.__octopusModelGroups.clear()
    await assert.rejects(resolveModelGroup(f.request, 'images'), /不会重复创建/)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
    const row = (await db.query("SELECT binding FROM community_group_credential WHERE binding ? 'pendingName' ORDER BY updated_at DESC LIMIT 1")).rows[0]
    assert.ok(row.binding.pendingName)
  })
  await t.test('search Auto and ordinary Auto share a verified native binding', async t => {
    const f = await fixture(t); f.request.database = db
    const ordinary = await resolveModelGroup(f.request, 'auto')
    assert.equal(await resolveSystemAutoToken(f.request), ordinary)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
  })
  async function deletedImportedToken(t, options = {}) {
    const f = await fixture(t, [{ id: 830, group: 'auto' }], options)
    const key = 'octopus:new-api:model-group:' + createHash('sha256')
      .update(JSON.stringify(['https://token-reuse.test', f.credentials.user.id, 'auto'])).digest('hex')
    for (const suffix of ['', ':web-search']) globalThis.__octopusModelGroups.set(key + suffix, JSON.stringify({ tokenId: 830 }))
    await db.query('INSERT INTO community_group_credential (key,binding,provenance) VALUES ($1,$2,$3)',
      [key + ':native', JSON.stringify({ tokenId: 830 }), 'operator-import: fixture'])
    f.items.length = 0
    return { ...f, key, fresh() { const req = new AccountRequest(f.request.url, { headers: f.request.headers }); req.database = db; return req } }
  }
  await t.test('a deleted imported Auto key is replaced once across concurrent fresh requests', async t => {
    const f = await deletedImportedToken(t)
    assert.equal(await resolveModelGroup(f.fresh(), 'auto', false), undefined)
    assert.deepEqual((await db.query('SELECT binding FROM community_group_credential WHERE key=$1', [f.key + ':native'])).rows[0].binding, { tokenId: 830 })
    const ids = await Promise.all(Array.from({ length: 8 }, () => resolveModelGroup(f.fresh(), 'auto')))
    assert.equal(new Set(ids).size, 1)
    assert.equal(await resolveSystemAutoToken(f.fresh()), ids[0])
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
    assert.equal(globalThis.__octopusModelGroups.has(f.key), false)
    assert.equal(globalThis.__octopusModelGroups.has(f.key + ':web-search'), false)
  })
  for (const conflict of [{ tokenId: 831 }, { pendingName: systemName + '-0000000000000000' }]) {
    await t.test('a deleted imported key preserves conflicting legacy state: ' + JSON.stringify(conflict), async t => {
      const f = await deletedImportedToken(t)
      globalThis.__octopusModelGroups.set(f.key + ':web-search', JSON.stringify(conflict))
      await assert.rejects(resolveModelGroup(f.fresh(), 'auto'), { code: 'NEW_API_CREDENTIAL_VERIFICATION_REQUIRED' })
      assert.deepEqual((await db.query('SELECT binding FROM community_group_credential WHERE key=$1', [f.key + ':native'])).rows[0].binding, { tokenId: 830 })
      assert.equal(globalThis.__octopusModelGroups.get(f.key + ':web-search'), JSON.stringify(conflict))
      assert.equal(f.writes().length, 0)
    })
  }
  await t.test('a rejected replacement preserves the deleted binding for a fresh retry', async t => {
    let reject = true
    const f = await deletedImportedToken(t, { respond(call) {
      if (call.method === 'POST' && reject) return Response.json({ success: false, message: 'capacity reached' }, { status: 400 })
    } })
    await assert.rejects(resolveModelGroup(f.fresh(), 'auto'), { status: 400 })
    assert.deepEqual((await db.query('SELECT binding FROM community_group_credential WHERE key=$1', [f.key + ':native'])).rows[0].binding, { tokenId: 830 })
    reject = false
    assert.equal(await resolveModelGroup(f.fresh(), 'auto'), 1)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 2)
  })
  await t.test('an uncertain replacement keeps its intent and never repeats the create', async t => {
    let hide = true
    const f = await deletedImportedToken(t, { respond(call, { items, token, ok }) {
      if (call.path === '/api/token/' && call.method === 'POST') {
        items.push(token(901, call.body)); throw new TypeError('fixture: lost replacement response')
      }
      if (call.path === '/api/token/' && call.method === 'GET' && hide) return ok({ items: [], total: 0 })
    } })
    await assert.rejects(resolveModelGroup(f.fresh(), 'auto'), { code: 'NEW_API_GROUP_TOKEN_PENDING' })
    const pending = (await db.query('SELECT binding FROM community_group_credential WHERE key=$1', [f.key + ':native'])).rows[0].binding
    assert.equal(pending.replacedTokenId, 830)
    hide = false
    assert.equal(await resolveModelGroup(f.fresh(), 'auto'), 901)
    assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
  })
})

async function fixture(t, entries = [], options = {}) {
  const environment = {
    NODE_ENV: 'test', NEW_API_BASE_URL: 'https://token-reuse.test',
    NEW_API_PUBLIC_URL: 'https://token-reuse.test',
    NEW_API_SESSION_SECRET: 'token-reuse-fixture-'.repeat(3), NEW_API_REDIS_URL: '',
  }
  const previousEnvironment = { ...process.env }
  Object.assign(process.env, environment)
  const user = { id: nextUser++, username: 'fixture', group: 'default' }
  const token = (id, changes = {}) => ({
    id, user_id: user.id, name: systemName, group: 'images', status: 1,
    expired_time: -1, unlimited_quota: true, remain_quota: 0,
    model_limits_enabled: false, model_limits: '', allow_ips: '',
    cross_group_retry: false, auto_groups: [], ...changes,
  })
  const items = entries.map(entry => token(entry.id, entry))
  const now = Math.floor(Date.now() / 1000)
  const credentials = { user, accessToken: 'fixture-access', refreshToken: 'fixture-refresh',
    upstreamSessionId: 'fixture-sid', accessExpiresAt: now + 3600 }
  const id = randomBytes(32).toString('base64url')
  await saveSession(id, { ...credentials, createdAt: now, expiresAt: now + 3600, version: 1,
    ...(options.selected ? { selectedTokenId: options.selected } : {}) })
  t.after(async () => {
    try { await removeSessionById(id) }
    finally {
      for (const key of Object.keys(environment)) {
        if (previousEnvironment[key] === undefined) delete process.env[key]
        else process.env[key] = previousEnvironment[key]
      }
    }
  })
  const request = new AccountRequest('https://community.test/api/new-api/model-groups/select', {
    method: 'POST', body: '{}', headers: { host: 'community.test', origin: 'https://community.test',
      cookie: `octopus_new_api_session=${id}`, 'content-type': 'application/json' },
  })
  const calls = []
  const ok = data => Response.json({ success: true, data })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const target = new URL(url)
    assert.equal(target.origin, 'https://token-reuse.test')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-access')
    const call = { path: target.pathname, method: init.method || 'GET',
      page: Number(target.searchParams.get('p')), body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const custom = await options.respond?.(call, { items, token, ok })
    if (custom) return custom
    if (call.path === '/api/user/self') return ok(user)
    if (call.path === '/api/user/self/groups') return ok({ images: {}, auto: {}, manual: {} })
    if (call.path === '/api/token/') {
      if (call.method === 'GET') return ok({ items, total: items.length })
      if (call.method === 'POST') {
        if (items.length >= (options.capacity ?? Infinity))
          return Response.json({ success: false, message: 'Maximum number of tokens reached' })
        items.push(token(Math.max(0, ...items.map(item => item.id)) + 1, call.body))
        return ok(null)
      }
      if (call.method === 'PUT') {
        const found = items.find(item => item.id === call.body.id)
        assert.ok(found)
        Object.assign(found, call.body)
        return ok(null)
      }
    }
    const match = /^\/api\/token\/(\d+)(\/key)?$/.exec(call.path)
    assert.ok(match, `Unexpected request ${call.method} ${call.path}`)
    const found = items.find(item => item.id === Number(match[1]))
    if (!found) return Response.json({ success: false, message: 'record not found' }, { status: 404 })
    return ok(match[2] ? { key: 'fixture-only-key' } : found)
  })
  return { request, credentials, items, calls,
    lists: () => calls.filter(call => call.path === '/api/token/' && call.method === 'GET'),
    writes: () => calls.filter(call => call.path === '/api/token/' && call.method !== 'GET') }
}

test('reuse an existing group token at capacity and skip later list reads', async t => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, group: index === 19 ? 'images' : 'manual',
  }))
  const f = await fixture(t, entries, { capacity: 20 })
  assert.equal(await resolveModelGroup(f.request, 'images'), 20)
  assert.equal(f.lists().length, 1)
  assert.equal(await resolveModelGroup(f.request, 'images'), 20)
  assert.equal(f.lists().length, 1)
  assert.equal(f.writes().length, 0)
})

test('idle preloading skips unprepared groups without listing or creating keys', async t => {
  const f = await fixture(t, [{ id: 30 }])
  assert.equal(await resolveModelGroup(f.request, 'images', false), undefined)
  assert.equal(f.lists().length, 0)
  assert.equal(f.writes().length, 0)
  assert.equal(await resolveModelGroup(f.request, 'images'), 30)
  const lists = f.lists().length
  assert.equal(await resolveModelGroup(f.request, 'images', false), 30)
  assert.equal(f.lists().length, lists)
  assert.equal(f.writes().length, 0)
})

test('idle preloading can reuse the current key', async t => {
  const selected = await fixture(t, [{ id: 40 }], { selected: 40 })
  assert.equal(await resolveModelGroup(selected.request, 'images', false), 40)
  assert.equal(selected.writes().length, 0)
})

test('idle preloading never recovers pending provisioning', async t => {
  const pending = await fixture(t, [], { respond(call) {
    if (call.path === '/api/token/' && call.method === 'POST') throw new TypeError('fixture: timeout')
  } })
  await assert.rejects(resolveModelGroup(pending.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_PENDING' })
  const calls = pending.calls.length
  assert.equal(await resolveModelGroup(pending.request, 'images', false), undefined)
  assert.equal(pending.calls.length, calls + 1, 'preloading only verifies available groups')
  assert.equal(pending.writes().length, 1)
})

test('duplicates use the oldest eligible system token regardless of list order', async t => {
  const f = await fixture(t, [{ id: 40 }, { id: 27, allow_ips: '127.0.0.1' }, { id: 30 }])
  assert.equal(await resolveModelGroup(f.request, 'images'), 30)
  assert.equal(f.writes().length, 0)
})

test('current selections and manual group bindings keep priority', async t => {
  const f = await fixture(t, [{ id: 40, group: 'manual', name: 'personal' }, { id: 30 }], { selected: 40 })
  assert.equal(await resolveModelGroup(f.request, 'images'), 30)
  assert.equal(await resolveModelGroup(f.request, 'manual'), 40)
  assert.equal(f.lists().length, 1)
  assert.equal(f.writes().length, 0)
})

test('the current same-group token wins over older duplicates', async t => {
  const f = await fixture(t, [{ id: 40, name: 'personal' }, { id: 30 }], { selected: 40 })
  assert.equal(await resolveModelGroup(f.request, 'images'), 40)
  assert.equal(f.lists().length, 0)
  assert.equal(f.writes().length, 0)
})

test('disabled bound tokens are preserved; confirmed deletion can reuse another token', async t => {
  const f = await fixture(t, [{ id: 30 }, { id: 40 }])
  assert.equal(await resolveModelGroup(f.request, 'images'), 30)
  f.items[0].status = 2
  await assert.rejects(resolveModelGroup(f.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_UNAVAILABLE' })
  assert.equal(f.lists().length, 1)
  f.items.shift()
  assert.equal(await resolveModelGroup(f.request, 'images'), 40)
  assert.equal(f.writes().length, 0)
})

test('restricted or invalid system tokens never trigger replacement creation', async t => {
  const cases = [
    { status: 2 }, { expired_time: 1 }, { expired_time: Math.floor(Date.now() / 1000) + 3600 },
    { unlimited_quota: false, remain_quota: 100 }, { model_limits_enabled: true, model_limits: 'gpt' },
    { allow_ips: '127.0.0.1' }, { auto_groups: ['images'] }, { cross_group_retry: true }, { user_id: -1 },
  ]
  for (const changes of cases) await t.test(JSON.stringify(changes), async t => {
    const f = await fixture(t, [{ id: 30, ...changes }])
    await assert.rejects(resolveModelGroup(f.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_UNAVAILABLE' })
    assert.equal(f.writes().length, 0)
  })
})

test('paginated lookup finds an existing token after the first page', async t => {
  const f = await fixture(t, [], { respond(call, { token, ok }) {
    if (call.path === '/api/token/' && call.method === 'GET')
      return ok({ items: call.page === 1 ? [token(1, { group: 'manual' })] : [token(30)], total: 2 })
    if (call.path === '/api/token/30') return ok(token(30))
  } })
  assert.equal(await resolveModelGroup(f.request, 'images'), 30)
  assert.equal(f.lists().length, 2)
  assert.equal(f.writes().length, 0)
})

test('uncertain or incomplete lists fail closed without creating tokens', async t => {
  for (const data of [ { items: [], total: 1 }, { items: [], total: '0' }, { items: null, total: 0 },
    { items: [{ id: 1 }, { id: 1 }], total: 2 }, { items: [{ id: '1' }], total: 1 } ]) {
    await t.test(JSON.stringify(data), async t => {
      const f = await fixture(t, [], { respond(call, { ok }) {
        if (call.path === '/api/token/') return ok(data)
      } })
      await assert.rejects(resolveModelGroup(f.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_PENDING' })
      assert.equal(f.writes().length, 0)
    })
  }
})

test('concurrent first requests create exactly one token and reuse its binding', async t => {
  const f = await fixture(t)
  const ids = await Promise.all(Array.from({ length: 8 }, () => resolveModelGroup(f.request, 'images')))
  assert.deepEqual(ids, Array(8).fill(1))
  assert.deepEqual(f.writes().map(call => call.method), ['POST', 'PUT'])
  assert.equal(f.lists().length, 2)
  assert.equal(f.items[0].name, systemName)
})

test('a lost create response recovers the upstream token without another POST', async t => {
  const f = await fixture(t, [], { respond(call, { items, token }) {
    if (call.path === '/api/token/' && call.method === 'POST') {
      items.push(token(35, call.body))
      throw new TypeError('fixture: response lost')
    }
  } })
  assert.equal(await resolveModelGroup(f.request, 'images'), 35)
  assert.equal(await resolveModelGroup(f.request, 'images'), 35)
  assert.equal(f.writes().filter(call => call.method === 'POST').length, 1)
})

test('an unconfirmed create stays pending across retries without another POST', async t => {
  const f = await fixture(t, [], { respond(call) {
    if (call.path === '/api/token/' && call.method === 'POST') throw new TypeError('fixture: timeout')
  } })
  for (let i = 0; i < 2; i++)
    await assert.rejects(resolveModelGroup(f.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_PENDING' })
  assert.equal(f.writes().length, 1)
})

test('Auto search recovers duplicates and shares the ordinary Auto binding', async t => {
  const f = await fixture(t, [{ id: 40, group: 'auto' }, { id: 30, group: 'auto', auto_groups: null, allow_ips: null }])
  assert.equal(await resolveSystemAutoToken(f.request), 30)
  assert.equal(await resolveModelGroup(f.request, 'auto'), 30)
  assert.equal(f.lists().length, 1)
  assert.equal(f.writes().length, 0)
})

test('login reuses system Auto; manual-only accounts do not get a new token', async t => {
  await t.test('existing Auto', async t => {
    const f = await fixture(t, [{ id: 30, group: 'auto' }])
    assert.deepEqual(await initializeLoginAuto(f.request, f.credentials), {
      selectedTokenId: 30, selectedKey: 'sk-fixture-only-key',
    })
    assert.equal(f.writes().length, 0)
  })
  await t.test('manual-only', async t => {
    const f = await fixture(t, [{ id: 30, group: 'auto', name: 'personal' }])
    assert.deepEqual(await initializeLoginAuto(f.request, f.credentials), {})
    assert.equal(f.writes().length, 0)
  })
})

test('a candidate modified after listing is rejected before binding', async t => {
  const f = await fixture(t, [{ id: 30 }], { respond(call, { token, ok }) {
    if (call.path === '/api/token/30') return ok(token(30, { user_id: -1 }))
  } })
  for (let i = 0; i < 2; i++)
    await assert.rejects(resolveModelGroup(f.request, 'images'), { code: 'NEW_API_GROUP_TOKEN_UNAVAILABLE' })
  assert.equal(f.lists().length, 2)
  assert.equal(f.writes().length, 0)
})

test('search Auto does not overwrite an existing manual Auto binding', async t => {
  const f = await fixture(t, [{ id: 40, group: 'auto', name: 'personal' }, { id: 30, group: 'auto' }], { selected: 40 })
  assert.equal(await resolveModelGroup(f.request, 'auto'), 40)
  assert.equal(await resolveSystemAutoToken(f.request), 30)
  assert.equal(await resolveModelGroup(f.request, 'auto'), 40)
  assert.equal(f.writes().length, 0)
})

test('a lost rename response keeps the recorded ID recoverable', async t => {
  let loseResponse = true
  const f = await fixture(t, [], { respond(call, { items }) {
    if (call.path === '/api/token/' && call.method === 'PUT' && loseResponse) {
      Object.assign(items[0], call.body)
      loseResponse = false
      throw new TypeError('fixture: rename response lost')
    }
  } })
  await assert.rejects(resolveModelGroup(f.request, 'images'), { status: 502, code: 'NEW_API_ERROR' })
  assert.equal(await resolveModelGroup(f.request, 'images'), 1)
  assert.deepEqual(f.writes().map(call => call.method), ['POST', 'PUT'])
})

test('an empty account login creates a single Auto token', async t => {
  const f = await fixture(t)
  const first = await initializeLoginAuto(f.request, f.credentials)
  assert.deepEqual(first, { selectedTokenId: 1, selectedKey: 'sk-fixture-only-key' })
  assert.deepEqual(await initializeLoginAuto(f.request, f.credentials), first)
  assert.deepEqual(f.writes().map(call => call.method), ['POST', 'PUT'])
})
