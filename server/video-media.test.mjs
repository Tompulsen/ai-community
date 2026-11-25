import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { fetchPublicMedia, videoRangeHeaders, videoResponseHeaders, videoResponseBody } from './creation/public-media.ts'

function transport(t, replies, addresses = [{ address: '93.184.216.34', family: 4 }]) {
  const calls = [], bodies = []
  const request = (url, options, callback) => {
    const req = new EventEmitter()
    req.setTimeout = () => req
    req.destroy = error => { req.emit('error', error); return req }
    req.end = () => options.lookup(url.hostname, {}, error => {
      if (error) return req.emit('error', error)
      if (options.signal.aborted) return req.emit('error', options.signal.reason)
      calls.push({ url: url.href, headers: new Headers(options.headers) })
      const result = replies.shift()
      assert.ok(result, 'unexpected upstream request')
      const body = new PassThrough()
      body.statusCode = result.status ?? 200
      body.headers = { 'content-type': 'video/mp4', ...result.headers }
      bodies.push(body)
      const abort = () => body.destroy(options.signal.reason)
      options.signal.addEventListener('abort', abort, { once: true })
      body.once('close', () => options.signal.removeEventListener('abort', abort))
      callback(body)
      if (!result.pending) body.end(result.body ?? 'video')
    })
    return req
  }
  t.mock.method(http, 'request', request)
  t.mock.method(https, 'request', request)
  t.mock.method(dns, 'lookup', async () => addresses)
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  return { calls, bodies }
}

for (const range of ['bytes=0-2', 'bytes=2-', 'bytes=-3']) {
  test(`public video preserves ${range}, validators, status and partial length`, async t => {
    const contentRange = range === 'bytes=0-2' ? 'bytes 0-2/5' : 'bytes 2-4/5'
    const body = range === 'bytes=0-2' ? 'vid' : 'deo'
    const { calls } = transport(t, [{ status: 206, headers: { 'content-range': contentRange, 'accept-ranges': 'bytes', etag: '"video-v1"' }, body }])
    const response = await fetchPublicMedia('https://media.example/video.mp4', 'video', 50, undefined,
      new Headers({ Range: range, 'If-Range': '"video-v1"', Authorization: 'private', Cookie: 'private' }))
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-length'), '3')
    assert.equal(response.headers.get('content-range'), contentRange)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(response.headers.get('etag'), '"video-v1"')
    assert.equal(await response.text(), body)
    assert.equal(calls[0].headers.get('range'), range)
    assert.equal(calls[0].headers.get('if-range'), '"video-v1"')
    assert.equal(calls[0].headers.get('accept-encoding'), 'identity')
    assert.equal(calls[0].headers.get('authorization'), null)
    assert.equal(calls[0].headers.get('cookie'), null)
  })
}

test('a changed If-Range validator may return the entire 200 response', async t => {
  transport(t, [{ headers: { 'content-length': '5', 'accept-ranges': 'bytes' } }])
  const response = await fetchPublicMedia('https://media.example/video', 'video', 50, undefined, new Headers({ range: 'bytes=2-', 'if-range': '"old"' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), '5')
  assert.equal(response.headers.get('content-range'), null)
  assert.equal(await response.text(), 'video')
})

test('unsatisfiable video ranges preserve 416 and total size without forwarding the error body', async t => {
  const { bodies } = transport(t, [{ status: 416, headers: { 'content-range': 'bytes */5', 'content-type': 'text/html', 'content-length': '100' }, body: 'upstream error page' }])
  const response = await fetchPublicMedia('https://media.example/video', 'video', 50, undefined, new Headers({ range: 'bytes=9-' }))
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('content-range'), 'bytes */5')
  assert.equal(response.headers.get('content-length'), '0')
  assert.equal(await response.text(), '')
  assert.ok(bodies[0].destroyed)
})

