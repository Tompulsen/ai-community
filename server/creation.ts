/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Reuses the Studio account relay, media import and generation protocol rules.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { httpError } from './auth.ts'
import {
  AccountRequest, NewApiError, getNewApiConfig, relayHeaders, resolveRelayCredentials,
} from './native-account/index.ts'
import {
  buildCreationPayload, creationRelayPath, creationTaskPath, normalizeCreationTask, normalizeNativeChat, validateCreationInput,
  type CreationInput, type CreationKind, type CreationReference, type CreationTask, type CreationTaskProtocol,
} from './creation-contract.ts'
import { fetchPublicMedia, PublicImageError } from './creation/public-media.ts'
import { createProxyLifecycle } from './creation/proxy-lifecycle.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'
import type { RequestContext } from './types.ts'
import { readGenerationStream, extractChatReasoning, extractResponseUsage, type CreationEvent } from './creation/stream.ts'
import { imageResultUrls } from '../shared/studio/image-response.ts'
import { modelMcpTools } from './studio-tools.ts'

const MiB = 1024 * 1024
const taskTtl = 90 * 86400
const requestTtl = 30 * 86400
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const uncertain: CreationTask = { status: 'indeterminate', outputs: [], error: '请求已提交，结果尚无法确认。请保留记录并核对使用记录，勿重复生成。' }
type Credentials = Awaited<ReturnType<typeof resolveRelayCredentials>>
type Result = CreationTask & { tokenId: number; protocol: CreationTaskProtocol }
interface TaskOwner { tokenId: number; protocol: CreationTaskProtocol }
interface CreationServices {
  credentials: typeof resolveRelayCredentials
  fetch: typeof fetch
  publicMedia: typeof fetchPublicMedia
}
const services: CreationServices = { credentials: resolveRelayCredentials, fetch, publicMedia: fetchPublicMedia }

function message(error: unknown, secret = '') {
  const value = record(error) && typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : '创作服务暂时不可用。'
  return (secret ? value.split(secret).join('[redacted]') : value)
    .replace(/(?:Bearer\s+|sk-)[A-Za-z0-9_.-]{8,}/gi, '[redacted]').slice(0, 500)
}

async function readJson(response: Response, maximum = 2 * MiB): Promise<unknown> {
  const length = Number(response.headers.get('content-length'))
  if (length > maximum || !response.body) {
    await response.body?.cancel()
    throw httpError(502, '创作服务响应过大或内容为空。')
  }
  let received = 0
  const chunks: Uint8Array[] = []
  for await (const chunk of response.body) {
    received += chunk.byteLength
    if (received > maximum) throw httpError(502, '创作服务响应过大。')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw httpError(502, '创作服务返回了无法识别的响应。') }
}

async function rateLimit(ctx: RequestContext, name: string, maximum: number) {
  const count = Number(await ctx.redis.eval(
    'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n',
    1, `community-next:creation:rate:${name}:${hash(ctx.user!.id)}`,
  ))
  if (count > maximum) throw httpError(429, '操作过于频繁，请稍后再试。')
}

function accountNamespace(ctx: RequestContext) {
  return hash(`${getNewApiConfig().publicUrl}:${ctx.user!.accountId}`)
}
function taskKey(ctx: RequestContext, kind: CreationKind, id: string, protocol: CreationTaskProtocol) {
  return `community-next:creation:task:${accountNamespace(ctx)}:${hash(`${kind}:${protocol}:${id}`)}`
}
function mediaKey(ctx: RequestContext, path: string) {
  return `community-next:creation:media:${accountNamespace(ctx)}:${hash(path)}`
}
function mediaPath(value: string) {
  return /^(?:videos|tasks)\//.test(value) ? `v1/${value}` : value
}
async function remember(ctx: RequestContext, kind: CreationKind, result: Result) {
  const owner: TaskOwner = { tokenId: result.tokenId, protocol: result.protocol }
  if (result.upstreamId) await ctx.redis.set(taskKey(ctx, kind, result.upstreamId, result.protocol), JSON.stringify(owner), 'EX', taskTtl)
  if (result.mediaPath) await ctx.redis.set(mediaKey(ctx, mediaPath(result.mediaPath)), JSON.stringify(owner), 'EX', taskTtl)
}
function ownedResponse(value: unknown, credentials: Credentials) {
  const envelope = record(value) ? value : {}
  const data = record(envelope.data) ? envelope.data : envelope
  const userId = data.user_id ?? envelope.user_id
  if (userId !== undefined && String(userId) !== String(credentials.userId))
    throw httpError(403, '此任务不属于当前章鱼账号。')
}
function responseResult(kind: CreationKind, value: unknown, credentials: Credentials, protocol: CreationTaskProtocol, id?: string): Result {
  ownedResponse(value, credentials)
  const result = normalizeCreationTask(kind, value, id, protocol)
  if (result.error) result.error = message(result.error, credentials.apiKey)
  return { ...result, tokenId: credentials.tokenId, protocol }
}

