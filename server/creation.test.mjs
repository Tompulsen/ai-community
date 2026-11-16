/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import test from 'node:test'
import Fastify from 'fastify'
import { handleCreation } from './creation.ts'

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
  const calls = []
  const credentialCalls = []
  const app = Fastify({ forceCloseConnections: true })
  t.after(() => app.close())
  const redis = {
    async eval() { return 1 },
    async get(key) { return values.get(key) ?? null },
    async set(key, value, ...flags) {
      if (flags.includes('NX') && values.has(key)) return null
      await options.beforeRedisSet?.(key, value, flags)
      values.set(key, value)
      return 'OK'
    },
  }
  const services = {
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
    const user = { id: `local-${accountId}`, accountId, username: 'root', isAdmin: false }
    const ctx = {
      req: request.raw, res: reply.raw, request, reply, redis, user,
      db: { async query(sql) {
        assert.equal(sql, 'SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')
        return { rows: [{ clientOptions: { communityModelTypes: options.modelTypes ?? [] } }] }
      } },
      config: { url: origin },
      url: new URL(request.raw.url, origin), body: request.body || {},
      requireUser() { return user },
      json(status, value) { reply.code(status).send(value) },
    }
    if (!await handleCreation(ctx, services)) reply.code(404).send({ error: { message: 'Missing route' } })
    return reply
  })
  return { app, values, calls, credentialCalls }
}

function submit(app, body = imageRequest, extraHeaders = {}) {
  return app.inject({ method: 'POST', url: '/api/creation/generate', headers: { ...headers, ...extraHeaders }, payload: body })
}

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
  assert.equal(inProgress.json().status, 'indeterminate')
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
  const created = await submit(app, { kind: 'video', model: 'sora-2', prompt: 'Video', requestId: 'video-1' })
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
    const input = { kind: 'video', model: 'sora-2', prompt: 'A paid video', requestId: `metadata-${failedMapping}` }
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
  const { app } = fixture(t, {
    selectedToken: () => token,
    modelTypes: [{ id: 'custom/alias', kind: 'image' }, { id: 'tts-custom', kind: 'video' }, { id: 'not-in-group', kind: 'image' }],
    fetch() { return Response.json({ data: token === 71 ? ['custom/alias', 'gpt-5', 'whisper-1', 'tts-custom'] : ['custom/alias', 'CUSTOM/alias'] }) },
  })
  const first = await app.inject('/api/creation/models')
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json().items.map(({ id, kinds, configuredKind }) => ({ id, kinds, configuredKind })), [
    { id: 'custom/alias', kinds: ['image'], configuredKind: 'image' },
    { id: 'gpt-5', kinds: ['text'], configuredKind: undefined },
    { id: 'tts-custom', kinds: ['video'], configuredKind: 'video' },
  ])
  token = 99
  const second = (await app.inject('/api/creation/models')).json()
  assert.equal(second.tokenId, 99)
  assert.deepEqual(second.items.map(item => [item.id, item.kinds[0], item.configuredKind]), [
    ['custom/alias', 'image', 'image'], ['CUSTOM/alias', 'text', undefined],
  ])
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

test('historical plugin and Gemini tasks recover their artifacts through the original read-only protocols', async t => {
  const { app, calls } = fixture(t, { fetch(url, init) {
    assert.equal(init.method, undefined)
    const pathname = new URL(String(url)).pathname
    if (pathname === '/v1/tasks/plugin_job') return Response.json({ status: 'COMPLETED', user_id: 17 })
    if (pathname === '/v1/tasks/plugin_job/artifacts') return Response.json({ artifacts: [{ type: 'video', key: 'result.mp4' }] })
    assert.equal(pathname, '/v1beta/models/veo/operations/job_1')
    return Response.json({ name: 'models/veo/operations/job_1', done: true,
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
