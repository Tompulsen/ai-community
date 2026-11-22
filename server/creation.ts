/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Reuses the Studio account relay, media import and generation protocol rules.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { sealData, unsealData } from 'iron-session'
import { httpError } from './auth.ts'
import {
  AccountRequest, NewApiError, getNewApiConfig, relayHeaders, resolveRelayCredentials,
} from './native-account/index.ts'
import {
  buildCreationPayload, creationRelayPath, creationTaskPath, normalizeCreationTask, normalizeNativeChat, resolveCreationModelSettings, validateCreationInput,
  type CreationInput, type CreationKind, type CreationReference, type CreationTask, type CreationTaskProtocol,
} from './creation-contract.ts'
import { fetchPublicMedia, PublicImageError } from './creation/public-media.ts'
import { createProxyLifecycle } from './creation/proxy-lifecycle.ts'
import { imagePreview } from './creation/image-preview.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'
import type { RequestContext } from './types.ts'
import { readGenerationStream, extractChatReasoning, extractResponseUsage, type CreationEvent } from './creation/stream.ts'
import { imageResultUrls } from '../shared/studio/image-response.ts'
import { modelMcpTools } from './studio-tools.ts'
import { readModelTypes, type ModelApiFormat } from '../shared/studio/model-types.ts'
import { usesGeminiImageChat } from '../shared/studio/image-params.ts'
import { signCommunityRequest } from './native-account/community-wallet.ts'
import { readAccountModelCatalogue } from './native-account/model-catalogue.ts'
import { resolveModelGroup } from './native-account/model-groups.ts'
import { assertSameOrigin } from './native-account/client.ts'

const MiB = 1024 * 1024
const taskTtl = 90 * 86400
const requestTtl = 30 * 86400
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const uncertain: CreationTask = { status: 'indeterminate', outputs: [], error: '请求已提交，结果尚无法确认。请保留记录并核对使用记录，勿重复生成。' }
type Credentials = Awaited<ReturnType<typeof resolveRelayCredentials>>
type Result = CreationTask & { tokenId: number; protocol: CreationTaskProtocol; apiFormat?: Exclude<ModelApiFormat, 'auto'>; requestId?: string }
interface TrackedRequest {
  fingerprint: string
  kind: CreationKind
  result: Result
  deadline?: number
  tracking?: string
  file?: string
  background?: boolean
  filesRoot?: string
}
interface PollCredentials {
  key: string
  credentials: Credentials
  deadline: number
  filesRoot?: string
}
const pendingTasks = 'community-next:creation:pending'
interface TaskOwner { tokenId: number; protocol: CreationTaskProtocol }
interface CreationServices {
  credentials: typeof resolveRelayCredentials
  modelCatalogue: typeof readAccountModelCatalogue
  groupToken: typeof resolveModelGroup
  fetch: typeof fetch
  publicMedia: typeof fetchPublicMedia
}
const services: CreationServices = { credentials: resolveRelayCredentials, modelCatalogue: readAccountModelCatalogue, groupToken: resolveModelGroup, fetch, publicMedia: fetchPublicMedia }

