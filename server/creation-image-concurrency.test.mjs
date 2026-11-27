import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import { handleCreation, processCreationTasks } from './creation.ts'
import { environment, requestDatabase, transactionalFixture } from './creation/test-database.mjs'
import { isModelBusy } from '../shared/studio/model-busy.ts'

const origin = 'https://community.example'
const image = { kind: 'image', model: 'gpt-image-2', prompt: 'Test' }
const success = () => Response.json({ data: [{ url: 'https://media.example/result.png' }] })
function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await delay(5)
  }
  assert.fail('Expected submission state was not reached')
}
async function fixture(t, options = {}) {
  environment(t, { COMMUNITY_REQUEST_STORE: options.legacy ? '0' : '1', COMMUNITY_REQUEST_V2: '0',
    COMMUNITY_REQUEST_V2_ACCOUNTS: '', NEW_API_SESSION_SECRET: 'image-concurrency-test-secret-'.repeat(3) })
  const database = await requestDatabase(t), db = transactionalFixture(database)
  await db.query('CREATE TABLE meta (id text PRIMARY KEY,"clientOptions" jsonb NOT NULL)')
  await db.query('INSERT INTO meta VALUES ($1,$2)', ['site', JSON.stringify({ communityImageConcurrency: options.settings })])
  const app = Fastify({ forceCloseConnections: true }), values = new Map(), due = new Map(), calls = [], rates = new Map()
  t.after(() => app.close())
  const redis = {
    async get(key) { return values.get(key) ?? null },
    async set(key, value, ...flags) {
      if (flags.includes('NX') && values.has(key)) return null
      values.set(key, value); return 'OK'
    },
    async eval(script, _count, key, ...args) {
      if (script.includes('INCR')) { rates.set(key, (rates.get(key) || 0) + 1); return rates.get(key) }
      if (script.includes('"ZADD"')) {
        if (script.includes('"NX"') && values.has(key)) return null
        const [, value, , score, member] = args
        values.set(key, value)
        if (score === '') due.delete(member)
        else due.set(member, Number(score))
        return 'OK'
      }
      if (script.includes('ARGV[1]') && values.get(key) === args[0]) values.delete(key)
      return 1
    },
    async zadd(_key, score, value) { due.set(value, Number(score)); return 1 },
    async zrem(_key, value) { return Number(due.delete(value)) },
    async zrangebyscore(_key, min, max) { return [...due].filter(([, score]) => score >= Number(min) && score <= Number(max)).slice(0, 4).map(([key]) => key) },
  }
  const services = {
    async credentials(req) { return { baseUrl: 'https://model.example', apiKey: 'fixture', tokenId: 71,
      userId: Number(req.headers.get('x-new-api-user')) } },
    async fetch(url, init) { calls.push({ url: String(url), init }); return options.fetch?.(url, init) ?? success() },
  }
  app.all('/api/creation/*', async (request, reply) => {
    const accountId = String(request.headers['x-test-account'] || '17')
    const user = { id: String(request.headers['x-test-user'] || `local${accountId}`), accountId, username: 'fixture' }
    const ctx = { req: request.raw, res: reply.raw, request, reply, db, redis, user, config: { url: origin },
      url: new URL(request.raw.url, origin), body: request.body || {}, requireUser() { return user },
      json(status, value) { reply.code(status).send(value) } }
    if (!await handleCreation(ctx, services)) reply.code(404).send({})
    return reply
  })
  return { app, db, redis, services, calls, values, rates,
    submit(requestId, extraHeaders = {}, input = {}) {
      return app.inject({ method: 'POST', url: '/api/creation/generate',
        headers: { origin, 'content-type': 'application/json', ...extraHeaders }, payload: { ...image, requestId, ...input } }).then(value => value)
    },
  }
}

test('four asynchronous images retain user capacity until polling records a terminal result', async t => {
  const f = await fixture(t, { settings: { defaultLimit: 1, globalLimit: 10, userOverrides: { local17: 4, '17': 1 } },
    fetch(_url, init) { return init.method === 'POST' ? Response.json({ id: 'async-image', status: 'queued' })
      : Response.json({ id: 'async-image', status: 'completed', data: [{ url: 'https://media.example/result.png' }] }) } })
  const first = await f.submit('four', {}, { n: 4, protocol: 'async' })
  assert.equal(first.json().status, 'pending', first.payload)
  const row = (await f.db.query('SELECT * FROM community_creation_request')).rows[0]
  assert.equal(row.record.imageCount, 4)
  assert.equal(row.record.result.status, 'pending')
  assert.equal(JSON.parse(f.calls[0].init.body).n, 4)
  assert.equal((await f.submit('four', {}, { n: 4, protocol: 'async' })).json().status, 'pending')
  for (const streaming of [false, true]) {
    const rejected = await f.submit(`fifth-${streaming}`, {}, streaming ? { imageOptions: { imageStream: true } } : {})
    const failure = streaming ? JSON.parse(rejected.payload.trim().slice('data: '.length)) : rejected.json()
    assert.equal(rejected.statusCode, streaming ? 200 : 429)
    assert.equal(streaming ? failure.code : failure.error.code, 'IMAGE_CONCURRENCY_LIMIT')
    assert.equal(failure.notAccepted, true)
    assert.equal(isModelBusy(failure), false)
  }
  assert.equal(f.calls.length, 1)
  await processCreationTasks(f.redis, f.services, f.db)
  assert.equal((await f.app.inject('/api/creation/requests/four')).json().status, 'succeeded')
  assert.equal((await f.submit('after-finish', {}, { protocol: 'async' })).json().status, 'pending')
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 2)
})

