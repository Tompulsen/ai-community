import assert from 'node:assert/strict'
import { request as httpsRequest } from 'node:https'
import { pipeline } from 'node:stream'
import { fileURLToPath } from 'node:url'

const publicOrigin = 'https://www.zhangyuapi.com'
const publicPaths = new Set([
  '/healthz', '/api/works', '/api/community/works', '/api/tags', '/api/creators',
  '/api/announcements', '/api/community/ads', '/api/site', '/api/uploads/limits',
  '/api/registration', '/api/security/capabilities', '/api/lottery/status',
])
const publicResource = /^\/api\/(?:works\/[a-zA-Z0-9]{1,32}(?:\/comments)?|users\/[a-zA-Z0-9]{1,32}(?:\/(?:followers|following))?)$/
const publicFile = /^\/(?:legacy-files\/[a-zA-Z0-9]{1,32}|files\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,255})$/
const responseHeaderNames = [
  'content-type', 'content-length', 'content-encoding', 'content-range', 'accept-ranges',
  'content-disposition', 'etag', 'last-modified', 'content-security-policy',
]

function classify(method, raw) {
  let target
  try {
    if (!raw.startsWith('/') || raw.startsWith('//') || /[\0-\x20\\#]/.test(raw)) throw Error()
    const decoded = decodeURIComponent(raw.split('?')[0])
    if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) throw Error()
    target = new URL(raw, publicOrigin)
    if (target.origin !== publicOrigin) throw Error()
  } catch { return { kind: 'invalid', status: 400 } }
  const pathname = target.pathname
  if (method === 'POST' && /^\/api\/works\/[a-zA-Z0-9]{1,32}\/view$/.test(pathname)) return { kind: 'view', status: 204 }
  if (!['GET', 'HEAD'].includes(method)) return { kind: 'write', status: 405 }
  if (pathname === '/api/session') return { kind: 'guest', status: 200 }
  if (publicPaths.has(pathname) || publicResource.test(pathname) || publicFile.test(pathname)) return { kind: 'proxy', target }
  if (pathname === '/api' || pathname.startsWith('/api/')) return { kind: 'private', status: 401 }
  if (/^\/(?:studio|auth|files|legacy-files)(?:\/|$)/.test(pathname)) return { kind: 'private', status: 403 }
  return { kind: 'vite' }
}

function requestHeaders(headers) {
  const result = { 'user-agent': 'Community-Design-Preview/1', accept: '*/*' }
  for (const name of ['accept', 'range', 'if-range', 'if-none-match', 'if-modified-since']) {
    if (typeof headers[name] === 'string') result[name] = headers[name]
  }
  return result
}

function responseHeaders(headers) {
  const result = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  for (const name of responseHeaderNames) if (headers[name] !== undefined) result[name] = headers[name]
  return result
}

function json(req, res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value))
}

function proxyPublic(req, res, target) {
  assert(['GET', 'HEAD'].includes(req.method))
  assert.equal(target.origin, publicOrigin)
  let timedOut = false
  const upstream = httpsRequest(target, { method: req.method, headers: requestHeaders(req.headers) }, incoming => {
    const status = incoming.statusCode || 502
    if (status >= 300 && status < 400 && status !== 304) {
      incoming.destroy()
      json(req, res, 502, { error: { code: 'PREVIEW_REDIRECT_BLOCKED', message: 'Public preview redirects are disabled.' } })
      return
    }
    res.statusCode = status
    for (const [name, value] of Object.entries(responseHeaders(incoming.headers))) res.setHeader(name, value)
    pipeline(incoming, res, error => { if (error && !res.destroyed) res.destroy() })
  })
  upstream.setTimeout(20000, () => {
    timedOut = true
    upstream.destroy(new Error('Public preview request timed out'))
  })
  upstream.once('error', () => {
    if (res.destroyed || res.writableEnded) return
    if (res.headersSent) { res.destroy(); return }
    json(req, res, timedOut ? 504 : 502, { error: {
      code: timedOut ? 'PREVIEW_UPSTREAM_TIMEOUT' : 'PREVIEW_UPSTREAM_UNAVAILABLE',
      message: 'The public preview source is unavailable. Please retry.',
    } })
  })
  res.once('close', () => { if (!res.writableFinished) upstream.destroy() })
  upstream.end()
}