async function saveRequestResult(redis: RequestContext['redis'], key: string, cached: TrackedRequest, filesRoot?: string, nextPoll = 5000) {
  let stored = cached
  if (JSON.stringify(cached).length > MiB) {
    if (!filesRoot) throw new Error('Result storage is unavailable')
    const directory = path.join(filesRoot, '.creation-results'), file = hash(key) + '.json'
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(directory, file), JSON.stringify(cached.result), { mode: 0o600 })
    stored = { ...cached, result: { ...cached.result, ...uncertain }, file }
  }
  if (!cached.background) { await redis.set(key, JSON.stringify(stored), 'EX', requestTtl); return }
  await redis.eval(
    'redis.call("SET",KEYS[1],ARGV[1],"EX",ARGV[2]); if ARGV[3]=="" then redis.call("ZREM",KEYS[2],ARGV[4]) else redis.call("ZADD",KEYS[2],ARGV[3],ARGV[4]) end; return "OK"',
    2, key, pendingTasks, JSON.stringify(stored), requestTtl,
    cached.result.status === 'pending' ? String(Date.now() + nextPoll) : '', key,
  )
  if (filesRoot) await unlink(path.join(filesRoot, '.creation-results', hash(key) + '.request.json')).catch(() => {})
}
async function requestFallback(cached: TrackedRequest, key: string) {
  if (cached.result.status !== 'pending' || !cached.filesRoot) return cached
  try {
    const fallback = JSON.parse(await readFile(path.join(cached.filesRoot, '.creation-results', hash(key) + '.request.json'), 'utf8')) as TrackedRequest
    if (fallback.fingerprint === cached.fingerprint && fallback.kind === cached.kind) return fallback
  } catch { /* The Redis record remains authoritative when no recovery file exists. */ }
  return cached
}
// Only GET credentials survive a restart; the paid POST is never replayed.
export async function processCreationTasks(redis: RequestContext['redis'], overrides: Partial<CreationServices> = {}) {
  const svc = { ...services, ...overrides }
  const keys = await redis.zrangebyscore(pendingTasks, 0, Date.now(), 'LIMIT', 0, 4)
  await Promise.all(keys.map(async key => {
    const lease = randomUUID(), lock = `${key}:poll`
    if (await redis.set(lock, lease, 'PX', 120000, 'NX') !== 'OK') return
    try {
      const stored = await redis.get(key)
      if (!stored) { await redis.zrem(pendingTasks, key); return }
      const cached = await requestFallback(JSON.parse(stored) as TrackedRequest, key)
      let filesRoot = cached.filesRoot
      if (cached.result.status !== 'pending') {
        await saveRequestResult(redis, key, cached, filesRoot)
        return
      }
      if (!cached.deadline || Date.now() >= cached.deadline) {
        cached.result = { ...cached.result, ...uncertain }
        delete cached.tracking
      } else if (cached.tracking) {
        const credentials = await unsealData<PollCredentials>(cached.tracking, { password: getNewApiConfig().secret })
        if (credentials.key !== key || credentials.deadline !== cached.deadline || !cached.result.upstreamId
          || !['image', 'video'].includes(cached.kind)) throw new Error('Invalid task tracking record')
        filesRoot = credentials.filesRoot
        const route = creationTaskPath(cached.kind as 'image' | 'video', cached.result.upstreamId, cached.result.protocol)
        const response = await svc.fetch(new URL(`/${route}`, credentials.credentials.baseUrl), {
          headers: { Authorization: `Bearer ${credentials.credentials.apiKey}`, 'Cache-Control': 'no-store' },
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000),
        })
        if (!response.ok) {
          await response.body?.cancel()
          await redis.zadd(pendingTasks, Date.now() + (response.status === 429 ? 30000 : 10000), key)
          return
        }
        const result = responseResult(cached.kind, await readJson(response, 40 * MiB), credentials.credentials,
          cached.result.protocol, cached.result.upstreamId)
        cached.result = { ...result, requestId: cached.result.requestId, ...(cached.result.apiFormat ? { apiFormat: cached.result.apiFormat } : {}) }
        if (result.status !== 'pending') delete cached.tracking
        if (result.mediaPath) {
          const namespace = /^community-next:creation:request:([a-f0-9]{64}):/.exec(key)?.[1]
          if (!namespace) throw new Error('Invalid task namespace')
          await redis.set(`community-next:creation:media:${namespace}:${hash(mediaPath(result.mediaPath))}`,
            JSON.stringify({ tokenId: result.tokenId, protocol: result.protocol }), 'EX', taskTtl)
        }
      }
      await saveRequestResult(redis, key, cached, filesRoot)
    } catch {
      await redis.zadd(pendingTasks, Date.now() + 15000, key)
    } finally {
      await redis.eval('if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end', 1, lock, lease)
    }
  }))
}
export function startCreationWorker(redis: RequestContext['redis']) {
  let running = false, stopped = false
  const run = async () => {
    if (running || stopped) return
    running = true
    try { await processCreationTasks(redis) } catch { /* Durable tasks remain queued for the next pass. */ }
    finally { running = false }
  }
  void run()
  const timer = setInterval(() => { void run() }, 1000)
  timer.unref()
  return () => { stopped = true; clearInterval(timer) }
}

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
function ownedResponse(value: unknown, credentials: Credentials, requireOwner = false) {
  const envelope = record(value) ? value : {}
  const data = record(envelope.data) ? envelope.data : envelope
  const userId = data.user_id ?? envelope.user_id
  if (requireOwner && userId === undefined)
    throw httpError(403, '旧任务缺少可验证的账号归属，无法恢复。')
  if (userId !== undefined && String(userId) !== String(credentials.userId))
    throw httpError(403, '此任务不属于当前章鱼账号。')
}
function responseResult(kind: CreationKind, value: unknown, credentials: Credentials, protocol: CreationTaskProtocol, id?: string): Result {
  ownedResponse(value, credentials)
  const result = normalizeCreationTask(kind, value, id, protocol)
  if (result.error) result.error = message(result.error, credentials.apiKey)
  return { ...result, tokenId: credentials.tokenId, protocol }
}