async function upstreamJson(req: AccountRequest, credentials: Credentials, path: string, svc: CreationServices) {
  if (!creationRelayPath('GET', path)) throw httpError(400, '任务地址无效。')
  const response = await svc.fetch(new URL(`/${path}`, credentials.baseUrl), {
    headers: relayHeaders(req, credentials.apiKey), redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw httpError(response.status === 404 ? 404 : response.status === 401 || response.status === 403 ? 403 : 502,
      response.status === 404 ? '任务或生成文件不存在，可能已过期。' : '暂时无法查询此任务，请稍后再试。')
  }
  return readJson(response, 40 * MiB)
}

async function taskResult(ctx: RequestContext, req: AccountRequest, kind: 'image' | 'video', id: string,
  protocol: CreationTaskProtocol, svc: CreationServices) {
  const path = creationTaskPath(kind, id, protocol)
  const saved = await ctx.redis.get(taskKey(ctx, kind, id, protocol))
  const requestedToken = ctx.url.searchParams.get('tokenId')
  if (saved) {
    const owner = JSON.parse(saved) as TaskOwner
    if (requestedToken && requestedToken !== String(owner.tokenId)) throw httpError(403, '任务密钥与原始记录不一致。')
    req.headers.set('x-new-api-token', String(owner.tokenId))
  } else if (!requestedToken) throw httpError(409, '旧任务缺少原始密钥编号，请保留记录并核对。')
  else req.headers.set('x-new-api-token', requestedToken)
  const credentials = await svc.credentials(req, path)
  let data = await upstreamJson(req, credentials, path, svc)
  ownedResponse(data, credentials)
  const envelope = record(data) ? data : {}
  const details = record(envelope.data) ? envelope.data : envelope
  if (kind === 'video' && protocol === 'plugin' && ['completed', 'succeeded', 'success', 'done'].includes(String(details.status).toLowerCase())) {
    const artifacts = await upstreamJson(req, credentials, `v1/tasks/${id}/artifacts`, svc)
    const rows = Array.isArray(artifacts) ? artifacts : record(artifacts) ? artifacts.data ?? artifacts.artifacts : []
    data = { ...details, artifacts: Array.isArray(rows) ? rows : [] }
  }
  const result = responseResult(kind, data, credentials, protocol, id)
  await remember(ctx, kind, result)
  return result
}

async function references(ctx: RequestContext, req: AccountRequest, input: CreationInput, svc: CreationServices) {
  const files: CreationReference[] = []
  let total = 0
  const urls: string[] = []
  for (const [index, source] of (input.referenceUrls ?? []).entries()) {
    let blob: Blob
    const data = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(source)
    if (data) blob = new Blob([Buffer.from(data[2]!, 'base64')], { type: data[1] })
    else {
      const url = new URL(source, ctx.config.url)
      if (url.origin === new URL(ctx.config.url).origin) {
        if (!/^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(url.pathname) || url.search && !/^\?variant=(?:thumbnail|web)$/.test(url.search))
          throw httpError(400, '参考图地址无效。')
        const options = { headers: { cookie: String(ctx.req.headers.cookie || '') }, url: `${url.pathname}${url.search}` }
        const head = await ctx.request.server.inject({ ...options, method: 'HEAD' })
        if (head.statusCode !== 200 || !/^image\/(?:png|jpeg|webp)$/.test(String(head.headers['content-type']))
          || Number(head.headers['content-length']) > 20 * MiB) throw httpError(400, '参考图无法读取或超过 20 MB。')
        const response = await ctx.request.server.inject({ ...options, method: 'GET' })
        if (response.statusCode !== 200) throw httpError(400, '参考图无法读取。')
        blob = new Blob([new Uint8Array(response.rawPayload)], { type: String(response.headers['content-type']) })
      } else {
        const response = await svc.publicMedia(url.href, 'image', 20 * MiB, req.signal)
        blob = await response.blob()
      }
    }
    total += blob.size
    if (blob.size === 0 || blob.size > 20 * MiB || total > 24 * MiB || !/^image\/(?:png|jpeg|webp)$/.test(blob.type))
      throw httpError(413, '参考图须为 PNG、JPEG 或 WebP，单张不超过 20 MB，总计不超过 24 MB。')
    urls.push(`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`)
    files.push({ blob, name: `reference-${index}.${blob.type.split('/')[1]}` })
  }
  input.referenceUrls = urls
  return files
}

async function cachedResult(ctx: RequestContext, cached: Record<string, unknown>) {
  if (typeof cached.file === 'string' && /^[a-f0-9]{64}\.json$/.test(cached.file) && ctx.filesRoot) {
    try { return JSON.parse(await readFile(path.join(ctx.filesRoot, '.creation-results', cached.file), 'utf8')) }
    catch { return cached.result }
  }
  return cached.result
}
async function generate(ctx: RequestContext, req: AccountRequest, svc: CreationServices, emit: (event: CreationEvent) => void = () => {}) {
  const input = validateCreationInput(ctx.body)
  if (!input.requestId) throw httpError(400, '缺少防止重复提交的请求编号。')
  const key = `community-next:creation:request:${accountNamespace(ctx)}:${input.requestId}`
  const fingerprint = hash(JSON.stringify(ctx.body))
  const existing = await ctx.redis.get(key)
  if (existing) {
    const cached: unknown = JSON.parse(existing)
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return cachedResult(ctx, cached)
  }
  if (input.kind === 'video' && input.videoOptions?.openaiReferenceSource === 'image_url') {
    input.referenceUrls = [input.videoOptions.openaiImageUrl || '', ...(input.videoOptions.mode === 'first-last-frame' ? [input.videoOptions.openaiLastImageUrl || ''] : [])]
    if (input.referenceUrls.some(value => { try { const url = new URL(value); return !['http:', 'https:'].includes(url.protocol) || !!url.username || !!url.password } catch { return true } })) throw httpError(400, '请填写有效的参考图片 URL。')
    input.videoOptions.openaiReferenceSource = 'upload'
  }
  const files = await references(ctx, req, input, svc)
  const tools = input.kind === 'text' && input.chatOptions?.mcpServers.length ? await modelMcpTools(ctx, req, input.chatOptions.mcpServers) : []
  const payload = buildCreationPayload(input, files, tools.map(({ type, function: definition }) => ({ type, function: definition })))
  if (!creationRelayPath('POST', payload.path)) throw httpError(400, '生成接口无效。')
  const credentials = await svc.credentials(req, payload.path)
  const protocol: CreationTaskProtocol = input.protocol === 'async' ? 'async' : input.kind === 'video' ? 'openai' : 'sync'
  const pending = { fingerprint, result: { ...uncertain, tokenId: credentials.tokenId, protocol } }
  const accepted = await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl, 'NX')
  if (accepted !== 'OK') {
    const previous = await ctx.redis.get(key)
    const cached: unknown = previous ? JSON.parse(previous) : null
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return cachedResult(ctx, cached)
  }
  let result: Result
  try {
    const headers = relayHeaders(req, credentials.apiKey)
    headers.delete('content-type')
    if (payload.contentType) headers.set('content-type', payload.contentType)
    headers.set('Idempotency-Key', hash(`${accountNamespace(ctx)}:${input.requestId}`))
    // Keep a paid request alive after the browser stops waiting, and never replay it.
    const response = await svc.fetch(new URL(`/${payload.path}`, credentials.baseUrl), {
      method: 'POST', headers, body: payload.body, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(input.kind === 'image' ? 600000 : 180000),
    })
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
      result = { ...await readGenerationStream(response, input, emit), tokenId: credentials.tokenId, protocol }
    } else {
      const data = await readJson(response, 40 * MiB)
      if (!response.ok) {
      const detail = record(data) && record(data.error) ? data.error.message : record(data) ? data.message : undefined
      result = { status: response.status >= 500 ? 'indeterminate' : 'failed', outputs: [],
        error: message(typeof detail === 'string' ? detail : `生成服务返回 ${response.status}，请核对任务与使用记录。`, credentials.apiKey),
        tokenId: credentials.tokenId, protocol }
      } else {
        result = input.kind === 'text' && input.chatOptions
          ? { ...normalizeNativeChat(input.chatOptions.format, data), tokenId: credentials.tokenId, protocol }
          : responseResult(input.kind, data, credentials, protocol)
        if (input.kind === 'text' && input.chatOptions) {
          const format = input.chatOptions.format
          result.reasoning = format === 'chat-completions' ? (data as { choices?: { message?: { reasoning_content?: string } }[] })?.choices?.[0]?.message?.reasoning_content : extractChatReasoning(format, data)
          result.usage = extractResponseUsage(format, data)
        }
        if (input.kind === 'image' && result.status === 'succeeded' && record(data) && Array.isArray(data.data)) {
          result.outputs = imageResultUrls(data).map(url => ({ url }))
        }
        if (result.status === 'pending' && !result.upstreamId) result = { ...result, ...uncertain }
      }
    }
    await remember(ctx, input.kind, result)
  } catch {
    result = { ...uncertain, tokenId: credentials.tokenId, protocol }
  }
  const serialized = JSON.stringify({ fingerprint, result })
  if (serialized.length > MiB && ctx.filesRoot) {
    try {
      const directory = path.join(ctx.filesRoot, '.creation-results'), file = hash(key) + '.json'
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(path.join(directory, file), JSON.stringify(result), { mode: 0o600 })
      await ctx.redis.set(key, JSON.stringify({ ...pending, file }), 'EX', requestTtl)
    } catch { await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl) }
  } else await ctx.redis.set(key, serialized.length <= MiB ? serialized : JSON.stringify(pending), 'EX', requestTtl)
  return result
}

