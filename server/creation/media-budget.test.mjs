import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { acquireVideoMediaBudget, budgetVideoSource, videoMediaBudgetOptions } from './media-budget.ts'
import { handleCreation } from '../creation.ts'
import { createApplication } from '../runtime.ts'

const options = { concurrency: 2, bytes: 10, windowMs: 600000, leaseMs: 60000, commandTimeoutMs: 1000 }
const freshSignal = () => new AbortController().signal
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const response = bytes => new Response(Uint8Array.from(bytes), { headers: { 'content-type': 'video/mp4' } })
function scriptedRedis(result = () => [1, 0]) {
  const calls = []
  return { calls, async eval(...args) { calls.push(args); return result(args[4], args[10], args) } }
}

test('video budget settings reject invalid configuration instead of disabling protection', () => {
  const name = 'COMMUNITY_VIDEO_MEDIA_CONCURRENCY', before = process.env[name]
  try {
    for (const value of ['0', '-1', '1.5', 'NaN', '101']) {
      process.env[name] = value
      assert.throws(videoMediaBudgetOptions, { statusCode: 503 })
    }
    delete process.env[name]
    assert.equal(videoMediaBudgetOptions().concurrency, 2)
  } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before }
})

test('video reads charge each chunk before forwarding and keep read bytes after cancellation', async () => {
  const redis = scriptedRedis(), budget = await acquireVideoMediaBudget(redis, '17', freshSignal(), options)
  let cancelled = 0, read = false
  const body = new ReadableStream({ pull(output) { if (!read) { read = true; output.enqueue(Uint8Array.from([1, 2, 3, 4])) } }, cancel() { cancelled++ } }, { highWaterMark: 0 })
  const reader = budget.measure(new Response(body)).body.getReader()
  assert.deepEqual((await reader.read()).value, Uint8Array.from([1, 2, 3, 4]))
  assert.deepEqual(redis.calls.filter(args => args[4] === 'consume').map(args => args[10]), [4])
  await reader.cancel(); await budget.release()
  assert.equal(cancelled, 1)
  assert.deepEqual(redis.calls.map(args => args[4]), ['acquire', 'consume', 'release'])
})

test('an over-budget chunk is charged as read but never forwarded, and its upstream is cancelled', async () => {
  let consumed = 0, cancelled = false
  const redis = scriptedRedis((action, bytes) => action === 'consume' && (consumed += bytes) > 4 ? [0, 123000] : [1, 0])
  const budget = await acquireVideoMediaBudget(redis, '18', freshSignal(), options)
  const body = new ReadableStream({ pull(output) { output.enqueue(Uint8Array.from([1, 2, 3, 4])) }, cancel() { cancelled = true } }, { highWaterMark: 0 })
  const reader = budget.measure(new Response(body)).body.getReader()
  assert.equal((await reader.read()).value.length, 4)
  await assert.rejects(reader.read(), { statusCode: 429, retryAfter: 123 })
  await budget.release()
  assert.equal(consumed, 8); assert.equal(cancelled, true)
})

test('Redis errors, invalid replies and timeouts fail closed before a source request', async () => {
  for (const result of [() => { throw new Error('redis offline') }, () => 1, () => [1, null], () => [true, 0], () => [1, -1], () => [-1, 0], () => new Promise(() => {})]) {
    await assert.rejects(acquireVideoMediaBudget(scriptedRedis(result), '19', freshSignal(), { ...options, commandTimeoutMs: 5 }), { statusCode: 503 })
  }
  let loaded = false
  await assert.rejects(budgetVideoSource(scriptedRedis(() => [0, 4500]), '19', freshSignal(), async () => { loaded = true; return response([1]) }), { statusCode: 429, retryAfter: 5 })
  assert.equal(loaded, false)
})

test('a lost lease or Redis failure during a stream prevents further forwarding', async () => {
  for (const failure of [() => [-1, 0], () => { throw new Error('connection lost') }]) {
    let count = 0, cancelled = false
    const redis = scriptedRedis(action => action === 'consume' && ++count === 2 ? failure() : [1, 0])
    const budget = await acquireVideoMediaBudget(redis, '20', freshSignal(), options)
    const reader = budget.measure(new Response(new ReadableStream({
      pull(output) { output.enqueue(new Uint8Array(2)) }, cancel() { cancelled = true },
    }, { highWaterMark: 0 }))).body.getReader()
    assert.equal((await reader.read()).value.length, 2)
    await assert.rejects(reader.read(), { statusCode: 503 })
    await budget.release(); assert.equal(cancelled, true)
  }
})

