import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { saveImageOutputs, readSavedImage } from './image-results.ts'

const namespace = 'a'.repeat(64)
const key = (id = randomUUID(), account = namespace) => `community-next:creation:request:${account}:${id}`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const png = await sharp({ create: { width: 23, height: 17, channels: 4, background: '#76829870' } }).png({ compressionLevel: 0 }).toBuffer()
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'community-image-save-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
const imageResponse = () => new Response(png, { headers: { 'Content-Type': 'image/png' } })

test('saved originals retain exact bytes and result properties, while private URLs reuse saved files', async t => {
  const root = await fixture(t), request = key(), id = request.split(':').at(-1)
  let downloads = 0
  const fetch = async (url, kind, maximum) => {
    assert.equal(url, 'https://media.example/original.png'); assert.equal(kind, 'image'); assert.equal(maximum, 32 * 1024 * 1024)
    downloads++; return imageResponse()
  }
  const results = await saveImageOutputs(root, request, [{ url: 'https://media.example/original.png', text: 'original' }], fetch)
  assert.deepEqual(results, [{ url: `/api/creation/media?requestId=${id}&index=0`, text: 'original' }])
  const response = await readSavedImage(root, request, 0)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(png))
  assert.deepEqual(await saveImageOutputs(root, request, results, fetch), results)
  assert.equal(downloads, 1)
})

test('partial failures checkpoint each image and retry downloads only the missing remainder', async t => {
  const root = await fixture(t), request = key(), calls = new Map()
  let fail = true
  const outputs = ['first', 'second', 'third'].map(name => ({ url: `https://media.example/${name}.png` }))
  const fetch = async url => {
    calls.set(url, (calls.get(url) || 0) + 1)
    if (url.includes('second') && fail) throw new Error('download unavailable')
    return imageResponse()
  }
  await assert.rejects(saveImageOutputs(root, request, outputs, fetch), /download unavailable/)
  assert.deepEqual(Buffer.from(await (await readSavedImage(root, request, 0)).arrayBuffer()), png)
  fail = false
  assert.equal((await saveImageOutputs(root, request, outputs, fetch)).length, 3)
  assert.deepEqual([...calls.values()], [1, 2, 1])
  await saveImageOutputs(root, request, outputs, fetch)
  assert.deepEqual([...calls.values()], [1, 2, 1], 'a database association retry must not download originals again')
})

test('concurrent saves of one request coalesce downloads and reject different sources', async t => {
  const root = await fixture(t), request = key()
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  let downloads = 0
  const fetch = async () => { downloads++; entered(); await blocked; return imageResponse() }
  const outputs = [{ url: 'https://media.example/one.png' }]
  const first = saveImageOutputs(root, request, outputs, fetch)
  await started
  const second = saveImageOutputs(root, request, outputs, fetch)
  await assert.rejects(saveImageOutputs(root, request, [{ url: 'https://media.example/different.png' }], fetch), { statusCode: 409 })
  release()
  assert.deepEqual(await first, await second)
  assert.equal(downloads, 1)
  await assert.rejects(saveImageOutputs(root, request, [{ url: 'https://media.example/different.png' }], fetch), { statusCode: 409 })
})

test('data images are persisted without network calls, invalid data and excessive image counts are rejected', async t => {
  const root = await fixture(t), request = key()
  const network = () => assert.fail('data images must not use the network')
  const outputs = [{ url: `data:image/png;base64,${png.toString('base64')}` }]
  await saveImageOutputs(root, request, outputs, network)
  assert.deepEqual(Buffer.from(await (await readSavedImage(root, request, 0)).arrayBuffer()), png)
  await assert.rejects(saveImageOutputs(root, key(), [{ url: 'data:image/png;base64,a===' }], network))
  await assert.rejects(saveImageOutputs(root, key(), Array.from({ length: 11 }, () => outputs[0]), network), { statusCode: 413 })
})

test('the 90-second batch deadline cancels a stalled body even when the media reader ignores its signal', async t => {
  const root = await fixture(t), request = key(), controller = new AbortController(), timeouts = []
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    timeouts.push(milliseconds)
    return milliseconds === 90000 ? controller.signal : originalTimeout(milliseconds)
  })
  let started, cancelled = false
  const reading = new Promise(resolve => { started = resolve })
  const outputs = [{ url: 'https://media.example/first.png' }, { url: 'https://media.example/blocked.png' }]
  const pending = saveImageOutputs(root, request, outputs, async url => {
    if (url.includes('first')) return imageResponse()
    return new Response(new ReadableStream({
      pull() { started(); return new Promise(() => {}) },
      cancel() { cancelled = true },
    }), { headers: { 'Content-Type': 'image/png' } })
  })
  await reading
  controller.abort(new DOMException('batch deadline', 'TimeoutError'))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
  assert.deepEqual(timeouts, [90000, 65000, 65000])
  assert.deepEqual(Buffer.from(await (await readSavedImage(root, request, 0)).arrayBuffer()), png)
})

