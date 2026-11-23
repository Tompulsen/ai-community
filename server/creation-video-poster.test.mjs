import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import sharp from 'sharp'
import { videoPoster, videoPosterSourceLimit } from './creation/video-poster.ts'
import { handleCreation } from './creation.ts'
import { getNewApiConfig } from './native-account/config.ts'
import { normalizeCreationTask } from './creation-contract.ts'

const available = spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0
let video
test.before(async () => {
  if (!available) return
  const root = await mkdtemp(join(tmpdir(), 'community-poster-fixture-'))
  try {
    const target = join(root, 'fast.mp4')
    const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=black:s=192x128:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=red:s=192x128:r=10:d=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target],
    { windowsHide: true, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    video = await readFile(target)
  } finally { await rm(root, { recursive: true, force: true }) }
})
const hash = value => createHash('sha256').update(value).digest('hex')
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function stream(bytes, state, paced = false) {
  let offset = 0
  return new Response(new ReadableStream({
    async pull(output) {
      if (paced) await delay(2)
      if (offset >= bytes.length) { output.close(); return }
      const chunk = bytes.subarray(offset, offset + 16384)
      offset += chunk.length; state.bytes += chunk.length
      try { output.enqueue(chunk) } catch {}
    },
    cancel() { state.cancelled++ },
  }), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) } })
}

test('video posters stop fast-start downloads early, preserve dark detail and cache one extraction', { skip: !available }, async () => {
  const free = Buffer.alloc(8 * 1024 * 1024)
  free.writeUInt32BE(free.length); free.write('free', 4)
  const bytes = Buffer.concat([video, free]), state = { reads: 0, bytes: 0, cancelled: 0 }
  const load = async () => { state.reads++; return stream(bytes, state, true) }
  const key = randomUUID(), signal = new AbortController().signal
  const [first, second] = await Promise.all([videoPoster(key, load, signal), videoPoster(key, load, signal)])
  const poster = Buffer.from(await first.arrayBuffer())
  const metadata = await sharp(poster).metadata(), stats = await sharp(poster).stats()
  assert.equal(first.headers.get('content-type'), 'image/webp')
  assert.equal(Number(first.headers.get('x-video-duration')), 2.5)
  assert.equal(metadata.width, 192); assert.equal(metadata.height, 128)
  assert(stats.channels.some(channel => channel.mean > 40), 'black intros must not become the poster')
  assert.equal(state.reads, 1)
  assert(state.bytes < bytes.length / 2, `read ${state.bytes} of ${bytes.length} bytes`)
  assert.equal(state.cancelled, 1)
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), poster)
  assert.deepEqual(Buffer.from(await (await videoPoster(key, load, signal)).arrayBuffer()), poster)
  assert.equal(state.reads, 1)
  console.log(JSON.stringify({ fastStartSourceBytes: bytes.length, actualSourceBytes: state.bytes, browserPosterBytes: poster.length }))
})

test('tail-indexed videos reuse a single bounded download and cache their seekable fallback', { skip: !available }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-tail-video-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'tail.mp4')
  const source = join(root, 'fast.mp4')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(source, video)
  const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', source,
    '-c', 'copy', '-map_metadata', '-1', '-f', 'mp4', target], { windowsHide: true, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const bytes = await readFile(target)
  assert(bytes.indexOf(Buffer.from('moov')) > bytes.indexOf(Buffer.from('mdat')))
  const state = { reads: 0, bytes: 0, cancelled: 0 }, key = randomUUID()
  const load = async () => { state.reads++; return stream(bytes, state) }
  for (let index = 0; index < 2; index++) {
    const response = await videoPoster(key, load, new AbortController().signal)
    assert.equal(Number(response.headers.get('x-video-duration')), 2.5)
    assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, 'webp')
  }
  assert.equal(state.reads, 1)
  assert.equal(state.bytes, bytes.length)
})

test('poster validation rejects wrong types and declared oversize bodies before decoding', async () => {
  for (const [type, size, statusCode] of [['text/html', 100, 415], ['video/mp4', videoPosterSourceLimit + 1, 413]]) {
    let cancelled = false
    const load = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), {
      headers: { 'Content-Type': type, 'Content-Length': String(size) },
    })
    await assert.rejects(videoPoster(randomUUID(), load, new AbortController().signal), { statusCode })
    assert.equal(cancelled, true)
  }
})

