/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import { AccountRequest, AccountResponse } from './native-account/http.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'

const origin = 'https://community.example'
const jsonHeaders = { origin, 'content-type': 'application/json' }
const indexHtml = '<!doctype html><html><body>community-http-entry</body></html>'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fakeStores() {
  let allowMedia = true
  const queries = []
  const media = {
    id: 'file1', name: 'creation.mp4', type: 'video/mp4',
    accessKey: 'original-key', thumbnailAccessKey: 'thumbnail-key',
    webpublicAccessKey: null, webpublicType: null,
  }
  const db = {
    async query(sql, parameters = []) {
      queries.push({ sql, parameters })
      assert(!sql.includes('community_lottery'), 'HTTP checks must not operate on lottery data')
      if (sql.includes('FROM drive_file f WHERE')) {
        return { rows: allowMedia && ['file1', 'original-key', 'thumbnail-key'].includes(parameters[1]) ? [media] : [], rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    },
    async connect() { return { query: db.query, release() {} } },
  }
  const redis = {
    async get() { return null },
    async set() { return 'OK' },
    async del() { return 0 },
    async exists() { return 0 },
    async ping() { return 'PONG' },
    async incr() { return 1 },
    async expire() { return 1 },
    async eval() { return 1 },
    async xrevrange() { return [] },
  }
  return { db, redis, queries, denyMedia() { allowMedia = false } }
}

async function fixture(t) {
  const { createApplication } = await import('./runtime.ts')
  const root = await mkdtemp(path.join(tmpdir(), 'community-fastify-http-'))
  assert.equal(path.dirname(root), path.resolve(tmpdir()))
  const filesRoot = path.join(root, 'files')
  const distRoot = path.join(root, 'public')
  await Promise.all([mkdir(filesRoot), mkdir(path.join(distRoot, 'assets'), { recursive: true })])
  await Promise.all([
    writeFile(path.join(distRoot, 'index.html'), indexHtml),
    writeFile(path.join(distRoot, 'assets', 'app.js'), 'export const app = true;'),
    writeFile(path.join(root, 'outside.txt'), 'outside-must-not-be-served'),
    writeFile(path.join(filesRoot, 'original-key'), '0123456789abcdefghij'),
    writeFile(path.join(filesRoot, 'thumbnail-key'), Buffer.from([255, 216, 255, 224, 0, 4, 74, 70, 73, 70])),
  ])
  const stores = fakeStores()
  const app = createApplication({
    db: stores.db, redis: stores.redis,
    config: { url: origin, db: { host: 'unused', user: 'unused', db: 'unused' }, redis: { host: 'unused' } },
    filesRoot, distRoot,
  })
  t.after(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  return { app, ...stores }
}

function assertJsonError(response, statusCode) {
  assert.equal(response.statusCode, statusCode)
  assert.match(response.headers['content-type'], /application\/json/)
  assert.equal(typeof response.json().error?.message, 'string')
  assert(response.json().error.message.length > 0)
}

test('Fastify keeps JSON errors, same-origin writes, guest session and logout cookies', async t => {
  const { app, queries } = await fixture(t)
  const anonymous = await app.inject({ method: 'GET', url: '/api/session' })
  assert.equal(anonymous.statusCode, 200)
  assert.deepEqual(anonymous.json(), { user: null, authentication: 'zhangyu', accountUrl: 'https://zhangyuapi.com' })
  assert.match(anonymous.headers['cache-control'], /no-store/)
  const registration = await app.inject({ method: 'GET', url: '/api/registration' })
  assert.equal(registration.statusCode, 200)
  assert.deepEqual(registration.json(), { enabled: false, authentication: 'zhangyu', accountUrl: 'https://zhangyuapi.com' })
  for (const url of ['/api/session/login', '/api/session/register']) {
    assertJsonError(await app.inject({ method: 'POST', url, headers: { origin: 'https://other.example',
      'content-type': 'application/json' }, payload: '{}' }), 403)
    const disabled = await app.inject({ method: 'POST', url, headers: jsonHeaders,
      payload: '{"login":"legacy","username":"legacy","password":"legacy-password"}' })
    assertJsonError(disabled, 410)
    assert.equal(disabled.json().error.code, 'ACCOUNT_LOGIN_REQUIRED')
  }
  assert.equal(queries.length, 0, 'disabled native authentication must not read or change legacy account data')

  for (const headers of [
    { 'content-type': 'application/json' },
    { origin: 'https://other.example', 'content-type': 'application/json' },
  ]) {
    assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers, payload: '{}' }), 403)
  }
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: { origin, 'content-type': 'text/plain' }, payload: '{}' }), 415)
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '{"broken":' }), 400)
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '[]' }), 400)
  assertJsonError(await app.inject({ method: 'GET', url: '/api/missing-http-check' }), 404)

  const logout = await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '{}' })
  assert.equal(logout.statusCode, 200)
  assert.deepEqual(logout.json(), { user: null })
  const cookies = [].concat(logout.headers['set-cookie'] || [])
  for (const name of ['community_session', 'octopus_new_api_session']) {
    const expired = cookies.find(value => value.startsWith(`${name}=`))
    assert(expired, `logout must forward the raw ${name} Set-Cookie header`)
    for (const attribute of [/Max-Age=0/i, /Path=\//i, /HttpOnly/i, /SameSite=Lax/i, /Secure/i]) assert.match(expired, attribute)
  }

  // A permitted upload body must reach authentication instead of Fastify's 1 MiB default cap.
  const upload = JSON.stringify({ name: 'creation.png', type: 'image/png', data: 'x'.repeat(1024 * 1024 + 1) })
  assertJsonError(await app.inject({ method: 'POST', url: '/api/uploads', headers: jsonHeaders, payload: upload }), 401)
  const oversized = JSON.stringify({ data: 'x'.repeat(28 * 1024 * 1024) })
  assertJsonError(await app.inject({ method: 'POST', url: '/api/uploads', headers: jsonHeaders, payload: oversized }), 413)

  const handoff = await app.inject({ method: 'GET', url: '/auth/newapi' })
  assert.equal(handoff.statusCode, 303)
  assert.equal(handoff.headers.location, '/account')
  const oldCallback = await app.inject({ method: 'GET', url: '/api/newapi/callback?code=old-code&state=old-state' })
  assert.equal(oldCallback.statusCode, 303)
  assert.equal(oldCallback.headers.location, '/account')
})