test('redirects retain only the permitted range headers and recheck the destination', async t => {
  const { calls } = transport(t, [
    { status: 302, headers: { location: 'https://cdn.example/video' } },
    { status: 206, headers: { 'content-range': 'bytes 0-4/5', 'content-length': '5' } },
    { status: 302, headers: { location: 'http://127.0.0.1/private' } },
  ])
  const headers = new Headers({ range: 'bytes=0-', 'if-range': '"v1"', authorization: 'private' })
  assert.equal(await (await fetchPublicMedia('https://media.example/video', 'video', 50, undefined, headers)).text(), 'video')
  assert.equal(calls[1].url, 'https://cdn.example/video')
  assert.equal(calls[1].headers.get('range'), 'bytes=0-')
  assert.equal(calls[1].headers.get('authorization'), null)
  await assert.rejects(fetchPublicMedia('https://media.example/redirect', 'video', 50, undefined, headers), { status: 400 })
  assert.equal(calls.length, 3)
})

test('video DNS resolution still rejects private addresses', async t => {
  const { calls } = transport(t, [], [{ address: '10.0.0.1', family: 4 }])
  await assert.rejects(fetchPublicMedia('https://media.example/video', 'video', 50), { status: 400 })
  assert.equal(calls.length, 0)
})

test('invalid and multiple ranges fail before requesting upstream', async t => {
  const { calls } = transport(t, [])
  for (const range of ['bytes=-', 'bytes=0-1,4-5', 'items=0-1', 'bytes=9007199254740992-']) {
    await assert.rejects(fetchPublicMedia('https://media.example/video', 'video', 50, undefined, new Headers({ range })), { status: 400 })
  }
  assert.equal(calls.length, 0)
  assert.equal([...videoRangeHeaders(new Headers({ 'if-range': '"v1"' }))].length, 0)
})

test('invalid, encoded and oversized video response metadata are rejected', () => {
  const cases = [
    [206, {}, 502],
    [206, { 'content-range': 'bytes 5-4/10' }, 502],
    [206, { 'content-range': 'bytes 0-5/5' }, 502],
    [206, { 'content-range': 'bytes 0-2/5', 'content-length': '5' }, 502],
    [206, { 'content-range': 'bytes 0-2/100' }, 413],
    [200, { 'content-length': 'unknown' }, 502],
    [200, { 'content-length': '100' }, 413],
    [200, { 'content-encoding': 'gzip' }, 415],
    [416, { 'content-range': 'bytes 0-2/5' }, 502],
  ]
  for (const [status, headers, expected] of cases) assert.throws(() => videoResponseHeaders(status, new Headers(headers), 50), { status: expected })
  assert.equal(videoResponseHeaders(200, new Headers(), 50).get('content-length'), null)
})

test('partial bodies must contain exactly the advertised bytes and are cancelled on excess data', async t => {
  const { bodies } = transport(t, [
    { status: 206, headers: { 'content-range': 'bytes 0-4/5' }, body: 'vid' },
    { status: 206, headers: { 'content-range': 'bytes 0-2/5' }, body: 'video' },
  ])
  for (let i = 0; i < 2; i++) {
    const response = await fetchPublicMedia('https://media.example/video', 'video', 50)
    await assert.rejects(response.text(), { status: 502 })
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(bodies.every(body => body.destroyed))
})

test('video body bounds apply even when the upstream does not provide a length', async () => {
  const body = videoResponseBody(new Response('video').body, new Headers(), 3)
  await assert.rejects(new Response(body).text(), { status: 413 })
  assert.throws(() => videoResponseBody(null, new Headers({ 'content-length': '3' }), 50), { status: 502 })
})

test('client abort and downstream cancellation close the public video request', async t => {
  const { bodies } = transport(t, [{ pending: true }, { pending: true }])
  const controller = new AbortController()
  const response = await fetchPublicMedia('https://media.example/video', 'video', 50, controller.signal)
  const reading = response.text()
  controller.abort()
  await assert.rejects(reading)
  const other = await fetchPublicMedia('https://media.example/video', 'video', 50)
  await other.body.cancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(bodies.every(body => body.destroyed))
})

test('image decoding keeps its original behavior and ignores video range headers', async t => {
  const { calls } = transport(t, [{ headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' }, body: gzipSync('image') }])
  const response = await fetchPublicMedia('https://media.example/image', 'image', 50, undefined, new Headers({ range: 'invalid', 'if-range': '"v1"' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), null)
  assert.equal(await response.text(), 'image')
  assert.equal(calls[0].headers.get('range'), null)
})