function classifyModel(id: string): CreationKind | null {
  const name = id.toLowerCase().split('/').pop()!
  if (/seedance|^veo(?:[-_.]?\d|$)|t2v|i2v|s2v|video|sora|runway|pika|gen-[23]|luma|kling|hailuo/.test(name)) return 'video'
  if (/gemini-(?:.*-)?(?:image|nano-banana)|grok-imagine-image|dall-?e|gpt-image|stable-diffusion|(?:^|-)sd-|sdxl|midjourney|flux|imagen|kandinsky|cogview|^agnes-image-|paint|draw|wanx/.test(name)) return 'image'
  if (/embed|whisper|(?:^|-)asr|tts|voice|speech|rerank|^bge|^e[56]-|^gte|music/.test(name)) return null
  return 'text'
}

async function media(ctx: RequestContext, req: AccountRequest, svc: CreationServices) {
  const path = ctx.url.searchParams.get('path')
  const kind = ctx.url.searchParams.get('kind') === 'video' ? 'video' : 'image'
  let response: Response
  if (path) {
    const normalized = mediaPath(path)
    if (!creationRelayPath('GET', normalized) || !/(?:\/content|:download\?alt=media)$/.test(normalized))
      throw httpError(400, '生成文件地址无效。')
    const saved = await ctx.redis.get(mediaKey(ctx, normalized))
    const owner: TaskOwner | null = saved ? JSON.parse(saved) as TaskOwner : null
    if (!owner) throw httpError(409, '请先恢复原任务，再读取生成文件。')
    const requested = ctx.url.searchParams.get('tokenId')
    if (requested && requested !== String(owner.tokenId)) throw httpError(403, '生成文件密钥与原始记录不一致。')
    req.headers.set('x-new-api-token', String(owner.tokenId))
    const credentials = await svc.credentials(req, normalized)
    const lifecycle = createProxyLifecycle(req.signal, 120000)
    try {
      const upstream = await svc.fetch(new URL(`/${normalized}`, credentials.baseUrl), {
        headers: relayHeaders(req, credentials.apiKey, true), signal: lifecycle.signal,
        redirect: 'manual', cache: 'no-store',
      })
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        await upstream.body?.cancel()
        lifecycle.dispose()
        const target = upstream.headers.get('location')
        if (!target) throw httpError(502, '生成文件地址暂时不可用。')
        response = await svc.publicMedia(new URL(target, credentials.baseUrl).href, 'video', 512 * MiB, req.signal)
      } else {
        const type = upstream.headers.get('content-type')?.split(';')[0] || ''
        if (![200, 206].includes(upstream.status) || !/^video\/(?:mp4|webm|quicktime|x-matroska)$/.test(type)) {
          await upstream.body?.cancel()
          throw httpError(upstream.status === 404 ? 404 : 502, '生成文件暂时无法读取。')
        }
        const headers = new Headers({ 'Content-Type': type })
        for (const name of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const value = upstream.headers.get(name)
          if (value) headers.set(name, value)
        }
        response = new Response(lifecycle.stream(upstream.body), { status: upstream.status, headers })
      }
    } catch (error) { lifecycle.dispose(); throw error }
  } else {
    const url = ctx.url.searchParams.get('url')
    if (!url || url.length > 8192) throw httpError(400, '生成文件地址无效。')
    response = await svc.publicMedia(url, kind, kind === 'image' ? 32 * MiB : 512 * MiB, req.signal)
  }
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  await sendWebResponse(ctx.reply, response)
}