test('shared poster sources release their own lease on upstream failure, completion and cancellation', async () => {
  const redis = scriptedRedis()
  await assert.rejects(budgetVideoSource(redis, '21', freshSignal(), async () => { throw new Error('upstream rejected') }), /upstream rejected/)
  assert.equal(redis.calls.filter(args => args[4] === 'release').length, 1)
  const complete = await budgetVideoSource(redis, '21', freshSignal(), async () => response([1, 2]))
  assert.equal((await complete.arrayBuffer()).byteLength, 2)
  assert.equal(redis.calls.filter(args => args[4] === 'release').length, 2)
  const source = new AbortController()
  const pending = await budgetVideoSource(redis, '21', source.signal, async () => new Response(new ReadableStream({ pull() {} })))
  const reading = pending.body.getReader().read()
  source.abort()
  await assert.rejects(reading)
  await waitFor(() => redis.calls.filter(args => args[4] === 'release').length === 3)
})

test('Redis renewal failure cancels a stalled source even when no new chunks arrive', async () => {
  const redis = scriptedRedis(action => { if (action === 'renew') throw new Error('offline'); return [1, 0] })
  const budget = await acquireVideoMediaBudget(redis, '22', freshSignal(), { ...options, leaseMs: 20 })
  let cancelled = false
  const reader = budget.measure(new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true } }))).body.getReader()
  const result = reader.read()
  // The real HTTP server keeps the process alive; this isolated stream has no socket handle.
  const alive = setTimeout(() => {}, 1000)
  try { await assert.rejects(result, { statusCode: 503 }) }
  finally { clearTimeout(alive); await budget.release() }
  assert.equal(cancelled, true)
})

test('the HTTP handler returns Retry-After when a concurrent transfer exhausts the budget before the first chunk', async t => {
  const budgetRedis = scriptedRedis(action => action === 'consume' ? [0, 60000] : [1, 0])
  const redis = { eval(...args) { return args[0].includes('community-video-media-budget-v1') ? budgetRedis.eval(...args) : Promise.resolve(1) } }
  const origin = 'https://community.example', user = { id: 'local-budget-test', accountId: '23' }
  const app = createApplication({ db: {}, redis, config: { url: origin }, filesRoot: 'unused' })
  t.after(() => app.close())
  let loaded = 0
  app.get('/media-budget-first-chunk', async (request, reply) => {
    await handleCreation({ request, reply, req: request.raw, res: reply.raw, redis, user,
      config: { url: origin }, url: new URL('/api/creation/media?kind=video&url=https%3A%2F%2Ffixture.example%2Fvideo.mp4', origin), body: {},
      requireUser: () => user, json: (status, value) => reply.code(status).send(value),
    }, { async publicMedia() {
      loaded++
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4', 'content-length': '4' } })
    } })
    return reply
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const result = await fetch('http://127.0.0.1:' + app.server.address().port + '/media-budget-first-chunk')
  assert.equal(result.status, 429)
  assert.equal(result.headers.get('retry-after'), '60')
  assert.match(result.headers.get('content-type'), /application\/json/)
  const body = await result.text()
  assert.equal(JSON.parse(body).error.code, 'MEDIA_BUDGET_EXCEEDED')
  assert.equal(Number(result.headers.get('content-length')), Buffer.byteLength(body))
  assert.equal(loaded, 1)
  await waitFor(() => budgetRedis.calls.some(args => args[4] === 'release'))
})

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(10) }
  assert.fail('Expected state did not arrive')
}

const redisUrl = process.env.MEDIA_BUDGET_TEST_REDIS_URL
async function realRedis(t) {
  const hostname = new URL(redisUrl).hostname
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(hostname) || (process.env.CI === 'true' && hostname === 'redis'), 'Use an isolated local or CI Redis service')
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 0, commandTimeout: 3000, lazyConnect: true })
  const other = redis.duplicate({ lazyConnect: true })
  await Promise.all([redis.connect(), other.connect()])
  const account = String(BigInt('0x' + randomBytes(7).toString('hex')) + 100000000000000n)
  const prefix = 'community-next:video-media:{' + createHash('sha256').update(account).digest('hex') + '}'
  const keys = [prefix + ':active', prefix + ':bytes']
  t.after(async () => { await redis.del(...keys); redis.disconnect(); other.disconnect() })
  return { redis, other, account, keys }
}

