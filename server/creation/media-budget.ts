import { createHash, randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { httpError } from '../auth.ts'

// Both keys share a Redis Cluster slot. Bytes are never refunded on cancellation.
const script = `-- community-video-media-budget-v1
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local action, token = ARGV[1], ARGV[2]
local lease, window, limit, maximum, bytes = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if action == 'release' then
  redis.call('ZREM', KEYS[1], token)
  return {1, 0}
end
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
local ttl = redis.call('PTTL', KEYS[2])
if action == 'consume' and bytes > 0 then
  used = redis.call('INCRBY', KEYS[2], bytes)
  if ttl < 0 then redis.call('PEXPIRE', KEYS[2], window); ttl = window end
end
if action == 'acquire' then
  if used >= maximum then return {0, math.max(1, ttl)} end
  if redis.call('ZCARD', KEYS[1]) >= limit then
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return {0, math.max(1, tonumber(oldest[2]) - now)}
  end
elseif not redis.call('ZSCORE', KEYS[1], token) then
  return {-1, 0}
end
if action == 'consume' and used > maximum then return {0, math.max(1, ttl)} end
redis.call('ZADD', KEYS[1], now + lease, token)
redis.call('PEXPIRE', KEYS[1], lease)
return {1, 0}
`

interface MediaBudgetOptions { concurrency: number; bytes: number; windowMs: number; leaseMs: number; commandTimeoutMs: number }

function configured(name: string, fallback: number, maximum: number) {
  const input = process.env[name]
  if (input === undefined || input === '') return fallback
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw httpError(503, '视频传输限制配置暂不可用。', 'MEDIA_BUDGET_UNAVAILABLE')
  return value
}

export function videoMediaBudgetOptions(): MediaBudgetOptions {
  return {
    concurrency: configured('COMMUNITY_VIDEO_MEDIA_CONCURRENCY', 2, 100),
    bytes: configured('COMMUNITY_VIDEO_MEDIA_BYTES', 1024 ** 3, 1024 ** 4),
    windowMs: configured('COMMUNITY_VIDEO_MEDIA_WINDOW_SECONDS', 600, 86400) * 1000,
    leaseMs: 60000, commandTimeoutMs: 3000,
  }
}

export async function acquireVideoMediaBudget(redis: Pick<Redis, 'eval'>, accountId: string, clientSignal: AbortSignal,
  options = videoMediaBudgetOptions()) {
  clientSignal.throwIfAborted()
  const owner = createHash('sha256').update(accountId).digest('hex')
  const prefix = `community-next:video-media:{${owner}}`, token = randomUUID()
  const keys = [`${prefix}:active`, `${prefix}:bytes`]
  const controller = new AbortController(), signal = AbortSignal.any([clientSignal, controller.signal])
  const unavailable = () => httpError(503, '视频传输限额暂时无法核验，请稍后重试。', 'MEDIA_BUDGET_UNAVAILABLE')
  let closed = false, renewing = false, releasing: Promise<void> | undefined
  const streams = new Set<() => Promise<void>>()
  async function command(action: 'acquire' | 'consume' | 'renew' | 'release', bytes = 0) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        redis.eval(script, 2, ...keys, action, token, options.leaseMs, options.windowMs, options.concurrency, options.bytes, bytes),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(unavailable()), options.commandTimeoutMs) }),
      ])
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1, -1].includes(result[0])
        || !Number.isSafeInteger(result[1]) || result[1] < 0) throw unavailable()
      if (Number(result[0]) === 0) throw Object.assign(httpError(429, '视频读取已达当前限额，请稍后重试。', 'MEDIA_BUDGET_EXCEEDED'),
        { retryAfter: Math.max(1, Math.ceil(Number(result[1]) / 1000)) })
      if (Number(result[0]) !== 1) throw unavailable()
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error && error.statusCode === 429) throw error
      throw unavailable()
    } finally { clearTimeout(timeout) }
  }
  await command('acquire')
  const timer = setInterval(() => {
    if (closed || renewing) return
    renewing = true
    void command('renew').catch(error => { clearInterval(timer); controller.abort(error) }).finally(() => { renewing = false })
  }, Math.max(1, Math.floor(options.leaseMs / 4)))
  timer.unref()
  function release(): Promise<void> {
    if (releasing) return releasing
    closed = true; clearInterval(timer)
    releasing = (async () => {
      controller.abort(new DOMException('Media transfer finished', 'AbortError'))
      await Promise.all([...streams].map(stop => stop()))
      // An unavailable Redis keeps the slot closed until its lease expires.
      await command('release').catch(() => {})
    })()
    return releasing
  }
  if (signal.aborted) { await release(); signal.throwIfAborted() }
  return {
    signal,
    release,
    measure(response: Response, releaseAtEnd = false) {
      if (!response.body) return response
      const reader = response.body.getReader()
      let ended = false
      let charging: Promise<void> | undefined, stopping: Promise<void> | undefined
      const stop = (reason?: unknown): Promise<void> => {
        if (stopping) return stopping
        if (ended) return Promise.resolve()
        ended = true; signal.removeEventListener('abort', abort)
        stopping = (async () => {
          try { await reader.cancel(reason) } catch {}
          await charging?.catch(() => {})
          reader.releaseLock(); streams.delete(stop)
        })()
        return stopping
      }
      let output: ReadableStreamDefaultController<Uint8Array>
      const abort = () => {
        if (ended) return
        output.error(signal.reason)
        void stop(signal.reason).then(() => { if (releaseAtEnd) return release() })
      }
      streams.add(stop)
      const body = new ReadableStream<Uint8Array>({
        start(target) { output = target; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort() },
        async pull(target) {
          if (ended) return
          try {
            const { done, value } = await reader.read()
            if (done) {
              if (!ended) {
                ended = true; signal.removeEventListener('abort', abort); reader.releaseLock(); streams.delete(stop)
                if (releaseAtEnd) await release()
                target.close()
              }
              return
            }
            // Charge bytes actually read, including a final over-budget chunk that is not forwarded.
            charging = command('consume', value.byteLength)
            await charging
            if (ended) return
            signal.throwIfAborted()
            target.enqueue(value)
          } catch (error) {
            if (!ended) { target.error(error); await stop(error) }
            if (releaseAtEnd) await release()
          }
        },
        async cancel(reason) { await stop(reason); if (releaseAtEnd) await release() },
      }, { highWaterMark: 0 })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    },
  }
}

export type VideoMediaBudget = Awaited<ReturnType<typeof acquireVideoMediaBudget>>

/** A coalesced poster job owns its source lease independently of any one HTTP viewer. */
export async function budgetVideoSource(redis: Pick<Redis, 'eval'>, accountId: string, signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<Response>) {
  const budget = await acquireVideoMediaBudget(redis, accountId, signal)
  try {
    const response = await load(budget.signal)
    if (!response.body) { await budget.release(); return response }
    return budget.measure(response, true)
  } catch (error) { await budget.release(); throw error }
}