function previewMiddleware(req, res, next) {
  const route = classify(req.method || 'GET', req.url || '/')
  if (route.kind === 'vite') { next(); return }
  if (route.kind === 'proxy') { proxyPublic(req, res, route.target); return }
  req.resume()
  if (route.kind === 'guest') { json(req, res, 200, { user: null, csrfToken: '' }); return }
  if (route.kind === 'view') {
    res.statusCode = 204
    res.setHeader('Cache-Control', 'no-store')
    res.end()
    return
  }
  if (route.kind === 'write') res.setHeader('Allow', 'GET, HEAD')
  json(req, res, route.status, { error: {
    code: route.kind === 'invalid' ? 'PREVIEW_INVALID_URL' : 'PREVIEW_READ_ONLY',
    message: 'Design preview only supports anonymous public browsing.',
  } })
}

function selfCheck() {
  for (const method of ['GET', 'HEAD']) {
    for (const pathname of [...publicPaths, '/api/works/oldWork1', '/api/works/oldWork1/comments',
      '/api/users/oldUser1', '/api/users/oldUser1/following', '/api/users/oldUser1/followers',
      '/legacy-files/oldFile1', '/files/original-key.webp']) {
      const route = classify(method, `${pathname}?cursor=page1`)
      assert.equal(route.kind, 'proxy', pathname)
      assert.equal(route.target.origin, publicOrigin)
    }
  }
  for (const pathname of ['/api/account', '/api/session/login', '/api/newapi/config', '/api/newapi/studio/start',
    '/api/admin/submissions', '/api/lottery/records', '/api/notifications', '/api/library', '/studio', '/auth/newapi']) {
    assert.equal(classify('GET', pathname).kind, 'private', pathname)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
    for (const pathname of ['/api/works', '/api/uploads', '/api/lottery/draw', '/api/session/login', '/studio', '/unknown']) {
      assert.equal(classify(method, pathname).kind, 'write', `${method} ${pathname}`)
    }
  }
  for (const raw of ['https://other.invalid/api/works', '//other.invalid/api/works', '/api/../api/works',
    '/api/%2e%2e/api/works', '/api/%5cworks', '/api/%', '/api/works#fragment']) assert.equal(classify('GET', raw).kind, 'invalid')
  assert.equal(classify('GET', '/discover').kind, 'vite')
  assert.equal(classify('GET', '/account').kind, 'vite')
  const forwarded = requestHeaders({ cookie: 'secret', authorization: 'Bearer secret', 'x-csrf-token': 'secret',
    host: 'other.invalid', origin: 'https://other.invalid', range: 'bytes=0-7' })
  assert.deepEqual(Object.keys(forwarded).sort(), ['accept', 'range', 'user-agent'])
  const received = responseHeaders({ 'set-cookie': ['session=secret'], location: 'https://other.invalid',
    'content-type': 'image/png', 'content-length': '8', 'content-range': 'bytes 0-7/100' })
  assert.equal(received['set-cookie'], undefined)
  assert.equal(received.location, undefined)
  assert.equal(received['content-range'], 'bytes 0-7/100')
  for (const [method, url, expected] of [['GET', '/api/session', 200], ['POST', '/api/works/oldWork1/view', 204],
    ['POST', '/api/lottery/draw', 405], ['GET', '/api/account', 401]]) {
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(value) { this.body = value; this.ended = true } }
    previewMiddleware({ method, url, resume() {} }, response, () => assert.fail('A local-only request reached Vite'))
    assert.equal(response.statusCode, expected)
    assert.equal(response.ended, true)
    if (url === '/api/session') assert.deepEqual(JSON.parse(response.body), { user: null, csrfToken: '' })
  }
  console.log('Self-check passed: public allowlist, local write blocking, guest session, URL confinement and credential stripping. No network requests or servers.')
}

if (process.argv.includes('--self-check')) selfCheck()
else {
  const port = Number(process.env.DESIGN_PREVIEW_PORT || 18775)
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid DESIGN_PREVIEW_PORT')
  const built = process.argv.includes('--built')
  const { createServer, preview } = await import('vite')
  const options = {
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [{
      name: 'anonymous-design-preview',
      configureServer(vite) { vite.middlewares.use(previewMiddleware) },
      configurePreviewServer(vite) { vite.middlewares.use(previewMiddleware) },
    }],
  }
  const listen = { host: '127.0.0.1', port, strictPort: false }
  const server = built ? await preview({ ...options, preview: listen }) : await createServer({ ...options, server: listen })
  if (!built) await server.listen()
  server.printUrls()
  console.log(`${built ? 'Built' : 'Development'} preview; public source: ${publicOrigin}; anonymous GET/HEAD only; all writes stay local.`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void (built ? server.httpServer.close() : server.close()) })
}
