/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Reuses the Studio account relay, media import and generation protocol rules.
 */
import { workSkillInstructions } from './content.ts'
import { chatOptionsSchema } from '../shared/studio/options.ts'
import { mediaSkillPrompt } from './community-skills.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
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
import { acquireImageRead, imagePreview, releaseImageRead } from './creation/image-preview.ts'
import { videoPoster, videoPosterSourceLimit } from './creation/video-poster.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'
import type { RequestContext } from './types.ts'
import { readGenerationStream, GenerationStreamError, extractChatReasoning, extractResponseUsage, type CreationEvent } from './creation/stream.ts'
import { createTextLifecycle } from './creation/text-lifecycle.ts'
import { createEventWriter } from './creation/event-writer.ts'
import { trackCreation, creationsClosing } from './creation/inflight.ts'
import { textGenerationTimeouts, creationStreamProtocol } from '../shared/studio/creation-limits.ts'
import { imageResultUrls } from '../shared/studio/image-response.ts'
import { modelMcpTools } from './studio-tools.ts'
import { readModelTypes, referenceCountIssue, resolveReferenceLimits, type ModelApiFormat } from '../shared/studio/model-types.ts'
import { usesGeminiImageChat } from '../shared/studio/image-params.ts'
import { signCommunityRequest } from './native-account/community-wallet.ts'
import { readAccountModelCatalogue, classifyModel } from './native-account/model-catalogue.ts'
import { resolveModelGroup } from './native-account/model-groups.ts'
import { assertSameOrigin } from './native-account/client.ts'
import { resolveVideoModelSetting } from './video-models.ts'
import { videoDurationSeconds } from './video-privacy.ts'
import { sniffType } from './media.ts'
import type { VideoModelSetting } from '../shared/studio/model-types.ts'

