/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { get as httpGet } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import sharp from 'sharp'
import { handleCreation, processCreationTasks } from './creation.ts'
import { readSkillPackage } from './skill-package.ts'
import { httpError } from './auth.ts'
import { NewApiError } from './native-account/config.ts'
import { videoModelSettingSchema } from '../shared/studio/model-types.ts'
import { handleContent } from './content.ts'
import { drainCreations, stopAcceptingCreations } from './creation/inflight.ts'
import { requestDatabase, environment } from './creation/test-database.mjs'
import { saveSession, removeSessionById } from './native-account/session.ts'

test('preference migration returns only token ownership/group mappings and never reveals secrets', async t => {
  const id = randomBytes(32).toString('base64url'), now = Math.floor(Date.now() / 1000)
  t.after(() => removeSessionById(id))
  environment(t, { NODE_ENV: 'test', NEW_API_BASE_URL: 'https://metadata.example', NEW_API_PUBLIC_URL: 'https://metadata.example',
    NEW_API_SESSION_SECRET: 'preference-metadata-secret-'.repeat(3), NEW_API_REDIS_URL: '' })
  await saveSession(id, { user: { id: 17, username: 'fixture' }, accessToken: 'fixture-access', refreshToken: 'fixture-refresh',
    upstreamSessionId: 'fixture-sid', accessExpiresAt: now + 3600, createdAt: now, expiresAt: now + 3600, version: 1 })
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname; calls.push(path)
    assert(!path.endsWith('/key'))
    const data = path === '/api/user/self/groups' ? { auto: {} } : path === '/api/user/self' ? { id: 17, username: 'fixture' }
      : { id: Number(path.split('/').pop()), user_id: path.endsWith('/42') ? 18 : 17, group: path.endsWith('/43') ? 'forbidden' : 'auto', key: 'must-not-leak' }
    return Response.json({ success: true, data })
  })
  const f = fixture(t)
  const response = await f.app.inject({ method: 'POST', url: '/api/creation/preference-groups',
    headers: { ...headers, host: 'community.example', cookie: `octopus_new_api_session=${id}` }, payload: { tokenIds: [41, 42, 43, 41] } })
  assert.equal(response.statusCode, 200, response.payload)
  assert.deepEqual(response.json().mappings, { 41: 'auto' })
  assert.doesNotMatch(response.payload, /must-not-leak|fixture-access/)
  assert.equal(calls.filter(path => path === '/api/token/41').length, 1)
})

test('native group catalogues never prepare a model key and retain configured model metadata', async t => {
  const f = fixture(t, { modelCatalogue: () => ({ groups: [{ id: 'images', name: 'images' }], items: [{ id: 'alias', groups: ['images'] }] }),
    modelTypes: [{ id: 'alias', kind: 'image', name: 'Configured image', apiFormat: 'images', image: { maxReferenceImages: 4 } }] })
  const response = await f.app.inject('/api/creation/models?group=images')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().group, 'images')
  assert.equal(response.json().tokenId, undefined)
  assert.equal(response.json().items[0].apiFormat, 'images')
  assert.equal(f.groupCalls.length, 0); assert.equal(f.credentialCalls.length, 0); assert.equal(f.calls.length, 0)
  assert.equal((await f.app.inject('/api/creation/models?group=images&group=auto')).statusCode, 400)
})