test('static assets and SPA routes preserve HEAD and never expose paths outside dist', async t => {
  const { app } = await fixture(t)
  const spa = await app.inject({ method: 'GET', url: '/work/legacy123' })
  assert.equal(spa.statusCode, 200)
  assert.equal(spa.payload, indexHtml)
  const head = await app.inject({ method: 'HEAD', url: '/work/legacy123' })
  assert.equal(head.statusCode, 200)
  assert.equal(head.payload, '')
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(indexHtml))
  const asset = await app.inject({ method: 'HEAD', url: '/assets/app.js' })
  assert.equal(asset.statusCode, 200)
  assert.equal(asset.payload, '')
  assert.match(asset.headers['content-type'], /javascript/)
  assert.match(asset.headers['cache-control'], /immutable/)
  assertJsonError(await app.inject({ method: 'GET', url: '/assets/missing.js' }), 404)
  for (const url of ['/assets/%2e%2e/%2e%2e/outside.txt', '/.env', '/assets/%5coutside.txt', '/assets/%00outside.txt']) {
    const blocked = await app.inject({ method: 'GET', url })
    assert([400, 404].includes(blocked.statusCode), `${url} must be rejected`)
    assert(!blocked.payload.includes('outside-must-not-be-served'))
  }
})

test('account page policy permits Turnstile without allowing arbitrary scripts or frames', async t => {
  const { app } = await fixture(t)
  for (const method of ['GET', 'HEAD']) {
    const page = await app.inject({ method, url: '/account?returnTo=/create/image' })
    assert.equal(page.statusCode, 200)
    const directives = new Map(page.headers['content-security-policy'].split(';').map(value => {
      const [name, ...sources] = value.trim().split(/\s+/)
      return [name, sources]
    }))
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      assert(directives.get(name).includes('https://challenges.cloudflare.com'), `${name} must allow account verification`)
      assert(!directives.get(name).some(value => ['*', 'https:', "'unsafe-inline'", "'unsafe-eval'"].includes(value)))
    }
    assert.deepEqual(directives.get('default-src'), ["'self'"])
    assert.deepEqual(directives.get('frame-ancestors'), ["'self'"])
    assert.deepEqual(directives.get('object-src'), ["'none'"])
  }
})