test('real Redis shares two slow-stream slots across server instances and preserves cancelled read bytes', { skip: !redisUrl }, async t => {
  const { redis, other, account, keys } = await realRedis(t)
  let calls = 0, cancelled = 0
  const apps = []
  t.after(async () => { await Promise.all(apps.map(app => app.close())) })
  async function server(client) {
    const app = Fastify({ forceCloseConnections: true }); apps.push(app)
    app.get('/api/creation/media', async (request, reply) => {
      const user = { id: 'local-' + account, accountId: account }
      await handleCreation({ request, reply, req: request.raw, res: reply.raw, redis: client, user,
        config: { url: 'https://community.example' }, url: new URL(request.url, 'https://community.example'), body: {},
        requireUser: () => user, json: (status, value) => reply.code(status).send(value),
      }, { async publicMedia() {
        calls++; let sent = false
        return new Response(new ReadableStream({ pull(output) { if (!sent) { sent = true; output.enqueue(new Uint8Array(4)) } }, cancel() { cancelled++ } }, { highWaterMark: 0 }),
          { headers: { 'content-type': 'video/mp4' } })
      } })
      return reply
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    return 'http://127.0.0.1:' + app.server.address().port + '/api/creation/media?kind=video&url=https%3A%2F%2Ffixture.example%2Fexternal.mp4'
  }
  const [firstUrl, secondUrl] = await Promise.all([server(redis), server(other)])
  const first = await fetch(firstUrl), firstReader = first.body.getReader()
  assert.equal((await firstReader.read()).value.length, 4)
  const second = await fetch(secondUrl), secondReader = second.body.getReader()
  assert.equal((await secondReader.read()).value.length, 4)
  const third = await fetch(firstUrl)
  assert.equal(third.status, 429); assert(Number(third.headers.get('retry-after')) > 0)
  assert.equal(calls, 2); assert.equal(await redis.get(keys[1]), '8')
  await firstReader.cancel()
  await waitFor(async () => await redis.zcard(keys[0]) === 1)
  assert.equal(await redis.get(keys[1]), '8')
  const replacement = await fetch(firstUrl), replacementReader = replacement.body.getReader()
  assert.equal((await replacementReader.read()).value.length, 4)
  await Promise.all([replacementReader.cancel(), secondReader.cancel()])
  await waitFor(async () => await redis.zcard(keys[0]) === 0)
  assert.equal(await redis.get(keys[1]), '12'); assert.equal(cancelled, 3)
})

test('real Redis simultaneous admissions atomically allow only two workers for one account', { skip: !redisUrl }, async t => {
  const { redis, other, account, keys } = await realRedis(t)
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    acquireVideoMediaBudget(index % 2 ? redis : other, account, freshSignal(), options)))
  const admitted = attempts.filter(result => result.status === 'fulfilled')
  assert.equal(admitted.length, 2)
  assert(attempts.filter(result => result.status === 'rejected').every(result => result.reason.statusCode === 429))
  assert.equal(await redis.zcard(keys[0]), 2)
  await Promise.all(admitted.map(result => result.value.release()))
  assert.equal(await redis.zcard(keys[0]), 0)
})

test('real Redis counts Range retries and the rejected final chunk without resetting the byte window', { skip: !redisUrl }, async t => {
  const { redis, other, account, keys } = await realRedis(t)
  for (let attempt = 0; attempt < 3; attempt++) {
    const budget = await acquireVideoMediaBudget(attempt % 2 ? other : redis, account, freshSignal(), options)
    const range = new Response(new Uint8Array(4), { status: 206, headers: { 'content-range': 'bytes 0-3/20', 'content-length': '4' } })
    const measured = budget.measure(range)
    if (attempt < 2) assert.equal((await measured.arrayBuffer()).byteLength, 4)
    else await assert.rejects(measured.arrayBuffer(), { statusCode: 429 })
    await budget.release()
  }
  assert.equal(await redis.get(keys[1]), '12')
  assert.equal(await redis.zcard(keys[0]), 0)
  assert(await redis.pttl(keys[1]) > 590000)
  await assert.rejects(acquireVideoMediaBudget(redis, account, freshSignal(), options), { statusCode: 429 })
})

test('real Redis expired crashed-worker leases are reclaimed but cannot resume transmitting', { skip: !redisUrl }, async t => {
  const { redis, other, account, keys } = await realRedis(t)
  const budget = await acquireVideoMediaBudget(redis, account, freshSignal(), options)
  const token = (await redis.zrange(keys[0], 0, -1))[0]
  await redis.zadd(keys[0], 1, token)
  const next = await acquireVideoMediaBudget(other, account, freshSignal(), options)
  await assert.rejects(budget.measure(response([1])).arrayBuffer(), { statusCode: 503 })
  assert.equal(await redis.get(keys[1]), '1', 'an expired lease still charges the chunk already read')
  await budget.release(); await next.release()
  assert.equal(await redis.zcard(keys[0]), 0)
})

test('real Redis active leases renew during downstream backpressure and byte windows expire independently', { skip: !redisUrl }, async t => {
  const { redis, account, keys } = await realRedis(t)
  const settings = { ...options, leaseMs: 1000, windowMs: 100 }
  const budget = await acquireVideoMediaBudget(redis, account, freshSignal(), settings)
  assert.equal((await budget.measure(response(new Array(10).fill(1))).arrayBuffer()).byteLength, 10)
  await delay(1200)
  assert.equal(await redis.zcard(keys[0]), 1, 'idle downstream must retain its active lease')
  assert.equal(await redis.get(keys[1]), null)
  const replacement = await acquireVideoMediaBudget(redis, account, freshSignal(), settings)
  assert.equal((await replacement.measure(response([1])).arrayBuffer()).byteLength, 1)
  await replacement.release(); await budget.release()
})