test('durable generation survives Redis loss and never replays dispatched requests', async t => {
  const db = await requestDatabase(t)
  environment(t, { COMMUNITY_REQUEST_STORE: '1', COMMUNITY_REQUEST_V2: '1', NEW_API_SESSION_SECRET: 'durable-request-secret-'.repeat(3) })
  const input = { kind: 'image', model: 'gpt-image-2', prompt: 'Test', requestId: 'durable', contractVersion: 2, group: 'images' }
  await t.test('eight concurrent retries, different groups and v1/v2 ID collisions', async t => {
    const f = fixture(t, { storeDb: db, groupToken: () => 71, fetch: () => Response.json({ data: [{ url: 'https://media.example/saved.png' }] }) })
    const responses = await Promise.all(Array.from({ length: 8 }, () => submit(f.app, input)))
    assert(responses.every(response => response.statusCode === 200), responses.map(response => response.payload).join('\n'))
    assert.equal(f.calls.length, 1); assert.equal(f.groupCalls.length, 1)
    f.values.clear()
    assert.equal((await f.app.inject('/api/creation/requests/durable')).json().status, 'succeeded')
    assert.equal((await submit(f.app, { ...input, group: 'auto' })).statusCode, 409)
    const { contractVersion, group, ...legacy } = input
    assert.equal((await submit(f.app, legacy)).statusCode, 409)
    assert.equal(f.calls.length, 1)
    process.env.COMMUNITY_REQUEST_V2 = '0'
    assert.equal((await submit(f.app, input)).json().status, 'succeeded')
    assert.equal((await f.app.inject({ url: '/api/creation/requests/durable', headers: { 'x-test-account': '18' } })).statusCode, 404)
    process.env.COMMUNITY_REQUEST_V2 = '1'
  })
  await t.test('conflicting legacy headers are rejected before credential preparation', async t => {
    const f = fixture(t, { storeDb: db })
    const response = await submit(f.app, { ...input, requestId: 'conflict' }, { 'x-new-api-token': '71' })
    assert.equal(response.statusCode, 400); assert.equal(f.groupCalls.length, 0); assert.equal(f.calls.length, 0)
  })
  await t.test('lost gateway response remains uncertain after Redis loss and retry', async t => {
    const f = fixture(t, { storeDb: db, groupToken: () => 72, fetch() { throw new Error('response lost') } })
    const body = { ...input, requestId: 'lost-response' }
    assert.equal((await submit(f.app, body)).json().status, 'indeterminate')
    f.values.clear()
    assert.equal((await submit(f.app, body)).json().status, 'indeterminate')
    assert.equal(f.calls.length, 1)
  })
  await t.test('a crash during preparation is bounded and cannot be dispatched by recovery', async t => {
    const f = fixture(t, { storeDb: db })
    const { registerDurableRequest } = await import('./creation/request-store.ts')
    const namespace = createHash('sha256').update('http://localhost:17').digest('hex')
    const key = `community-next:creation:request:${namespace}:crashed`
    await registerDurableRequest(db, key, 'hash', { kind: 'image', deadline: Date.now() - 10, result: { status: 'pending', tokenId: 0, protocol: 'sync', outputs: [] } })
    await processCreationTasks(f.redis, f.services, db)
    assert.equal((await f.app.inject('/api/creation/requests/crashed')).json().status, 'failed')
    assert.equal((await db.query('SELECT state FROM community_creation_request WHERE key=$1', [key])).rows[0].state, 'failed_before_dispatch')
    assert.equal(f.calls.length, 0)
  })
  await t.test('pending jobs rebuild their GET-only queue after Redis loss', async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'durable-poll-'))
    t.after(() => rm(filesRoot, { recursive: true, force: true }))
    const f = fixture(t, { storeDb: db, filesRoot, groupToken: () => 73, fetch(url, init) {
      if (init.method === 'POST') return Response.json({ id: 'original-job', status: 'queued' })
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${apiKey}`)
      return Response.json({ status: 'completed', url: 'https://media.example/finished.png' })
    } })
    const response = await submit(f.app, { ...input, requestId: 'pending-job', protocol: 'async' }, { prefer: 'respond-async' })
    assert.equal(response.statusCode, 202)
    await drainCreations(f.redis)
    f.values.clear()
    await db.query('UPDATE community_creation_request SET next_poll=$1 WHERE record->\'result\'->>\'upstreamId\'=$2', [Date.now() - 1, 'original-job'])
    await processCreationTasks(f.redis, f.services, db)
    const recovered = await f.app.inject('/api/creation/requests/pending-job')
    assert.equal(recovered.json().status, 'succeeded', recovered.payload)
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
  await t.test('a paid result saved to a recovery file repairs PostgreSQL before removing the file', async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'durable-recovery-'))
    t.after(() => rm(filesRoot, { recursive: true, force: true }))
    let unavailable = false
    const storeDb = { query(sql, params) {
      if (unavailable && sql.includes('SET record=$4')) throw new Error('database disconnected')
      return db.query(sql, params)
    } }
    const f = fixture(t, { storeDb, filesRoot, groupToken: () => 74, fetch() {
      unavailable = true
      return Response.json({ data: [{ url: 'https://media.example/recovered.png' }] })
    } })
    await submit(f.app, { ...input, requestId: 'fallback' }, { prefer: 'respond-async' })
    await drainCreations(f.redis)
    unavailable = false; f.values.clear()
    for (let read = 0; read < 2; read++) {
      const recovered = await f.app.inject('/api/creation/requests/fallback')
      assert.equal(recovered.json().status, 'succeeded', recovered.payload)
    }
    assert.equal(f.calls.length, 1)
    assert(!(await readdir(path.join(filesRoot, '.creation-results'))).some(name => name.endsWith('.request.json')))
  })
  for (const target of ['postgres', 'redis']) for (const failures of [1, 3]) await t.test(`worker result survives ${failures} ${target} save failures without querying the paid task again`, async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'durable-worker-save-'))
    t.after(() => rm(filesRoot, { recursive: true, force: true }))
    const requestId = `worker-${target}-${failures}`
    let remaining = failures, queries = 0
    const storeDb = { query(sql, params) {
      if (target === 'postgres' && sql.includes('SET record=$4') && JSON.parse(params[3]).result.status === 'succeeded' && remaining-- > 0)
        throw new Error('Temporary PostgreSQL failure')
      return db.query(sql, params)
    } }
    const f = fixture(t, { filesRoot, storeDb, groupToken: () => 73,
      beforeRedisSet(key, value) {
        if (target === 'redis' && key.endsWith(`:${requestId}`) && JSON.parse(value).result.status === 'succeeded' && remaining-- > 0)
          throw new Error('Temporary Redis failure')
      },
      fetch(_url, init) {
        if (init.method === 'POST') return Response.json({ id: requestId, status: 'queued' })
        return Response.json(++queries === 1 ? { status: 'completed', data: [{ url: 'https://media.example/completed.png' }] } : { status: 'expired' })
      },
    })
    await submit(f.app, { ...input, requestId, protocol: 'async' }, { prefer: 'respond-async' })
    await drainCreations(f.redis)
    const key = [...f.values.keys()].find(key => key.endsWith(`:${requestId}`))
    await db.query('UPDATE community_creation_request SET next_poll=$1 WHERE key=$2', [Date.now() - 1, key])
    await processCreationTasks(f.redis, f.services, storeDb)
    await f.redis.zadd('community-next:creation:pending', 0, key)
    await db.query("UPDATE community_creation_request SET next_poll=$1 WHERE key=$2 AND state<>'succeeded'", [Date.now() - 1, key])
    await processCreationTasks(f.redis, f.services, storeDb)
    const recovered = (await f.app.inject(`/api/creation/requests/${requestId}`)).json()
    assert.equal(recovered.status, 'succeeded')
    assert.equal(recovered.outputs[0].url, 'https://media.example/completed.png')
    assert.equal((await db.query('SELECT state FROM community_creation_request WHERE key=$1', [key])).rows[0].state, 'succeeded')
    assert.equal(queries, 1)
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
  await t.test('an outdated worker never writes a recovery file after losing its database owner', async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'durable-worker-owner-'))
    t.after(() => rm(filesRoot, { recursive: true, force: true }))
    let updates = 0, moved = false
    const storeDb = { query(sql, params) {
      if (moved && sql.includes('SET record=$4')) updates++
      return db.query(sql, params)
    } }
    const f = fixture(t, { filesRoot, storeDb, groupToken: () => 73,
      async fetch(_url, init) {
        if (init.method === 'POST') return Response.json({ id: 'owner-moved', status: 'queued' })
        await db.query("UPDATE community_creation_request SET owner='another-worker',version=version+1 WHERE key LIKE '%:owner-moved'")
        moved = true
        return Response.json({ status: 'completed', data: [{ url: 'https://media.example/stale.png' }] })
      },
    })
    await submit(f.app, { ...input, requestId: 'owner-moved', protocol: 'async' }, { prefer: 'respond-async' })
    await drainCreations(f.redis)
    const key = [...f.values.keys()].find(key => key.endsWith(':owner-moved'))
    await db.query('UPDATE community_creation_request SET next_poll=$1 WHERE key=$2', [Date.now() - 1, key])
    await processCreationTasks(f.redis, f.services, storeDb)
    assert.equal(updates, 1)
    const files = await readdir(path.join(filesRoot, '.creation-results')).catch(() => [])
    assert(!files.some(file => file.endsWith('.request.json')))
    assert.equal((await db.query('SELECT owner FROM community_creation_request WHERE key=$1', [key])).rows[0].owner, 'another-worker')
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
  await t.test('a synchronous v1 paid result repairs an uncertain terminal record from its late recovery file', async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'durable-sync-recovery-'))
    t.after(() => rm(filesRoot, { recursive: true, force: true }))
    let unavailable = false
    const f = fixture(t, { filesRoot, storeDb: { query(sql, params) {
      if (unavailable && sql.includes('SET record=$4')) throw new Error('database disconnected')
      return db.query(sql, params)
    } }, fetch() { unavailable = true; return Response.json({ data: [{ url: 'https://media.example/late.png' }] }) } })
    const result = await submit(f.app, { kind: 'image', model: 'gpt-image-2', prompt: 'Test', requestId: 'fallback-sync' })
    assert.equal(result.json().status, 'succeeded')
    unavailable = false; f.values.clear()
    await db.query(`UPDATE community_creation_request SET state='indeterminate', version=version+1,
      record=jsonb_set(record,'{result,status}','"indeterminate"') WHERE key LIKE '%:fallback-sync'`)
    for (let read = 0; read < 2; read++) assert.equal((await f.app.inject('/api/creation/requests/fallback-sync')).json().status, 'succeeded')
    assert.equal(f.calls.length, 1)
  })
})

const origin = 'https://community.example'
const headers = { origin, 'content-type': 'application/json' }
const apiKey = 'sk-fixture-secret-for-tests'
const imageRequest = { kind: 'image', model: 'gpt-image-2', prompt: 'A test image', requestId: 'request-1' }

test('wallet-paid creation signs the actual relay request once and config failure leaves no accepted record', async t => {
  const config = { COMMUNITY_WALLET_ENABLED: 'true', COMMUNITY_WALLET_SECRET: 'fixture-wallet-secret-'.repeat(3),
    COMMUNITY_WALLET_CLIENT_ID: origin, NEW_API_BASE_URL: 'https://model.example' }
  for (const [key, value] of Object.entries(config)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const { app, calls } = fixture(t, { async fetch(url, init) {
    const wire = new Request(url, init), headers = wire.headers
    const bytes = Buffer.from(await wire.arrayBuffer())
    const canonical = ['community-wallet-v1', origin, '17', headers.get('X-Community-Timestamp'),
      headers.get('X-Community-Nonce'), 'POST', new URL(url).pathname + new URL(url).search,
      headers.get('Idempotency-Key'), createHash('sha256').update(bytes).digest('hex')].join('\n')
    assert.equal(headers.get('X-Community-User'), '17')
    assert.equal(headers.get('X-Community-Signature'), createHmac('sha256', config.COMMUNITY_WALLET_SECRET).update(canonical).digest('hex'))
    return Response.json({ data: [{ url: 'https://media.example/result.png' }] })
  } })
  process.env.COMMUNITY_WALLET_SECRET = ''
  const unaccepted = await submit(app)
  assert.equal(unaccepted.statusCode, 503)
  assert.equal(unaccepted.json().notAccepted, true)
  assert.equal(calls.length, 0)
  assert.equal((await app.inject('/api/creation/requests/request-1')).statusCode, 404)
  const streaming = await submit(app, { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'stream-config',
    chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } })
  assert.match(streaming.payload, /"notAccepted":true/)
  assert.match(streaming.payload, /"statusCode":503/)
  assert.equal((await app.inject('/api/creation/requests/stream-config')).statusCode, 404)
  assert.equal(calls.length, 0)
  process.env.COMMUNITY_WALLET_SECRET = config.COMMUNITY_WALLET_SECRET
  const result = await submit(app, imageRequest, { 'X-Community-User': '999', 'X-Community-Signature': 'forged' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.json().status, 'succeeded')
  assert.deepEqual((await submit(app)).json(), result.json())
  assert.equal(calls.length, 1)
})

test('a streamed paid request persists a final recoverable result without another POST', async t => {
  const { app, calls } = fixture(t, { fetch() {
    return new Response('data: {"choices":[{"delta":{"content":"saved answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'stream-1', chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } }
  const result = await submit(app, input)
  assert.equal(result.statusCode, 200)
  assert.match(result.headers['content-type'], /text\/event-stream/)
  assert.match(result.payload, /"type":"delta"/)
  assert.match(result.payload, /"status":"succeeded"/)
  const recovered = await app.inject('/api/creation/requests/stream-1')
  assert.equal(recovered.json().outputs[0].text, 'saved answer')
  assert.equal((await app.inject({ url: '/api/creation/requests/stream-1', headers: { 'x-test-account': '18' } })).statusCode, 404)
  await submit(app, input)
  assert.equal(calls.length, 1)
})

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

function fixture(t, options = {}) {
  const values = new Map()
  const due = new Map()
  const calls = []
  const credentialCalls = []
  const catalogueCalls = []
  const groupCalls = []
  const mediaCalls = []
  const app = Fastify({ forceCloseConnections: true })
  t.after(() => app.close())
  const redis = {
    async eval(script, _count, key, ...args) {
      if (script.includes('"ZADD"')) {
        const [, value, ttl, score, member] = args
        if (script.includes('"NX"') && values.has(key)) return null
        await options.beforeRedisSet?.(key, value, ['EX', ttl, ...(script.includes('"NX"') ? ['NX'] : [])])
        values.set(key, value)
        if (score === '') due.delete(member)
        else due.set(member, Number(score))
        options.afterRedisSet?.(key, value)
        return 'OK'
      }
      if (script.includes('ARGV[1]') && values.get(key) === args[0]) values.delete(key)
      return 1
    },
    async zadd(_name, score, key) { due.set(key, Number(score)); return 1 },
    async zrem(_name, key) { return Number(due.delete(key)) },
    async zrangebyscore(_name, min, max) {
      return [...due].filter(([, score]) => score >= Number(min) && score <= Number(max)).slice(0, 4).map(([key]) => key)
    },
    async get(key) { return values.get(key) ?? null },
    async set(key, value, ...flags) {
      if (flags.includes('NX') && values.has(key)) return null
      await options.beforeRedisSet?.(key, value, flags)
      values.set(key, value)
      return 'OK'
    },
  }
  const services = {
    async groupToken(req, group, create) {
      groupCalls.push({ group, userId: req.headers.get('x-new-api-user') })
      if (!options.groupToken) throw new Error('Unexpected group token resolution')
      return options.groupToken(req, group, create)
    },
    async modelCatalogue(req) {
      catalogueCalls.push(req)
      if (!options.modelCatalogue) throw new Error('Unexpected account model catalogue request')
      return options.modelCatalogue(req)
    },
    async credentials(req, path) {
      if (options.credentials) return options.credentials(req, path)
      const tokenId = Number(req.headers.get('x-new-api-token') || options.selectedToken?.() || 71)
      const userId = Number(req.headers.get('x-new-api-user'))
      credentialCalls.push({ path, tokenId, userId })
      return { baseUrl: 'https://model.example', apiKey, tokenId, userId }
    },
    async fetch(url, init) {
      calls.push({ path: new URL(String(url)).pathname, init })
      if (!options.fetch) throw new Error('Unexpected upstream request')
      return options.fetch(url, init)
    },
    ...(options.publicMedia ? { publicMedia: options.publicMedia } : {}),
  }
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error.statusCode || error.status || 500).send({ error: { message: error.message } })
  })
  const route = async (request, reply) => {
    if (/^\/(?:legacy-files|api\/uploads)\//.test(request.raw.url)) mediaCalls.push({ method: request.method, url: request.raw.url })
    const accountId = String(request.headers['x-test-account'] || /(?:^|;\s*)fixture-account=(\d+)/.exec(String(request.headers.cookie || ''))?.[1] || '17')
    const user = { id: `local-${accountId}`, accountId, username: 'root', isAdmin: options.isAdmin === true }
    const ctx = {
      req: request.raw, res: reply.raw, request, reply, redis, user,
      db: { async query(sql, params) {
        if (options.storeDb && sql.includes('community_creation_request')) return options.storeDb.query(sql, params)
        if (options.mediaFiles && sql.includes('FROM drive_file')) {
          if (sql.includes('WITH visible_file')) {
            const file = options.mediaFiles.find(file => file.id === params[1] && file.userId === params[0])
            return { rows: file ? [{ ...file, publiclyVisible: false }] : [] }
          }
          assert.match(sql, /WHERE id=\$1 AND "userId"=\$2 AND "storedInternal" AND NOT "isLink"/)
          return { rows: options.mediaFiles.filter(file => file.id === params[0] && file.userId === params[1] && file.storedInternal && !file.isLink) }
        }
        if (options.workQuery && (sql.includes('FROM community_submission s') || sql.includes('FROM drive_file'))) return { rows: await options.workQuery(sql, params) }
        if (options.skillRows && sql.includes('FROM community_skill')) return { rows: await options.skillRows(sql, params) }
        assert.equal(sql, 'SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')
        if (options.modelReadError) throw options.modelReadError
        return { rows: [{ clientOptions: { communityModelTypes: options.modelTypes ?? [] } }] }
      } },
      config: { url: origin }, filesRoot: options.filesRoot,
      url: new URL(request.raw.url, origin), body: request.body || {},
      requireUser() { return user },
      requireAdmin() { if (!user.isAdmin) throw httpError(403, '需要管理员权限。'); return user },
      json(status, value) { reply.code(status).send(value) },
    }
    if (!await handleCreation(ctx, services) && !(options.mediaFiles && await handleContent(ctx))) reply.code(404).send({ error: { message: 'Missing route' } })
    return reply
  }
  app.all('/api/creation/*', route)
  if (options.mediaFiles) {
    app.get('/api/uploads/:id', route)
    app.route({ method: ['GET', 'HEAD'], url: '/legacy-files/:id', handler: route })
  }
  return { app, values, due, calls, credentialCalls, catalogueCalls, groupCalls, mediaCalls, redis, services }
}

function submit(app, body = imageRequest, extraHeaders = {}) {
  return app.inject({ method: 'POST', url: '/api/creation/generate', headers: { ...headers, ...extraHeaders }, payload: body })
}

test('text partial results remain recoverable across protocols, duplicate submission and a final Redis outage', async t => {
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-text-recovery-'))
  t.after(() => rm(filesRoot, { recursive: true, force: true }))
  let savingFails = true, failedSaves = 0
  const f = fixture(t, { filesRoot,
    beforeRedisSet(key, value) {
      if (savingFails && key.includes(':request:') && JSON.parse(value).result.status !== 'pending') {
        failedSaves++; throw new Error('fixture Redis outage')
      }
    },
    fetch() { return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '已生成的🌊正文', reasoning_content: '推理内容',
      tool_calls: [{ index: 0, id: 'tool-1', function: { name: 'unfinished', arguments: '{' } }] } }],
      usage: { prompt_tokens: 7, completion_tokens: 8 } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) },
  })
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'partial-text', chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } }
  const sent = await submit(f.app, input, { 'X-Creation-Stream': 'append-v1' })
  const events = sent.payload.split('\n\n').filter(value => value.startsWith('data: ')).map(value => JSON.parse(value.slice(6)))
  const final = events.at(-1)
  assert.equal(final.status, 'indeterminate')
  assert.equal(final.outputs[0].text, '已生成的🌊正文')
  assert.equal(final.reasoning, '推理内容')
  assert.deepEqual(final.usage, { inputTokens: 7, outputTokens: 8 })
  assert.equal(final.toolCalls, undefined)
  assert.match(final.error, /部分回答/)
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), final.outputs[0].text)
  assert.equal(failedSaves, 3)
  const recovered = (await f.app.inject('/api/creation/requests/partial-text')).json()
  assert.equal(recovered.status, 'indeterminate')
  assert.deepEqual(recovered.outputs, final.outputs)
  assert.equal((await f.app.inject({ url: '/api/creation/requests/partial-text', headers: { 'x-test-account': '18' } })).statusCode, 404)
  savingFails = false
  const again = await submit(f.app, input)
  assert.match(again.payload, /"status":"indeterminate"/)
  assert.match(again.payload, /已生成的🌊正文/)
  assert.equal(f.calls.length, 1)
  assert.equal((await readdir(path.join(filesRoot, '.creation-results'))).filter(name => name.endsWith('.request.json')).length, 0)
})

test('text request recovery follows its accepted deadline beyond 195 seconds and shutdown waits for persistence', async t => {
  const started = deferred(), upstream = deferred()
  const f = fixture(t, { fetch() { started.resolve(); return upstream.promise } })
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'long-text', chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } }
  const sending = submit(f.app, input).then(value => value)
  await started.promise
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 4 * 60_000)
  const pending = (await f.app.inject('/api/creation/requests/long-text')).json()
  assert.equal(pending.status, 'pending')
  assert(pending.deadline > Date.now() + 26 * 60_000)
  stopAcceptingCreations(f.redis)
  let drained = false
  const stopping = drainCreations(f.redis).then(() => { drained = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(drained, false)
  const rejected = await submit(f.app, { ...input, requestId: 'during-shutdown' })
  assert.equal(rejected.statusCode, 503)
  assert.equal(rejected.json().notAccepted, true)
  upstream.resolve(new Response('data: {"choices":[{"delta":{"content":"completed"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  await sending; await stopping
  assert.equal(drained, true)
  const saved = (await f.app.inject('/api/creation/requests/long-text')).json()
  assert.equal(saved.status, 'succeeded')
  assert.equal(saved.outputs[0].text, 'completed')
  assert.equal(saved.deadline, pending.deadline)
  assert.equal(f.calls.length, 1)
})

test('a disconnected HTTP stream still persists before shutdown closes its storage', async t => {
  const started = deferred(), upstream = deferred()
  const f = fixture(t, { fetch() { started.resolve(); return upstream.promise } })
  let closed = false
  f.app.addHook('preClose', async () => { stopAcceptingCreations(f.redis) })
  f.app.addHook('onClose', async () => { await drainCreations(f.redis); closed = true })
  await f.app.listen({ port: 0, host: '127.0.0.1' })
  const address = 'http://127.0.0.1:' + f.app.server.address().port
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'disconnected-stream', chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } }
  const response = await fetch(address + '/api/creation/generate', { method: 'POST', headers, body: JSON.stringify(input) })
  const reader = response.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /accepted/)
  await reader.cancel(); await started.promise
  const stopping = f.app.close()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(closed, false)
  upstream.resolve(new Response('data: {"choices":[{"delta":{"content":"saved after disconnect"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  await stopping
  assert.equal(closed, true)
  const saved = JSON.parse([...f.values].find(([key]) => key.endsWith(':disconnected-stream'))[1])
  assert.equal(saved.result.status, 'succeeded')
  assert.equal(saved.result.outputs[0].text, 'saved after disconnect')
  assert.equal(f.calls.length, 1)
})

test('oversized final text detaches HTTP output but the original request recovers the whole answer once', async t => {
  const text = '长回答🌊'.repeat(40_000)
  const f = fixture(t, { async fetch() {
    await new Promise(resolve => setTimeout(resolve, 10))
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  await f.app.listen({ port: 0, host: '127.0.0.1' })
  const address = 'http://127.0.0.1:' + f.app.server.address().port
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'large-stream', chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: true } }
  const response = await fetch(address + '/api/creation/generate', { method: 'POST', headers: { ...headers, 'X-Creation-Stream': 'append-v1' }, body: JSON.stringify(input) })
  await assert.rejects(response.text())
  await drainCreations(f.redis)
  const recovered = (await f.app.inject('/api/creation/requests/large-stream')).json()
  assert.equal(recovered.status, 'succeeded')
  assert.equal(recovered.outputs[0].text, text)
  assert.equal(f.calls.length, 1)
})

async function relayRequestBody(init) {
  const request = new Request('https://model.example/fixture', { ...init, method: 'POST' })
  return request.headers.get('content-type')?.startsWith('multipart/form-data')
    ? Object.fromEntries(await request.formData()) : await request.json()
}

test('private work skills are resolved on the server, survive retries, and never expose the source in tracking or errors', async t => {
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-work-skill-'));
  t.after(() => rm(filesRoot, { recursive: true, force: true }));
  const source = Buffer.from('---\nname: private-helper\ndescription: Help users\n---\nPrivate instruction sentinel.');
  await writeFile(path.join(filesRoot, 'source-key'), source);
  const pack = await readSkillPackage('SKILL.md', source);
  const row = { id: 'work1', authorId: 'author1', status: 'approved', fileIds: ['source1'], generation: { skill: { sourceFileId: 'source1', sourceSha256: pack.sha256, sourcePublic: false } } };
  let visible = true, reject = false;
  const { app, calls, values } = fixture(t, { filesRoot, workQuery(sql, params) {
    if (sql.includes('FROM community_submission s')) { assert.match(sql, /s\.status IN \('published', 'approved'\)/); return visible ? [row] : []; }
    assert.deepEqual(params, ['source1', 'author1']);
    return [{ name: 'SKILL.md', accessKey: 'source-key', storedInternal: true, isLink: false }];
  }, fetch(_url, init) {
    const payload = JSON.parse(init.body);
    assert.equal(payload.messages[0].role, 'system'); assert.equal(payload.messages[0].content, 'Private instruction sentinel.');
    assert.equal(payload.messages.at(-1).content, 'hello');
    return reject ? Response.json({ error: { message: 'Private instruction sentinel.' } }, { status: 400 })
      : Response.json({ choices: [{ message: { role: 'assistant', content: 'Useful answer' } }] });
  } });
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'work-skill-1', skills: [{ id: 'work-work1', sha256: pack.sha256 }] };
  const accepted = await submit(app, input);
  assert.equal(accepted.statusCode, 200, accepted.payload); assert(!accepted.payload.includes('Private instruction sentinel'));
  assert(!JSON.stringify([...values.values()]).includes('Private instruction sentinel'));
  visible = false;
  assert.equal((await submit(app, input)).statusCode, 200); assert.equal(calls.length, 1);
  assert.equal((await submit(app, { ...input, requestId: 'work-skill-2' })).statusCode, 404); assert.equal(calls.length, 1);
  visible = true; row.status = 'pending';
  assert.equal((await submit(app, { ...input, requestId: 'work-skill-3' })).statusCode, 409); assert.equal(calls.length, 1);
  row.status = 'approved'; reject = true;
  const denied = await submit(app, { ...input, requestId: 'work-skill-4' });
  assert(!denied.payload.includes('Private instruction sentinel')); assert.equal(calls.length, 2);
  await writeFile(path.join(filesRoot, 'source-key'), Buffer.concat([source, Buffer.from(' Changed after approval.')]));
  assert.equal((await submit(app, { ...input, requestId: 'work-skill-5' })).statusCode, 409); assert.equal(calls.length, 2);
});

test('typed media skills reach the actual model request; accepted results survive withdrawal', async t => {
  for (const kind of ['image', 'video']) await t.test(kind, async t => {
    const body = '---\nname: visual\ndescription: visual rules\n---\nUse soft light and a wide composition.'
    const sha256 = createHash('sha256').update(body).digest('hex')
    let available = true, reads = 0
    const { app, calls } = fixture(t, { skillRows(sql, params) {
      reads++; assert.match(sql, /s.status='published'/); assert.match(sql, /NOT u."isSuspended"/)
      assert.deepEqual(params, [['visual']])
      return available ? [{ id: 'visual', kind, body, sha256 }] : []
    }, async fetch(url, init) {
      const prompt = (await relayRequestBody(init)).prompt
      assert.match(prompt, /Use soft light/); assert.match(prompt, /My original prompt/); assert.doesNotMatch(prompt, /description: visual/)
      return kind === 'image' ? Response.json({ data: [{ url: 'https://media.example/result.png' }] }) : Response.json({ id: 'video-1', status: 'completed', url: 'https://media.example/result.mp4' })
    } })
    const request = { ...imageRequest, kind, duration: 8, model: kind === 'image' ? 'gpt-image-2' : 'sora-2', prompt: 'My original prompt', skills: [{ id: 'community-visual', sha256 }] }
    const response = await submit(app, request)
    assert.equal(response.statusCode, 200, response.payload); assert.equal(calls.length, 1)
    available = false
    assert.deepEqual((await submit(app, request)).json(), response.json())
    assert.equal(calls.length, 1); assert.equal(reads, 1)
    const rejected = await submit(app, { ...request, requestId: 'new-attempt' })
    assert.equal(rejected.statusCode, 400); assert.equal(calls.length, 1)
  })
})

test('wrong type, stale hash, invalid references and excessive skill prompts never send a paid request', async t => {
  const body = '---\nname: rules\ndescription: test\n---\nShort rules'
  const sha256 = createHash('sha256').update(body).digest('hex')
  let row = { id: 'rules', kind: 'image', body, sha256 }
  const { app, calls, credentialCalls } = fixture(t, { skillRows: () => [row] })
  const input = { ...imageRequest, skills: [{ id: 'community-rules', sha256 }] }
  for (const override of [{ kind: 'video' }, { sha256: '0'.repeat(64) }, { body: body + 'changed' }]) {
    row = { id: 'rules', kind: 'image', body, sha256, ...override }
    assert.equal((await submit(app, input)).statusCode, 400)
  }
  for (const skills of [null, [{}], [{ id: 'builtin', sha256 }], [...input.skills, ...input.skills], Array(11).fill(input.skills[0])])
    assert.equal((await submit(app, { ...input, skills })).statusCode, 400)
  for (const length of [33000, 100001]) {
    const longBody = 'x'.repeat(length)
    row = { id: 'rules', kind: 'image', body: longBody, sha256: createHash('sha256').update(longBody).digest('hex') }
    const response = await submit(app, { ...input, skills: [{ id: 'community-rules', sha256: row.sha256 }] })
    assert.equal(response.statusCode, 400, response.payload)
  }
  assert.equal(calls.length, 0); assert.equal(credentialCalls.length, 0)
})

test('image previews are small WebP responses while original downloads retain every byte', async t => {
  const original = await sharp({ create: { width: 2160, height: 3840, channels: 4, background: '#3488bb80' } }).png().toBuffer()
  const reads = []
  const { app } = fixture(t, { publicMedia(url, kind, maximum, signal) {
    reads.push({ url, kind, maximum, signal })
    return new Response(original, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(original.length) } })
  } })
  const url = '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Flarge.png&kind=image'
  const preview = await app.inject(url + '&variant=preview')
  assert.equal(preview.statusCode, 200, preview.payload)
  assert.equal(preview.headers['content-type'], 'image/webp')
  assert.equal(preview.headers['cache-control'], 'private, no-store')
  assert.equal(preview.headers['x-content-type-options'], 'nosniff')
  assert.equal(Number(preview.headers['content-length']), preview.rawPayload.length)
  const info = await sharp(preview.rawPayload).metadata()
  assert.equal(info.width, 540)
  assert.equal(info.height, 960)
  assert.equal(info.hasAlpha, true)
  assert(preview.rawPayload.length < original.length / 5)
  const download = await app.inject(url)
  assert.equal(download.headers['content-type'], 'image/png')
  assert.equal(Number(download.headers['content-length']), original.length)
  assert.deepEqual(download.rawPayload, original)
  assert.equal(reads.length, 2)
  assert(reads.every(read => read.url === 'https://media.example/large.png' && read.kind === 'image' && read.maximum === 32 * 1024 * 1024 && read.signal instanceof AbortSignal))
})

test('original image streams finish before success and broken bodies return a readable error', async t => {
  const original = await sharp({ create: { width: 17, height: 23, channels: 3, background: '#336699' } }).png().toBuffer()
  let broken = true
  const { app } = fixture(t, { publicMedia() {
    let first = true
    return new Response(new ReadableStream({ pull(controller) {
      if (first) { first = false; controller.enqueue(original.subarray(0, 10)); return }
      if (broken) controller.error(new TypeError('upstream reset'))
      else { controller.enqueue(original.subarray(10)); controller.close() }
    } }), { headers: { 'Content-Type': 'image/png' } })
  } })
  const url = '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fstream.png&kind=image'
  const failed = await app.inject(url)
  assert.equal(failed.statusCode, 502)
  assert.match(failed.payload, /原图/)
  assert.doesNotMatch(failed.payload, /upstream reset/)
  broken = false
  const saved = await app.inject(url)
  assert.equal(saved.statusCode, 200)
  assert.equal(Number(saved.headers['content-length']), original.length)
  assert.deepEqual(saved.rawPayload, original)
})

test('original image buffering shares bounded read slots and never forwards oversized bodies', async t => {
  const { acquireImageRead, releaseImageRead } = await import('./creation/image-preview.ts')
  const pending = [], controllers = Array.from({ length: 16 }, () => new AbortController())
  await acquireImageRead(controllers[0].signal)
  await acquireImageRead(controllers[1].signal)
  try {
    for (const controller of controllers.slice(2)) pending.push(acquireImageRead(controller.signal).catch(error => error))
    await assert.rejects(acquireImageRead(new AbortController().signal), error => error.statusCode === 503)
    controllers.slice(2).forEach(controller => controller.abort())
    assert((await Promise.all(pending)).every(error => error.name === 'AbortError'))
  } finally { releaseImageRead(); releaseImageRead() }
  const { app } = fixture(t, { publicMedia() {
    return new Response(new Uint8Array(32 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })
  } })
  const result = await app.inject('/api/creation/media?url=https%3A%2F%2Fmedia.example%2Flarge.png&kind=image')
  assert.equal(result.statusCode, 413)
  assert(result.rawPayload.length < 1000)
})

for (const ending of ['finish', 'disconnect', 'timeout']) test(`original image response holds its read slot until ${ending}`, { timeout: 5000 }, async t => {
  const { acquireImageRead, releaseImageRead } = await import('./creation/image-preview.ts')
  const bytes = Buffer.from('complete original image'), writeGate = deferred(), writing = deferred(), ended = deferred()
  const deadline = new AbortController()
  if (ending === 'timeout') {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    t.mock.method(AbortSignal, 'timeout', ms => ms === 65000 ? deadline.signal : timeout(ms))
  }
  const { app } = fixture(t, { publicMedia() { return new Response(bytes, { headers: { 'Content-Type': 'image/png' } }) } })
  let raw, client, probe, acquired = false, reserved = false
  const probeController = new AbortController()
  app.addHook('onRequest', (request, reply, done) => {
    raw = reply.raw
    raw.once('finish', () => ended.resolve('finish'))
    raw.once('close', () => ended.resolve('close'))
    // Hold actual socket writes so writableEnded is true while writableFinished remains false.
    for (const name of ['_write', '_writev']) {
      const write = raw.socket[name]
      if (!write) continue
      raw.socket[name] = function (...args) {
        writing.resolve()
        void writeGate.promise.then(() => this.destroyed ? args.at(-1)() : write.apply(this, args))
      }
    }
    done()
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  try {
    await acquireImageRead(new AbortController().signal); reserved = true
    const received = new Promise(resolve => {
      client = httpGet({ host: '127.0.0.1', port: app.server.address().port, agent: false,
        path: '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fslow.png&kind=image' }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
        response.on('error', () => resolve(null))
      })
      client.on('error', () => resolve(null))
    })
    await writing.promise
    assert.equal(raw.writableEnded, true)
    assert.equal(raw.writableFinished, false)
    probe = acquireImageRead(probeController.signal).then(() => { acquired = true }, () => {})
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(acquired, false, 'a buffered response must keep its slot while the socket write is pending')
    if (ending === 'finish') writeGate.resolve()
    else if (ending === 'disconnect') client.socket.resetAndDestroy()
    else deadline.abort(new DOMException('Image response deadline', 'TimeoutError'))
    assert.equal(await ended.promise, ending === 'finish' ? 'finish' : 'close')
    await probe
    assert.equal(acquired, true, 'ending the response must release its slot')
    if (ending === 'finish') assert.deepEqual(await received, bytes)
  } finally {
    probeController.abort()
    client?.destroy(); raw?.destroy(); writeGate.resolve()
    await probe
    if (acquired) releaseImageRead()
    if (reserved) releaseImageRead()
  }
})

test('preview requests reject invalid variants, protected paths, videos and switched accounts before reading media', async t => {
  let reads = 0
  const { app } = fixture(t, { publicMedia() { reads++; throw new Error('Unexpected media read') } })
  const url = '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Flarge.png'
  for (const query of ['&variant=', '&variant=unknown', '&variant=preview&variant=preview', '&variant=preview&kind=video',
    '&variant=preview&kind=text', '&variant=preview&path=videos/job/content', '&variant=preview&path='])
    assert.equal((await app.inject(url + query)).statusCode, 400, query)
  assert.equal((await app.inject({ url: url + '&variant=preview', headers: { 'x-new-api-user': '18' } })).statusCode, 409)
  assert.equal(reads, 0)
})

test('preview requests keep the public-media private-network restrictions', async t => {
  const { app } = fixture(t)
  for (const source of ['http://127.0.0.1/a.png', 'http://169.254.169.254/a.png', 'https://user:password@media.example/private.png'])
    assert.equal((await app.inject(`/api/creation/media?variant=preview&url=${encodeURIComponent(source)}`)).statusCode, 400)
})

test('background media returns its request ID before the upstream responds and a durable worker saves the final result', { timeout: 5000 }, async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous })
  const upstream = deferred(), trackingSaved = deferred()
  let queryFailure = 'http'
  const f = fixture(t, {
    afterRedisSet(key, value) { if (key.endsWith(':background-video') && JSON.parse(value).tracking) trackingSaved.resolve() },
    fetch(url, init) {
      if (init.method === 'POST') return upstream.promise
      assert.equal(new URL(url).pathname, '/v1/videos/upstream-video')
      if (queryFailure === 'http') return new Response('temporarily unavailable', { status: 503 })
      if (queryFailure === 'transport') throw new TypeError(`fetch failed with ${apiKey}`)
      if (queryFailure === 'json') return new Response('invalid JSON')
      return Response.json({ id: 'upstream-video', status: 'completed' })
    },
  })
  const input = { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'background-video' }
  process.env.NEW_API_SESSION_SECRET = ''
  const unaccepted = await submit(f.app, input, { Prefer: 'respond-async' })
  assert.equal(unaccepted.statusCode, 503)
  assert.equal(unaccepted.json().notAccepted, true)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.app.inject('/api/creation/requests/background-video')).statusCode, 404)
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  const response = await submit(f.app, input, { Prefer: 'respond-async' })
  assert.equal(response.statusCode, 202, response.payload)
  assert.equal(response.json().requestId, input.requestId)
  assert.equal(response.json().status, 'pending')
  assert.equal(response.json().upstreamId, undefined)
  const key = [...f.values.keys()].find(key => key.endsWith(':background-video'))
  assert(key)
  assert.equal((await f.app.inject('/api/creation/requests/background-video')).json().status, 'pending')
  await submit(f.app, input, { Prefer: 'respond-async' })
  assert.equal(f.calls.length, 1)
  upstream.resolve(Response.json({ id: 'upstream-video', status: 'queued' }))
  await trackingSaved.promise
  const stored = JSON.parse(f.values.get(key))
  assert.equal(stored.result.upstreamId, 'upstream-video')
  assert.equal(typeof stored.tracking, 'string')
  assert(!JSON.stringify(stored).includes(apiKey))
  // This pass needs only persisted Redis data, not the original request or browser.
  await processCreationTasks(f.redis, f.services)
  const temporary = (await f.app.inject('/api/creation/requests/background-video')).json()
  assert.equal(temporary.status, 'pending')
  assert.equal(temporary.errorStage, '任务查询')
  assert.equal(temporary.errorStatus, 503)
  assert.match(temporary.error, /HTTP 503/)
  for (const failure of ['transport', 'json']) {
    queryFailure = failure
    await f.redis.zadd('community-next:creation:pending', 0, key)
    await processCreationTasks(f.redis, f.services)
    const recovered = (await f.app.inject('/api/creation/requests/background-video')).json()
    assert.equal(recovered.status, 'pending')
    assert.equal(recovered.errorStage, '任务查询')
    assert.equal(recovered.errorStatus, failure === 'json' ? 200 : undefined)
    assert(!JSON.stringify(recovered).includes(apiKey))
  }
  queryFailure = ''
  await f.redis.zadd('community-next:creation:pending', 0, key)
  await processCreationTasks(f.redis, f.services)
  const result = (await f.app.inject('/api/creation/requests/background-video')).json()
  assert.equal(result.status, 'succeeded')
  assert.equal(result.requestId, input.requestId)
  assert.equal(result.upstreamId, 'upstream-video')
  assert.equal(result.errorStage, undefined)
  assert.equal(result.mediaPath, 'videos/upstream-video/content')
  assert.equal(JSON.parse(f.values.get(key)).tracking, undefined)
  assert.equal((await f.app.inject({ url: '/api/creation/requests/background-video', headers: { 'x-test-account': '18' } })).statusCode, 404)
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
})
test('background queries stop on permanent rejection without declaring generation failed or repeating a paid POST', async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous })
  for (const status of [400, 401, 403, 404, 410, 422]) await t.test(String(status), async t => {
    const ready = deferred()
    const f = fixture(t, {
      afterRedisSet(key, value) { if (key.endsWith(':permanent-query') && JSON.parse(value).tracking) ready.resolve() },
      fetch(_url, init) { return init.method === 'POST'
        ? Response.json({ id: 'original-video', status: 'queued' }) : new Response('Unavailable task', { status }) },
    })
    const input = { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'permanent-query' }
    await submit(f.app, input, { Prefer: 'respond-async' }); await ready.promise
    const key = [...f.values.keys()].find(key => key.endsWith(':permanent-query'))
    await processCreationTasks(f.redis, f.services)
    const result = (await f.app.inject('/api/creation/requests/permanent-query')).json()
    assert.equal(result.status, 'indeterminate')
    assert.equal(result.errorStage, '任务查询')
    assert.equal(result.errorStatus, status)
    assert.equal(result.upstreamId, 'original-video')
    assert.equal(result.tokenId, 71)
    assert(!/自动重试/.test(result.error))
    assert.equal(f.due.has(key), false)
    await processCreationTasks(f.redis, f.services)
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
})

test('background queries respect Retry-After and recover temporary 408 errors using the original task', async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous })
  for (const [status, retryAfter, minimum] of [[429, '120', 120000], [429, 'date', 119000], [429, 'invalid', 30000], [503, '120', 120000], [408, '', 10000]]) await t.test(`${status}/${retryAfter}`, async t => {
    const ready = deferred()
    let completed = false
    const f = fixture(t, {
      afterRedisSet(key, value) { if (key.endsWith(':retry-query') && JSON.parse(value).tracking) ready.resolve() },
      fetch(_url, init) {
        if (init.method === 'POST') return Response.json({ id: 'original-video', status: 'queued' })
        if (completed) return Response.json({ id: 'original-video', status: 'completed' })
        return new Response('Temporarily unavailable', { status, headers: { 'Retry-After': retryAfter === 'date' ? new Date(Date.now() + 120000).toUTCString() : retryAfter } })
      },
    })
    await submit(f.app, { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'retry-query' }, { Prefer: 'respond-async' })
    await ready.promise
    const key = [...f.values.keys()].find(key => key.endsWith(':retry-query'))
    const now = Date.now()
    await processCreationTasks(f.redis, f.services)
    assert.equal(JSON.parse(f.values.get(key)).result.status, 'pending')
    assert(f.due.get(key) >= now + minimum, `next query was scheduled too early: ${f.due.get(key) - now} ms`)
    await processCreationTasks(f.redis, f.services)
    assert.equal(f.calls.length, 2)
    completed = true
    await f.redis.zadd('community-next:creation:pending', 0, key)
    await processCreationTasks(f.redis, f.services)
    assert.equal((await f.app.inject('/api/creation/requests/retry-query')).json().status, 'succeeded')
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
})

for (const failures of [1, 3]) test(`a worker preserves its completed result across ${failures} storage failures even if the next upstream read expires`, async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-worker-recovery-'))
  t.after(async () => {
    if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous
    await rm(filesRoot, { recursive: true, force: true })
  })
  const ready = deferred()
  let remaining = failures, queries = 0
  const f = fixture(t, { filesRoot,
    beforeRedisSet(key, value) {
      if (key.endsWith(':worker-result') && JSON.parse(value).result.status === 'succeeded' && remaining-- > 0)
        throw new Error('Temporary result storage failure')
    },
    afterRedisSet(key, value) { if (key.endsWith(':worker-result') && JSON.parse(value).tracking) ready.resolve() },
    fetch(_url, init) {
      if (init.method === 'POST') return Response.json({ id: 'original-video', status: 'queued' })
      return Response.json({ id: 'original-video', status: ++queries === 1 ? 'completed' : 'expired' })
    },
  })
  await submit(f.app, { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'worker-result' }, { Prefer: 'respond-async' })
  await ready.promise
  const key = [...f.values.keys()].find(key => key.endsWith(':worker-result'))
  await processCreationTasks(f.redis, f.services)
  await f.redis.zadd('community-next:creation:pending', 0, key)
  await processCreationTasks(f.redis, f.services)
  const result = (await f.app.inject('/api/creation/requests/worker-result')).json()
  assert.equal(result.status, 'succeeded')
  assert.equal(result.mediaPath, 'videos/original-video/content')
  assert.equal(queries, 1)
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  assert.equal((await f.app.inject({ url: '/api/creation/requests/worker-result', headers: { 'x-test-account': '18' } })).statusCode, 404)
})

test('worker media ownership storage failure preserves the completed result and request reads repair ownership', async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous })
  const ready = deferred()
  let rejected = false, queries = 0
  const f = fixture(t, {
    beforeRedisSet(key) {
      if (key.startsWith('community-next:creation:media:') && !rejected) {
        rejected = true
        throw new Error('Temporary media ownership storage failure')
      }
    },
    afterRedisSet(key, value) { if (key.endsWith(':worker-owner') && JSON.parse(value).tracking) ready.resolve() },
    fetch(_url, init) {
      if (init.method === 'POST') return Response.json({ id: 'original-video', status: 'queued' })
      return Response.json({ id: 'original-video', status: ++queries === 1 ? 'completed' : 'expired' })
    },
  })
  await submit(f.app, { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'worker-owner' }, { Prefer: 'respond-async' })
  await ready.promise
  const key = [...f.values.keys()].find(key => key.endsWith(':worker-owner'))
  await processCreationTasks(f.redis, f.services)
  await f.redis.zadd('community-next:creation:pending', 0, key)
  await processCreationTasks(f.redis, f.services)
  const result = (await f.app.inject('/api/creation/requests/worker-owner')).json()
  assert.equal(result.status, 'succeeded')
  assert.equal(result.mediaPath, 'videos/original-video/content')
  assert([...f.values.keys()].some(key => key.startsWith('community-next:creation:media:')))
  assert.equal(queries, 1)
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
})

test('synchronous image results survive exhausted Redis writes through the same disk fallback without replay', async t => {
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-sync-recovery-'))
  t.after(() => rm(filesRoot, { recursive: true, force: true }))
  let remaining = 3
  const f = fixture(t, { filesRoot,
    beforeRedisSet(key, value) {
      if (key.endsWith(':request-1') && JSON.parse(value).result.status === 'succeeded' && remaining-- > 0)
        throw new Error('Temporary result storage failure')
    },
    fetch() { return Response.json({ data: [{ url: 'https://media.example/paid-result.png' }] }) },
  })
  const sent = await submit(f.app)
  assert.equal(sent.statusCode, 200)
  assert.equal(sent.json().status, 'succeeded')
  const recovered = (await f.app.inject('/api/creation/requests/request-1')).json()
  assert.equal(recovered.status, 'succeeded')
  assert.equal(recovered.outputs[0].url, 'https://media.example/paid-result.png')
  assert.equal((await submit(f.app)).json().status, 'succeeded')
  assert.equal(f.calls.length, 1)
})

test('async video failure details survive polling, request reload and duplicate submission without replay', async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-async-error-secret-'.repeat(3)
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous })
  for (const [stage, expectedStage] of [['upstream_submission', '上游提交'], ['upstream_query', '任务查询'], ['result_download', '结果下载']]) await t.test(stage, async t => {
    const ready = deferred()
    const f = fixture(t, {
      afterRedisSet(key, value) { if (key.endsWith(':async-failure') && JSON.parse(value).tracking) ready.resolve() },
      fetch(url, init) {
        if (init.method === 'POST') return Response.json({ id: 'upstream-video', status: 'queued' })
        assert.equal(new URL(url).pathname, '/async-videos/v1/tasks/upstream-video')
        return Response.json({ id: 'upstream-video', status: stage === 'result_download' ? 'save_failed' : 'failed', error: {
          code: 'upstream_rejected', message: `body.resolution: unsupported value ${apiKey} https://provider.example/private?token=secret`,
          status: 422, stage, upstream_code: 'validation_error',
        } })
      },
    })
    const input = { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', protocol: 'async', requestId: 'async-failure' }
    assert.equal((await submit(f.app, input, { Prefer: 'respond-async' })).statusCode, 202)
    await ready.promise
    const queried = await f.app.inject('/api/creation/tasks/video/upstream-video?protocol=async')
    const expected = queried.json()
    assert.equal(expected.status, stage === 'result_download' ? 'save_failed' : 'failed')
    assert.equal(expected.errorStage, expectedStage)
    assert.equal(expected.errorStatus, 422)
    assert.match(expected.error, /HTTP 422.*body\.resolution: unsupported value/)
    assert(!queried.payload.includes(apiKey)); assert(!queried.payload.includes('provider.example')); assert(!queried.payload.includes('token=secret'))
    await processCreationTasks(f.redis, f.services)
    const reloaded = (await f.app.inject('/api/creation/requests/async-failure')).json()
    assert.deepEqual(reloaded, { ...expected, requestId: input.requestId })
    assert.deepEqual((await submit(f.app, input)).json(), reloaded)
    assert(!JSON.stringify([...f.values.values()]).includes('provider.example'))
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
  })
})