test('temporary media keeps original, HEAD, range and thumbnail permission semantics', async t => {
  const { app, denyMedia } = await fixture(t)
  const full = await app.inject({ method: 'GET', url: '/legacy-files/file1' })
  assert.equal(full.statusCode, 200)
  assert.equal(full.payload, '0123456789abcdefghij')
  assert.equal(full.headers['content-type'], 'video/mp4')
  assert.equal(full.headers['accept-ranges'], 'bytes')
  assert.equal(Number(full.headers['content-length']), 20)
  const head = await app.inject({ method: 'HEAD', url: '/legacy-files/file1' })
  assert.equal(head.statusCode, 200)
  assert.equal(head.payload, '')
  assert.equal(Number(head.headers['content-length']), 20)
  const partial = await app.inject({ method: 'GET', url: '/legacy-files/file1', headers: { range: 'bytes=2-5' } })
  assert.equal(partial.statusCode, 206)
  assert.equal(partial.payload, '2345')
  assert.equal(partial.headers['content-range'], 'bytes 2-5/20')
  assert.equal(Number(partial.headers['content-length']), 4)
  const rangeHead = await app.inject({ method: 'HEAD', url: '/legacy-files/file1', headers: { range: 'bytes=-4' } })
  assert.equal(rangeHead.statusCode, 206)
  assert.equal(rangeHead.payload, '')
  assert.equal(rangeHead.headers['content-range'], 'bytes 16-19/20')
  const invalid = await app.inject({ method: 'GET', url: '/legacy-files/file1', headers: { range: 'bytes=20-' } })
  assert.equal(invalid.statusCode, 416)
  assert.equal(invalid.headers['content-range'], 'bytes */20')
  const thumbnail = await app.inject({ method: 'GET', url: '/legacy-files/file1?variant=thumbnail' })
  assert.equal(thumbnail.statusCode, 200)
  assert.equal(thumbnail.headers['content-type'], 'image/jpeg')
  assert.equal(thumbnail.rawPayload.length, 10)
  assert.equal(thumbnail.rawPayload[0], 255)
  const byKey = await app.inject({ method: 'GET', url: '/files/thumbnail-key' })
  assert.equal(byKey.statusCode, 200)
  assert.deepEqual(byKey.rawPayload, thumbnail.rawPayload)
  denyMedia()
  for (const url of ['/legacy-files/file1', '/legacy-files/file1?variant=thumbnail', '/files/thumbnail-key']) {
    assertJsonError(await app.inject({ method: 'GET', url }), 404)
  }
})

test('native account adapters preserve the public URL, JSON body, cookies and separate Set-Cookie headers', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.post('/account-contract', async (request, reply) => {
    const req = new AccountRequest(applicationRequest(request, reply, origin))
    assert.equal(req.nextUrl.origin, origin)
    assert.equal(req.nextUrl.searchParams.get('returnTo'), '/create/image')
    assert.equal(req.headers.get('content-length'), null)
    assert.equal(req.cookies.get('octopus_new_api_session')?.value, 'session/value')
    assert.equal(req.cookies.get('pref')?.value, 'dark')
    assert.deepEqual(await req.json(), { username: 'root', password: 'opaque-test-only' })
    const response = AccountResponse.json({ success: true }, { status: 201 })
    response.cookies.set('octopus_new_api_session', 'new/session', {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
    })
    response.cookies.set('community_session', 'community/session', {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
    })
    response.headers.append('Set-Cookie', 'pref=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/')
    return sendWebResponse(reply, response)
  })
  const response = await app.inject({
    method: 'POST', url: '/account-contract?returnTo=%2Fcreate%2Fimage',
    headers: { 'content-type': 'application/json', cookie: 'octopus_new_api_session=session%2Fvalue; pref=dark' },
    payload: { username: 'root', password: 'opaque-test-only' },
  })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), { success: true })
  assert.deepEqual([].concat(response.headers['set-cookie'] || []), [
    'octopus_new_api_session=new%2Fsession; Path=/; HttpOnly; Secure; SameSite=lax; Max-Age=600',
    'community_session=community%2Fsession; Path=/; HttpOnly; Secure; SameSite=lax; Max-Age=600',
    'pref=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
  ])
})