test('the batch deadline also ends an ignored header wait and cancels a late response', async t => {
  const root = await fixture(t), controller = new AbortController(), originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', milliseconds => milliseconds === 90000 ? controller.signal : originalTimeout(milliseconds))
  let started, finish, cancelled = false
  const headers = new Promise(resolve => { started = resolve })
  const pending = saveImageOutputs(root, key(), [{ url: 'https://media.example/blocked.png' }], () => {
    started(); return new Promise(resolve => { finish = resolve })
  })
  await headers
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  finish(new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'image/png' } }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, true)
})

test('image saves have two shared read slots and release them after download failures', async t => {
  const root = await fixture(t)
  let active = 0, peak = 0
  const fetch = async () => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 20))
    active--; return imageResponse()
  }
  await Promise.all(Array.from({ length: 5 }, () => saveImageOutputs(root, key(), [{ url: 'https://media.example/a.png' }], fetch)))
  assert.equal(peak, 2)
  await assert.rejects(saveImageOutputs(root, key(), [{ url: 'https://media.example/a.png' }], async () => { throw new Error('failed') }))
  await saveImageOutputs(root, key(), [{ url: 'https://media.example/a.png' }], fetch)
  assert.equal(active, 0)
})

test('oversize streams release their save slot even if upstream cancellation never completes', { timeout: 2000 }, async t => {
  const root = await fixture(t)
  let cancelled = false
  const response = () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  }), { headers: { 'Content-Type': 'image/png' } })
  await assert.rejects(saveImageOutputs(root, key(), [{ url: 'https://media.example/large.png' }], async () => response()), { statusCode: 413 })
  assert.equal(cancelled, true)
  await saveImageOutputs(root, key(), [{ url: 'https://media.example/normal.png' }], async () => imageResponse())
})

test('private lookup rejects invalid identities and indices and cannot find another account or request', async t => {
  const root = await fixture(t), id = randomUUID(), request = key(id)
  await saveImageOutputs(root, request, [{ url: 'https://media.example/a.png' }], async () => imageResponse())
  for (const invalid of ['../../escape', key('../escape'), key(id, 'not-an-account')])
    await assert.rejects(readSavedImage(root, invalid, 0), { statusCode: 400 })
  for (const invalid of [-1, 10, 0.5, NaN]) await assert.rejects(readSavedImage(root, request, invalid), { statusCode: 400 })
  await assert.rejects(readSavedImage(root, key(id, 'b'.repeat(64)), 0))
  await assert.rejects(readSavedImage(root, key(), 0))
})

test('tampered checkpoints and original bytes are rejected rather than downloaded or served', async t => {
  const root = await fixture(t), id = randomUUID(), request = key(id)
  await saveImageOutputs(root, request, [{ url: 'https://media.example/a.png' }], async () => imageResponse())
  const directory = path.join(root, '.creation-images', namespace, hash(id))
  const original = (await readdir(directory)).find(name => name.endsWith('.png'))
  await writeFile(path.join(directory, original), Buffer.alloc(png.length, 5))
  await assert.rejects(readSavedImage(root, request, 0), /损坏/)
  await assert.rejects(saveImageOutputs(root, request, [{ url: 'https://media.example/a.png' }], () => assert.fail('tampered originals must not be silently replaced')), /损坏/)
  await writeFile(path.join(directory, '0.json'), JSON.stringify({ version: 1, source: hash('https://media.example/a.png'), file: { name: '../../escape', hash: 'a'.repeat(64), type: 'image/png', size: 10 } }))
  await assert.rejects(readSavedImage(root, request, 0), /记录无效/)
})

test('junctions cannot redirect a private image namespace outside the storage root', async t => {
  const root = await fixture(t), outside = await fixture(t), request = key()
  await symlink(outside, path.join(root, '.creation-images'), 'junction')
  await assert.rejects(saveImageOutputs(root, request, [{ url: 'https://media.example/a.png' }], () => assert.fail('must reject before network')), /目录无效/)
  assert.deepEqual(await readdir(outside), [])
})