test('an interrupted text client reads pending until the original request finishes without another paid POST', async t => {
  const started = deferred(), finished = deferred()
  const f = fixture(t, { fetch() { started.resolve(); return finished.promise } })
  const input = { kind: 'text', model: 'chat-test', prompt: 'hello', requestId: 'pending-text',
    chatOptions: { messages: [{ role: 'user', content: 'hello' }], stream: false } }
  const sending = submit(f.app, input).then(value => value)
  await started.promise
  const pending = (await f.app.inject('/api/creation/requests/pending-text')).json()
  assert.equal(pending.status, 'pending')
  assert.equal(pending.requestId, input.requestId)
  finished.resolve(Response.json({ choices: [{ message: { content: 'Original answer' } }] }))
  await sending
  assert.equal((await f.app.inject('/api/creation/requests/pending-text')).json().outputs[0].text, 'Original answer')
  assert.equal(f.calls.length, 1)
})
test('background acceptance failure never crosses the paid boundary and large worker results use file storage', { timeout: 5000 }, async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-background-test-'))
  t.after(async () => {
    if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous
    await rm(filesRoot, { recursive: true, force: true })
  })
  let rejected = true
  const trackingSaved = deferred()
  const pixels = 'aW1hZ2U='.repeat(150000)
  const f = fixture(t, { filesRoot,
    async beforeRedisSet(key, value, flags) {
      if (rejected && key.endsWith(':request-1') && flags.includes('NX')) throw new Error('Redis unavailable')
      if (key.endsWith(':request-1') && JSON.parse(value).tracking) await new Promise(resolve => setTimeout(resolve, 50))
    },
    afterRedisSet(key, value) { if (key.endsWith(':request-1') && JSON.parse(value).tracking) trackingSaved.resolve() },
    fetch(_url, init) { return Response.json(init.method === 'POST'
      ? { id: 'large-image', status: 'queued' }
      : { id: 'large-image', status: 'succeeded', data: [{ b64_json: pixels }] }) },
  })
  assert.equal((await submit(f.app, imageRequest, { Prefer: 'respond-async' })).statusCode, 500)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.app.inject('/api/creation/requests/request-1')).statusCode, 404)
  rejected = false
  await submit(f.app, imageRequest, { Prefer: 'respond-async' })
  const key = [...f.values.keys()].find(key => key.endsWith(':request-1'))
  await trackingSaved.promise
  await processCreationTasks(f.redis, f.services)
  const saved = JSON.parse(f.values.get(key))
  assert.equal(typeof saved.file, 'string')
  assert(f.values.get(key).length < 10000)
  const result = (await f.app.inject('/api/creation/requests/request-1')).json()
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outputs[0].b64_json, pixels)
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
})
for (const failures of [1, 3]) test(`background results survive ${failures} storage failures without replaying generation`, async t => {
  const previous = process.env.NEW_API_SESSION_SECRET
  process.env.NEW_API_SESSION_SECRET = 'fixture-background-secret-'.repeat(3)
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-result-recovery-'))
  t.after(async () => {
    if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous
    await rm(filesRoot, { recursive: true, force: true })
  })
  let remaining = failures
  const f = fixture(t, { filesRoot,
    beforeRedisSet(key, value) {
      if (key.endsWith(':request-1') && JSON.parse(value).result.status === 'succeeded' && remaining-- > 0)
        throw new Error('Temporary result storage failure')
    },
    fetch() { return Response.json({ data: [{ url: 'https://media.example/paid-result.png' }] }) },
  })
  assert.equal((await submit(f.app, imageRequest, { Prefer: 'respond-async' })).statusCode, 202)
  let result
  for (let i = 0; i < 100; i++) {
    result = (await f.app.inject('/api/creation/requests/request-1')).json()
    if (result.status === 'succeeded') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outputs[0].url, 'https://media.example/paid-result.png')
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
})