test('admitted durable images exceed both the old two POST slots and twelve-per-minute limit', async t => {
  const gates = [], f = await fixture(t, { settings: { defaultLimit: 20, globalLimit: 1000, userOverrides: {} },
    fetch() { const gate = deferred(); gates.push(gate); return gate.promise } })
  t.after(() => gates.forEach(gate => gate.resolve(success())))
  const requests = Array.from({ length: 13 }, (_, index) => f.submit(`direct-${index}`))
  try {
    await until(() => gates.length === 13)
    assert.equal(f.rates.size, 0, 'durable images must not consume the legacy generate RPM quota')
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM community_creation_request')).rows[0].count, 13)
  } finally { gates.forEach(gate => gate.resolve(success())) }
  assert((await Promise.all(requests)).every(response => response.json().status === 'succeeded'))
})

test('the global request cap differs from the user image cap and preserves its precise HTTP error', async t => {
  const f = await fixture(t, { settings: { defaultLimit: 4, globalLimit: 1, userOverrides: {} },
    fetch: () => Response.json({ id: 'one-batch', status: 'queued' }) })
  assert.equal((await f.submit('batch', {}, { n: 4, protocol: 'async' })).json().status, 'pending')
  const rejected = await f.submit('other', { 'x-test-account': '18' })
  assert.equal(rejected.statusCode, 429)
  assert.equal(rejected.json().error.code, 'IMAGE_GLOBAL_LIMIT')
  assert.equal(rejected.json().notAccepted, true)
  assert.equal(f.calls.length, 1)
})

test('failed image generation frees capacity immediately while uncertain outcomes remain reserved', async t => {
  let outcome = 'failed'
  const f = await fixture(t, { settings: { defaultLimit: 1, globalLimit: 1, userOverrides: {} }, fetch() {
    if (outcome === 'failed') return Response.json({ error: { message: 'invalid image' } }, { status: 400 })
    if (outcome === 'uncertain') throw new Error('upstream response lost')
    return success()
  } })
  assert.equal((await f.submit('failed')).json().status, 'failed')
  outcome = 'uncertain'
  assert.equal((await f.submit('unknown')).json().status, 'indeterminate')
  assert.equal((await f.submit('blocked')).json().error.code, 'IMAGE_CONCURRENCY_LIMIT')
  await f.db.query(`UPDATE community_creation_request SET record=jsonb_set(record,'{deadline}',$1::jsonb) WHERE record#>>'{result,status}'='indeterminate'`, [String(Date.now() - 1)])
  outcome = 'success'
  assert.equal((await f.submit('after-deadline')).json().status, 'succeeded')
  assert.equal(f.calls.length, 3)
})

test('image option extras cannot override the admitted batch count', async t => {
  const f = await fixture(t, { settings: { defaultLimit: 1, globalLimit: 10, userOverrides: {} }, fetch(_url, init) {
    const payload = JSON.parse(init.body)
    assert.equal(payload.n, 1)
    return Response.json({ id: 'one-image', status: 'queued' })
  } })
  const result = await f.submit('extra-options', {}, { n: 1, protocol: 'async', imageOptions: { n: 10, customJSON: '{"n":10}', customParameters: '{"n":10}' } })
  assert.equal(result.json().status, 'pending')
  assert.equal((await f.db.query('SELECT record FROM community_creation_request')).rows[0].record.imageCount, 1)
  assert.equal((await f.submit('second')).json().error.code, 'IMAGE_CONCURRENCY_LIMIT')
})

test('explicit concurrency settings fail closed when durable storage is disabled', async t => {
  const f = await fixture(t, { legacy: true, settings: { defaultLimit: 4, globalLimit: 1000, userOverrides: {} } })
  const response = await f.submit('unavailable')
  assert.equal(response.statusCode, 503)
  assert.equal(response.json().error.code, 'IMAGE_CONCURRENCY_UNAVAILABLE')
  assert.equal(response.json().notAccepted, true)
  assert.equal(f.calls.length, 0)
})
