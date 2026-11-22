import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { imagePreview } from './creation/image-preview.ts'

const source = 'https://media.example/image.png'
const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#398cbd' } }).png().toBuffer()
const response = bytes => new Response(bytes, { headers: { 'Content-Type': 'image/png' } })

test('previews rotate orientation, preserve small dimensions and reject broken or excessive decoded images', async () => {
  const original = await sharp(png).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const result = await imagePreview(source, async () => response(original), new AbortController().signal)
  const info = await sharp(Buffer.from(await result.arrayBuffer())).metadata()
  assert.equal(info.width, 32)
  assert.equal(info.height, 64)
  assert.equal(info.orientation, undefined)
  for (const bytes of [Buffer.from('not an image'), Buffer.from('<svg width="100001" height="100001"></svg>')])
    await assert.rejects(imagePreview(source, async () => response(bytes), new AbortController().signal), { statusCode: 502 })
})

test('preview work is bounded to two active and sixteen total jobs, and canceled queued work never fetches', async () => {
  let active = 0, peak = 0, calls = 0
  const release = []
  const fetcher = async () => {
    calls++; active++; peak = Math.max(peak, active)
    await new Promise(resolve => release.push(resolve))
    active--
    return response(png)
  }
  const controllers = Array.from({ length: 16 }, () => new AbortController())
  const jobs = controllers.map(controller => imagePreview(source, fetcher, controller.signal))
  const settled = Promise.allSettled(jobs)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  await assert.rejects(imagePreview(source, fetcher, new AbortController().signal), { statusCode: 503 })
  for (const controller of controllers.slice(2)) controller.abort()
  for (const finish of release) finish()
  const results = await settled
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2)
  assert(results.slice(2).every(result => result.status === 'rejected' && result.reason.statusCode === 504))
  assert.equal(calls, 2)
  assert.equal(peak, 2)
  assert.equal((await imagePreview(source, async () => response(png), new AbortController().signal)).status, 200)
})

test('preview deadline includes queue time and aborts the active downloader before queued work starts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let calls = 0, canceled = 0
  const fetcher = async (_url, _kind, _maximum, signal) => {
    calls++
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { canceled++; reject(signal.reason) }, { once: true }))
  }
  const jobs = Array.from({ length: 3 }, () => imagePreview(source, fetcher, new AbortController().signal))
  const settled = Promise.allSettled(jobs)
  await Promise.resolve()
  assert.equal(calls, 2)
  t.mock.timers.tick(65000)
  const results = await settled
  assert(results.every(result => result.status === 'rejected' && result.reason.statusCode === 504))
  assert.equal(calls, 2)
  assert.equal(canceled, 2)
})