test('automatic text interfaces use model configuration while explicit and legacy formats keep their selection', async t => {
  for (const [apiFormat, expectedPath] of [['auto', '/v1/responses'], ['chat-completions', '/v1/chat/completions'], [undefined, '/v1/chat/completions']]) {
    const { app, calls } = fixture(t, {
      modelTypes: [{ id: 'custom-chat', name: 'Configured chat', tags: ['Reasoning'], kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' }, remark: 'private-routing-note' }],
      fetch(url, init) {
        const body = JSON.parse(init.body)
        assert(!JSON.stringify(body).includes('private-routing-note'))
        assert.equal(body.model, 'custom-chat')
        assert(!Object.hasOwn(body, 'name'))
        assert(!Object.hasOwn(body, 'tags'))
        if (new URL(url).pathname === '/v1/responses') {
          assert.equal(body.reasoning.effort, 'high')
          return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'selected interface' }] }] })
        }
        return Response.json({ choices: [{ message: { content: 'selected interface' } }] })
      },
    })
    const response = await submit(app, { kind: 'text', model: 'custom-chat', prompt: 'Hello', requestId: 'text-interface',
      ...(apiFormat ? { apiFormat } : {}), chatOptions: { messages: [{ role: 'user', content: 'Hello' }], format: 'chat-completions', stream: false, reasoningEffort: 'auto' } })
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().outputs[0].text, 'selected interface')
    assert.equal(response.json().apiFormat, apiFormat === 'auto' ? 'responses' : apiFormat)
    assert.deepEqual(calls.map(call => call.path), [expectedPath])
  }
})

test('model configuration changes never rewrite or replay an accepted request and database failures stay visible', async t => {
  const options = {
    modelTypes: [{ id: 'custom-chat', kind: 'text', apiFormat: 'responses', remark: 'private-admin-note' }],
    fetch(url) {
      const text = new URL(url).pathname === '/v1/responses' ? 'original response' : 'new response'
      return Response.json(new URL(url).pathname === '/v1/responses'
        ? { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
        : { choices: [{ message: { content: text } }] })
    },
  }
  const { app, calls } = fixture(t, options)
  const input = { kind: 'text', model: 'custom-chat', prompt: 'Hello', requestId: 'configured-interface', apiFormat: 'auto',
    chatOptions: { messages: [{ role: 'user', content: 'Hello' }], stream: false } }
  const original = await submit(app, input)
  assert.equal(original.json().outputs[0].text, 'original response')
  assert.equal(original.json().apiFormat, 'responses')
  options.modelTypes[0].apiFormat = 'chat-completions'
  options.modelReadError = new Error('Model configuration is unavailable')
  assert.deepEqual((await submit(app, input)).json(), original.json())
  assert.deepEqual((await app.inject('/api/creation/requests/configured-interface')).json(), original.json())
  assert.equal(calls.length, 1)
  const unavailable = await submit(app, { ...input, requestId: 'unavailable-interface' })
  assert.equal(unavailable.statusCode, 500)
  assert.equal((await app.inject('/api/creation/requests/unavailable-interface')).statusCode, 404)
  assert.equal(calls.length, 1)
  delete options.modelReadError
  const next = await submit(app, { ...input, requestId: 'updated-interface' })
  assert.equal(next.json().outputs[0].text, 'new response')
  assert.equal(next.json().apiFormat, 'chat-completions')
  assert.deepEqual(calls.map(call => call.path), ['/v1/responses', '/v1/chat/completions'])
})

test('configured image transport and automatic parameters preserve manual selections and actual recovery protocol', async t => {
  for (const manual of [false, true]) {
    const { app, calls } = fixture(t, {
      modelTypes: [{ id: 'gpt-image-2', kind: 'image', apiFormat: 'images', protocol: 'async',
        image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '3:2', autoBackground: 'transparent' } }],
      fetch() { return Response.json({ data: [{ url: 'https://media.example/configured.png' }] }) },
    })
    const input = { ...imageRequest, apiFormat: 'auto', protocol: manual ? 'sync' : 'auto', size: 'auto', aspect_ratio: manual ? '1:1' : 'auto',
      imageOptions: { resolution: manual ? '1k' : 'auto', quality: manual ? 'low' : 'auto', imageBackground: manual ? 'opaque' : 'auto' } }
    const response = await submit(app, input)
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().status, 'succeeded')
    assert.equal(response.json().protocol, manual ? 'sync' : 'async')
    assert.equal(response.json().apiFormat, 'images')
    assert.equal(calls[0].path, manual ? '/v1/images/generations' : '/async-images/v1/tasks')
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.size, manual ? '1024x1024' : '2160x1440')
    assert.equal(body.quality, manual ? 'low' : 'high')
    assert.equal(body.background, manual ? 'opaque' : 'transparent')
  }
})

test('image requests retain their resolved interface while pending and cached across administrator changes', async t => {
  const started = deferred(), completed = deferred()
  const chatResult = { choices: [{ message: { content: '![Image](https://media.example/original-interface.png)' } }] }
  t.after(() => completed.resolve(Response.json(chatResult)))
  const modelTypes = [{ id: 'custom-image', kind: 'image', apiFormat: 'chat-completions', protocol: 'sync', remark: 'private-interface-note' }]
  const { app, calls } = fixture(t, { modelTypes, fetch() {
    if (calls.length === 1) { started.resolve(); return completed.promise }
    return Response.json({ data: [{ url: 'https://media.example/new-interface.png' }] })
  } })
  const input = { ...imageRequest, model: 'custom-image', apiFormat: 'auto', protocol: 'auto' }
  const pending = submit(app, input).then(response => response)
  await started.promise
  const inProgress = await submit(app, input)
  assert.equal(inProgress.json().status, 'pending')
  assert.equal(inProgress.json().apiFormat, 'chat-completions')
  modelTypes[0].apiFormat = 'images'
  completed.resolve(Response.json(chatResult))
  const original = await pending
  assert.equal(original.json().status, 'succeeded')
  assert.equal(original.json().apiFormat, 'chat-completions')
  assert.deepEqual((await submit(app, input)).json(), original.json())
  assert.deepEqual((await app.inject('/api/creation/requests/request-1')).json(), original.json())
  assert.equal(calls.length, 1)
  const next = await submit(app, { ...input, requestId: 'new-image-interface' })
  assert.equal(next.json().apiFormat, 'images')
  assert.equal(next.json().outputs[0].url, 'https://media.example/new-interface.png')
  assert.deepEqual(calls.map(call => call.path), ['/v1/chat/completions', '/v1/images/generations'])
  assert(!original.payload.includes('private-'))
})

test('an uncertain paid result retains its resolved interface and never replays the request', async t => {
  const { app, calls } = fixture(t, {
    modelTypes: [{ id: 'custom-image', kind: 'image', apiFormat: 'images' }],
    fetch() { throw new DOMException('Provider timed out', 'TimeoutError') },
  })
  const input = { ...imageRequest, model: 'custom-image', apiFormat: 'auto' }
  const response = await submit(app, input)
  assert.equal(response.json().status, 'indeterminate')
  assert.equal(response.json().apiFormat, 'images')
  assert.deepEqual((await submit(app, input)).json(), response.json())
  assert.equal(calls.length, 1)
})

test('configured model types reject mismatched creation requests before a paid call', async t => {
  const { app, calls, credentialCalls } = fixture(t, { modelTypes: [{ id: 'gpt-image-2', kind: 'text' }] })
  const response = await submit(app)
  assert.equal(response.statusCode, 400)
  assert.equal((await app.inject('/api/creation/requests/request-1')).statusCode, 404)
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
})

test('model catalogs publish only authorized public configuration and keep administrator remarks private', async t => {
  const modelTypes = [
    { id: 'configured-text', name: 'Configured text', tags: ['Reasoning'], kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' }, remark: 'private-text-remark' },
    { id: 'configured-image', name: 'Configured image', tags: ['Edit'], kind: 'image', apiFormat: 'images', protocol: 'async', image: { autoQuality: 'high', maxReferenceImages: 0 }, remark: 'private-image-remark' },
    { id: 'configured-video', name: 'Configured video', tags: [], kind: 'video', apiFormat: 'openai', protocol: 'sync',
      video: { autoResolution: '720p', parameterFormat: 'xai', maxReferenceImages: 0, maxReferenceVideos: 2, maxReferenceAudios: 1 }, remark: 'private-video-remark' },
    { id: 'not-in-group', name: 'private-unauthorized-display', tags: ['private-unauthorized-tag'], kind: 'text', apiFormat: 'claude', remark: 'private-unauthorized-remark' },
  ]
  const { app } = fixture(t, { modelTypes, fetch() {
    return Response.json({ data: [
      ...modelTypes.slice(0, 3).map(({ id }) => ({ id, name: 'Upstream title', tags: ['untrusted-upstream-tag'], apiFormat: 'untrusted', remark: 'private-upstream-remark', secret: 'private-upstream-secret' })),
      { id: 'gpt-5', name: 'Upstream fallback', tags: ['untrusted-upstream-tag'] },
    ] })
  } })
  const response = await app.inject('/api/creation/models')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().items.length, 4)
  assert(!response.payload.includes('private-'))
  for (const setting of modelTypes.slice(0, 3)) {
    const item = response.json().items.find(item => item.id === setting.id)
    assert.equal(item.name, setting.name)
    assert.deepEqual(item.tags, setting.tags)
    assert.equal(item.apiFormat, setting.apiFormat)
    assert.equal(item.protocol, setting.protocol ?? 'openai')
    for (const key of ['image', 'text', 'video']) assert.deepEqual(item[key], setting[key])
    assert(!Object.hasOwn(item, 'remark'))
  }
  const fallback = response.json().items.find(item => item.id === 'gpt-5')
  assert.equal(fallback.name, 'Upstream fallback')
  assert(!Object.hasOwn(fallback, 'tags'))
})

test('administrator catalogs span authorized groups without selecting a relay token and preserve ordinary catalogs', async t => {
  const modelTypes = []
  const { app, calls, credentialCalls, catalogueCalls } = fixture(t, { isAdmin: true, modelTypes,
    modelCatalogue() { return { groups: [{ id: 'images', name: 'images' }, { id: 'chat', name: 'chat' }], items: [
      { id: 'custom/embedding-alias', groups: ['images', 'chat'] }, { id: 'gpt-5', groups: ['chat'] },
      { id: '', groups: ['images'] }, { id: ' bad-alias ', groups: ['images'] },
    ] } },
    fetch() {
    return Response.json({ data: ['custom/embedding-alias', { id: 'gpt-5' }, '', ' bad-alias ', 'gpt-5\nbad', { id: 'x'.repeat(201) }] })
  } })
  const ordinary = await app.inject('/api/creation/models')
  assert.deepEqual(ordinary.json().items.map(item => item.id), ['gpt-5'])
  assert.equal(ordinary.json().tokenId, 71)
  assert.equal(catalogueCalls.length, 0)
  const management = await app.inject('/api/creation/models?management=1')
  assert.equal(management.statusCode, 200)
  assert.deepEqual(management.json().items.map(item => item.id), ['custom/embedding-alias', 'gpt-5'])
  assert.deepEqual(management.json().items.find(item => item.id === 'custom/embedding-alias').kinds, [])
  assert.deepEqual(management.json().items[0].groups, ['images', 'chat'])
  assert.deepEqual(management.json().groups.map(group => group.id), ['images', 'chat'])
  assert(!Object.hasOwn(management.json(), 'tokenId'))
  assert.equal(catalogueCalls.length, 1)
  assert.equal(credentialCalls.length, 1)
  assert.equal(calls.length, 1)
  modelTypes.push({ id: 'custom/embedding-alias', kind: 'image', name: 'Configured alias', tags: ['Edit'] })
  const configured = (await app.inject('/api/creation/models')).json().items.find(item => item.id === 'custom/embedding-alias')
  assert.deepEqual(configured.kinds, ['image'])
  assert.equal(configured.configuredKind, 'image')
  assert.equal(configured.name, 'Configured alias')
  assert.deepEqual(configured.tags, ['Edit'])
})

test('management model catalogs require a community administrator before reading upstream credentials', async t => {
  const { app, calls, credentialCalls, catalogueCalls } = fixture(t)
  const response = await app.inject('/api/creation/models?management=1')
  assert.equal(response.statusCode, 403)
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
  assert.equal(catalogueCalls.length, 0)
})

test('an unavailable group fails the administrator directory without falling back to the current token', async t => {
  const { app, calls, credentialCalls } = fixture(t, { isAdmin: true,
    modelCatalogue() { throw httpError(502, '账号模型目录暂不可用。') },
  })
  const response = await app.inject('/api/creation/models?management=1')
  assert.equal(response.statusCode, 502)
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
})

test('configured image interfaces select the matching stream parser and history preparation', async t => {
  for (const apiFormat of ['chat-completions', 'images']) {
    const model = apiFormat === 'images' ? 'gemini-3.1-flash-image-preview' : 'custom-image-alias'
    const reads = [], imageUrl = 'https://media.example/explicit-interface.png'
    const { app, calls } = fixture(t, {
      modelTypes: [{ id: model, kind: 'image', apiFormat, protocol: 'sync' }],
      publicMedia(url) { reads.push(url); return new Response('image', { headers: { 'content-type': 'image/png' } }) },
      fetch() {
        const event = apiFormat === 'images' ? { type: 'image_generation.completed', data: [{ url: imageUrl }] }
          : { choices: [{ delta: { content: `![Image](${imageUrl})` }, finish_reason: 'stop' }] }
        return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      },
    })
    const input = { ...imageRequest, model, apiFormat: 'auto', protocol: 'auto', imageOptions: { imageStream: true },
      imageContext: { turns: [{ prompt: 'Previous image', images: ['https://media.example/history.png'] }] } }
    const response = await submit(app, input)
    assert.match(response.headers['content-type'], /text\/event-stream/)
    assert.match(response.payload, /"status":"succeeded"/)
    const recovered = (await app.inject('/api/creation/requests/request-1')).json()
    assert.equal(recovered.outputs[0].url, imageUrl)
    assert.equal(recovered.apiFormat, apiFormat)
    assert.equal(calls[0].path, apiFormat === 'images' ? '/v1/images/generations' : '/v1/chat/completions')
    assert.equal(reads.length, apiFormat === 'images' ? 0 : 1)
    await submit(app, input)
    assert.equal(calls.length, 1)
  }
})

