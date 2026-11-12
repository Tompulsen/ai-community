/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { IncomingMessage } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type HTTPMethods } from 'fastify'
import multipart from '@fastify/multipart'
import { parse } from 'yaml'
import pg from 'pg'
import { Redis } from 'ioredis'
import { authServices, httpError, newId } from './auth.ts'
import { handleContent } from './content.ts'
import { handleLottery, startPendingWorker } from './lottery.ts'
import { handleAccount } from './account.ts'
import { handleSocial } from './social.ts'
import { handleAdmin } from './admin.ts'
import { handleSecurity } from './security.ts'
import { startMediaWorker } from './media.ts'
import { handleAccountRequest } from './native-account/index.ts'
import { handleCreation } from './creation.ts'
import { handleStudioTools, closeMcpClients } from './studio-tools.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'
import type { AppConfig, Database, RequestContext } from './types.ts'
export { compareStreamIds } from './social.ts'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }
const bodyLimit = 28 * 1024 * 1024
const nativeAccountPath = (pathname: string) => /^\/(?:studio\/)?api\/new-api\//.test(pathname)
const objectBody = { type: 'object', additionalProperties: true } as const

export function requireSameOrigin(req: Pick<IncomingMessage, 'method' | 'headers'>, origin: string, allowMultipart = false) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) return
  if (req.headers.origin !== origin) throw httpError(403, '请从本站重新提交操作。', 'ORIGIN_REQUIRED')
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  if (!contentType.startsWith('application/json') && !(allowMultipart && contentType.startsWith('multipart/form-data;'))) throw httpError(415, '请使用正确的请求格式提交。')
}

export function staticPath(root: string, pathname: string) {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { throw httpError(400, '地址格式无效。') }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..') || decoded.split('/').some(part => part.startsWith('.'))) throw httpError(404, '文件不存在。')
  const filename = path.resolve(root, '.' + decoded)
  if (filename !== root && !filename.startsWith(root + path.sep)) throw httpError(404, '文件不存在。')
  return filename
}

interface ApplicationOptions {
  db: Database
  redis: Redis
  config: AppConfig
  filesRoot: string
  distRoot?: string
}

type ModuleHandler = (ctx: RequestContext) => Promise<boolean>
type RouteGroup = [HTTPMethods | HTTPMethods[], string[]]