export async function handleCreation(ctx: RequestContext, overrides: Partial<CreationServices> = {}): Promise<boolean> {
  if (!ctx.url.pathname.startsWith('/api/creation/')) return false
  const svc = { ...services, ...overrides }
  const user = ctx.requireUser()
  if (!user.accountId || !/^[1-9]\d{0,18}$/.test(user.accountId)) throw httpError(409, '请先用章鱼账号登录社区。')
  const expected = ctx.req.headers['x-new-api-user']
  if (expected !== undefined && expected !== user.accountId) throw httpError(409, '账号已切换，请重新操作。')
  const req = new AccountRequest(applicationRequest(ctx.request, ctx.reply, new URL(ctx.config.url).origin))
  req.headers.set('x-new-api-user', user.accountId)
  try {
    if (ctx.req.method === 'POST' && ctx.url.pathname === '/api/creation/generate') {
      await rateLimit(ctx, 'generate', 12)
      const input = validateCreationInput(ctx.body)
      if (input.imageOptions?.imageStream || input.kind === 'text' && input.chatOptions?.stream) {
        // A disconnected browser stops receiving events; the paid job still finishes and is recoverable.
        ctx.reply.hijack()
        ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
        const emit = (event: CreationEvent) => { if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.write(`data: ${JSON.stringify(event)}\n\n`) }
        const heartbeat = setInterval(() => { if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.write(': keepalive\n\n') }, 15000)
        try { emit({ type: 'result', ...await generate(ctx, req, svc, emit) as object }) }
        catch (error) { emit({ type: 'error', error: message(error) }) }
        finally { clearInterval(heartbeat); if (!ctx.res.destroyed) ctx.res.end() }
      } else ctx.json(200, await generate(ctx, req, svc))
    } else if (ctx.req.method === 'GET' && /^\/api\/creation\/requests\/[A-Za-z0-9_-]{1,128}$/.test(ctx.url.pathname)) {
      await rateLimit(ctx, 'tasks', 180)
      const id = ctx.url.pathname.split('/').pop()!
      const stored = await ctx.redis.get(`community-next:creation:request:${accountNamespace(ctx)}:${id}`)
      if (!stored) throw httpError(404, '没有找到此请求记录。')
      ctx.json(200, await cachedResult(ctx, JSON.parse(stored)))
    } else if (ctx.req.method === 'GET' && ctx.url.pathname === '/api/creation/models') {
      await rateLimit(ctx, 'models', 60)
      const credentials = await svc.credentials(req, 'v1/models')
      const data = await upstreamJson(req, credentials, 'v1/models', svc)
      const items = record(data) && Array.isArray(data.data) ? data.data : []
      ctx.json(200, { tokenId: credentials.tokenId, items: items.flatMap(item => {
        const id = typeof item === 'string' ? item : record(item) && typeof item.id === 'string' ? item.id : ''
        const kind = id.length <= 200 && id.trim() ? classifyModel(id) : null
        const text = (key: string, limit: number) => record(item) && typeof item[key] === 'string' ? item[key].trim().slice(0, limit) : undefined
        return kind ? [{ id, name: text('name', 200) || id, description: text('description', 1000), provider: text('owned_by', 200), kinds: [kind], protocol: 'openai' }] : []
      }) })
    } else if (ctx.req.method === 'GET' && ctx.url.pathname === '/api/creation/media') {
      await rateLimit(ctx, 'media', 120)
      await media(ctx, req, svc)
    } else {
      const match = /^\/api\/creation\/tasks\/(image|video)\/([^/]+)$/.exec(ctx.url.pathname)
      if (ctx.req.method !== 'GET' || !match) return false
      await rateLimit(ctx, 'tasks', 180)
      const protocol = ctx.url.searchParams.get('protocol') || 'openai'
      if (!['openai', 'sync', 'async', 'legacy', 'plugin', 'seedance', 'gemini', 'xai'].includes(protocol))
        throw httpError(400, '任务协议无效。')
      ctx.json(200, await taskResult(ctx, req, match[1] as 'image' | 'video', decodeURIComponent(match[2]!), protocol as CreationTaskProtocol, svc))
    }
    return true
  } catch (error) {
    if (error instanceof NewApiError || error instanceof PublicImageError)
      throw httpError(error.status, message(error), error instanceof NewApiError ? error.code : 'MEDIA_UNAVAILABLE')
    throw error
  }
}