test('native Gemini automatic image requests prepare private history and recover without another paid submission', async t => {
  for (const stream of [false, true]) {
    const modelTypes = [{ id: 'native-image', kind: 'image', apiFormat: 'gemini',
      image: { autoResolution: '2k', autoAspectRatio: '16:9' } }]
    const reads = []
    const { app, calls } = fixture(t, { modelTypes,
      publicMedia(url) { reads.push(url); return new Response('reference', { headers: { 'content-type': 'image/png' } }) },
      fetch(url) {
        assert.equal(new URL(url).search, stream ? '?alt=sse' : '')
        const data = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }] }
        return stream ? new Response(`data: ${JSON.stringify(data)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data)
      },
    })
    const input = { ...imageRequest, model: 'native-image', apiFormat: 'auto', protocol: 'auto', imageOptions: { imageStream: stream },
      imageContext: { turns: [{ prompt: 'Previous', images: ['https://media.example/history.png'] }] } }
    const response = await submit(app, input)
    assert.equal(response.statusCode, 200)
    const result = (await app.inject('/api/creation/requests/request-1')).json()
    assert.equal(result.status, 'succeeded')
    assert.equal(result.apiFormat, 'gemini')
    assert.equal(result.protocol, 'sync')
    assert.equal(result.outputs[0].url, 'data:image/png;base64,aW1hZ2U=')
    assert.equal(reads.length, 1)
    assert.equal(calls[0].path, `/v1beta/models/native-image:${stream ? 'streamGenerateContent' : 'generateContent'}`)
    const body = JSON.parse(calls[0].init.body)
    assert.deepEqual(body.generationConfig.imageConfig, { imageSize: '2K', aspectRatio: '16:9' })
    assert(!JSON.stringify(body).includes('https://media.example'))
    modelTypes[0].apiFormat = 'images'
    await submit(app, input)
    assert.equal((await app.inject('/api/creation/requests/request-1')).json().apiFormat, 'gemini')
    assert.equal(calls.length, 1)
  }
})

test('converted Gemini Markdown images survive synchronous and streamed result recovery without another POST', async t => {
  for (const stream of [false, true]) {
    const image = 'https://media.example/converted.png'
    const modelTypes = [{ id: 'native-image', kind: 'image', apiFormat: 'gemini' }]
    const { app, calls } = fixture(t, { modelTypes, fetch() {
      const candidate = { content: { role: 'model', parts: [{ text: `![Generated Image](${image})` }] }, finishReason: 'STOP' }
      return stream
        ? new Response(`data: ${JSON.stringify({ candidates: [candidate] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json({ candidates: [candidate] })
    } })
    const input = { ...imageRequest, model: 'native-image', apiFormat: 'gemini', imageOptions: { imageStream: stream } }
    assert.equal((await submit(app, input)).statusCode, 200)
    const result = (await app.inject('/api/creation/requests/request-1')).json()
    assert.equal(result.status, 'succeeded')
    assert.deepEqual(result.outputs, [{ url: image }])
    assert.equal(result.apiFormat, 'gemini')
    modelTypes[0].apiFormat = 'images'
    await submit(app, input)
    assert.deepEqual((await app.inject('/api/creation/requests/request-1')).json(), result)
    assert.equal(calls.length, 1)
  }
})

test('automatic text interfaces use the resolved response stream format', async t => {
  const { app, calls } = fixture(t, {
    modelTypes: [{ id: 'custom-chat', kind: 'text', apiFormat: 'responses' }],
    fetch() {
      const events = [{ type: 'response.output_text.delta', delta: 'resolved stream' }, { type: 'response.completed', response: { usage: { input_tokens: 2, output_tokens: 3 } } }]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })
  const input = { kind: 'text', model: 'custom-chat', prompt: 'Hello', requestId: 'resolved-text-stream', apiFormat: 'auto',
    chatOptions: { messages: [{ role: 'user', content: 'Hello' }], format: 'chat-completions', stream: true } }
  const response = await submit(app, input)
  assert.match(response.payload, /"status":"succeeded"/)
  assert.match(response.payload, /"apiFormat":"responses"/)
  assert.equal(calls[0].path, '/v1/responses')
  assert.equal((await app.inject('/api/creation/requests/resolved-text-stream')).json().outputs[0].text, 'resolved stream')
})

test('video preflight rejections return 400 before recording or sending a paid request', async t => {
  const { app, calls, credentialCalls } = fixture(t)
  for (const withOptions of [false, true]) {
    const requestId = `preflight-known-${withOptions}`
    const response = await submit(app, {
      kind: 'video', model: 'sora-2', prompt: 'Video', duration: 5, requestId,
      ...(withOptions ? { videoOptions: { mode: 'text-to-video', resolution: '720p' } } : {}),
    })
    assert.equal(response.statusCode, 400)
    assert.match(response.json().error.message, /视频时长/)
    assert.equal((await app.inject(`/api/creation/requests/${requestId}`)).statusCode, 404)
  }
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
})

test('unregistered video models can submit automatic resolution while unsafe values fail before another paid request', async t => {
  const { app, calls } = fixture(t, { fetch() { return Response.json({ id: 'new-model-job', status: 'queued' }) } })
  const input = { kind: 'video', model: 'unknown-video-model', prompt: 'Video', duration: 8, size: 'auto',
    requestId: 'new-model-request', videoOptions: { mode: 'text-to-video', resolution: 'auto' } }
  const accepted = await submit(app, input)
  assert.equal(accepted.statusCode, 200, accepted.payload)
  assert.equal(accepted.json().status, 'pending')
  assert.equal(calls.length, 1)
  const rejected = await submit(app, { ...input, requestId: 'unsafe-resolution',
    videoOptions: { ...input.videoOptions, resolution: 'javascript:alert(1)' } })
  assert.equal(rejected.statusCode, 400)
  assert.equal((await app.inject('/api/creation/requests/unsafe-resolution')).statusCode, 404)
  assert.equal(calls.length, 1)
})

test('automatic video resolution uses the administrator setting while explicit and upstream choices stay intact', async t => {
  for (const [video, resolution, expected] of [
    [{ autoResolution: '480p' }, 'auto', '480p'],
    [{ autoResolution: '480p' }, '1080p', '1080p'],
    [{ autoResolution: '480p' }, undefined, '480p'],
    [undefined, 'auto', undefined],
    [{ autoResolution: 'auto' }, 'auto', undefined],
    [{ resolutions: ['720p'] }, 'auto', undefined],
  ]) {
    const { app, calls } = fixture(t, {
      modelTypes: video ? [{ id: 'wan3.0', kind: 'video', video }] : [],
      fetch() { return Response.json({ id: 'resolution-job', status: 'queued' }) },
    })
    const response = await submit(app, { kind: 'video', model: 'wan3.0', prompt: 'Video', duration: 8, requestId: 'resolution-request',
      size: 'auto', videoOptions: { mode: 'text-to-video', ...(resolution ? { resolution } : {}) } })
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().status, 'pending')
    assert.equal(calls.length, 1)
    const body = await relayRequestBody(calls[0].init)
    const metadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata
    assert.equal(body.resolution ?? metadata?.resolution, expected)
    assert.equal(String(body.seconds), '8')
    if (!expected) assert.equal(body.size, undefined)
  }
})

test('changed video settings apply to new requests while original IDs only return their cached results', async t => {
  const modelTypes = [{ id: 'wan3.0', kind: 'video', video: { autoResolution: '480p', resolutions: ['480p', '720p', '1080p'] } }]
  const { app, calls } = fixture(t, {
    modelTypes, fetch() { return Response.json({ id: `resolution-job-${calls.length}`, status: 'queued' }) },
  })
  const input = { kind: 'video', model: 'wan3.0', prompt: 'Video', duration: 8, size: 'auto', requestId: 'fixed-resolution',
    videoOptions: { mode: 'text-to-video', resolution: 'auto' } }
  const first = await submit(app, input)
  assert.equal(first.statusCode, 200, first.payload)
  modelTypes[0].video.autoResolution = '1080p'
  assert.deepEqual((await submit(app, input)).json(), first.json())
  assert.deepEqual((await app.inject('/api/creation/requests/fixed-resolution')).json(), first.json())
  assert.equal(calls.length, 1)
  const next = await submit(app, { ...input, requestId: 'new-resolution' })
  assert.equal(next.statusCode, 200, next.payload)
  assert.equal(calls.length, 2)
  const resolutions = await Promise.all(calls.map(async ({ init }) => {
    const body = await relayRequestBody(init)
    const metadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata
    return body.resolution ?? metadata?.resolution
  }))
  assert.deepEqual(resolutions, ['480p', '1080p'])
})

test('administrator video resolution choices still reject unsupported explicit values before a paid request', async t => {
  const { app, calls, credentialCalls } = fixture(t, {
    modelTypes: [{ id: 'wan3.0', kind: 'video', video: { autoResolution: '480p', resolutions: ['480p', '720p'] } }],
  })
  const response = await submit(app, { kind: 'video', model: 'wan3.0', prompt: 'Video', duration: 8, size: 'auto',
    requestId: 'unsupported-resolution', videoOptions: { mode: 'text-to-video', resolution: '1080p' } })
  assert.equal(response.statusCode, 400)
  assert.equal((await app.inject('/api/creation/requests/unsupported-resolution')).statusCode, 404)
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
})

for (const [label, video] of [
  ['built-in defaults', undefined],
  ['partial administrator settings', { resolutions: ['1080p'], autoResolution: '1080p' }],
  ['explicit operation', { operation: 'upscale', resolutions: ['1080p'], autoResolution: '1080p', sendSize: false }],
]) test(`video upscaling with ${label} reads an owned MP4 and reserves its measured duration`, async t => {
  if (['ffprobe', 'ffmpeg'].some(command => spawnSync(command, ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0)) return t.skip('FFmpeg is unavailable')
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-upscale-source-'))
  t.after(() => rm(filesRoot, { recursive: true, force: true }))
  const sourcePath = path.join(filesRoot, 'source-video')
  const generated = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=16x16:r=4:d=2.5',
    '-c:v', 'mpeg4', '-f', 'mp4', sourcePath], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  const bytes = await readFile(sourcePath)
  const source = { id: 'source1', userId: 'local-17', name: 'private.mp4', type: 'video/mp4', size: String(bytes.length),
    accessKey: 'source-video', storedInternal: true, isLink: false, properties: { communityVideoPrivacy: { 'source-video': 1 } } }
  const model = 'DMC 视频超分'
  const f = fixture(t, { filesRoot, mediaFiles: [source], modelTypes: video ? [{ id: model, kind: 'video', video }] : [], async fetch(_url, init) {
    const sent = await relayRequestBody(init)
    assert.equal(sent.seconds, '3')
    const metadata = JSON.parse(sent.metadata)
    assert.equal(metadata.operation, 'upscale')
    const file = sent.input_videos
    assert(file instanceof Blob)
    assert.equal(file.type, 'video/mp4')
    assert.equal(file.size, bytes.length)
    return Response.json({ id: 'upscale-job', status: 'queued' })
  } })
  const input = { kind: 'video', model, prompt: '', requestId: 'upscale-source', duration: 1,
    referenceUrls: ['/legacy-files/source1'], videoOptions: { mode: 'reference-to-video', resolution: '1080p' } }
  const response = await submit(f.app, input, { cookie: 'fixture-account=17' })
  assert.equal(response.statusCode, 200, response.payload)
  assert.equal(f.calls.length, 1)
  assert.equal(response.json().upstreamId, 'upscale-job')
  assert.equal((await submit(f.app, input, { cookie: 'fixture-account=17' })).statusCode, 200)
  assert.equal(f.calls.length, 1)
  const other = await submit(f.app, { ...input, requestId: 'upscale-foreign' }, { 'x-test-account': '18', cookie: 'fixture-account=18' })
  assert.equal(other.statusCode, 404, other.payload)
  assert.equal(f.calls.length, 1)
  assert.equal(f.credentialCalls.length, 1)
})

test('video upscaling rejects unowned, external, oversized and invalid video sources before gateway credentials', async t => {
  if (['ffprobe', 'ffmpeg'].some(command => spawnSync(command, ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0)) return t.skip('FFmpeg is unavailable')
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-upscale-invalid-'))
  t.after(() => rm(filesRoot, { recursive: true, force: true }))
  await writeFile(path.join(filesRoot, 'invalid-video'), 'not a video')
  const audioPath = path.join(filesRoot, 'audio-only')
  const audio = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
    '-t', '0.5', '-c:a', 'aac', '-f', 'mp4', audioPath], { windowsHide: true, encoding: 'utf8' })
  assert.equal(audio.status, 0, audio.stderr)
  const audioBytes = await readFile(audioPath)
  const base = { userId: 'local-17', name: 'source.mp4', type: 'video/mp4', size: 11, accessKey: 'invalid-video',
    storedInternal: true, isLink: false, properties: { communityVideoPrivacy: { 'invalid-video': 1 } } }
  const model = 'DMC 视频超分', video = { operation: 'upscale', resolutions: ['1080p'], autoResolution: '1080p', sendSize: false }
  const f = fixture(t, { filesRoot, modelTypes: [{ id: model, kind: 'video', video }], mediaFiles: [
    { ...base, id: 'invalid1' }, { ...base, id: 'foreign1', userId: 'someone-else' },
    { ...base, id: 'webm1', type: 'video/webm' }, { ...base, id: 'large1', size: 64 * 1024 * 1024 + 1 },
    { ...base, id: 'audio1', size: audioBytes.length, accessKey: 'audio-only', properties: { communityVideoPrivacy: { 'audio-only': 1 } } },
    { ...base, id: 'pending1', properties: { communityMedia: { state: 'processing' } } },
  ] })
  for (const [index, [references, expected]] of [
    [[], 400], [['/legacy-files/invalid1', '/legacy-files/foreign1'], 400], [['/legacy-files/foreign1'], 404],
    [['/legacy-files/invalid1'], 400], [['/legacy-files/webm1'], 400], [['/legacy-files/large1'], 413],
    [['/legacy-files/pending1'], 400], [['/legacy-files/audio1'], 400], [['https://media.example/source.mp4'], 400],
    [['/legacy-files/invalid1?variant=thumbnail'], 400], [['data:video/mp4;base64,YQ=='], 400],
  ].entries()) {
    const response = await submit(f.app, { kind: 'video', model, prompt: '', requestId: `upscale-invalid-${index}`,
      referenceUrls: references, videoOptions: { mode: 'reference-to-video', resolution: '1080p' } }, { cookie: 'fixture-account=17' })
    assert.equal(response.statusCode, expected, response.payload)
  }
  assert.equal(f.calls.length, 0)
  assert.equal(f.credentialCalls.length, 0)
  assert.equal(f.values.size, 0)
})

test('ordinary video generation forwards owned video and audio bytes without changing output duration', async t => {
  if (['ffprobe', 'ffmpeg'].some(command => spawnSync(command, ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0)) return t.skip('FFmpeg is unavailable')
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-reference-media-'))
  t.after(() => rm(filesRoot, { recursive: true, force: true }))
  const generated = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=16x16:r=4:d=2.5',
    '-c:v', 'mpeg4', '-f', 'mp4', path.join(filesRoot, 'source-video')], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  const video = await readFile(path.join(filesRoot, 'source-video'))
  const generatedAudio = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
    '-t', '0.25', '-c:a', 'pcm_s16le', '-f', 'wav', path.join(filesRoot, 'source-audio')], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generatedAudio.status, 0, generatedAudio.stderr)
  const audio = await readFile(path.join(filesRoot, 'source-audio'))
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  await writeFile(path.join(filesRoot, 'source-image'), image)
  const row = (id, type, accessKey, size) => ({ id, type, accessKey, size, userId: 'local-17', name: 'private', storedInternal: true, isLink: false,
    properties: { communityVideoPrivacy: { [accessKey]: 1 }, communityImagePrivacy: { [accessKey]: 1 } } })
  const mediaFiles = [row('video1', 'video/mp4', 'source-video', String(video.length)), row('audio1', 'audio/wav', 'source-audio', audio.length),
    row('image1', 'image/png', 'source-image', image.length), row('image2', 'image/png', 'source-image', image.length)]
  for (const [name, referenceUrls, mode, videoCount, audioCount] of [
    ['video-only', ['/legacy-files/video1'], 'text-to-video', 1, 0],
    ['audio-only', ['/legacy-files/audio1'], 'text-to-video', 0, 1],
    ['mixed', ['/legacy-files/video1', '/legacy-files/image1', '/legacy-files/audio1', '/legacy-files/image2'], 'first-last-frame', 1, 1],
  ]) await t.test(name, async t => {
    const f = fixture(t, { filesRoot, mediaFiles,
      modelTypes: [{ id: 'ordinary-video', kind: 'video', video: { maxReferenceImages: mode === 'first-last-frame' ? 2 : 0,
        maxReferenceVideos: videoCount, maxReferenceAudios: audioCount } }],
      async fetch(url, init) {
      const wire = new Request(url, init)
      assert.match(wire.headers.get('content-type'), /^multipart\/form-data;/)
      const form = await wire.formData()
      assert.equal(form.get('seconds'), '8')
      assert.equal(form.getAll('input_videos').length, videoCount)
      assert.equal(form.getAll('input_audios').length, audioCount)
      if (videoCount) assert.deepEqual(Buffer.from(await form.get('input_videos').arrayBuffer()), video)
      if (audioCount) assert.deepEqual(Buffer.from(await form.get('input_audios').arrayBuffer()), audio)
      assert(!form.has('__c_reference_video_seconds'))
      if (mode === 'first-last-frame') {
        const metadata = JSON.parse(form.get('metadata'))
        assert.match(metadata.first_frame.url, /^data:image\/png;base64,/)
        assert.match(metadata.last_frame.url, /^data:image\/png;base64,/)
      }
      return Response.json({ id: 'mixed-reference-task', status: 'queued' })
    } })
    const input = { kind: 'video', model: 'ordinary-video', prompt: 'Waves', duration: 8, requestId: name, referenceUrls,
      referenceVideoSeconds: 0.001, videoOptions: { mode } }
    const response = await submit(f.app, input, { cookie: 'fixture-account=17' })
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().upstreamId, 'mixed-reference-task')
    assert.equal((await submit(f.app, input, { cookie: 'fixture-account=17' })).statusCode, 200)
    assert.equal(f.calls.length, 1)
    const other = await submit(f.app, { ...input, requestId: `${name}-foreign` }, { cookie: 'fixture-account=18', 'x-test-account': '18' })
    assert([400, 404].includes(other.statusCode), other.payload)
    assert.equal(f.calls.length, 1)
    assert.equal(f.credentialCalls.length, 1)
    if (videoCount) {
      const tooLong = await submit(f.app, { ...input, duration: 3598, requestId: `${name}-too-long`, referenceVideoSeconds: 0 }, { cookie: 'fixture-account=17' })
      assert.equal(tooLong.statusCode, 400, tooLong.payload)
      assert.equal(tooLong.json().notAccepted, true)
      assert.equal(f.calls.length, 1)
    }
  })
  for (const [name, videoSetting, referenceUrls, model = 'ordinary-video'] of [
    ['images-disabled', { maxReferenceImages: 0 }, ['/legacy-files/image1']],
    ['videos-disabled', { maxReferenceVideos: 0 }, ['/legacy-files/video1']],
    ['audios-disabled', { maxReferenceAudios: 0 }, ['/legacy-files/audio1']],
    ['duplicate-images', { maxReferenceImages: 1 }, ['/legacy-files/image1', '/legacy-files/image1']],
    ['duplicate-videos', { maxReferenceVideos: 1 }, ['/legacy-files/video1', '/legacy-files/video1']],
    ['duplicate-audios', { maxReferenceAudios: 1 }, ['/legacy-files/audio1', '/legacy-files/audio1']],
    ['upscale-disabled', { maxReferenceVideos: 0 }, ['/legacy-files/video1'], 'DMC 视频超分'],
  ]) await t.test(name, async t => {
    const f = fixture(t, { filesRoot, mediaFiles, modelTypes: [{ id: model, kind: 'video', video: videoSetting }] })
    const response = await submit(f.app, { kind: 'video', model, prompt: 'Waves', duration: 8, requestId: name, referenceUrls,
      referenceTypes: ['image'], videoOptions: { mode: 'reference-to-video' } }, { cookie: 'fixture-account=17', prefer: 'respond-async' })
    assert.equal(response.statusCode, 400, response.payload)
    assert.equal(response.json().notAccepted, true)
    assert.match(response.json().error.message, /当前模型(?:不支持|最多支持)/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.credentialCalls.length, 0)
    assert.equal(f.mediaCalls.filter(call => call.method === 'GET').length, 0)
    assert.equal(f.values.size, 0)
  })
  await writeFile(path.join(filesRoot, 'invalid-audio'), 'not a WAV file')
  const invalid = fixture(t, { filesRoot, mediaFiles: [
    mediaFiles[1],
    row('bad1', 'audio/wav', 'invalid-audio', 14),
    { ...mediaFiles[1], id: 'large1', size: 64 * 1024 * 1024 + 1 },
    { ...mediaFiles[1], id: 'pending1', properties: { communityMedia: { state: 'processing' } } },
  ] })
  for (const [index, referenceUrls] of [
    ['/legacy-files/bad1'], ['/legacy-files/large1'], ['/legacy-files/pending1'],
    ['/legacy-files/audio1?variant=thumbnail'], ['data:audio/wav;base64,UklGRg=='],
  ].entries()) {
    const response = await submit(invalid.app, { kind: 'video', model: 'ordinary-video', prompt: 'Waves', duration: 8,
      requestId: `invalid-media-${index}`, referenceUrls, videoOptions: { mode: 'text-to-video' } }, { cookie: 'fixture-account=17' })
    assert([400, 404, 413].includes(response.statusCode), response.payload)
  }
  assert.equal(invalid.calls.length, 0)
  assert.equal(invalid.credentialCalls.length, 0)
  const paddedAudio = Buffer.alloc(33 * 1024 * 1024)
  audio.copy(paddedAudio)
  await writeFile(path.join(filesRoot, 'large-audio'), paddedAudio)
  const oversized = fixture(t, { filesRoot, mediaFiles: [row('largea', 'audio/wav', 'large-audio', paddedAudio.length), row('largeb', 'audio/wav', 'large-audio', paddedAudio.length)] })
  const rejected = await submit(oversized.app, { kind: 'video', model: 'ordinary-video', prompt: 'Waves', duration: 8,
    requestId: 'combined-reference-budget', referenceUrls: ['/legacy-files/largea', '/legacy-files/largeb'], videoOptions: { mode: 'text-to-video' } }, { cookie: 'fixture-account=17' })
  assert.equal(rejected.statusCode, 413, rejected.payload)
  assert.equal(rejected.json().notAccepted, true)
  assert.equal(oversized.calls.length, 0)
  assert.equal(oversized.credentialCalls.length, 0)
})