export function createApplication({ db, redis, config, filesRoot, distRoot = path.join(projectRoot, 'dist') }: ApplicationOptions): FastifyInstance {
  const origin = new URL(config.url).origin
  const auth = authServices({ db, redis, config })
  const app = Fastify({
    bodyLimit, requestTimeout: 120000, exposeHeadRoutes: false,
    routerOptions: { maxParamLength: 512 },
    ajv: { customOptions: { coerceTypes: false, useDefaults: false, removeAdditional: false } },
  })
  app.addHook('onClose', closeMcpClients)
  const contexts = new WeakMap<FastifyRequest, RequestContext>()
  app.register(multipart, { limits: { files: 1, fields: 4, parts: 5, fieldSize: 4096, fileSize: 10 * 1024 ** 3 } })
  const parseJson = app.getDefaultJsonParser('error', 'error')
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body === '') done(null, {})
    else parseJson(request, typeof body === 'string' ? body : body.toString('utf8'), done)
  })
  app.addHook('onRequest', async (request, reply) => {
    let url: URL
    try { url = new URL(request.raw.url || '/', origin) } catch { throw httpError(400, '地址格式无效。') }
    if (url.pathname !== '/healthz') requireSameOrigin(request.raw, origin, url.pathname === '/api/uploads' && request.method === 'POST')
  })
  app.addHook('preHandler', async (request, reply) => {
    const url = new URL(request.raw.url || '/', origin)
    if (url.pathname === '/healthz' || nativeAccountPath(url.pathname)) return
    const identity = await auth.authenticate(request.raw)
    const requireUser = () => {
      if (!identity.user) throw httpError(401, '请先登录。', 'AUTH_REQUIRED')
      return identity.user
    }
    contexts.set(request, {
      req: request.raw, request, res: reply.raw, reply, url, ip: request.ip,
      body: (request.body || {}) as Record<string, unknown>,
      db, redis, config, filesRoot, newId, ...identity,
      json: (status, value) => {
        if (reply.sent) return
        reply.headers(reply.raw.getHeaders()).code(status)
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff').send(value)
      },
      createSession: (userId, expectedTokenHash, account) => auth.createSession(userId, reply.raw, request.raw, expectedTokenHash, account),
      requireUser,
      requireAdmin: () => {
        const user = requireUser()
        if (!user.isAdmin) throw httpError(403, '需要管理员权限。')
        return user
      },
    })
  })
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { status?: number; statusCode?: number; code?: string; validation?: unknown }
    const status = failure.code === '23505' ? 409 : failure.statusCode || failure.status || 500
    if (status >= 500) console.error(JSON.stringify({ path: request.url.split('?')[0], code: failure.code || failure.name, at: failure.stack?.split('\n').slice(1, 3).join(' ') }))
    if (reply.raw.headersSent) { if (!reply.raw.writableEnded) reply.raw.destroy(); return }
    const message = status >= 500 ? '服务暂时不可用，请稍后重试。'
      : failure.code === '23505' ? '记录已经存在，请刷新后重试。'
      : failure.validation || failure.code?.startsWith('FST_ERR_CTP_INVALID_JSON') || failure.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ? '请求内容格式无效。'
      : status === 413 ? '上传内容过大。' : failure.message
    reply.headers(reply.raw.getHeaders()).code(status)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send({ error: { message, code: failure.code || undefined } })
  })
  const register = (handler: ModuleHandler, groups: RouteGroup[]) => {
    for (const [methods, urls] of groups) for (const method of Array.isArray(methods) ? methods : [methods]) for (const url of urls) {
      app.route({
        method, url,
        ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && url !== '/api/uploads' ? { schema: { body: objectBody } } : {}),
        handler: async (request, reply) => {
          const ctx = contexts.get(request)
          if (!ctx) throw httpError(500, 'Request context missing')
          if (!await handler(ctx)) ctx.json(404, { error: { message: '接口不存在。' } })
          return reply
        },
      })
    }
  }
  const health = async (_request: FastifyRequest, reply: FastifyReply) => {
    await Promise.all([db.query('SELECT 1'), redis.ping()])
    reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
    return { status: 'ok', backend: 'community-next', framework: 'fastify', database: 'ready', creation: 'native' }
  }
  app.route({ method: ['GET', 'HEAD'], url: '/healthz', handler: health })
  for (const url of ['/api/new-api/*', '/studio/api/new-api/*']) app.all(url, async (request, reply) =>
    sendWebResponse(reply, await handleAccountRequest(applicationRequest(request, reply, origin))))
  for (const url of ['/studio', '/studio/*']) app.route({ method: ['GET', 'HEAD'], url,
    handler: async (_request, reply) => reply.redirect('/create', 302) })
  register(handleCreation, [
    ['GET', ['/api/creation/models', '/api/creation/tasks/:kind/:id', '/api/creation/media', '/api/creation/requests/:id']],
    ['POST', ['/api/creation/generate']],
  ])
  register(handleStudioTools, [
    ['GET', ['/api/creation/skills/catalog', '/api/creation/mcp/status', '/api/creation/mcp/tools']],
    ['POST', ['/api/creation/search', '/api/creation/mcp/config', '/api/creation/mcp/call']],
  ])
  register(auth.handleAuth, [
    ['GET', ['/api/session', '/api/registration']],
    ['POST', ['/api/session/login', '/api/session/logout', '/api/session/register']],
    ['PATCH', ['/api/profile']],
  ])
  register(handleAccount, [
    ['GET', ['/api/newapi/callback', '/auth/newapi', '/api/newapi/config', '/api/account']],
    ['POST', ['/api/account/session', '/api/account/connect', '/api/newapi/start', '/api/account/finish', '/api/newapi/finish',
      '/api/newapi/studio/start', '/api/newapi/studio/exchange', '/api/newapi/studio/context', '/api/newapi/studio/validate']],
  ])
  register(handleLottery, [
    ['GET', ['/api/lottery/status', '/api/lottery/records', '/api/admin/lottery/config', '/api/admin/lottery/account', '/api/admin/lottery/records']],
    ['POST', ['/api/lottery/draw', '/api/admin/lottery/chances', '/api/admin/lottery/retry']],
    ['PATCH', ['/api/admin/lottery/config']],
  ])
  register(handleContent, [
    [['GET', 'HEAD'], ['/legacy-files/:id', '/files/:key']],
    ['GET', ['/api/works', '/api/community/works', '/api/library', '/api/admin/submissions', '/api/tags', '/api/creators', '/api/announcements',
      '/api/users/:id', '/api/users/:id/followers', '/api/users/:id/following', '/api/uploads/limits', '/api/uploads/:id']],
    ['POST', ['/api/uploads', '/api/works', '/api/admin/submissions/:id/review', '/api/works/:id/like', '/api/works/:id/save', '/api/users/:id/follow',
      '/api/works/:id/view', '/api/works/:id/repost', '/api/works/:id/report', '/api/reports', '/api/works/:id/comments/:commentId/like']],
    [['GET', 'POST'], ['/api/works/:id/comments']],
    ['DELETE', ['/api/works/:id/comments/:commentId']],
    [['GET', 'PATCH', 'DELETE'], ['/api/works/:id']],
    ['POST', ['/api/community/submissions/create', '/api/community/submissions/update', '/api/community/submissions/delete',
      '/api/community/submissions/show', '/api/community/submissions/mine', '/api/community/works', '/api/community/works/show',
      '/api/community/tags', '/api/community/comments/delete', '/api/admin/community/submissions', '/api/admin/community/submissions/review']],
  ])
  register(handleSocial, [
    ['GET', ['/api/notifications', '/api/messages', '/api/messages/threads', '/api/messages/:userId']],
    ['POST', ['/api/notifications/read', '/api/messages/:userId', '/api/messages/:userId/read']],
  ])
  register(handleAdmin, [
    ['GET', ['/api/site', '/api/admin/settings', '/api/admin/announcements', '/api/admin/community/config', '/api/admin/community/ads', '/api/community/ads', '/api/admin/tags', '/api/admin/users', '/api/admin/reports']],
    ['PATCH', ['/api/admin/settings', '/api/admin/community/config', '/api/admin/community/ads', '/api/admin/tags/:id', '/api/admin/users/:id', '/api/admin/reports/:id']],
    ['POST', ['/api/admin/tags', '/api/admin/announcements']],
    ['DELETE', ['/api/admin/tags/:id', '/api/admin/announcements/:id']],
  ])
  register(handleSecurity, [
    ['GET', ['/api/security/capabilities', '/api/security/status', '/api/security/logins', '/api/security/sessions']],
    ['POST', ['/api/security/password/forgot', '/api/security/password/reset', '/api/security/password', '/api/security/sessions/revoke']],
  ])
  app.all('/api/*', async (_request, reply) => reply.code(404).header('Cache-Control', 'private, no-store').send({ error: { message: '接口不存在。' } }))
  const serveClient = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, '请求方式不支持。')
    const url = new URL(request.raw.url || '/', origin)
    if (url.pathname === '/activity') return reply.redirect('/activities', 302)
    const legacyWork = /^\/community\/(?:works?|submissions)\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
    if (legacyWork) return reply.redirect(`/work/${legacyWork[1]}`, 302)
    if (['/sw.js', '/sw', '/service-worker.js'].includes(url.pathname)) {
      const source = 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.registration.unregister()));'
      return reply.type('text/javascript').header('Cache-Control', 'no-store').header('Service-Worker-Allowed', '/').send(request.method === 'HEAD' ? '' : source)
    }
    let filename = staticPath(distRoot, url.pathname)
    let metadata
    try { metadata = await stat(filename) } catch { /* Client routes use the application entry. */ }
    if (!metadata?.isFile()) {
      if (path.extname(filename)) throw httpError(404, '文件不存在。')
      filename = path.join(distRoot, 'index.html')
      metadata = await stat(filename)
    }
    reply.headers({
      'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Length': metadata.size,
      'Cache-Control': filename.endsWith('index.html') ? 'no-cache' : url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    })
    return reply.send(request.method === 'HEAD' ? undefined : createReadStream(filename))
  }
  app.route({ method: ['GET', 'HEAD'], url: '/', handler: serveClient })
  app.route({ method: ['GET', 'HEAD'], url: '/*', handler: serveClient })
  app.setNotFoundHandler(serveClient)
  app.server.headersTimeout = 30000
  return app
}