const MiB = 1024 * 1024
const taskTtl = 90 * 86400
const requestTtl = 30 * 86400
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const uncertain: CreationTask = { status: 'indeterminate', outputs: [], error: '获取生成结果失败。' }
const workSkillError = '生成服务未能完成本次技能调用，请核对任务与使用记录。'
const preparationErrors = new Set(['NEW_API_GROUP_TOKEN_UNAVAILABLE', 'NEW_API_TOKEN_REQUIRED', 'COMMUNITY_WALLET_CONFIG'])
type Credentials = Awaited<ReturnType<typeof resolveRelayCredentials>>
type Result = CreationTask & { tokenId: number; protocol: CreationTaskProtocol; apiFormat?: Exclude<ModelApiFormat, 'auto'>; requestId?: string; deadline?: number }
interface TrackedRequest {
  fingerprint: string
  hasWorkSkills?: boolean
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
interface TaskOwner { tokenId: number; protocol: CreationTaskProtocol; hasWorkSkills?: boolean }
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
  if (!cached.background) await redis.set(key, JSON.stringify(stored), 'EX', requestTtl)
  else await redis.eval(
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
        const stage = cached.tracking ? '任务查询' : '网关提交'
        cached.result = { ...cached.result, ...uncertain, errorStage: stage,
          error: stageError(stage, '等待结果超时。', cached.result.errorStatus) }
        delete cached.tracking
      } else if (cached.tracking) {
        let result: Result
        let queryStatus: number | undefined
        try {
        const credentials = await unsealData<PollCredentials>(cached.tracking, { password: getNewApiConfig().secret })
        if (credentials.key !== key || credentials.deadline !== cached.deadline || !cached.result.upstreamId
          || !['image', 'video'].includes(cached.kind)) throw new Error('Invalid task tracking record')
        filesRoot = credentials.filesRoot
        const route = creationTaskPath(cached.kind as 'image' | 'video', cached.result.upstreamId, cached.result.protocol)
        const response = await svc.fetch(new URL(`/${route}`, credentials.credentials.baseUrl), {
          headers: { Authorization: `Bearer ${credentials.credentials.apiKey}`, 'Cache-Control': 'no-store' },
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000),
        })
        queryStatus = response.status
        if (!response.ok) {
          await response.body?.cancel()
          cached.result = { ...cached.result, errorStage: '任务查询', errorStatus: response.status,
            error: stageError('任务查询', '网关暂未返回任务状态，后台将自动重试。', response.status) }
          await saveRequestResult(redis, key, cached, filesRoot, response.status === 429 ? 30000 : 10000)
          return
        }
        result = responseResult(cached.kind, await readJson(response, 40 * MiB), credentials.credentials,
          cached.result.protocol, cached.result.upstreamId, cached.hasWorkSkills)
        } catch {
          cached.result = { ...cached.result, errorStage: '任务查询', errorStatus: queryStatus,
            error: stageError('任务查询', '读取网关任务状态失败，后台将自动重试。', queryStatus) }
          logCreationFailure(key.split(':').pop(), '任务查询', queryStatus)
          await saveRequestResult(redis, key, cached, filesRoot, 15000)
          return
        }
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
    try { await trackCreation(redis, processCreationTasks(redis)) } catch { /* Durable tasks remain queued for the next pass. */ }
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
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted]')
    .replace(/(?:Bearer\s+|sk-)[A-Za-z0-9_.-]{8,}/gi, '[redacted]').slice(0, 500)
}
function stageError(stage: string, detail: string, status?: number) {
  return `${stage}失败${status ? `（HTTP ${status}）` : ''}：${detail}`
}
function logCreationFailure(requestId: unknown, stage: string, status?: number, code?: unknown, notAccepted?: boolean) {
  console.error(JSON.stringify({ event: 'creation_failure',
    requestId: typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(requestId) ? requestId : undefined,
    stage, status, code: typeof code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : undefined,
    ...(notAccepted === undefined ? {} : { notAccepted }),
  }))
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
async function remember(ctx: RequestContext, kind: CreationKind, result: Result, hasWorkSkills = false) {
  const owner: TaskOwner = { tokenId: result.tokenId, protocol: result.protocol, ...(hasWorkSkills ? { hasWorkSkills: true } : {}) }
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
function responseResult(kind: CreationKind, value: unknown, credentials: Credentials, protocol: CreationTaskProtocol, id?: string, hasWorkSkills = false): Result {
  ownedResponse(value, credentials)
  const result = normalizeCreationTask(kind, value, id, protocol)
  if (result.error) {
    result.errorStage ??= result.status === 'save_failed' ? '结果保存' : result.status === 'indeterminate' ? '网关响应处理' : '生成任务'
    result.error = stageError(result.errorStage, hasWorkSkills ? workSkillError : message(result.error, credentials.apiKey), result.errorStatus)
  }
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
    throw Object.assign(httpError(response.status === 404 ? 404 : response.status === 401 || response.status === 403 ? 403 : 502,
      response.status === 404 ? '任务或生成文件不存在，可能已过期。' : '暂时无法查询此任务，请稍后再试。'), { errorStatus: response.status })
  }
  return readJson(response, 40 * MiB)
}

async function taskResult(ctx: RequestContext, req: AccountRequest, kind: 'image' | 'video', id: string,
  protocol: CreationTaskProtocol, svc: CreationServices) {
  const path = creationTaskPath(kind, id, protocol)
  const saved = await ctx.redis.get(taskKey(ctx, kind, id, protocol))
  const requestedToken = ctx.url.searchParams.get('tokenId')
  const owner: TaskOwner | null = saved ? JSON.parse(saved) as TaskOwner : null
  if (owner) {
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
  const hasWorkSkills = owner?.hasWorkSkills ?? !saved
  const result = responseResult(kind, data, credentials, protocol, id, hasWorkSkills)
  await remember(ctx, kind, result, hasWorkSkills)
  return result
}

async function references(ctx: RequestContext, req: AccountRequest, input: CreationInput, svc: CreationServices, videoSetting?: VideoModelSetting,
  limits?: ReturnType<typeof resolveReferenceLimits>, limitImageHistory = false) {
  if (input.kind === 'video' && videoSetting?.operation === 'upscale') {
    if (input.referenceUrls?.length !== 1) throw httpError(400, '视频超分需上传一个源视频。')
    const issue = limits && referenceCountIssue({ images: 0, videos: 1, audios: 0 }, limits)
    if (issue) throw httpError(400, issue)
    const source = new URL(input.referenceUrls[0]!, ctx.config.url)
    const fileId = /^\/legacy-files\/([A-Za-z0-9]{1,32})$/.exec(source.pathname)?.[1]
    if (source.origin !== new URL(ctx.config.url).origin || source.search || source.hash || source.username || source.password || !fileId)
      throw httpError(400, '源视频须为当前账号上传的视频。')
    const headers = { cookie: String(ctx.req.headers.cookie || '') }
    const owned = await ctx.request.server.inject({ method: 'GET', url: `/api/uploads/${fileId}`, headers })
    if (owned.statusCode !== 200) throw httpError(404, '源视频不存在或不属于当前账号。')
    const file: unknown = owned.json().file
    if (!record(file) || file.id !== fileId || file.type !== 'video/mp4'
      || file.processing !== 'ready') throw httpError(400, '源视频尚未就绪或格式不受支持。')
    const size = typeof file.size === 'string' && /^[1-9]\d*$/.test(file.size) ? Number(file.size) : file.size
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > videoPosterSourceLimit) throw httpError(413, '源视频须非空且不超过 64 MB。')
    const head = await ctx.request.server.inject({ method: 'HEAD', url: `/legacy-files/${fileId}`, headers })
    const type = String(head.headers['content-type'] || '').split(';')[0]!
    if (head.statusCode !== 200 || type !== 'video/mp4') throw httpError(400, '源视频无法安全读取，请重新上传。')
    const length = Number(head.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 1 || length > videoPosterSourceLimit)
      throw httpError(413, '源视频须非空且不超过 64 MB。')
    const response = await ctx.request.server.inject({ method: 'GET', url: `/legacy-files/${fileId}`, headers })
    if (response.statusCode !== 200 || String(response.headers['content-type'] || '').split(';')[0] !== type)
      throw httpError(400, '源视频读取失败，请重新上传。')
    const bytes = response.rawPayload
    if (!bytes.length || bytes.length > videoPosterSourceLimit) throw httpError(413, '源视频须非空且不超过 64 MB。')
    const durationSeconds = await videoDurationSeconds(bytes, type, req.signal)
    input.duration = Math.ceil(durationSeconds)
    return [{ blob: new Blob([new Uint8Array(bytes)], { type }), name: `source-${fileId}.mp4`,
      mediaType: 'video' as const, durationSeconds }]
  }
  let total = 0
  let mediaTotal = 0
  const localHeads = new Map<string, { statusCode: number; type: string; length: number }>()
  if (limits) {
    const counts = { images: input.kind === 'video' && input.videoOptions?.openaiReferenceSource === 'file_id' ? 1 : 0, videos: 0, audios: 0 }
    let sources = [...input.referenceUrls ?? []]
    if (limitImageHistory && input.kind === 'image' && usesGeminiImageChat(input.model, input.apiFormat)) {
      for (const turn of input.imageContext?.turns ?? []) sources.push(...turn.images, ...turn.references ?? [])
      if (input.apiFormat === 'gemini') sources = [...new Set(sources)]
    }
    for (const source of sources) {
      let kind: keyof typeof counts = 'images'
      if (!source.startsWith('data:')) {
        const url = new URL(source, ctx.config.url)
        if (url.origin === new URL(ctx.config.url).origin && /^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(url.pathname)
          && (!url.search || /^\?variant=(?:thumbnail|web)$/.test(url.search))) {
          let head = localHeads.get(source)
          if (!head) {
            const response = await ctx.request.server.inject({ method: 'HEAD', url: `${url.pathname}${url.search}`,
              headers: { cookie: String(ctx.req.headers.cookie || '') } })
            head = { statusCode: response.statusCode, type: String(response.headers['content-type'] || ''), length: Number(response.headers['content-length']) }
            localHeads.set(source, head)
          }
          kind = head.type.startsWith('video/') ? 'videos' : head.type.startsWith('audio/') ? 'audios' : 'images'
        }
      }
      counts[kind]++
    }
    const issue = referenceCountIssue(counts, limits)
    if (issue) throw httpError(400, issue)
  }
  const prepared = new Map<string, { blob: Blob; url: string; mediaType?: 'image' | 'video' | 'audio'; durationSeconds?: number }>()
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
          let head = localHeads.get(source)
          if (!head) {
            const response = await ctx.request.server.inject({ ...options, method: 'HEAD' })
            head = { statusCode: response.statusCode, type: String(response.headers['content-type'] || ''), length: Number(response.headers['content-length']) }
          }
          const type = head.type.split(';')[0]!
          if (input.kind === 'video' && /^(?:video|audio)\//.test(type)) {
            const fileId = /^\/legacy-files\/([A-Za-z0-9]{1,32})$/.exec(url.pathname)?.[1]
            if (!fileId || url.search || url.hash || url.username || url.password) throw httpError(400, '视频和音频参考须为当前账号上传的文件。')
            const owned = await ctx.request.server.inject({ method: 'GET', url: `/api/uploads/${fileId}`, headers: options.headers })
            if (owned.statusCode !== 200) throw httpError(404, '参考素材不存在或不属于当前账号。')
            const file: unknown = owned.json().file
            if (!record(file) || file.id !== fileId || file.type !== type || file.processing !== 'ready'
              || !['video/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg'].includes(type))
              throw httpError(400, '参考素材尚未就绪或格式不受支持。')
            const size = typeof file.size === 'string' && /^[1-9]\d*$/.test(file.size) ? Number(file.size) : file.size
            const length = head.length
            if (head.statusCode !== 200 || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > 64 * MiB
              || !Number.isSafeInteger(length) || length < 1 || length > 64 * MiB || mediaTotal + length > 64 * MiB)
              throw httpError(413, '参考素材须非空，单个及合计不超过 64 MB。')
            const response = await ctx.request.server.inject({ ...options, method: 'GET' })
            const bytes = response.rawPayload
            if (response.statusCode !== 200 || String(response.headers['content-type'] || '').split(';')[0] !== type
              || !bytes.length || bytes.length > 64 * MiB || mediaTotal + bytes.length > 64 * MiB || sniffType(bytes, type) !== type)
              throw httpError(400, '参考素材内容或格式无效，请重新上传。')
            const mediaType = type === 'video/mp4' ? 'video' as const : 'audio' as const
            const durationSeconds = mediaType === 'video' ? await videoDurationSeconds(bytes, type, req.signal) : undefined
            mediaTotal += bytes.length
            const value = { blob: new Blob([new Uint8Array(bytes)], { type }), url: source, mediaType, durationSeconds }
            prepared.set(source, value)
            return value
          }
          if (head.statusCode !== 200 || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(head.type)
            || head.length > 20 * MiB) throw httpError(400, '参考图无法读取或超过 20 MB。')
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
    mediaTotal += Math.max(originalSize, blob.size)
    if (blob.size > 20 * MiB || total > 24 * MiB) throw httpError(413, '参考图转换后过大，单张不超过 20 MB，总计不超过 24 MB。')
    if (input.kind === 'video' && mediaTotal > 64 * MiB) throw httpError(413, '参考素材合计不能超过 64 MB。')
    const value = { blob, url: `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
      mediaType: 'image' as const, durationSeconds: undefined }
    prepared.set(source, value)
    return value
  }
  const files: CreationReference[] = [], urls: string[] = []
  for (const [index, source] of (input.referenceUrls ?? []).entries()) {
    const value = await prepare(source)
    files.push({ blob: value.blob, name: `reference-${index}.${value.blob.type === 'audio/mpeg' ? 'mp3' : value.blob.type.split('/')[1]}`,
      mediaType: value.mediaType ?? 'image', ...(value.durationSeconds !== undefined ? { durationSeconds: value.durationSeconds } : {}) })
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
  if (input.kind === 'video' && files.reduce((size, file) => size + file.blob.size, 0) > 64 * MiB) throw httpError(413, '参考素材合计不能超过 64 MB。')
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
  if (result.status === 'pending' && typeof cached.deadline === 'number' && Date.now() >= cached.deadline) {
    const stage = cached.tracking ? '任务查询' : '网关提交'
    result = { ...result, status: 'indeterminate', errorStage: stage, error: stageError(stage, '等待结果超时。', result.errorStatus) }
  }
  if (cached.kind === 'text' && typeof cached.deadline === 'number') result = { ...result, deadline: cached.deadline }
  if (result.status === 'indeterminate' && result.error === '请求已提交，结果尚无法确认。请保留记录并核对使用记录，勿重复生成。')
    result = { ...result, error: uncertain.error }
  if (cached.kind === 'image' || cached.kind === 'video' || cached.kind === 'text') {
    await remember(ctx, cached.kind, result, cached.hasWorkSkills === true).catch(() => {})
  }
  return result
}
async function generate(ctx: RequestContext, req: AccountRequest, svc: CreationServices, emit: (event: CreationEvent) => void = () => {}, background = false) {
  let errorStage = '请求校验', recoverable = false
  try {
  let input = validateCreationInput(ctx.body)
  if (!input.requestId) throw httpError(400, '缺少防止重复提交的请求编号。')
  const key = `community-next:creation:request:${accountNamespace(ctx)}:${input.requestId}`
  const fingerprint = hash(JSON.stringify(ctx.body))
  errorStage = '请求记录读取'; recoverable = true
  const existing = await ctx.redis.get(key)
  recoverable = Boolean(existing)
  if (existing) {
    const cached: unknown = JSON.parse(existing)
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return await cachedResult(ctx, cached, key)
  }
  errorStage = '技能准备'
  const workSkills = input.skills?.filter(skill => skill.id.startsWith('work-')) || []
  const instructions = await workSkillInstructions(ctx, workSkills, input.kind)
  const hasWorkSkills = workSkills.length > 0
  if (input.kind === 'text' && instructions.length) {
    const options = input.chatOptions || chatOptionsSchema.parse({ messages: [{ role: 'user', content: input.prompt }] })
    input.chatOptions = { ...options, messages: [...instructions.map(content => ({ role: 'system' as const, content })), ...options.messages] }
  } else input.prompt = await mediaSkillPrompt(ctx.db, input.kind, input.prompt, input.skills, new Map(workSkills.map((skill, index) => [skill.id, instructions[index]!])))
  errorStage = '模型配置读取'
  const options = (await ctx.db.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')).rows[0]?.clientOptions
  const setting = readModelTypes(options?.communityModelTypes).find(item => item.id === input.model)
  input = resolveCreationModelSettings(input, setting)
  if (input.kind === 'video' && input.videoOptions?.openaiReferenceSource === 'image_url') {
    input.referenceUrls = [input.videoOptions.openaiImageUrl || '', ...(input.videoOptions.mode === 'first-last-frame' ? [input.videoOptions.openaiLastImageUrl || ''] : [])]
    if (input.referenceUrls.some(value => { try { const url = new URL(value); return !['http:', 'https:'].includes(url.protocol) || !!url.username || !!url.password } catch { return true } })) throw httpError(400, '请填写有效的参考图片 URL。')
    input.videoOptions.openaiReferenceSource = 'upload'
  }
  errorStage = '参考素材准备'
  const videoSetting = input.kind === 'video' ? resolveVideoModelSetting(input.model, setting?.video) : undefined
  const limits = input.kind === 'text' ? undefined : resolveReferenceLimits(input.kind,
    input.kind === 'image' ? setting?.image : videoSetting, videoSetting?.operation === 'upscale')
  const files = await references(ctx, req, input, svc, videoSetting, limits, setting?.image?.maxReferenceImages !== undefined)
  errorStage = '工具准备'
  const tools = input.kind === 'text' && input.chatOptions?.mcpServers.length ? await modelMcpTools(ctx, req, input.chatOptions.mcpServers) : []
  errorStage = '生成参数组装'
  const payload = buildCreationPayload(input, files, tools.map(({ type, function: definition }) => ({ type, function: definition })), setting?.video)
  if (input.kind === 'video' && files.some(file => file.mediaType === 'video')
    && resolveVideoModelSetting(input.model, setting?.video)?.operation !== 'upscale') {
    const sent = typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
    const seconds = Number(sent.seconds)
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds + files.reduce((sum, file) => sum + (file.mediaType === 'video' ? file.durationSeconds! : 0), 0) > 3600)
      throw httpError(400, '参考视频与生成视频的合计时长不能超过 3600 秒。')
  }
  if (!creationRelayPath('POST', payload.path)) throw httpError(400, '生成接口无效。')
  errorStage = '网关凭证准备'
  const credentials = await svc.credentials(req, payload.path)
  const url = new URL(`/${payload.path}`, credentials.baseUrl)
  const headers = relayHeaders(req, credentials.apiKey)
  headers.delete('content-type')
  if (payload.contentType) headers.set('content-type', payload.contentType)
  headers.set('Idempotency-Key', hash(`${accountNamespace(ctx)}:${input.requestId}`))
  errorStage = '请求签名'
  const signed = await signCommunityRequest(url, credentials.userId, headers, payload.body)
  if (input.kind === 'video') {
    if (signed.body instanceof FormData) {
      const frozen = new Response(signed.body)
      signed.body = await frozen.arrayBuffer()
      signed.headers.set('Content-Type', frozen.headers.get('content-type')!)
    }
    const bytes = typeof signed.body === 'string' ? Buffer.byteLength(signed.body) : signed.body.byteLength
    if (bytes > 65 * MiB) throw httpError(413, '视频请求超过 65 MB，请减少参考素材后重试。')
  }
  const protocol: CreationTaskProtocol = input.protocol === 'async' ? 'async' : input.kind === 'video' ? 'openai' : 'sync'
  const apiFormat = input.apiFormat && input.apiFormat !== 'auto' ? input.apiFormat : undefined
  errorStage = '任务登记'
  if (background && getNewApiConfig().secret.length < 32)
    throw Object.assign(httpError(503, '任务服务配置不完整，请联系管理员。'), { notAccepted: true })
  const textStream = input.kind === 'text' && input.chatOptions?.stream
  const deadline = Date.now() + (input.kind === 'image' ? 615000 : input.kind === 'video' ? 375000 : textStream ? textGenerationTimeouts.total + textGenerationTimeouts.save : 195000)
  const pending: TrackedRequest = { fingerprint, kind: input.kind, ...(hasWorkSkills ? { hasWorkSkills: true } : {}), result: { status: 'pending', outputs: [], requestId: input.requestId,
    ...(input.kind === 'text' ? { deadline } : {}),
    tokenId: credentials.tokenId, protocol, ...(apiFormat ? { apiFormat } : {}) },
    deadline, ...(background ? { background: true } : {}),
    ...(background || input.kind === 'text' ? { filesRoot: ctx.filesRoot } : {}) }
  recoverable = true
  const accepted = background ? await ctx.redis.eval(
    'if redis.call("SET",KEYS[1],ARGV[1],"EX",ARGV[2],"NX") then redis.call("ZADD",KEYS[2],ARGV[3],ARGV[4]); return "OK" end; return false',
    2, key, pendingTasks, JSON.stringify(pending), requestTtl, pending.deadline!, key,
  ) : await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl, 'NX')
  if (accepted !== 'OK') {
    errorStage = '请求记录读取'
    const previous = await ctx.redis.get(key)
    const cached: unknown = previous ? JSON.parse(previous) : null
    if (!record(cached) || cached.fingerprint !== fingerprint) throw httpError(409, '请求编号已被使用，请先核对原任务。')
    return await cachedResult(ctx, cached, key)
  }
  errorStage = '结果保存'
  if (textStream) emit({ type: 'accepted', requestId: input.requestId, deadline })
  const finish = async () => {
  let result: Result
  let responseReceived = false
  let responseStatus: number | undefined
  const lifecycle = textStream ? createTextLifecycle() : undefined
  try {
    // Keep a paid request alive after the browser stops waiting, and never replay it.
    const response = await svc.fetch(url, {
      method: 'POST', ...signed, redirect: 'error', cache: 'no-store',
      signal: lifecycle?.signal ?? AbortSignal.timeout(input.kind === 'image' ? 600000 : input.kind === 'video' ? 360000 : 180000),
    })
    lifecycle?.receivedResponse()
    responseReceived = true
    responseStatus = response.status
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
      result = { ...await readGenerationStream(response, input, emit, { signal: lifecycle?.signal, progress: lifecycle?.progress,
        intervalMs: ctx.req.headers['x-creation-stream'] === creationStreamProtocol ? 75 : 300 }), tokenId: credentials.tokenId, protocol }
    } else {
      const data = await readJson(response, 40 * MiB).catch(error => { if (response.ok) throw error; return null })
      if (!response.ok) {
      const detail = record(data) && record(data.error) ? data.error.message : record(data) ? data.message : undefined
      const admission = payload.path === 'async-videos/v1/tasks' && record(data) && typeof data.detail === 'string'
        ? new Map([
          ['video_storage_capacity_reached', { status: 503, error: '视频缓存暂时没有足够空间，本次请求未提交至模型，请稍后重试。' }],
          ['insufficient_disk_space', { status: 503, error: '视频服务磁盘空间不足，本次请求未提交至模型，请联系管理员。' }],
          ['video_queue_full', { status: 429, error: '视频生成队列已满，本次请求未提交至模型，请稍后重试。' }],
        ]).get(data.detail) : undefined
      const rejected = admission?.status === response.status ? admission.error : undefined
      result = { status: rejected ? 'failed' : response.status >= 500 ? 'indeterminate' : 'failed', outputs: [],
        error: stageError('网关提交', message(rejected || (!hasWorkSkills && typeof detail === 'string' ? detail : '网关返回错误响应，是否已转发上游尚未确认。'), credentials.apiKey), response.status),
        errorStage: '网关提交', errorStatus: response.status,
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
        if (result.status === 'pending' && !result.upstreamId)
          result = { ...result, ...uncertain, error: '生成服务未返回可读取的生成结果。' }
      }
    }
  } catch (error) {
    const detail = lifecycle?.signal.aborted ? String(lifecycle.signal.reason.message)
      : error instanceof GenerationStreamError ? error.message
      : record(error) && typeof error.statusCode === 'number' ? message(error, credentials.apiKey)
      : error instanceof Error && error.name === 'TimeoutError' ? '等待生成服务响应超时。'
      : responseReceived ? '读取生成结果失败。' : '生成服务连接异常，未能获取生成结果。'
    const stage = responseReceived ? '网关响应处理' : '网关提交'
    result = { ...uncertain, ...(error instanceof GenerationStreamError ? error.partial : {}), error: stageError(stage, detail, responseStatus), errorStage: stage,
      ...(responseStatus ? { errorStatus: responseStatus } : {}), tokenId: credentials.tokenId, protocol }
  } finally { lifecycle?.dispose() }
  if (input.kind === 'text') {
    result.deadline = deadline
    if (result.status === 'indeterminate' && (result.outputs.some(output => output.text) || result.reasoning))
      result.error += ' 已保留部分回答，内容尚未完整生成。'
  }
  if (hasWorkSkills && result.error)
    result.error = result.errorStage ? stageError(result.errorStage, workSkillError, result.errorStatus) : workSkillError
  if (result.error && !result.errorStage) {
    result.errorStage = result.status === 'save_failed' ? '结果保存' : result.status === 'failed' ? '生成任务' : '网关响应处理'
    result.errorStatus = responseStatus
    result.error = stageError(result.errorStage, result.error, responseStatus)
  }
  if (result.error) logCreationFailure(input.requestId, result.errorStage || '网关响应处理', result.errorStatus)
  if (apiFormat) result.apiFormat = apiFormat
  if (background) result.requestId = input.requestId
  // A metadata outage must not discard an accepted paid result; cached reads repair ownership.
  await remember(ctx, input.kind, result, hasWorkSkills).catch(() => {})
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
  if (!saved && (background || input.kind === 'text') && ctx.filesRoot) {
    const directory = path.join(ctx.filesRoot, '.creation-results')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(directory, hash(key) + '.request.json'), JSON.stringify(tracked), { mode: 0o600 })
  } else if (!saved && !background) await ctx.redis.set(key, JSON.stringify(pending), 'EX', requestTtl)
  return result
  }
  if (!background) return await finish()
  void trackCreation(ctx.redis, finish()).catch(() => { /* Keep the durable request boundary; never repeat the POST. */ })
  return pending.result
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('创作服务暂时不可用。'), { errorStage, notAccepted: !recoverable })
  }
}


async function media(ctx: RequestContext, req: AccountRequest, svc: CreationServices) {
  const path = ctx.url.searchParams.get('path')
  const kind = ctx.url.searchParams.get('kind') === 'video' ? 'video' : 'image'
  const variant = ctx.url.searchParams.get('variant')
  if (variant !== null && (ctx.url.searchParams.getAll('variant').length !== 1 ||
    !(variant === 'poster' && ctx.url.searchParams.get('kind') === 'video' ||
      variant === 'preview' && !ctx.url.searchParams.has('path') && (!ctx.url.searchParams.has('kind') || ctx.url.searchParams.get('kind') === 'image'))))
    throw httpError(400, '媒体预览地址无效。')
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
    const load = async (signal: AbortSignal) => {
      const lifecycle = createProxyLifecycle(signal, 120000)
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
        return await svc.publicMedia(new URL(target, credentials.baseUrl).href, 'video', variant === 'poster' ? videoPosterSourceLimit : 512 * MiB, signal)
      } else {
        const type = upstream.headers.get('content-type')?.split(';')[0] || ''
        if (![200, 206].includes(upstream.status) || !/^video\/(?:mp4|webm|quicktime|x-matroska)$/.test(type)) {
          await upstream.body?.cancel()
          throw Object.assign(httpError(upstream.status === 404 ? 404 : 502, '生成文件暂时无法读取。'), { errorStatus: upstream.status })
        }
        const headers = new Headers({ 'Content-Type': type })
        for (const name of ['content-range', 'accept-ranges', 'etag', 'last-modified', 'content-length']) {
          const value = upstream.headers.get(name)
          if (value) headers.set(name, value)
        }
        return new Response(lifecycle.stream(upstream.body), { status: upstream.status, headers })
      }
      } catch (error) { lifecycle.dispose(); throw error }
    }
    response = variant === 'poster'
      ? await videoPoster(hash(`${ctx.user!.id}:${accountNamespace(ctx)}:${credentials.tokenId}:${normalized}`), load, req.signal)
      : await load(req.signal)
  } else {
    const url = ctx.url.searchParams.get('url')
    if (!url || url.length > 8192) throw httpError(400, '生成文件地址无效。')
    if (kind === 'image' && variant === null) {
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(65000)])
      await acquireImageRead(signal)
      try {
        const original = await svc.publicMedia(url, 'image', 32 * MiB, signal)
        let bytes: Buffer
        try { bytes = Buffer.from(await original.arrayBuffer()) }
        catch { throw httpError(502, '原图传输中断，请重试保存图片。', 'ORIGINAL_IMAGE_READ_FAILED') }
        signal.throwIfAborted()
        if (!bytes.length || bytes.length > 32 * MiB) throw httpError(413, '原图为空或超过 32 MB，请手动下载保存。')
        // A sent Fastify reply can still have bytes queued for a slow client.
        const completed = finished(ctx.res, { cleanup: true }).catch(() => { ctx.res.destroy() })
        const abortResponse = () => { ctx.res.destroy() }
        signal.addEventListener('abort', abortResponse, { once: true })
        try {
          ctx.reply.headers({ 'Content-Type': original.headers.get('content-type') || 'application/octet-stream',
            'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes)
        } catch (error) { ctx.res.destroy(); throw error }
        finally {
          await completed
          signal.removeEventListener('abort', abortResponse)
        }
        return
      } finally { releaseImageRead() }
    }
    response = variant === 'preview' ? await imagePreview(url, svc.publicMedia, req.signal)
      : variant === 'poster' ? await videoPoster(
        hash(`${ctx.user!.id}:${accountNamespace(ctx)}:${ctx.sessionHash || ''}:${req.headers.get('x-new-api-token') || ''}:${url}`),
        signal => svc.publicMedia(url, 'video', videoPosterSourceLimit, signal), req.signal)
        : await svc.publicMedia(url, kind, kind === 'image' ? 32 * MiB : 512 * MiB, req.signal)
  }
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (variant === 'preview' || variant === 'poster') ctx.reply.header('Content-Length', response.headers.get('content-length')!)
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
      if (creationsClosing(ctx.redis)) throw Object.assign(httpError(503, '服务正在更新，请稍后提交。'), { notAccepted: true, errorStage: '请求校验' })
      const input = validateCreationInput(ctx.body)
      const background = input.kind !== 'text' && String(ctx.req.headers.prefer || '').split(',').some(value => value.trim() === 'respond-async')
      if (!background && (input.imageOptions?.imageStream || input.kind === 'text' && input.chatOptions?.stream)) {
        // A disconnected browser stops receiving events; the paid job still finishes and is recoverable.
        ctx.reply.hijack()
        ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
        const writer = createEventWriter(ctx.res, ctx.req.headers['x-creation-stream'] === creationStreamProtocol, input.kind === 'text' ? 256 * 1024 : 40 * MiB)
        const emit = writer.emit
        try { emit({ type: 'result', ...await trackCreation(ctx.redis, generate(ctx, req, svc, emit)) as object }) }
        catch (error) {
          const statusCode = record(error) ? Number(error.statusCode ?? error.status) : 0
          const stage = record(error) && typeof error.errorStage === 'string' ? error.errorStage : '请求校验'
          const notAccepted = record(error) && typeof error.notAccepted === 'boolean' ? error.notAccepted
            : [400, 401, 403, 413, 422, 429].includes(statusCode) || record(error) && preparationErrors.has(String(error.code))
          const detail = statusCode < 500 || error instanceof NewApiError || error instanceof PublicImageError ? message(error) : '服务暂时不可用。'
          logCreationFailure(record(ctx.body) ? ctx.body.requestId : undefined, stage, statusCode || 500, record(error) ? error.code : undefined, notAccepted)
          emit({ type: 'error', error: stageError(stage, detail, statusCode || 500) + (notAccepted ? ' 未向生成网关提交请求。' : ''), errorStage: stage, errorStatus: statusCode || 500, notAccepted,
            ...(error instanceof NewApiError ? { code: error.code } : {}),
            ...(notAccepted ? { statusCode, notAccepted: true } : {}) })
        }
        finally { writer.end() }
      } else ctx.json(background ? 202 : 200, await trackCreation(ctx.redis, generate(ctx, req, svc, undefined, background)))
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
        const preload = record(ctx.body) ? ctx.body.preload : undefined
        if (management || allGroups || typeof group !== 'string' || !group.trim() || group !== group.trim() || group.length > 200 || /[\u0000-\u001f\u007f]/u.test(group))
          throw httpError(400, '请选择有效的模型分组。')
        if (preload !== undefined && typeof preload !== 'boolean') throw httpError(400, '模型预加载参数无效。')
        const tokenId = await svc.groupToken(req, group, preload !== true)
        if (preload === true && tokenId === undefined) { ctx.json(200, { prepared: false, items: [] }); return true }
        if (!Number.isSafeInteger(tokenId) || !tokenId || tokenId < 1) throw httpError(502, '模型分组暂不可用，请重试。')
        req.headers.set('x-new-api-token', String(tokenId))
        req.headers.set('x-new-api-group', encodeURIComponent(group))
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
        const kind = valid ? configuredKind ?? (resolveVideoModelSetting(id) ? 'video' : classifyModel(id)) : null
        const video = kind === 'video' ? resolveVideoModelSetting(id, configured?.video) : undefined
        const text = (key: string, limit: number) => record(item) && typeof item[key] === 'string' ? item[key].trim().slice(0, limit) : undefined
        return valid && (kind || management) ? [{ id, name: configured?.name || text('name', 200) || id, description: text('description', 1000), provider: text('owned_by', 200), kinds: kind ? [kind] : [], ...(configuredKind ? { configuredKind } : {}),
          ...(catalogue && record(item) ? { groups: item.groups } : {}),
          ...(configured?.tags ? { tags: configured.tags } : {}),
          ...(configured?.apiFormat ? { apiFormat: configured.apiFormat } : {}),
          ...(kind === 'image' && configured?.image ? { image: configured.image } : {}),
          ...(kind === 'text' && configured?.text ? { text: configured.text } : {}),
          ...(video ? { video } : {}),
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
    const route = ctx.url.pathname
    const stage = record(error) && typeof error.errorStage === 'string' ? error.errorStage
      : route === '/api/creation/generate' ? '请求校验' : route === '/api/creation/media' ? '结果下载'
      : /^\/api\/creation\/(?:requests|tasks)\//.test(route) ? '任务查询' : undefined
    if (stage) {
      const failure = record(error) ? error : {}
      const status = Number(failure.statusCode ?? failure.status) || 500
      const errorStatus = Number(failure.errorStatus) || status
      const detail = status < 500 || error instanceof NewApiError || error instanceof PublicImageError || failure.code === 'ORIGINAL_IMAGE_READ_FAILED'
        || failure.notAccepted === true && status === 503 ? message(error) : '服务暂时不可用。'
      const requestId = record(ctx.body) && ctx.body.requestId || /^\/api\/creation\/requests\//.test(route) && route.split('/').pop()
      logCreationFailure(requestId, stage, errorStatus, failure.code, typeof failure.notAccepted === 'boolean' ? failure.notAccepted : undefined)
      ctx.json(status, { error: { code: failure.code, message: stageError(stage, detail, errorStatus) + (failure.notAccepted === true ? ' 未向生成网关提交请求。' : '') }, errorStage: stage, errorStatus,
        ...(typeof failure.notAccepted === 'boolean' ? { notAccepted: failure.notAccepted } : {}) })
      return true
    }
    if (error instanceof NewApiError || error instanceof PublicImageError)
      throw httpError(error.status, message(error), error instanceof NewApiError ? error.code : 'MEDIA_UNAVAILABLE')
    throw error
  }
}