test('model reference limits cover image URLs, file IDs and explicitly limited image history before media reads', async t => {
  for (const scenario of [
    { name: 'image-disabled', kind: 'image', limit: 0, referenceUrls: ['https://media.example/current.png'] },
    { name: 'image-count', kind: 'image', limit: 1, referenceUrls: ['https://media.example/current.png', 'https://media.example/current.png'] },
    { name: 'image-url-disabled', kind: 'video', limit: 0, videoOptions: { mode: 'image-to-video', openaiReferenceSource: 'image_url', openaiImageUrl: 'https://media.example/current.png' } },
    { name: 'last-image-url-count', kind: 'video', limit: 1, videoOptions: { mode: 'first-last-frame', openaiReferenceSource: 'image_url',
      openaiImageUrl: 'https://media.example/current.png', openaiLastImageUrl: 'https://media.example/last.png' } },
    { name: 'file-id-disabled', kind: 'video', limit: 0, videoOptions: { mode: 'image-to-video', openaiReferenceSource: 'file_id', openaiFileId: 'file-upstream' } },
    { name: 'history-images-disabled', kind: 'image', limit: 0, imageContext: { turns: [{ prompt: 'Previous', images: ['https://media.example/previous.png'] }] } },
    { name: 'history-references-count', kind: 'image', limit: 1, referenceUrls: ['https://media.example/current.png'],
      imageContext: { turns: [{ prompt: 'Previous', images: [], references: ['https://media.example/previous.png'] }] } },
    { name: 'stream-image-disabled', kind: 'image', limit: 0, stream: true, referenceUrls: ['https://media.example/current.png'] },
  ]) await t.test(scenario.name, async t => {
    const model = scenario.kind === 'image' ? 'gemini-3.1-flash-image-preview' : 'ordinary-video'
    let mediaReads = 0
    const f = fixture(t, { modelTypes: [{ id: model, kind: scenario.kind, [scenario.kind]: { maxReferenceImages: scenario.limit } }],
      publicMedia() { mediaReads++; throw new Error('Reference limits must reject before media bytes are read') } })
    const response = await submit(f.app, { kind: scenario.kind, model, prompt: 'Waves', requestId: scenario.name,
      ...(scenario.referenceUrls ? { referenceUrls: scenario.referenceUrls } : {}),
      ...(scenario.videoOptions ? { videoOptions: scenario.videoOptions } : {}),
      ...(scenario.imageContext ? { imageContext: scenario.imageContext } : {}),
      ...(scenario.stream ? { imageOptions: { imageStream: true } } : {}) })
    if (scenario.stream) {
      assert.equal(response.statusCode, 200)
      const event = JSON.parse(response.payload.trim().slice('data: '.length))
      assert.equal(event.type, 'error')
      assert.equal(event.statusCode, 400)
      assert.equal(event.notAccepted, true)
    } else {
      assert.equal(response.statusCode, 400, response.payload)
      assert.equal(response.json().notAccepted, true)
    }
    assert.match(response.payload, /当前模型(?:不支持|最多支持)/)
    assert.equal(mediaReads, 0)
    assert.equal(f.calls.length, 0)
    assert.equal(f.credentialCalls.length, 0)
    assert.equal(f.values.size, 0)
  })
  const image = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()).toString('base64')}`
  for (const [name, imageSetting, apiFormat, historyCount] of [
    ['default-history', {}, 'chat-completions', 16],
    ['native-deduplicated-history', { maxReferenceImages: 1 }, 'gemini', 1],
    ['zero-images-without-reference', { maxReferenceImages: 0 }, 'chat-completions', 0],
  ]) await t.test(name, async t => {
    const model = 'gemini-3.1-flash-image-preview'
    const f = fixture(t, { modelTypes: [{ id: model, kind: 'image', apiFormat, image: imageSetting }], fetch(_url, init) {
      const payload = JSON.parse(init.body)
      if (name === 'default-history') assert.equal(payload.messages.reduce((count, message) => count
        + (Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url').length : 0), 0), 17)
      return apiFormat === 'gemini'
        ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AQ==' } }] }, finishReason: 'STOP' }] })
        : Response.json({ choices: [{ message: { content: '![Image](https://media.example/result.png)' } }] })
    } })
    const input = { kind: 'image', model, apiFormat, prompt: 'Waves', requestId: name,
      ...(historyCount ? { referenceUrls: [image], imageContext: { turns: [{ prompt: 'Previous', images: Array(historyCount).fill(image) }] } } : {}) }
    const response = await submit(f.app, input)
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().status, 'succeeded')
    assert.equal((await submit(f.app, input)).statusCode, 200)
    assert.equal(f.calls.length, 1)
  })
})

test('custom video reference aliases cannot bypass configured zero reference limits', async t => {
  const image = 'data:image/png;base64,AQ=='
  const f = fixture(t, { modelTypes: [{ id: 'ordinary-video', kind: 'video', video: {
    maxReferenceImages: 0, maxReferenceVideos: 0, maxReferenceAudios: 0,
  } }] })
  for (const [index, custom] of [
    { images: [image] }, { input_reference: { file_id: 'untracked-file' } },
    { metadata: { content: [{ type: 'image_url', image_url: { url: image } }] } },
    { metadata: { first_frame: { url: image } } }, { metadata: { last_frame: { url: image } } },
    { metadata: { first_frame_image: image } }, { metadata: { last_frame_image: image } },
    { metadata: { reference_images: [{ url: image }] } }, { metadata: { keyframes: [{ url: image }] } },
    { metadata: JSON.stringify({ images: [image] }) }, { metadata: JSON.stringify({ first_frame_image: image }) },
    { metadata: { 'input_videos[]': ['data:video/mp4;base64,AQ=='] } },
    { metadata: { input_audios: ['data:audio/wav;base64,AQ=='] } },
  ].entries()) {
    const response = await submit(f.app, { kind: 'video', model: 'ordinary-video', prompt: 'Waves', requestId: `custom-reference-${index}`,
      videoOptions: { mode: 'text-to-video', customParameters: JSON.stringify(custom) } })
    assert.equal(response.statusCode, 400, response.payload)
    assert.equal(response.json().notAccepted, true)
    assert.match(response.json().error.message, /参考素材.*上传控件/)
  }
  assert.equal(f.calls.length, 0)
  assert.equal(f.credentialCalls.length, 0)
  assert.equal(f.values.size, 0)
})

test('upstream read throttling preserves Retry-After for HTTP 429 and 503 without replaying requests', async t => {
  for (const status of [429, 503]) for (const retryAfter of ['7', 'Sun, 22 Nov 2026 12:00:00 GMT', undefined]) {
    const { app, calls } = fixture(t, { fetch(_url, init) {
      assert.notEqual(init.method, 'POST')
      return Response.json({ error: { code: 'rate_limited' } }, {
        status, headers: retryAfter ? { 'Retry-After': retryAfter } : {},
      })
    } })
    for (const url of ['/api/creation/tasks/image/rate-limited?protocol=async&tokenId=71', '/api/creation/models']) {
      const response = await app.inject(url)
      assert.equal(response.statusCode, status === 429 ? 429 : 502)
      assert.equal(response.headers['retry-after'], retryAfter)
    }
    assert.equal(calls.length, 2)
  }
})

test('concurrent and repeated paid submissions send one upstream POST, and request IDs cannot be reused for different content', async t => {
  const started = deferred()
  const completed = deferred()
  t.after(() => completed.resolve(Response.json({ data: [{ url: 'https://media.example/result.png' }] })))
  const { app, calls } = fixture(t, { fetch(_url, init) {
    assert.equal(init.method, 'POST')
    started.resolve()
    return completed.promise
  } })
  const first = submit(app).then(response => response)
  await started.promise
  const inProgress = await submit(app)
  assert.equal(inProgress.statusCode, 200)
  assert.equal(inProgress.json().status, 'pending')
  assert.equal(calls.length, 1)
  assert.match(calls[0].init.headers.get('Idempotency-Key'), /^[a-f0-9]{64}$/)
  assert.equal(calls[0].init.headers.get('cookie'), null)
  completed.resolve(Response.json({ data: [{ url: 'https://media.example/result.png' }] }))
  const result = await first
  assert.equal(result.json().status, 'succeeded')
  assert.deepEqual((await submit(app)).json(), result.json())
  const changed = await submit(app, { ...imageRequest, prompt: 'A different paid request' })
  assert.equal(changed.statusCode, 409)
  assert.equal(changed.json().notAccepted, false)
  assert.equal(calls.length, 1)
})

for (const [scenario, fetch, expected] of [
  ['empty-result', () => Response.json({ data: [] }), '生成服务未返回可读取的生成结果。'],
  ['invalid-response', () => new Response('invalid JSON'), '创作服务返回了无法识别的响应。'],
  ['submission-timeout', () => { throw new DOMException('Submission timed out', 'TimeoutError') }, '等待生成服务响应超时。'],
  ['connection-error', () => { throw new TypeError(`fetch failed with ${apiKey}`) }, '生成服务连接异常，未能获取生成结果。'],
  ['response-read-error', () => new Response(new ReadableStream({ start(controller) {
    controller.error(new Error(`response interrupted with ${apiKey}`))
  } })), '读取生成结果失败。'],
]) {
  test(`${scenario} returns a concrete error without asking users to investigate or resubmitting`, async t => {
    const { app, calls } = fixture(t, { fetch })
    const response = await submit(app)
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().status, 'indeterminate')
    const stage = ['submission-timeout', 'connection-error'].includes(scenario) ? '网关提交' : '网关响应处理'
    assert.equal(response.json().errorStage, stage)
    assert.equal(response.json().error, `${stage}失败${stage === '网关响应处理' ? '（HTTP 200）' : ''}：${expected}`)
    assert.doesNotMatch(response.payload, /核对|联系管理员|尚无法确认/)
    assert(!response.payload.includes(apiKey))
    assert.deepEqual((await app.inject('/api/creation/requests/request-1')).json(), response.json())
    assert.deepEqual((await submit(app)).json(), response.json())
    assert.equal(calls.length, 1)
  })
}

test('submission failures identify their boundary and retain HTTP errors even without a JSON body', async t => {
  for (const [scenario, options, expectedStage, expectedStatus, paidCalls] of [
    ['models', { modelReadError: new Error('database details must stay private') }, '模型配置读取', 500, 0],
    ['references', { publicMedia() { throw httpError(404, '参考图片不存在。') } }, '参考素材准备', 404, 0],
    ['credentials', { credentials() { throw new NewApiError('Group key changed', 409, 'NEW_API_GROUP_TOKEN_UNAVAILABLE') } }, '网关凭证准备', 409, 0],
    ['tracking', { beforeRedisSet() { throw new Error('Redis unavailable') } }, '任务登记', 500, 0],
    ['gateway-http', { fetch() { return new Response('<html>Bad Gateway</html>', { status: 504 }) } }, '网关提交', 504, 1],
    ['gateway-read', { fetch() { return new Response('invalid JSON') } }, '网关响应处理', 200, 1],
    ['save-failed', { fetch() { return Response.json({ id: 'saved-job', status: 'save_failed', error: { code: 'insufficient_disk_space' } }) } }, '结果保存', undefined, 1],
  ]) await t.test(scenario, async t => {
    const { app, calls } = fixture(t, options)
    const response = await submit(app, { ...imageRequest, ...(scenario === 'references' ? { referenceUrls: ['https://media.example/missing.png'] } : {}) })
    const data = response.json()
    assert.equal(data.errorStage, expectedStage)
    assert.equal(data.errorStatus, expectedStatus)
    assert.match(typeof data.error === 'string' ? data.error : data.error.message, new RegExp(expectedStage))
    assert.equal(calls.length, paidCalls)
    assert(!response.payload.includes('database details must stay private'))
    if (scenario === 'gateway-http') assert.match(data.error, /HTTP 504/)
    if (!paidCalls && scenario !== 'tracking') assert.equal(data.notAccepted, true)
    if (paidCalls) {
      assert.equal(data.notAccepted, undefined)
      assert.deepEqual((await app.inject('/api/creation/requests/request-1')).json(), data)
      await submit(app)
      assert.equal(calls.length, 1)
    }
  })
})

test('result persistence errors after a paid submission are not reported as unaccepted registration errors', async t => {
  const { app, calls } = fixture(t, {
    beforeRedisSet(key, _value, flags) { if (key.includes(':creation:request:') && !flags.includes('NX')) throw new Error('Result storage unavailable') },
    fetch() { return Response.json({ data: [{ url: 'https://media.example/result.png' }] }) },
  })
  const response = await submit(app)
  assert.equal(response.statusCode, 500)
  assert.equal(response.json().errorStage, '结果保存')
  assert.equal(response.json().notAccepted, false)
  assert.equal(calls.length, 1)
  await submit(app)
  assert.equal(calls.length, 1)
})

test('cached legacy errors use the current failure message without replaying generation', async t => {
  const { app, values, calls } = fixture(t, { fetch: () => Response.json({ data: [] }) })
  await submit(app)
  const [key, raw] = [...values].find(([key]) => key.includes(':creation:request:'))
  const cached = JSON.parse(raw)
  cached.result.error = '请求已提交，结果尚无法确认。请保留记录并核对使用记录，勿重复生成。'
  values.set(key, JSON.stringify(cached))
  const response = await app.inject('/api/creation/requests/request-1')
  assert.equal(response.json().error, '获取生成结果失败。')
  assert.equal(response.json().status, 'indeterminate')
  assert.equal(calls.length, 1)
})

test('video admission rejection explains unsubmitted tasks and never replays their POST', async t => {
  for (const [code, status, phrase] of [
    ['video_storage_capacity_reached', 503, '缓存'],
    ['insufficient_disk_space', 503, '磁盘'],
    ['video_queue_full', 429, '队列'],
  ]) {
    const { app, calls } = fixture(t, { fetch() { return Response.json({ detail: code }, { status }) } })
    const input = { kind: 'video', model: 'sora-2', protocol: 'async', prompt: 'Video', duration: 8, requestId: code }
    const first = await submit(app, input)
    assert.equal(first.statusCode, 200, first.payload)
    assert.equal(first.json().status, 'failed')
    assert.match(first.json().error, new RegExp(phrase))
    assert.match(first.json().error, /未提交至模型/)
    assert.deepEqual((await submit(app, input)).json(), first.json())
    assert.equal(calls.length, 1)
  }
})

test('unknown, malformed, and non-queue 503 responses keep the paid outcome uncertain', async t => {
  for (const [detail, protocol] of [
    ['video_storage_capacity_reached', 'sync'],
    ['unrecognized_' + apiKey, 'async'],
    [{ error: apiKey }, 'async'],
    [['video_storage_capacity_reached'], 'async'],
    ['__proto__', 'async'],
  ]) {
    const { app, calls } = fixture(t, { fetch() { return Response.json({ detail }, { status: 503 }) } })
    const input = { kind: 'video', model: 'sora-2', protocol, prompt: 'Video', duration: 8, requestId: 'uncertain-video' }
    const first = await submit(app, input)
    assert.equal(first.statusCode, 200, first.payload)
    assert.equal(first.json().status, 'indeterminate')
    assert.match(first.json().error, /503/)
    assert(!first.payload.includes(apiKey))
    assert.deepEqual((await submit(app, input)).json(), first.json())
    assert.equal(calls.length, 1)
  }
})

for (const scenario of ['server-error', 'submission-timeout']) {
  test(`${scenario} stays indeterminate and a retry never replays the paid POST`, async t => {
    const { app, calls } = fixture(t, { fetch() {
      if (scenario === 'submission-timeout') throw new DOMException('Submission timed out', 'TimeoutError')
      return Response.json({ error: { message: `Upstream failure with ${apiKey}` } }, { status: 503 })
    } })
    const first = await submit(app)
    assert.equal(first.statusCode, 200)
    assert.equal(first.json().status, 'indeterminate')
    assert(!first.payload.includes(apiKey), 'upstream credentials must never reach the browser')
    assert.deepEqual((await submit(app)).json(), first.json())
    assert.equal(calls.length, 1)
  })
}

test('video submissions wait up to six minutes and never replay the paid request after a timeout', async t => {
  let elapsed = 0
  t.mock.method(AbortSignal, 'timeout', duration => duration > elapsed
    ? new AbortController().signal : AbortSignal.abort(new DOMException('Submission timed out', 'TimeoutError')))
  for (const [duration, status] of [[359999, 'pending'], [360001, 'indeterminate']]) {
    elapsed = duration
    const { app, calls } = fixture(t, { fetch(_url, init) {
      init.signal.throwIfAborted()
      return Response.json({ id: 'slow-video', status: 'queued' })
    } })
    const input = { kind: 'video', model: 'sora-2', prompt: 'A slow video', duration: 8, requestId: 'slow-video' }
    const response = await submit(app, input)
    assert.equal(response.json().status, status)
    if (status === 'pending') assert.equal(response.json().upstreamId, 'slow-video')
    assert.deepEqual((await submit(app, input)).json(), response.json())
    assert.equal(calls.length, 1)
  }
})

test('task and protected video recovery retain the original token and account ownership', async t => {
  let selectedToken = 71
  const { app, calls, credentialCalls } = fixture(t, {
    selectedToken: () => selectedToken,
    fetch(url, init) {
      const pathname = new URL(String(url)).pathname
      if (init.method === 'POST') return Response.json({ id: 'job_1', status: 'queued', user_id: 17 })
      if (pathname === '/v1/videos/job_1') return Response.json({ id: 'job_1', status: 'completed', user_id: 17 })
      assert.equal(pathname, '/v1/videos/job_1/content')
      assert.equal(init.headers.get('range'), 'bytes=0-2')
      return new Response('vid', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/12' } })
    },
  })
  const created = await submit(app, { kind: 'video', model: 'sora-2', prompt: 'Video', duration: 8, requestId: 'video-1' })
  assert.equal(created.json().tokenId, 71)
  selectedToken = 99
  const recovered = await app.inject({ url: '/api/creation/tasks/video/job_1?protocol=openai' })
  assert.equal(recovered.json().status, 'succeeded')
  assert.equal(recovered.json().mediaPath, 'videos/job_1/content')
  assert.equal(credentialCalls.at(-1).tokenId, 71)
  const beforeRejectedReads = calls.length
  for (const url of ['/api/creation/tasks/video/job_1?protocol=openai&tokenId=99',
    '/api/creation/media?path=videos/job_1/content&tokenId=99']) {
    assert.equal((await app.inject({ url })).statusCode, 403)
  }
  for (const url of ['/api/creation/tasks/video/job_1?protocol=openai',
    '/api/creation/media?path=videos/job_1/content']) {
    assert.equal((await app.inject({ url, headers: { 'x-test-account': '18' } })).statusCode, 409)
  }
  assert.equal(calls.length, beforeRejectedReads, 'foreign account or mismatched token must fail before upstream access')
  const media = await app.inject({ url: '/api/creation/media?path=videos/job_1/content&tokenId=71', headers: { range: 'bytes=0-2' } })
  assert.equal(media.statusCode, 206)
  assert.equal(media.payload, 'vid')
  assert.equal(media.headers['content-range'], 'bytes 0-2/12')
  assert.equal(media.headers['content-length'], '3')
  assert.equal(credentialCalls.at(-1).tokenId, 71)
})

test('public video replies preserve length and range through the HTTP response adapter', async t => {
  const cases = [
    { status: 200, headers: { 'content-length': '5' }, body: 'video' },
    { status: 206, headers: { 'content-length': '3', 'content-range': 'bytes 2-4/5' }, body: 'deo' },
    { status: 416, headers: { 'content-length': '0', 'content-range': 'bytes */5' }, body: null },
  ]
  for (const upstream of cases) {
    const { app } = fixture(t, { async publicMedia(_url, kind, _limit, _signal, ranges) {
      assert.equal(kind, 'video')
      assert.deepEqual(Object.fromEntries(ranges), { 'if-range': '"v1"', range: 'bytes=2-' })
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', ...upstream.headers } })
    } })
    const response = await app.inject({ url: '/api/creation/media?kind=video&url=https%3A%2F%2Fmedia.example%2Fvideo.mp4',
      headers: { range: 'bytes=2-', 'if-range': '"v1"', cookie: 'private=value', authorization: 'Bearer private' } })
    assert.equal(response.statusCode, upstream.status)
    assert.equal(response.headers['content-length'], upstream.headers['content-length'])
    assert.equal(response.headers['content-range'], upstream.headers['content-range'])
    assert.equal(response.headers['cache-control'], 'private, no-store')
    assert.equal(response.payload, upstream.body || '')
  }
})

test('protected videos and their redirects retain ranges without leaking account credentials', async t => {
  for (const status of [200, 206, 302, 416]) {
    let cancelled = false, redirected = false
    const { app } = fixture(t, {
      async fetch(_url, init) {
        if (init.method === 'POST') return Response.json({ id: 'range_job', status: 'completed', user_id: 17 })
        assert.equal(init.headers.get('range'), 'bytes=-3')
        assert.equal(init.headers.get('if-range'), '"v1"')
        assert.equal(init.headers.get('accept-encoding'), 'identity')
        if (status === 302 || status === 416) return new Response(new ReadableStream({ cancel() { cancelled = true } }), {
          status, headers: status === 302 ? { location: 'https://cdn.example/video' } : { 'content-type': 'text/html', 'content-range': 'bytes */5' },
        })
        return new Response(status === 200 ? 'video' : 'deo', { status, headers: { 'content-type': 'video/mp4',
          ...(status === 200 ? { 'content-length': '5' } : { 'content-range': 'bytes 2-4/5' }) } })
      },
      async publicMedia(url, kind, _limit, _signal, ranges) {
        redirected = true
        assert.equal(url, 'https://cdn.example/video')
        assert.equal(kind, 'video')
        assert.deepEqual(Object.fromEntries(ranges), { 'if-range': '"v1"', range: 'bytes=-3' })
        return new Response('deo', { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '3', 'content-range': 'bytes 2-4/5' } })
      },
    })
    await submit(app, { kind: 'video', model: 'sora-2', prompt: 'Video', duration: 8, requestId: 'range-video' })
    const response = await app.inject({ url: '/api/creation/media?path=videos/range_job/content&tokenId=71', headers: { range: 'bytes=-3', 'if-range': '"v1"' } })
    assert.equal(response.statusCode, status === 302 ? 206 : status)
    assert.equal(response.headers['content-length'], status === 416 ? '0' : status === 200 ? '5' : '3')
    assert.equal(response.payload, status === 416 ? '' : status === 200 ? 'video' : 'deo')
    assert.equal(redirected, status === 302)
    assert.equal(cancelled, status === 302 || status === 416)
  }
})

test('poster extraction ignores incoming video ranges on public and protected sources', async t => {
  let publicReads = 0, protectedReads = 0
  const { app } = fixture(t, {
    async publicMedia(_url, _kind, _limit, _signal, ranges) {
      publicReads++
      assert.equal(ranges?.get('range'), undefined)
      throw httpError(502, 'fixture media unavailable')
    },
    async fetch(_url, init) {
      if (init.method === 'POST') return Response.json({ id: 'poster_range_job', status: 'completed', user_id: 17 })
      protectedReads++
      assert.equal(init.headers.get('range'), null)
      assert.equal(init.headers.get('if-range'), null)
      assert.equal(init.headers.get('accept-encoding'), 'identity')
      return new Response(null, { status: 404 })
    },
  })
  await submit(app, { kind: 'video', model: 'sora-2', prompt: 'Video', duration: 8, requestId: 'poster-range' })
  for (const source of ['url=https%3A%2F%2Fmedia.example%2Fposter-range.mp4', 'path=videos/poster_range_job/content&tokenId=71']) {
    const response = await app.inject({ url: '/api/creation/media?kind=video&variant=poster&' + source,
      headers: { range: 'not-a-byte-range', 'if-range': '"v1"' } })
    assert.ok([404, 502].includes(response.statusCode))
  }
  assert.equal(publicReads, 1)
  assert.equal(protectedReads, 1)
})

for (const failedMapping of ['task', 'media']) {
  test(`${failedMapping} metadata write failure preserves the accepted result and cached recovery repairs ownership without another POST`, async t => {
    let failed = false, selectedToken = 71
    const { app, values, calls, credentialCalls } = fixture(t, {
      selectedToken: () => selectedToken,
      beforeRedisSet(key) {
        if (!failed && key.includes(`community-next:creation:${failedMapping}:`)) {
          failed = true
          throw new Error('Injected metadata storage failure')
        }
      },
      fetch(url, init) {
        if (init.method === 'POST') return Response.json({
          id: 'paid_job', status: failedMapping === 'task' ? 'queued' : 'completed', user_id: 17,
        })
        const pathname = new URL(String(url)).pathname
        if (pathname === '/v1/videos/paid_job') return Response.json({ id: 'paid_job', status: 'completed', user_id: 17 })
        assert.equal(pathname, '/v1/videos/paid_job/content')
        return new Response('video', { headers: { 'content-type': 'video/mp4' } })
      },
    })
    const input = { kind: 'video', model: 'sora-2', prompt: 'A paid video', duration: 8, requestId: `metadata-${failedMapping}` }
    const created = await submit(app, input)
    assert.equal(failed, true)
    assert.equal(created.statusCode, 200)
    assert.equal(created.json().status, failedMapping === 'task' ? 'pending' : 'succeeded')
    assert.equal(created.json().upstreamId, 'paid_job')
    assert.equal(created.json().tokenId, 71)
    if (failedMapping === 'media') assert.equal(created.json().mediaPath, 'videos/paid_job/content')
    assert(!created.payload.includes(apiKey))
    selectedToken = 99
    const clearOwnership = () => {
      for (const key of values.keys()) if (/community-next:creation:(?:task|media):/.test(key)) values.delete(key)
    }
    const assertOwnership = () => {
      const saved = [...values].filter(([key]) => /community-next:creation:(?:task|media):/.test(key))
      assert.equal(saved.length, failedMapping === 'task' ? 1 : 2)
      assert(saved.every(([, value]) => JSON.parse(value).tokenId === 71))
    }
    clearOwnership()
    const recovered = await app.inject(`/api/creation/requests/${input.requestId}`)
    assert.equal(recovered.statusCode, 200)
    assert.deepEqual(recovered.json(), created.json())
    assertOwnership()
    clearOwnership()
    assert.deepEqual((await submit(app, input)).json(), created.json())
    assertOwnership()
    const resolved = await app.inject('/api/creation/tasks/video/paid_job?protocol=openai')
    assert.equal(resolved.statusCode, 200)
    assert.equal(resolved.json().status, 'succeeded')
    assert.equal(credentialCalls.at(-1).tokenId, 71)
    const media = await app.inject('/api/creation/media?path=videos/paid_job/content')
    assert.equal(media.statusCode, 200)
    assert.equal(media.payload, 'video')
    assert.equal(credentialCalls.at(-1).tokenId, 71)
    assert.equal((await app.inject({ url: `/api/creation/requests/${input.requestId}`, headers: { 'x-test-account': '18' } })).statusCode, 404)
    assert.equal(calls.filter(call => call.init.method === 'POST').length, 1)
  })
}

test('server model types apply to exact IDs across group catalogs without granting access to other models', async t => {
  let token = 71
  const video = { autoResolution: '480p', resolutions: ['480p', '720p'] }
  const { app } = fixture(t, {
    selectedToken: () => token,
    modelTypes: [{ id: 'custom/alias', kind: 'image' }, { id: 'tts-custom', kind: 'video', video }, { id: 'not-in-group', kind: 'video', video }],
    fetch() { return Response.json({ data: token === 71 ? ['custom/alias', 'gpt-5', 'whisper-1', 'tts-custom'] : ['custom/alias', 'CUSTOM/alias'] }) },
  })
  const first = await app.inject('/api/creation/models')
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json().items.map(({ id, kinds, configuredKind }) => ({ id, kinds, configuredKind })), [
    { id: 'custom/alias', kinds: ['image'], configuredKind: 'image' },
    { id: 'gpt-5', kinds: ['text'], configuredKind: undefined },
    { id: 'tts-custom', kinds: ['video'], configuredKind: 'video' },
  ])
  assert.deepEqual(first.json().items.find(item => item.id === 'tts-custom').video, video)
  assert(first.json().items.filter(item => item.id !== 'tts-custom').every(item => !Object.hasOwn(item, 'video')))
  token = 99
  const second = (await app.inject('/api/creation/models')).json()
  assert.equal(second.tokenId, 99)
  assert.deepEqual(second.items.map(item => [item.id, item.kinds[0], item.configuredKind]), [
    ['custom/alias', 'image', 'image'], ['CUSTOM/alias', 'text', undefined],
  ])
  assert(second.items.every(item => !Object.hasOwn(item, 'video')))
})

test('model catalogs publish server video defaults and validated overrides without trusting upstream metadata', async t => {
  for (const { id, video, resolutions } of [
    { id: 'wan3.0', resolutions: ['720p', '1080p'] },
    { id: 'wan3.0', video: { autoResolution: '720p', headers: { authorization: 'must-not-forward' } }, resolutions: ['720p', '1080p'] },
    { id: 'MiniMax H3视频生成', resolutions: ['768p', '1080p'] },
    { id: 'MiniMax H3视频生成', video: { resolutions: ['540p'], durations: [4, 8, 12] }, resolutions: ['540p'] },
    { id: 'sd2.0-fast-720p', resolutions: ['720p'] },
    { id: '火山2.0 Fast官转', resolutions: ['720p', '1080p', '2k'] },
    { id: '火山2.0 Mini官转', resolutions: ['720p', '1080p', '2k'] },
    { id: '火山2.5官转', resolutions: ['720p', '1080p', '2k'] },
    { id: 'DMC 视频超分', resolutions: ['720p', '1080p', '2k', '4k'] },
  ]) {
    const { app } = fixture(t, {
      modelTypes: video ? [{ id, kind: 'video', video }] : [],
      fetch() { return Response.json({ data: [{ id, video: { autoResolution: '4k', secret: 'must-not-forward' } }] }) },
    })
    const response = await app.inject('/api/creation/models')
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().items.length, 1)
    const item = response.json().items[0]
    assert.deepEqual(item.kinds, ['video'])
    assert.equal(videoModelSettingSchema.safeParse(item.video).success, true)
    assert.deepEqual(item.video.resolutions, resolutions)
    if (id === 'MiniMax H3视频生成') assert.equal(item.video.autoDuration, video ? 4 : 10)
    assert(!response.payload.includes('must-not-forward'))
  }
})

test('unrecorded historical task recovery is GET-only and rejects an upstream owner mismatch', async t => {
  const { app, calls } = fixture(t, { fetch(_url, init) {
    assert.equal(init.method, undefined)
    return Response.json({ id: 'foreign_job', status: 'completed', user_id: 18, video_url: 'https://media.example/foreign.mp4' })
  } })
  const missingToken = await app.inject({ url: '/api/creation/tasks/video/foreign_job?protocol=legacy' })
  assert.equal(missingToken.statusCode, 409)
  assert.equal(calls.length, 0)
  const forbidden = await app.inject({ url: '/api/creation/tasks/video/foreign_job?protocol=legacy&tokenId=71' })
  assert.equal(forbidden.statusCode, 403)
  assert.equal(calls.length, 1)
})

test('unrecorded tasks without an explicit upstream owner cannot recover or register artifacts', async t => {
  const { app, calls, values } = fixture(t, { fetch() {
    return Response.json({ id: 'unowned_job', status: 'COMPLETED', video_url: 'https://media.example/private.mp4' })
  } })
  for (const protocol of ['legacy', 'plugin', 'gemini']) {
    const id = protocol === 'gemini' ? 'models/veo/operations/unowned_job' : 'unowned_job'
    const result = await app.inject(`/api/creation/tasks/video/${encodeURIComponent(id)}?protocol=${protocol}&tokenId=71`)
    assert.equal(result.statusCode, 403)
    assert.match(result.json().error.message, /归属/)
  }
  assert.equal(calls.length, 3)
  assert.equal(values.size, 0)
})

test('recorded tasks remain readable when upstream omits the owner field', async t => {
  const { app, values } = fixture(t, { fetch(_url, init) {
    return Response.json({ id: 'tracked_job', status: init.method === 'POST' ? 'queued' : 'completed' })
  } })
  const created = await submit(app, { kind: 'video', model: 'sora-2', prompt: 'Test', duration: 8, requestId: 'tracked-request' })
  assert.equal(created.statusCode, 200)
  assert([...values.keys()].some(key => key.includes(':task:')))
  const recovered = await app.inject('/api/creation/tasks/video/tracked_job?protocol=openai')
  assert.equal(recovered.statusCode, 200)
  assert.equal(recovered.json().status, 'succeeded')
})

test('historical plugin and Gemini tasks recover their artifacts through the original read-only protocols', async t => {
  const { app, calls } = fixture(t, { fetch(url, init) {
    assert.equal(init.method, undefined)
    const pathname = new URL(String(url)).pathname
    if (pathname === '/v1/tasks/plugin_job') return Response.json({ status: 'COMPLETED', user_id: 17 })
    if (pathname === '/v1/tasks/plugin_job/artifacts') return Response.json({ artifacts: [{ type: 'video', key: 'result.mp4' }] })
    assert.equal(pathname, '/v1beta/models/veo/operations/job_1')
    return Response.json({ name: 'models/veo/operations/job_1', done: true, user_id: 17,
      response: { generatedVideos: [{ video: { uri: 'https://media.example/v1beta/files/file_1' } }] } })
  } })
  const plugin = await app.inject({ url: '/api/creation/tasks/video/plugin_job?protocol=plugin&tokenId=71' })
  assert.equal(plugin.json().status, 'succeeded')
  assert.equal(plugin.json().mediaPath, 'tasks/plugin_job/artifacts/result.mp4/content')
  const gemini = await app.inject({
    url: `/api/creation/tasks/video/${encodeURIComponent('models/veo/operations/job_1')}?protocol=gemini&tokenId=71`,
  })
  assert.equal(gemini.json().status, 'succeeded')
  assert.equal(gemini.json().mediaPath, 'v1beta/files/file_1:download?alt=media')
  assert.deepEqual(calls.map(call => call.path), [
    '/v1/tasks/plugin_job', '/v1/tasks/plugin_job/artifacts', '/v1beta/models/veo/operations/job_1',
  ])
})

test('media and references reject private destinations and unregistered protected paths before any paid request', async t => {
  const { app, calls, credentialCalls } = fixture(t)
  for (const source of ['http://127.0.0.1/private.png', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/private.png', 'http://localhost/private.png', 'file:///private.png',
    'https://user:password@media.example/private.png']) {
    const response = await app.inject({ url: `/api/creation/media?url=${encodeURIComponent(source)}` })
    assert.equal(response.statusCode, 400, source)
  }
  for (const pathname of ['v1/videos/../content', 'api/user/self', 'videos/job_1/content?url=http://127.0.0.1']) {
    assert.equal((await app.inject({ url: `/api/creation/media?path=${encodeURIComponent(pathname)}` })).statusCode, 400)
  }
  assert.equal((await app.inject({ url: '/api/creation/media?path=videos/job_1/content' })).statusCode, 409)
  const invalidReference = await submit(app, { ...imageRequest, referenceUrls: ['http://127.0.0.1/reference.png'] })
  assert.equal(invalidReference.statusCode, 400)
  assert.equal(calls.length, 0)
  assert.equal(credentialCalls.length, 0)
})

test('model catalogs identify their selected group token and paid submissions pin the catalog token', async t => {
  let currentToken = 71
  const { app, credentialCalls } = fixture(t, {
    selectedToken: () => currentToken,
    fetch(_url, init) {
      return Response.json(init.method === 'POST' ? { data: [{ url: 'https://media.example/result.png' }] }
        : { data: [{ id: 'gpt-image-2', name: '图像模型', description: '账号模型说明', owned_by: 'OpenAI', secret: 'must-not-forward' }] })
    },
  })
  const catalog = await app.inject({ url: '/api/creation/models' })
  assert.equal(catalog.json().tokenId, 71)
  assert.deepEqual(catalog.json().items, [{ id: 'gpt-image-2', name: '图像模型', description: '账号模型说明', provider: 'OpenAI', kinds: ['image'], protocol: 'openai' }])
  currentToken = 99
  const generated = await submit(app, imageRequest, { 'x-new-api-token': String(catalog.json().tokenId) })
  assert.equal(generated.json().status, 'succeeded')
  assert.equal(generated.json().tokenId, 71)
  assert.equal(credentialCalls.at(-1).tokenId, 71)
})

test('Gemini conversation history and references share safe media preparation without forwarding raw remote URLs', async t => {
  const reads = []
  const reference = 'https://media.example/previous.png'
  const { app, calls } = fixture(t, {
    publicMedia(url, kind, maximum) {
      reads.push({ url, kind, maximum })
      return new Response('image', { headers: { 'content-type': 'image/png' } })
    },
    fetch(_url, init) {
      const body = JSON.parse(init.body)
      assert.equal(body.messages.length, 3)
      assert.equal(body.messages[0].content[0].text, '一只猫')
      assert.equal(body.messages[0].content[1].image_url.url, `data:${'image/png'};base64,${Buffer.from('image').toString('base64')}`)
      assert.equal(body.messages[1].content[0].image_url.url, 'data:image/png;base64,aW1hZ2U=')
      assert.equal(body.messages[2].content[1].image_url.url, 'data:image/png;base64,aW1hZ2U=')
      assert.equal(body.messages[2].content[0].text, '背景换蓝色')
      return Response.json({ choices: [{ message: { content: '![Image](https://media.example/result.png)' } }] })
    },
  })
  const input = { ...imageRequest, model: 'gemini-3.1-flash-image-preview', prompt: '背景换蓝色', referenceUrls: [reference],
    imageContext: { turns: [{ prompt: '一只猫', images: [reference], references: [reference] }] } }
  const generated = await submit(app, input)
  assert.equal(generated.json().status, 'succeeded')
  assert.equal(reads.length, 1, 'history and current references reuse the same downloaded bytes')
  assert.equal(reads[0].maximum, 20 * 1024 ** 2)
  assert.equal(calls.length, 1)
  const repeated = await submit(app, input)
  assert.deepEqual(repeated.json(), generated.json())
  assert.equal(calls.length, 1, 'retry retrieves the immutable submitted request')
  assert.equal(reads.length, 1)
})

test('Gemini history media shares the 24 MiB reference budget and fails before a paid POST', async t => {
  const { app, calls } = fixture(t, {
    publicMedia() { return new Response(new Uint8Array(13 * 1024 ** 2), { headers: { 'content-type': 'image/png' } }) },
  })
  const response = await submit(app, { ...imageRequest, model: 'gemini-3.1-flash-image-preview',
    referenceUrls: ['https://media.example/current.png'],
    imageContext: { turns: [{ prompt: '前一张图', images: ['https://media.example/previous.png'] }] } })
  assert.equal(response.statusCode, 413)
  assert.equal(calls.length, 0)
})

test('same-origin image proxies unwrap only the image URL through the safe media service', async t => {
  const reads = []
  const { app, calls } = fixture(t, {
    publicMedia(url) { reads.push(url); return new Response('image', { headers: { 'content-type': 'image/png' } }) },
    fetch() { return Response.json({ data: [{ url: 'https://media.example/result.png' }] }) },
  })
  const proxy = '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fprevious.png&kind=image'
  assert.equal((await submit(app, { ...imageRequest, referenceUrls: [proxy] })).json().status, 'succeeded')
  assert.deepEqual(reads, ['https://media.example/previous.png'])
  for (const source of [
    '/api/creation/media?path=videos/private/content',
    '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Ffile.png&kind=video',
    '/api/creation/media?url=file%3A%2F%2Fprivate',
    '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Ffile.png&tokenId=99',
  ]) {
    assert.equal((await submit(app, { ...imageRequest, requestId: 'invalid-proxy', referenceUrls: [source] })).statusCode, 400)
  }
  assert.equal(calls.length, 1)
})

test('private and unauthorized local history media never reach a Gemini paid request', async t => {
  const { app, calls } = fixture(t)
  for (const source of ['http://127.0.0.1/private.png', '/legacy-files/otheraccount']) {
    const response = await submit(app, { ...imageRequest, model: 'gemini-3.1-flash-image-preview',
      imageContext: { turns: [{ prompt: '原图', images: [source] }] } })
    assert.equal(response.statusCode, 400)
  }
  assert.equal(calls.length, 0)
})

test('Gemini image chat streaming keeps final results recoverable and never replays the paid request', async t => {
  const { app, calls } = fixture(t, { fetch(_url, init) {
    assert.equal(JSON.parse(init.body).stream, true)
    const event = { choices: [{ delta: { content: '![Image](https://media.example/stream.png)' }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  const input = { ...imageRequest, requestId: 'gemini-stream', model: 'gemini-3.1-flash-image-preview', imageOptions: { imageStream: true } }
  const response = await submit(app, input)
  assert.match(response.payload, /"type":"preview"/)
  assert.match(response.payload, /"status":"succeeded"/)
  const recovered = await app.inject('/api/creation/requests/gemini-stream')
  assert.deepEqual(recovered.json().outputs, [{ url: 'https://media.example/stream.png' }])
  await submit(app, input)
  assert.equal(calls.length, 1)
})

test('streaming preflight rejections explicitly report that no paid task was accepted', async t => {
  const { app, calls } = fixture(t, {
    publicMedia() { return new Response(new Uint8Array(13 * 1024 ** 2), { headers: { 'content-type': 'image/png' } }) },
  })
  const response = await submit(app, { ...imageRequest, requestId: 'stream-not-accepted',
    model: 'gemini-3.1-flash-image-preview', imageOptions: { imageStream: true },
    referenceUrls: ['https://media.example/current.png'],
    imageContext: { turns: [{ prompt: '前一张图', images: ['https://media.example/previous.png'] }] } })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /text\/event-stream/)
  const event = JSON.parse(response.payload.trim().slice('data: '.length))
  assert.equal(event.type, 'error')
  assert.equal(event.statusCode, 413)
  assert.equal(event.notAccepted, true)
  assert.equal(calls.length, 0)
  assert.equal((await app.inject('/api/creation/requests/stream-not-accepted')).statusCode, 404)
})


for (const format of ['gif', 'avif']) test(`public ${format} source images are converted to PNG before the paid relay`, async t => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ef3344' } }).toFormat(format).toBuffer()
  const { app, calls } = fixture(t, { async fetch(_url, init) {
    const image = JSON.parse(init.body).messages[0].content.find(part => part.type === 'image_url').image_url.url
    assert.match(image, /^data:image\/png;base64,/)
    const metadata = await sharp(Buffer.from(image.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 3); assert.equal(metadata.height, 2)
    return Response.json({ choices: [{ message: { content: '![Image](https://media.example/result.png)' } }] })
  } })
  app.get('/legacy-files/sourceImage', (_request, reply) => reply.type(`image/${format}`).send(bytes))
  const response = await submit(app, { ...imageRequest, model: 'gemini-3.1-flash-image-preview', referenceUrls: ['/legacy-files/sourceImage'] })
  assert.equal(response.statusCode, 200, response.payload)
  assert.equal(response.json().status, 'succeeded'); assert.equal(calls.length, 1)
})

test('invalid GIF source images fail before any paid relay call', async t => {
  const { app, calls } = fixture(t)
  app.get('/legacy-files/brokenGif', (_request, reply) => reply.type('image/gif').send(Buffer.from('not an image')))
  const response = await submit(app, { ...imageRequest, referenceUrls: ['/legacy-files/brokenGif'] })
  assert.equal(response.statusCode, 400); assert.match(response.json().error.message, /无法解码/)
  assert.equal(calls.length, 0)
})


test('ordinary all-group catalogs expose only available classified models without selecting a token', async t => {
  const { app, catalogueCalls, credentialCalls, groupCalls } = fixture(t, { modelCatalogue() {
    return { groups: [{ id: 'text', name: 'Text' }], items: [{ id: 'gpt-5', groups: ['text'] }, { id: 'embedding-alias', groups: ['text'] }] }
  } })
  const response = await app.inject('/api/creation/models?scope=all')
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().items.map(item => item.id), ['gpt-5'])
  assert.deepEqual(response.json().items[0].groups, ['text'])
  assert.equal(response.json().tokenId, undefined)
  assert.equal(catalogueCalls.length, 1)
  assert.equal(credentialCalls.length + groupCalls.length, 0)
  assert.equal((await app.inject('/api/creation/models?scope=all&management=1')).statusCode, 403)
})

test('resolving an independent group uses its token only for the current model request', async t => {
  const { app, groupCalls, credentialCalls } = fixture(t, { groupToken: () => 83,
    fetch: () => Response.json({ data: [{ id: 'gpt-5' }] }) })
  const response = await app.inject({ method: 'POST', url: '/api/creation/models',
    headers: { ...headers, host: 'community.example', 'x-new-api-user': '17', 'x-new-api-token': '71' }, payload: { group: 'text' } })
  assert.equal(response.statusCode, 200, response.payload)
  assert.equal(response.json().tokenId, 83)
  assert.deepEqual(groupCalls, [{ group: 'text', userId: '17' }])
  await app.inject('/api/creation/models')
  assert.deepEqual(credentialCalls.map(call => call.tokenId), [83, 71])
  assert(!response.payload.includes(apiKey))
})

test('group resolution rejects foreign origins, wrong accounts and invalid groups before provisioning', async t => {
  const { app, groupCalls, credentialCalls } = fixture(t)
  for (const extra of [{ origin: 'https://attacker.test' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'x-new-api-user': '18' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/creation/models', headers: { ...headers, host: 'community.example', ...extra }, payload: { group: 'text' } })
    assert([403, 409].includes(response.statusCode), response.payload)
  }
  for (const group of ['', ' text ', 'x'.repeat(201), ['text'], 17]) {
    const response = await app.inject({ method: 'POST', url: '/api/creation/models', headers: { ...headers, host: 'community.example' }, payload: { group } })
    assert.equal(response.statusCode, 400)
  }
  assert.equal(groupCalls.length + credentialCalls.length, 0)
})

test('unavailable or malformed group tokens never fall back to the active generation group', async t => {
  for (const token of [null, 0, -1, '83', 1.5]) {
    const { app, credentialCalls } = fixture(t, { groupToken: () => token })
    const response = await app.inject({ method: 'POST', url: '/api/creation/models', headers: { ...headers, host: 'community.example' }, payload: { group: 'text' } })
    assert.equal(response.statusCode, 502)
    assert.equal(credentialCalls.length, 0)
  }
})

test('preloading an unprepared group returns immediately without reading model credentials', async t => {
  const { app, credentialCalls, calls } = fixture(t, { groupToken(_req, group, create) {
    assert.equal(group, 'text'); assert.equal(create, false)
    return undefined
  } })
  const response = await app.inject({ method: 'POST', url: '/api/creation/models', headers: { ...headers, host: 'community.example' }, payload: { group: 'text', preload: true } })
  assert.equal(response.statusCode, 200, response.payload)
  assert.deepEqual(response.json(), { prepared: false, items: [] })
  assert.equal(credentialCalls.length + calls.length, 0)
  const invalid = await app.inject({ method: 'POST', url: '/api/creation/models', headers: { ...headers, host: 'community.example' }, payload: { group: 'text', preload: 'true' } })
  assert.equal(invalid.statusCode, 400)
})

test('group preparation failures are explicitly unaccepted for JSON and streaming generation', async t => {
  for (const stream of [false, true]) await t.test(stream ? 'SSE' : 'JSON', async t => {
    const { app, calls } = fixture(t, { credentials() { throw new NewApiError('Group key changed', 409, 'NEW_API_GROUP_TOKEN_UNAVAILABLE') } })
    const input = stream ? { ...imageRequest, kind: 'text', model: 'gpt-5', chatOptions: { stream: true, messages: [{ role: 'user', content: 'test' }] } } : imageRequest
    const response = await submit(app, input)
    assert.equal(response.statusCode, stream ? 200 : 409, response.payload)
    assert.match(response.payload, /"notAccepted":true/)
    assert.match(response.payload, /NEW_API_GROUP_TOKEN_UNAVAILABLE/)
    assert.equal(calls.length, 0)
    assert.equal((await app.inject(`/api/creation/requests/${input.requestId}`)).statusCode, 404)
  })
})


test('private image and video work skills combine with community skills in order without leaking source', async t => {
  for (const kind of ['image', 'video']) await t.test(kind, async t => {
    const filesRoot = await mkdtemp(path.join(tmpdir(), 'community-media-work-skill-'));
    t.after(() => rm(filesRoot, { recursive: true, force: true }));
    const secret = 'Private media instruction sentinel.';
    const source = Buffer.from('---\nname: visual-helper\ndescription: visual rules\n---\n' + secret);
    await writeFile(path.join(filesRoot, 'source-key'), source);
    const pack = await readSkillPackage('SKILL.md', source);
    const body = 'Use a pastel palette.', sha256 = createHash('sha256').update(body).digest('hex');
    const row = { id: 'work1', authorId: 'author1', status: 'approved', fileIds: ['source1'], generation: { skill: { kind, sourceFileId: 'source1', sourceSha256: pack.sha256, sourcePublic: false } } };
    let visible = true, failed = false;
    const f = fixture(t, { filesRoot, workQuery(sql) {
      if (sql.includes('FROM community_submission s')) return visible ? [row] : [];
      return [{ name: 'SKILL.md', accessKey: 'source-key', storedInternal: true, isLink: false }];
    }, skillRows(sql, params) { assert.deepEqual(params, [['visual']]); return [{ id: 'visual', kind, body, sha256 }]; }, async fetch(_url, init) {
      const prompt = (await relayRequestBody(init)).prompt;
      assert.equal(prompt.replaceAll('\r\n', '\n'), `${body}\n\n${secret}\n\n本次创作要求：\nA scene`);
      if (failed) return Response.json({ status: 'failed', error: { message: secret } });
      return kind === 'image' ? Response.json({ data: [{ url: 'https://media.example/result.png' }] }) : Response.json({ id: 'video-1', status: 'completed', url: 'https://media.example/result.mp4' });
    } });
    const input = { kind, model: kind === 'image' ? 'gpt-image-2' : 'sora-2', prompt: 'A scene', duration: 8, requestId: 'private-media-1', skills: [{ id: 'community-visual', sha256 }, { id: 'work-work1', sha256: pack.sha256 }] };
    const accepted = await submit(f.app, input);
    assert.equal(accepted.statusCode, 200, accepted.payload);
    assert.equal(accepted.json().status, 'succeeded');
    assert(!accepted.payload.includes(secret));
    assert(!JSON.stringify([...f.values.values()]).includes(secret));
    visible = false;
    assert.deepEqual((await submit(f.app, input)).json(), accepted.json());
    assert.equal(f.calls.length, 1);
    assert.equal((await submit(f.app, { ...input, requestId: 'withdrawn' })).statusCode, 404);
    visible = true; row.generation.skill.kind = kind === 'image' ? 'video' : 'image';
    assert.equal((await submit(f.app, { ...input, requestId: 'wrong-kind' })).statusCode, 409);
    assert.equal(f.calls.length, 1);
    row.generation.skill.kind = kind; failed = true;
    const failure = await submit(f.app, { ...input, requestId: 'upstream-error' });
    assert.equal(failure.statusCode, 200, failure.payload);
    assert.equal(failure.json().status, 'failed');
    assert(!failure.payload.includes(secret));
    assert(!JSON.stringify([...f.values.values()]).includes(secret));
    await writeFile(path.join(filesRoot, 'source-key'), Buffer.concat([source, Buffer.from('Changed.')]));
    assert.equal((await submit(f.app, { ...input, requestId: 'changed-source' })).statusCode, 409);
    assert.equal(f.calls.length, 2);
  });
});


test('private media errors stay redacted through background polling, cached recovery and lost task ownership', async t => {
  const previous = process.env.NEW_API_SESSION_SECRET;
  process.env.NEW_API_SESSION_SECRET = 'fixture-work-media-secret-'.repeat(3);
  t.after(() => { if (previous === undefined) delete process.env.NEW_API_SESSION_SECRET; else process.env.NEW_API_SESSION_SECRET = previous; });
  const filesRoot = await mkdtemp(path.join(tmpdir(), 'private-media-poll-'));
  t.after(() => rm(filesRoot, { recursive: true, force: true }));
  const secret = 'Private background skill instruction sentinel.';
  const source = Buffer.from('---\nname: visual\ndescription: rules\n---\n' + secret);
  await writeFile(path.join(filesRoot, 'source-key'), source);
  const pack = await readSkillPackage('SKILL.md', source), ready = deferred();
  const row = { id: 'work1', authorId: 'author1', status: 'approved', fileIds: ['source1'], generation: { skill: { kind: 'video', sourceFileId: 'source1', sourceSha256: pack.sha256 } } };
  const f = fixture(t, { filesRoot,
    workQuery: sql => sql.includes('FROM community_submission s') ? [row] : [{ name: 'SKILL.md', accessKey: 'source-key', storedInternal: true, isLink: false }],
    afterRedisSet(key, value) { if (key.endsWith(':private-background') && JSON.parse(value).tracking) ready.resolve(); },
    fetch(_url, init) {
      return Response.json(init.method === 'POST' ? { id: 'private-video', status: 'queued' }
        : { id: 'private-video', user_id: 17, status: 'failed', error: { code: 'upstream_rejected', message: secret, status: 422, stage: 'upstream_submission' } });
    },
  });
  const input = { kind: 'video', model: 'sora-2', prompt: 'A scene', duration: 8, requestId: 'private-background', skills: [{ id: 'work-work1', sha256: pack.sha256 }] };
  const initial = await submit(f.app, input, { Prefer: 'respond-async' });
  assert.equal(initial.statusCode, 202, initial.payload);
  await ready.promise;
  const taskKey = [...f.values.keys()].find(key => key.startsWith('community-next:creation:task:'));
  assert.equal(JSON.parse(f.values.get(taskKey)).hasWorkSkills, true);
  const assertSafe = response => {
    assert.equal(response.statusCode, 200, response.payload);
    assert.equal(response.json().status, 'failed');
    assert.equal(response.json().errorStage, '上游提交');
    assert.equal(response.json().errorStatus, 422);
    assert.match(response.json().error, /HTTP 422/);
    assert(!response.payload.includes(secret));
  };
  assertSafe(await f.app.inject('/api/creation/tasks/video/private-video?protocol=openai'));
  await processCreationTasks(f.redis, f.services);
  assertSafe(await f.app.inject('/api/creation/requests/private-background'));
  assertSafe(await submit(f.app, input));
  f.values.delete(taskKey);
  assertSafe(await f.app.inject('/api/creation/tasks/video/private-video?protocol=openai&tokenId=71'));
  assert.equal(JSON.parse(f.values.get(taskKey)).hasWorkSkills, true);
  assert(!JSON.stringify([...f.values.values()]).includes(secret));
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
});
