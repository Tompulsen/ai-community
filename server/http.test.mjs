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
import { createApplication } from './runtime.ts'

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

async function fixture(t, options = {}) {
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
    filesRoot, distRoot, ...options,
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

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

async function closeServer(server) {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
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

test('Studio forwards raw bodies, public Host, cookies, Set-Cookie and OAuth callback path', async t => {
  const seen = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
    if (req.url.startsWith('/studio/api/new-api/community/callback')) {
      res.writeHead(302, { Location: '/create/image' })
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Set-Cookie': ['studio_one=1; Path=/studio; HttpOnly', 'studio_two=2; Path=/studio; SameSite=Lax'],
    })
    res.end(Buffer.concat(chunks))
  })
  const studioUpstream = await listen(upstream)
  t.after(() => closeServer(upstream))
  const { app } = await fixture(t, { studioUpstream })
  const body = Buffer.from([0, 255, 1, 2, 123, 10])
  const proxied = await app.inject({
    method: 'POST', url: '/studio/api/raw-check?value=1',
    headers: { 'content-type': 'application/octet-stream', cookie: 'octopus_new_api_session=opaque; pref=dark' },
    payload: body,
  })
  assert.equal(proxied.statusCode, 200)
  assert.deepEqual(proxied.rawPayload, body)
  assert.equal(seen[0].url, '/studio/api/raw-check?value=1')
  assert.equal(seen[0].headers.host, 'community.example')
  assert.equal(seen[0].headers['x-forwarded-host'], 'community.example')
  assert.equal(seen[0].headers['x-forwarded-proto'], 'https')
  assert.equal(seen[0].headers.cookie, 'octopus_new_api_session=opaque; pref=dark')
  assert.deepEqual(seen[0].body, body)
  assert.deepEqual([].concat(proxied.headers['set-cookie'] || []), [
    'studio_one=1; Path=/studio; HttpOnly', 'studio_two=2; Path=/studio; SameSite=Lax',
  ])
  const callback = await app.inject({ method: 'GET', url: '/api/new-api/community/callback?code=opaque&state=test-state' })
  assert.equal(callback.statusCode, 302)
  assert.equal(callback.headers.location, '/create/image')
  assert.equal(seen[1].url, '/studio/api/new-api/community/callback?code=opaque&state=test-state')
})

test('Studio sends the first chunk before upstream completion and propagates client cancellation', { timeout: 10000 }, async t => {
  const finish = deferred()
  const cancelled = deferred()
  let upstreamEnded = false
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    res.flushHeaders()
    res.write('first-chunk\n')
    if (req.url === '/studio/cancel') {
      res.once('close', () => cancelled.resolve(res.writableEnded))
      return
    }
    void finish.promise.then(() => {
      upstreamEnded = true
      res.end('last-chunk\n')
    })
  })
  const studioUpstream = await listen(upstream)
  t.after(() => { finish.resolve(); return closeServer(upstream) })
  const { app } = await fixture(t, { studioUpstream })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const openResponse = url => new Promise((resolve, reject) => {
    const request = http.get(url, res => { res.pause(); resolve(res) })
    request.once('error', reject)
  })
  const response = await openResponse(new URL('/studio/stream', address))
  t.after(() => response.destroy())
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  const first = once(response, 'data')
  response.resume()
  await first
  assert.equal(upstreamEnded, false, 'proxy must not wait for upstream end before sending data')
  assert(Buffer.concat(chunks).length > 0)
  const ended = once(response, 'end')
  finish.resolve()
  await ended
  assert.equal(Buffer.concat(chunks).toString(), 'first-chunk\nlast-chunk\n')

  const cancelResponse = await openResponse(new URL('/studio/cancel', address))
  t.after(() => cancelResponse.destroy())
  const cancelFirst = once(cancelResponse, 'data')
  cancelResponse.resume()
  await cancelFirst
  cancelResponse.destroy()
  assert.equal(await cancelled.promise, false, 'upstream response must close before its body was completed')
})