export async function start(): Promise<FastifyInstance> {
  const config = parse(await readFile(process.env.CONFIG_PATH || path.join(projectRoot, '.config/default.yml'), 'utf8')) as AppConfig
  if (!config?.db || !config?.redis || !config.url) throw new Error('Database, Redis and site configuration are required')
  const db = new pg.Pool({ host: config.db.host, port: config.db.port || 5432, user: config.db.user, password: config.db.pass, database: config.db.db, max: 10, connectionTimeoutMillis: 8000, statement_timeout: 15000 })
  const source = config.redis
  const redis = new Redis({ host: source.host, port: source.port || 6379, password: source.pass, username: source.username, db: source.db || 0, keyPrefix: `${source.prefix ?? new URL(config.url).host}:`, maxRetriesPerRequest: 1, connectTimeout: 8000 })
  db.on('error', () => console.error('Database connection interrupted'))
  redis.on('error', () => console.error('Redis connection interrupted'))
  await Promise.all([db.query('SELECT 1'), redis.ping()])
  const app = createApplication({ db, redis, config, filesRoot: process.env.FILES_ROOT || '/app/files' })
  const stopWorker = process.env.DISABLE_LOTTERY_WORKER === '1' ? () => {} : startPendingWorker({ db, config, newId })
  const stopMedia = process.env.DISABLE_MEDIA_WORKER === '1' ? async () => {} : startMediaWorker({ db, filesRoot: process.env.FILES_ROOT || '/app/files' })
  app.addHook('onClose', async () => {
    stopWorker()
    await stopMedia()
    await Promise.allSettled([db.end(), redis.quit()])
  })
  await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '0.0.0.0' })
  console.log(JSON.stringify({ status: 'listening', port: app.server.address(), backend: 'community-next', framework: 'fastify' }))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1 })
  })
  return app
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(error => { console.error(JSON.stringify({ status: 'startup-failed', code: (error as Error).name })); process.exitCode = 1 })
}