async function upstreamJson(ctx: RequestContext, req: AccountRequest, credentials: Credentials, path: string, svc: CreationServices) {
  if (!creationRelayPath('GET', path)) throw httpError(400, '任务地址无效。')
  const response = await svc.fetch(new URL(`/${path}`, credentials.baseUrl), {
    headers: relayHeaders(req, credentials.apiKey), redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      if (retryAfter) ctx.reply.header('Retry-After', retryAfter)
      throw httpError(429, '任务查询过于频繁，请稍后重试。')
    }
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
  let data = await upstreamJson(ctx, req, credentials, path, svc)
  ownedResponse(data, credentials, !saved)
  const envelope = record(data) ? data : {}
  const details = record(envelope.data) ? envelope.data : envelope
  if (kind === 'video' && protocol === 'plugin' && ['completed', 'succeeded', 'success', 'done'].includes(String(details.status).toLowerCase())) {
    const artifacts = await upstreamJson(ctx, req, credentials, `v1/tasks/${id}/artifacts`, svc)
    const rows = Array.isArray(artifacts) ? artifacts : record(artifacts) ? artifacts.data ?? artifacts.artifacts : []
    data = { ...details, artifacts: Array.isArray(rows) ? rows : [] }
  }
  const result = responseResult(kind, data, credentials, protocol, id)
  await remember(ctx, kind, result)
  return result
}

async function references(ctx: RequestContext, req: AccountRequest, input: CreationInput, svc: CreationServices) {
  let total = 0
  const prepared = new Map<string, { blob: Blob; url: string }>()
  async function prepare(source: string) {
    const previous = prepared.get(source)
    if (previous) return previous
    let blob: Blob
    const data = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(source)
    if (data) blob = new Blob([Buffer.from(data[2]!, 'base64')], { type: data[1] })
    else {
      let url = new URL(source, ctx.config.url)
      if (url.origin === new URL(ctx.config.url).origin) {
        if (url.pathname === '/api/creation/media') {
          const target = url.searchParams.get('url')
          if (!target || target.length > 8192 || url.searchParams.getAll('url').length !== 1
            || [...url.searchParams.keys()].some(key => !['url', 'kind'].includes(key))
            || url.searchParams.has('kind') && url.searchParams.get('kind') !== 'image')
            throw httpError(400, '参考图地址无效。')
          url = new URL(target)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || url.origin === new URL(ctx.config.url).origin) throw httpError(400, '参考图地址无效。')
          const response = await svc.publicMedia(url.href, 'image', 20 * MiB, req.signal)
          blob = await response.blob()
        } else {
          if (!/^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(url.pathname) || url.search && !/^\?variant=(?:thumbnail|web)$/.test(url.search))
            throw httpError(400, '参考图地址无效。')
          const options = { headers: { cookie: String(ctx.req.headers.cookie || '') }, url: `${url.pathname}${url.search}` }
          const head = await ctx.request.server.inject({ ...options, method: 'HEAD' })
          if (head.statusCode !== 200 || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(String(head.headers['content-type']))
            || Number(head.headers['content-length']) > 20 * MiB) throw httpError(400, '参考图无法读取或超过 20 MB。')
          const response = await ctx.request.server.inject({ ...options, method: 'GET' })
          if (response.statusCode !== 200) throw httpError(400, '参考图无法读取。')
          blob = new Blob([new Uint8Array(response.rawPayload)], { type: String(response.headers['content-type']) })
        }
      } else {
        const response = await svc.publicMedia(url.href, 'image', 20 * MiB, req.signal)
        blob = await response.blob()
      }
    }
    const originalSize = blob.size
    if (blob.size === 0 || blob.size > 20 * MiB || total + blob.size > 24 * MiB || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type))
      throw httpError(413, '参考图须为 PNG、JPEG、WebP、GIF 或 AVIF，单张不超过 20 MB，总计不超过 24 MB。')
    if (/^image\/(?:gif|avif)$/.test(blob.type)) {
      try {
        const png = await sharp(Buffer.from(await blob.arrayBuffer()), { pages: 1, limitInputPixels: 100_000_000, failOn: 'warning' }).rotate().png().toBuffer()
        blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
      } catch { throw httpError(400, '参考图无法解码，请更换图片或重新上传。') }
    }
    total += Math.max(originalSize, blob.size)
    if (blob.size > 20 * MiB || total > 24 * MiB) throw httpError(413, '参考图转换后过大，单张不超过 20 MB，总计不超过 24 MB。')
    const value = { blob, url: `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}` }
    prepared.set(source, value)
    return value
  }
  const files: CreationReference[] = [], urls: string[] = []
  for (const [index, source] of (input.referenceUrls ?? []).entries()) {
    const value = await prepare(source)
    files.push({ blob: value.blob, name: `reference-${index}.${value.blob.type.split('/')[1]}` })
    urls.push(value.url)
  }
  if (input.kind === 'image' && usesGeminiImageChat(input.model, input.apiFormat) && input.imageContext) {
    for (const turn of input.imageContext.turns) {
      const images: string[] = []
      for (const source of turn.images) images.push((await prepare(source)).url)
      turn.images = images
      if (turn.references) {
        const attachments: string[] = []
        for (const source of turn.references) attachments.push((await prepare(source)).url)
        turn.references = attachments
      }
    }
  }
  input.referenceUrls = urls
  return files
}

