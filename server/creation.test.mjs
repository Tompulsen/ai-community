/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { handleCreation } from './creation.ts'

const origin = 'https://community.example'
const headers = { origin, 'content-type': 'application/json' }
const apiKey = 'sk-fixture-secret-for-tests'
const imageRequest = { kind: 'image', model: 'gpt-image-2', prompt: 'A test image', requestId: 'request-1' }

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