test('native account response sends the first chunk before completion and aborts on client disconnect', { timeout: 10000 }, async t => {
  const finish = deferred()
  const requestAborted = deferred()
  const bodyCancelled = deferred()
  let streamEnded = false
  const app = Fastify({ forceCloseConnections: true })
  app.get('/native/:mode', async (request, reply) => {
    const req = new AccountRequest(applicationRequest(request, reply, origin))
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('first-chunk\n'))
        if (request.params.mode === 'cancel') {
          req.signal.addEventListener('abort', () => requestAborted.resolve(req.signal.aborted), { once: true })
          return
        }
        void finish.promise.then(() => {
          streamEnded = true
          controller.enqueue(encoder.encode('last-chunk\n'))
          controller.close()
        })
      },
      cancel() { bodyCancelled.resolve() },
    })
    return sendWebResponse(reply, new AccountResponse(stream, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    }))
  })
  t.after(async () => { finish.resolve(); await app.close() })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const openResponse = url => new Promise((resolve, reject) => {
    const request = http.get(url, res => { res.pause(); resolve(res) })
    request.once('error', reject)
  })
  const response = await openResponse(new URL('/native/stream', address))
  t.after(() => response.destroy())
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  const first = once(response, 'data')
  response.resume()
  await first
  assert.equal(streamEnded, false, 'native response must deliver data before its body has completed')
  assert(Buffer.concat(chunks).length > 0)
  const ended = once(response, 'end')
  finish.resolve()
  await ended
  assert.equal(Buffer.concat(chunks).toString(), 'first-chunk\nlast-chunk\n')

  const cancelResponse = await openResponse(new URL('/native/cancel', address))
  t.after(() => cancelResponse.destroy())
  const cancelFirst = once(cancelResponse, 'data')
  cancelResponse.resume()
  await cancelFirst
  cancelResponse.destroy()
  assert.equal(await requestAborted.promise, true, 'client disconnect must terminate the native account request')
  await bodyCancelled.promise
})

test('legacy Studio pages redirect to native creation and old POST requests are not proxied', async t => {
  const { app } = await fixture(t)
  for (const method of ['GET', 'HEAD']) {
    for (const url of ['/studio', '/studio/', '/studio/image?model=old', '/studio/api/raw-check']) {
      const response = await app.inject({ method, url })
      assert.equal(response.statusCode, 302)
      assert.equal(response.headers.location, '/create')
      if (method === 'HEAD') assert.equal(response.payload, '')
    }
  }
  for (const url of ['/studio', '/studio/image', '/studio/api/raw-check']) {
    assertJsonError(await app.inject({ method: 'POST', url, headers: jsonHeaders, payload: '{}' }), 405)
  }
})

test('native creation endpoints require the community account before upstream access', async t => {
  const { app } = await fixture(t)
  for (const url of ['/api/creation/models', '/api/creation/tasks/image/job_1',
    '/api/creation/tasks/video/job_1', '/api/creation/media?path=videos/job_1/content']) {
    assertJsonError(await app.inject({ method: 'GET', url }), 401)
  }
  assertJsonError(await app.inject({ method: 'POST', url: '/api/creation/generate', headers: jsonHeaders,
    payload: '{"kind":"image","model":"gpt-image-2","prompt":"Guest generation must be blocked"}' }), 401)
})
