import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { httpError } from './auth.ts'
import type { RequestContext } from './types.ts'
import { DOCUMENT_MAX_BYTES, documentJobRequest, documentName, documentPlan } from '../shared/studio/document-workspace.ts'

const uuid = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}'
const routes: Record<string, RegExp> = {
  GET: new RegExp(`^(?:capabilities|assets|jobs|jobs/${uuid}|assets/${uuid}/versions|assets/${uuid}/[1-9][0-9]{0,5}/(?:structure|changes|download))$`),
  POST: new RegExp(`^(?:jobs|upload|jobs/${uuid}/retry)$`),
  DELETE: new RegExp(`^(?:jobs|assets)/${uuid}$`),
}

export async function handleDocuments(ctx: RequestContext, fetcher: typeof fetch = fetch): Promise<boolean> {
  const resource = ctx.url.pathname.replace(/^\/api\/documents\//, '')
  const method = ctx.req.method || 'GET'
  if (!ctx.url.pathname.startsWith('/api/documents/') || !routes[method]?.test(resource)) return false
  const user = ctx.requireUser()
  if (!user.accountId || !/^[1-9]\d{0,14}$/.test(user.accountId)) throw httpError(409, '请先用章鱼账号登录。')
  if (ctx.req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, '请从本站打开文档。')
  if (ctx.req.headers['x-new-api-user'] !== user.accountId) throw httpError(409, '账号已切换，请重新打开文档工作区。')
  const origin = process.env.DOCUMENT_SERVICE_URL, secret = process.env.DOCUMENT_SERVICE_SECRET
  if (!origin || !secret || secret.length < 32) {
    if (resource === 'capabilities') { ctx.json(200, { enabled: false, docx: false, xlsx: false, reason: '文档服务暂未就绪，请稍后重试。' }); return true }
    throw httpError(503, '文档服务暂未就绪，请稍后重试。')
  }
  const count = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n', 1,
    `community-next:documents:rate:${method}:${createHash('sha256').update(user.accountId).digest('hex')}`))
  if (count > (method === 'GET' ? 180 : 20)) throw httpError(429, '文档操作过于频繁，请稍后重试。')
  const upstream = new URL(resource, origin.replace(/\/$/, '') + '/')
  const sessionId = ctx.url.searchParams.get('sessionId')
  if (sessionId && ['assets', 'jobs'].includes(resource)) upstream.searchParams.set('sessionId', sessionId.slice(0, 128))
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}`, 'X-Document-Owner': `user-${user.accountId}` }
  let body: string | Buffer | undefined
  if (method === 'POST') {
    if (resource === 'jobs' || resource === 'upload') {
      const key = ctx.body.key
      if (typeof key !== 'string' || !new RegExp(`^${uuid}$`).test(key)) throw httpError(400, '文档任务编号无效。')
      headers['Idempotency-Key'] = key
    }
    if (resource === 'upload') {
      const { fileName, data, sessionId } = ctx.body
      if (!documentName.safeParse(fileName).success || typeof fileName !== 'string' || !/\.(docx|xlsx)$/.test(fileName)
        || typeof sessionId !== 'string' || !sessionId || sessionId.length > 128
        || typeof data !== 'string' || data.length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw httpError(400, '请选择 20 MiB 以内的 DOCX / XLSX 文件。')
      body = Buffer.from(data, 'base64')
      if (body.length > DOCUMENT_MAX_BYTES || body.length < 4 || body.readUInt32LE(0) !== 0x04034b50) throw httpError(400, '文件内容无效，请选择 DOCX / XLSX 原文件。')
      headers['Content-Type'] = 'application/octet-stream'; headers['X-File-Name'] = encodeURIComponent(fileName); headers['X-Chat-Session'] = sessionId
    } else if (resource === 'jobs') {
      const plan = documentPlan.safeParse(ctx.body.plan), request = documentJobRequest.safeParse(ctx.body.request)
      if (!plan.success || !request.success) throw httpError(400, '文档内容或参数无效，请检查后重试。')
      body = JSON.stringify({ plan: plan.data, request: request.data })
      if (Buffer.byteLength(body) > 600 * 1024) throw httpError(413, '文档内容过长，请缩小范围。')
      headers['Content-Type'] = 'application/json'
    }
  }
  let response: Response
  try { response = await fetcher(upstream, { method, headers, body: typeof body === 'string' || body === undefined ? body : new Uint8Array(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) }) }
  catch { throw httpError(502, '文档服务暂时不可用，已生成的内容可稍后重试制作。') }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null
    ctx.json(response.status >= 500 ? 502 : response.status, { error: { message: typeof data?.error === 'string' ? data.error : '文档操作失败，请稍后重试。' } })
  } else if (resource.endsWith('/download') && response.body) {
    ctx.reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
    for (const name of ['content-type', 'content-disposition', 'content-length']) {
      const value = response.headers.get(name)
      if (value) ctx.reply.header(name, value)
    }
    ctx.reply.send(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream))
  } else ctx.json(response.status, await response.json())
  return true
}
