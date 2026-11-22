/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import sharp from 'sharp'
import { handleCreation, processCreationTasks } from './creation.ts'
import { httpError } from './auth.ts'

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
  assert.equal((await submit(app)).statusCode, 503)
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
    async modelCatalogue(req) {
      catalogueCalls.push(req)
      if (!options.modelCatalogue) throw new Error('Unexpected account model catalogue request')
      return options.modelCatalogue(req)
    },
    async credentials(req, path) {
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
  app.all('/api/creation/*', async (request, reply) => {
    const accountId = String(request.headers['x-test-account'] || '17')
    const user = { id: `local-${accountId}`, accountId, username: 'root', isAdmin: options.isAdmin === true }
    const ctx = {
      req: request.raw, res: reply.raw, request, reply, redis, user,
      db: { async query(sql) {
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
    if (!await handleCreation(ctx, services)) reply.code(404).send({ error: { message: 'Missing route' } })
    return reply
  })
  return { app, values, calls, credentialCalls, catalogueCalls, redis, services }
}

function submit(app, body = imageRequest, extraHeaders = {}) {
  return app.inject({ method: 'POST', url: '/api/creation/generate', headers: { ...headers, ...extraHeaders }, payload: body })
}

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
  assert.deepEqual(download.rawPayload, original)
  assert.equal(reads.length, 2)
  assert(reads.every(read => read.url === 'https://media.example/large.png' && read.kind === 'image' && read.maximum === 32 * 1024 * 1024 && read.signal instanceof AbortSignal))
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
  const f = fixture(t, {
    afterRedisSet(key, value) { if (key.endsWith(':background-video') && JSON.parse(value).tracking) trackingSaved.resolve() },
    fetch(url, init) {
      if (init.method === 'POST') return upstream.promise
      assert.equal(new URL(url).pathname, '/v1/videos/upstream-video')
      return Response.json({ id: 'upstream-video', status: 'completed' })
    },
  })
  const input = { kind: 'video', model: 'sora-2', duration: 8, prompt: 'A test video', requestId: 'background-video' }
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
  const result = (await f.app.inject('/api/creation/requests/background-video')).json()
  assert.equal(result.status, 'succeeded')
  assert.equal(result.requestId, input.requestId)
  assert.equal(result.upstreamId, 'upstream-video')
  assert.equal(result.mediaPath, 'videos/upstream-video/content')
  assert.equal(JSON.parse(f.values.get(key)).tracking, undefined)
  assert.equal((await f.app.inject({ url: '/api/creation/requests/background-video', headers: { 'x-test-account': '18' } })).statusCode, 404)
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1)
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
    { id: 'configured-image', name: 'Configured image', tags: ['Edit'], kind: 'image', apiFormat: 'images', protocol: 'async', image: { autoQuality: 'high' }, remark: 'private-image-remark' },
    { id: 'configured-video', name: 'Configured video', tags: [], kind: 'video', apiFormat: 'openai', protocol: 'sync', video: { autoResolution: '720p', parameterFormat: 'xai' }, remark: 'private-video-remark' },
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
    const body = typeof calls[0].init.body === 'string' ? JSON.parse(calls[0].init.body) : Object.fromEntries(calls[0].init.body.entries())
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
  const resolutions = calls.map(({ init }) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : Object.fromEntries(init.body.entries())
    const metadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata
    return body.resolution ?? metadata?.resolution
  })
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

test('upstream read throttling preserves HTTP 429 and Retry-After without replaying requests', async t => {
  for (const retryAfter of ['7', 'Sun, 22 Nov 2026 12:00:00 GMT', undefined]) {
    const { app, calls } = fixture(t, { fetch(_url, init) {
      assert.notEqual(init.method, 'POST')
      return Response.json({ error: { code: 'rate_limited' } }, {
        status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {},
      })
    } })
    for (const url of ['/api/creation/tasks/image/rate-limited?protocol=async&tokenId=71', '/api/creation/models']) {
      const response = await app.inject(url)
      assert.equal(response.statusCode, 429)
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
  assert.equal(calls.length, 1)
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
  assert.equal(credentialCalls.at(-1).tokenId, 71)
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

test('model catalogs only publish validated administrator video settings instead of upstream metadata', async t => {
  for (const video of [undefined, { autoResolution: '720p', headers: { authorization: 'must-not-forward' } }]) {
    const { app } = fixture(t, {
      modelTypes: video ? [{ id: 'wan3.0', kind: 'video', video }] : [],
      fetch() { return Response.json({ data: [{ id: 'wan3.0', video: { autoResolution: '4k', secret: 'must-not-forward' } }] }) },
    })
    const response = await app.inject('/api/creation/models')
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().items.length, 1)
    assert(!Object.hasOwn(response.json().items[0], 'video'))
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