test('poster queues allow two active downloads and cancel queued and active work', { skip: !available }, async () => {
  let calls = 0, active = 0, peak = 0
  const load = async signal => {
    calls++; active++; peak = Math.max(peak, active)
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { active--; reject(signal.reason) }, { once: true })
    })
  }
  const controllers = Array.from({ length: 16 }, () => new AbortController())
  const jobs = controllers.map(controller => videoPoster(randomUUID(), load, controller.signal))
  const settled = Promise.allSettled(jobs)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  await assert.rejects(videoPoster(randomUUID(), load, new AbortController().signal), { statusCode: 503 })
  for (const controller of controllers) controller.abort()
  assert((await settled).every(result => result.status === 'rejected'))
  assert.equal(calls, 2); assert.equal(peak, 2); assert.equal(active, 0)
})

test('canceling a blocked body stops its reader and permits an immediate retry of the same key', { skip: !available }, async () => {
  let cancelled = false, reads = 0, started
  const ready = new Promise(resolve => { started = resolve })
  const key = randomUUID(), controller = new AbortController()
  const pending = videoPoster(key, async () => {
    reads++; started()
    return new Response(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true } }),
      { headers: { 'Content-Type': 'video/mp4' } })
  }, controller.signal)
  await ready
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  const recovered = await videoPoster(key, async () => {
    reads++
    return new Response(video, { headers: { 'Content-Type': 'video/mp4' } })
  }, new AbortController().signal)
  assert.equal((await sharp(Buffer.from(await recovered.arrayBuffer())).metadata()).format, 'webp')
  assert.equal(cancelled, true)
  assert.equal(reads, 2)
})

test('completed video tasks expose only explicit valid poster URLs', () => {
  const base = { status: 'succeeded', video_url: 'https://media.example/video.mp4' }
  assert.equal(normalizeCreationTask('video', { ...base, poster_url: 'https://media.example/poster.jpg' }).poster, 'https://media.example/poster.jpg')
  assert.equal(normalizeCreationTask('video', { ...base, video: { thumbnail_url: 'https://media.example/poster.png' } }).poster, 'https://media.example/poster.png')
  for (const poster_url of ['javascript:alert(1)', 'file:///tmp/video', 'https://name:password@media.example/poster.jpg'])
    assert.equal(normalizeCreationTask('video', { ...base, poster_url }).poster, undefined)
  assert.equal(normalizeCreationTask('video', { ...base, status: 'pending', poster_url: 'https://media.example/poster.jpg' }).poster, undefined)
  assert.equal(normalizeCreationTask('video', base).poster, undefined)
})

test('poster routes retain account and token authorization before cached protected media', { skip: !available }, async t => {
  const app = Fastify(), values = new Map(), calls = []
  t.after(() => app.close())
  const normalized = `v1/videos/${randomUUID()}/content`
  const mediaKey = `community-next:creation:media:${hash(`${getNewApiConfig().publicUrl}:17`)}:${hash(normalized)}`
  values.set(mediaKey, JSON.stringify({ tokenId: 71, protocol: 'openai' }))
  app.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || error.status || 500).send({ message: error.message }))
  app.get('/api/creation/media', async (request, reply) => {
    const accountId = String(request.headers['x-test-account'] || '17')
    const user = { id: `local-${accountId}`, accountId }
    return handleCreation({
      req: request.raw, res: reply.raw, request, reply, user, sessionHash: 'test-session',
      url: new URL(request.url, 'https://community.example'), config: { url: 'https://community.example' },
      redis: { async get(key) { return values.get(key) || null }, async eval() { return 1 } },
      body: {}, requireUser() { return user },
    }, {
      async credentials(req) { return { baseUrl: 'https://model.example', apiKey: 'dummy', tokenId: Number(req.headers.get('x-new-api-token')), userId: Number(accountId) } },
      async fetch(url) {
        calls.push(String(url))
        return new Response(video, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) } })
      },
    }).then(() => reply)
  })
  const path = `/api/creation/media?kind=video&path=${encodeURIComponent(normalized)}&variant=poster`
  for (let index = 0; index < 2; index++) {
    const response = await app.inject(path)
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.headers['content-type'], 'image/webp')
    assert.equal(response.headers['cache-control'], 'private, no-store')
  }
  assert.equal(calls.length, 1)
  assert.equal((await app.inject(path + '&tokenId=72')).statusCode, 403)
  assert.equal((await app.inject({ url: path, headers: { 'x-test-account': '18' } })).statusCode, 409)
  values.delete(mediaKey)
  assert.equal((await app.inject(path)).statusCode, 409)
  assert.equal(calls.length, 1)
})