async function cachedResult(ctx: RequestContext, cached: Record<string, unknown>, key?: string) {
  if (key) {
    const original = cached as unknown as TrackedRequest
    const recovered = await requestFallback(original, key)
    if (recovered !== original) {
      cached = recovered as unknown as Record<string, unknown>
      await saveRequestResult(ctx.redis, key, recovered, ctx.filesRoot, 0).catch(() => {})
    }
  }
  let result = cached.result as Result
  if (typeof cached.file === 'string' && /^[a-f0-9]{64}\.json$/.test(cached.file) && ctx.filesRoot) {
    try { result = JSON.parse(await readFile(path.join(ctx.filesRoot, '.creation-results', cached.file), 'utf8')) }
    catch { /* Keep the saved request state when its result file is unavailable. */ }
  }
  if (result.status === 'pending' && typeof cached.deadline === 'number' && Date.now() >= cached.deadline)
    result = { ...result, ...uncertain }
  if (cached.kind === 'image' || cached.kind === 'video' || cached.kind === 'text') {
    await remember(ctx, cached.kind, result).catch(() => {})
  }
  return result
}
async function generate(ctx: RequestContext, req: AccountRequest, svc: CreationServices, emit: (event: CreationEvent) => void = () => {}, background = false) {
  let input = validateCreationInput(ctx.body)
  if (!input.requestId) throw httpError(400, '缺少防止重复提交的请求编号。')
  const key = `community-next:creation:request:${accountNamespace(ctx)}:${input.requestId}`
  const fingerprint = hash(JSON.stringify(ctx.body))
  const existing = await ctx.redis.get(key)
  if (existing) {
    const cached: unknown = JSON.parse(existing)
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return cachedResult(ctx, cached, key)
  }
  const options = (await ctx.db.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')).rows[0]?.clientOptions
  const setting = readModelTypes(options?.communityModelTypes).find(item => item.id === input.model)
  input = resolveCreationModelSettings(input, setting)
  if (input.kind === 'video' && input.videoOptions?.openaiReferenceSource === 'image_url') {
    input.referenceUrls = [input.videoOptions.openaiImageUrl || '', ...(input.videoOptions.mode === 'first-last-frame' ? [input.videoOptions.openaiLastImageUrl || ''] : [])]
    if (input.referenceUrls.some(value => { try { const url = new URL(value); return !['http:', 'https:'].includes(url.protocol) || !!url.username || !!url.password } catch { return true } })) throw httpError(400, '请填写有效的参考图片 URL。')
    input.videoOptions.openaiReferenceSource = 'upload'
  }
  const files = await references(ctx, req, input, svc)
  const tools = input.kind === 'text' && input.chatOptions?.mcpServers.length ? await modelMcpTools(ctx, req, input.chatOptions.mcpServers) : []
  const payload = buildCreationPayload(input, files, tools.map(({ type, function: definition }) => ({ type, function: definition })), setting?.video)
  if (!creationRelayPath('POST', payload.path)) throw httpError(400, '生成接口无效。')
  const credentials = await svc.credentials(req, payload.path)
  const url = new URL(`/${payload.path}`, credentials.baseUrl)
  const headers = relayHeaders(req, credentials.apiKey)
  headers.delete('content-type')
  if (payload.contentType) headers.set('content-type', payload.contentType)
  headers.set('Idempotency-Key', hash(`${accountNamespace(ctx)}:${input.requestId}`))
  const signed = await signCommunityRequest(url, credentials.userId, headers, payload.body)
  const protocol: CreationTaskProtocol = input.protocol === 'async' ? 'async' : input.kind === 'video' ? 'openai' : 'sync'
  const apiFormat = input.apiFormat && input.apiFormat !== 'auto' ? input.apiFormat : undefined
  if (background && getNewApiConfig().secret.length < 32) throw httpError(503, '任务服务配置不完整，请联系管理员。')
  const pending: TrackedRequest = { fingerprint, kind: input.kind, result: { status: 'pending', outputs: [], requestId: input.requestId,
    tokenId: credentials.tokenId, protocol, ...(apiFormat ? { apiFormat } : {}) },
    deadline: Date.now() + (input.kind === 'image' ? 615000 : input.kind === 'video' ? 375000 : 195000),
    ...(background ? { background: true, filesRoot: ctx.filesRoot } : {}) }
  const accepted = background ? await ctx.redis.eval(
    'if redis.call("SET",KEYS[1],ARGV[1],"EX",ARGV[2],"NX") then redis.call("ZADD",KEYS[2],ARGV[3],ARGV[4]); return "OK" end; return false',
    2, key, pendingTasks, JSON.stringify(pending), requestTtl, pending.deadline!, key,
  ) : await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl, 'NX')
  if (accepted !== 'OK') {
    const previous = await ctx.redis.get(key)
    const cached: unknown = previous ? JSON.parse(previous) : null
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return cachedResult(ctx, cached, key)
  }
  const finish = async () => {
  let result: Result
  try {
    // Keep a paid request alive after the browser stops waiting, and never replay it.
    const response = await svc.fetch(url, {
      method: 'POST', ...signed, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(input.kind === 'image' ? 600000 : input.kind === 'video' ? 360000 : 180000),
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
  } catch {
    result = { ...uncertain, tokenId: credentials.tokenId, protocol }
  }
  if (apiFormat) result.apiFormat = apiFormat
  if (background) result.requestId = input.requestId
  // A metadata outage must not discard an accepted paid result; cached reads repair ownership.
  await remember(ctx, input.kind, result).catch(() => {})
  const tracked = { ...pending, result }
  if (background && result.status === 'pending' && result.upstreamId) {
    tracked.deadline = Date.now() + (input.kind === 'video' ? 7200000 : 1800000)
    tracked.tracking = await sealData({ key, credentials, deadline: tracked.deadline, filesRoot: ctx.filesRoot } satisfies PollCredentials,
      { password: getNewApiConfig().secret, ttl: 86400 })
  }
  let saved = false
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await saveRequestResult(ctx.redis, key, tracked, ctx.filesRoot, 0); saved = true; break }
    catch { if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt)) }
  }
  if (!saved && background && ctx.filesRoot) {
    const directory = path.join(ctx.filesRoot, '.creation-results')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(directory, hash(key) + '.request.json'), JSON.stringify(tracked), { mode: 0o600 })
  } else if (!saved && !background) await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl)
  return result
  }
  if (!background) return finish()
  void finish().catch(() => { /* Keep the durable request boundary; never repeat the POST. */ })
  return pending.result
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
  const variant = ctx.url.searchParams.get('variant')
  if (variant !== null && (variant !== 'preview' || ctx.url.searchParams.getAll('variant').length !== 1
    || ctx.url.searchParams.has('path') || ctx.url.searchParams.has('kind') && ctx.url.searchParams.get('kind') !== 'image'))
    throw httpError(400, '图片预览地址无效。')
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
    response = variant === 'preview' ? await imagePreview(url, svc.publicMedia, req.signal)
      : await svc.publicMedia(url, kind, kind === 'image' ? 32 * MiB : 512 * MiB, req.signal)
  }
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (variant === 'preview') ctx.reply.header('Content-Length', response.headers.get('content-length')!)
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
      const background = input.kind !== 'text' && String(ctx.req.headers.prefer || '').split(',').some(value => value.trim() === 'respond-async')
      if (!background && (input.imageOptions?.imageStream || input.kind === 'text' && input.chatOptions?.stream)) {
        // A disconnected browser stops receiving events; the paid job still finishes and is recoverable.
        ctx.reply.hijack()
        ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
        const emit = (event: CreationEvent) => { if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.write(`data: ${JSON.stringify(event)}\n\n`) }
        const heartbeat = setInterval(() => { if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.write(': keepalive\n\n') }, 15000)
        try { emit({ type: 'result', ...await generate(ctx, req, svc, emit) as object }) }
        catch (error) {
          const statusCode = record(error) ? Number(error.statusCode ?? error.status) : 0
          const notAccepted = [400, 401, 403, 413, 422, 429].includes(statusCode)
            || record(error) && error.code === 'COMMUNITY_WALLET_CONFIG'
          emit({ type: 'error', error: message(error),
            ...(notAccepted ? { statusCode, notAccepted: true } : {}) })
        }
        finally { clearInterval(heartbeat); if (!ctx.res.destroyed) ctx.res.end() }
      } else ctx.json(background ? 202 : 200, await generate(ctx, req, svc, undefined, background))
    } else if (ctx.req.method === 'GET' && /^\/api\/creation\/requests\/[A-Za-z0-9_-]{1,128}$/.test(ctx.url.pathname)) {
      await rateLimit(ctx, 'tasks', 180)
      const id = ctx.url.pathname.split('/').pop()!
      const stored = await ctx.redis.get(`community-next:creation:request:${accountNamespace(ctx)}:${id}`)
      if (!stored) throw httpError(404, '没有找到此请求记录。')
      ctx.json(200, await cachedResult(ctx, JSON.parse(stored), `community-next:creation:request:${accountNamespace(ctx)}:${id}`))
    } else if (['GET', 'POST'].includes(ctx.req.method || '') && ctx.url.pathname === '/api/creation/models') {
      const management = ctx.url.searchParams.get('management') === '1'
      if (management) ctx.requireAdmin()
      await rateLimit(ctx, 'models', 60)
      const allGroups = ctx.url.searchParams.get('scope') === 'all'
      if (ctx.req.method === 'POST') {
        // Resolving a group can provision its token; validate origin before any mutation.
        assertSameOrigin(req)
        const group = record(ctx.body) ? ctx.body.group : undefined
        if (management || allGroups || typeof group !== 'string' || !group.trim() || group !== group.trim() || group.length > 200 || /[\u0000-\u001f\u007f]/u.test(group))
          throw httpError(400, '请选择有效的模型分组。')
        const tokenId = await svc.groupToken(req, group)
        if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw httpError(502, '模型分组暂不可用，请重试。')
        req.headers.set('x-new-api-token', String(tokenId))
      }
      const catalogue = management || allGroups ? await svc.modelCatalogue(req) : undefined
      const credentials = catalogue ? undefined : await svc.credentials(req, 'v1/models')
      const data = credentials ? await upstreamJson(ctx, req, credentials, 'v1/models', svc) : undefined
      const items: unknown[] = catalogue?.items ?? (record(data) && Array.isArray(data.data) ? data.data : [])
      const options = (await ctx.db.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')).rows[0]?.clientOptions
      const types = new Map(readModelTypes(options?.communityModelTypes).map(item => [item.id, item]))
      ctx.json(200, { ...(catalogue ? { groups: catalogue.groups } : { tokenId: credentials!.tokenId }), items: items.flatMap(item => {
        const id = typeof item === 'string' ? item : record(item) && typeof item.id === 'string' ? item.id : ''
        const configured = types.get(id), configuredKind = configured?.kind
        const valid = id.length > 0 && id.length <= 200 && id === id.trim() && !/[\u0000-\u001f\u007f]/u.test(id)
        const kind = valid ? configuredKind ?? classifyModel(id) : null
        const text = (key: string, limit: number) => record(item) && typeof item[key] === 'string' ? item[key].trim().slice(0, limit) : undefined
        return valid && (kind || management) ? [{ id, name: configured?.name || text('name', 200) || id, description: text('description', 1000), provider: text('owned_by', 200), kinds: kind ? [kind] : [], ...(configuredKind ? { configuredKind } : {}),
          ...(catalogue && record(item) ? { groups: item.groups } : {}),
          ...(configured?.tags ? { tags: configured.tags } : {}),
          ...(configured?.apiFormat ? { apiFormat: configured.apiFormat } : {}),
          ...(kind === 'image' && configured?.image ? { image: configured.image } : {}),
          ...(kind === 'text' && configured?.text ? { text: configured.text } : {}),
          ...(kind === 'video' && configured?.video ? { video: configured.video } : {}),
          protocol: configured?.protocol || 'openai' }] : []
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
