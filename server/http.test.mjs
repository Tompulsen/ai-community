/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import sharp from 'sharp'
import { crc32 } from 'node:zlib'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { AccountRequest, AccountResponse } from './native-account/http.ts'
import { closeNewApiRedis, getNewApiRedis } from './native-account/session.ts'
import { applicationRequest, sendWebResponse } from './web-request.ts'
import { coverImage, downloadImage } from './image-export.ts'

const origin = 'https://community.example'
const jsonHeaders = { origin, 'content-type': 'application/json' }
const indexHtml = '<!doctype html><html><body>community-http-entry</body></html>'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fakeStores() {
  let allowMedia = true
  let failUpdate = false
  const queries = []
  const media = {
    id: 'file1', name: 'creation.mp4', type: 'video/mp4',
    accessKey: 'original-key', thumbnailAccessKey: 'thumbnail-key',
    properties: { communityVideoPrivacy: { 'original-key': 1 } },
    webpublicAccessKey: null, webpublicType: null,
  }
  const db = {
    async query(sql, parameters = []) {
      queries.push({ sql, parameters })
      assert(!sql.includes('community_lottery'), 'HTTP checks must not operate on lottery data')
      if (sql.startsWith('UPDATE drive_file SET')) {
        if (failUpdate) { failUpdate = false; throw new Error('simulated metadata write failure') }
        const privacyKey = sql.includes('{communityVideoPrivacy}') ? 'communityVideoPrivacy' : 'communityImagePrivacy'
        media.properties = { ...media.properties, [privacyKey]: { ...media.properties?.[privacyKey], [parameters[1]]: 1 } }
        if (sql.includes('size=$3')) Object.assign(media, { size: parameters[2], md5: parameters[3], type: parameters[4], name: parameters[5] })
        else if (media.webpublicAccessKey === parameters[1]) media.webpublicType = parameters[2]
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('FROM drive_file f WHERE')) {
        return { rows: allowMedia && ['file1', media.accessKey, media.thumbnailAccessKey, media.webpublicAccessKey].includes(parameters[1]) ? [{ ...media }] : [], rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    },
    async connect() { return { query: db.query, release() {} } },
  }
  const redis = {
    async get() { return null },
    async set() { return 'OK' },
    async del() { return 0 },
    async exists() { return 0 },
    async ping() { return 'PONG' },
    async incr() { return 1 },
    async expire() { return 1 },
    async eval() { return 1 },
    async xrevrange() { return [] },
  }
  return { db, redis, queries, media, denyMedia() { allowMedia = false }, failMediaUpdate() { failUpdate = true } }
}

async function fixture(t) {
  const { createApplication } = await import('./runtime.ts')
  const root = await mkdtemp(path.join(tmpdir(), 'community-fastify-http-'))
  assert.equal(path.dirname(root), path.resolve(tmpdir()))
  const filesRoot = path.join(root, 'files')
  const distRoot = path.join(root, 'public')
  await Promise.all([mkdir(filesRoot), mkdir(path.join(distRoot, 'assets'), { recursive: true })])
  await Promise.all([
    writeFile(path.join(distRoot, 'index.html'), indexHtml),
    writeFile(path.join(distRoot, 'assets', 'app.js'), 'export const app = true;'),
    writeFile(path.join(root, 'outside.txt'), 'outside-must-not-be-served'),
    writeFile(path.join(filesRoot, 'original-key'), '0123456789abcdefghij'),
    sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).jpeg().toFile(path.join(filesRoot, 'thumbnail-key')),
  ])
  const stores = fakeStores()
  const app = createApplication({
    db: stores.db, redis: stores.redis,
    config: { url: origin, db: { host: 'unused', user: 'unused', db: 'unused' }, redis: { host: 'unused' } },
    filesRoot, distRoot,
  })
  t.after(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  return { app, filesRoot, ...stores }
}

for (const format of ['jpeg', 'png', 'webp', 'gif']) test(`explicit ${format} download uses full original, real encoding and media authorization`, async t => {
  const f = await fixture(t)
  const original = await sharp({ create: { width: 123, height: 79, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/webp', properties: { communityImagePrivacy: { 'original-key': 1 } } })
  const url = `/files/thumbnail-key?variant=cover&format=jpeg&download=${format}`
  const result = await f.app.inject({ method: 'GET', url })
  assert.equal(result.statusCode, 200); assert.equal(result.headers['content-type'], `image/${format}`)
  assert.match(result.headers['content-disposition'], new RegExp(`^attachment;.*zhangyu-file1\\.${format === 'jpeg' ? 'jpg' : format}`))
  const metadata = await sharp(result.rawPayload).metadata()
  assert.equal(metadata.format, format); assert.equal(metadata.width, 123); assert.equal(metadata.height, 79)
  const pixels = await sharp(result.rawPayload).ensureAlpha().raw().toBuffer()
  assert.equal(pixels[3], format === 'jpeg' ? 255 : 0)
  if (format === 'jpeg') assert(pixels.every(value => value >= 254))
  assert.deepEqual(await readFile(path.join(f.filesRoot, 'original-key')), original)
  const partial = await f.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-7' } })
  assert.equal(partial.statusCode, 206); assert.deepEqual(partial.rawPayload, result.rawPayload.subarray(0, 8))
  f.denyMedia()
  assertJsonError(await f.app.inject({ method: 'GET', url }), 404)
})

test('selected GIF and WebP preserve animation; selected JPG and PNG export only the first frame', async t => {
  const f = await fixture(t)
  const pixels = Buffer.concat([Buffer.alloc(16 * 16 * 3), Buffer.alloc(16 * 16 * 3, 255)])
  const original = await sharp(pixels, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp({ delay: [120, 240], loop: 2 }).toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/webp', properties: { communityImagePrivacy: { 'original-key': 1 } } })
  for (const format of ['gif', 'webp', 'jpeg', 'png']) {
    const result = await f.app.inject({ method: 'GET', url: `/legacy-files/file1?download=${format}` })
    assert.equal(result.statusCode, 200); assert.equal(result.headers['content-type'], `image/${format}`)
    const metadata = await sharp(result.rawPayload, { animated: true }).metadata()
    assert.equal(metadata.format, format)
    assert.equal(metadata.pages ?? 1, ['gif', 'webp'].includes(format) ? 2 : 1)
    if (['gif', 'webp'].includes(format)) { assert.deepEqual(metadata.delay, [120, 240]); assert.equal(metadata.loop, 2) }
    else assert.equal(metadata.height, 16)
  }
})

test('local image export is temporary, validates bytes and format, and enforces same origin and rate limits', async t => {
  const f = await fixture(t), url = '/api/images/export'
  const before = await readdir(f.filesRoot)
  const data = (await sharp({ create: { width: 31, height: 27, channels: 4, background: 'red' } }).png().toBuffer()).toString('base64')
  for (const format of ['jpeg', 'png', 'webp', 'gif']) {
    const result = await f.app.inject({ method: 'POST', url, headers: jsonHeaders, payload: { data, format } })
    assert.equal(result.statusCode, 200); assert.equal(result.headers['content-type'], `image/${format}`)
    assert.equal(result.headers['cache-control'], 'private, no-store')
    assert.equal((await sharp(result.rawPayload).metadata()).format, format)
  }
  assert.deepEqual(await readdir(f.filesRoot), before)
  for (const body of [{ data, format: 'svg' }, { data: 'bad!', format: 'gif' }, { data: Buffer.from('<svg/>').toString('base64'), format: 'gif' }, { data: Buffer.from('broken').toString('base64'), format: 'png' }])
    assertJsonError(await f.app.inject({ method: 'POST', url, headers: jsonHeaders, payload: body }), 400)
  assertJsonError(await f.app.inject({ method: 'POST', url, headers: { ...jsonHeaders, origin: 'https://outside.example' }, payload: { data, format: 'gif' } }), 403)
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1?download=svg' }), 400)
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1?download=png' }), 400)
  f.redis.eval = async () => 31
  assertJsonError(await f.app.inject({ method: 'POST', url, headers: jsonHeaders, payload: { data, format: 'gif' } }), 429)
})

test('image exports bound input size and refuse unsupported animation instead of silently dropping frames', async t => {
  await assert.rejects(downloadImage('must-not-be-read', { size: 32 * 1024 ** 2 + 1 }, 'gif'), { statusCode: 413 })
  const f = await fixture(t)
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  const control = Buffer.alloc(20)
  control.writeUInt32BE(8); control.write('acTL', 4); control.writeUInt32BE(2, 8); control.writeUInt32BE(crc32(control.subarray(4, 16)), 16)
  const apng = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)])
  for (const format of ['gif', 'webp']) {
    const result = await f.app.inject({ method: 'POST', url: '/api/images/export', headers: jsonHeaders, payload: { format, data: apng.toString('base64') } })
    assertJsonError(result, 400); assert.match(result.json().error.message, /首帧/)
  }
})

test('JPEG exports preserve dimensions and stored bytes with correct filenames, ranges and private access', async t => {
  const f = await fixture(t)
  const original = await sharp({ create: { width: 127, height: 83, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .withExif({ IFD0: { Artist: 'PRIVATE' } }).webp().toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/webp', publiclyVisible: true, webpublicAccessKey: 'original-key', webpublicType: 'image/webp',
    properties: { communityImagePrivacy: { 'original-key': 1 } } })
  const url = '/legacy-files/file1?format=jpeg&variant=webpublic'
  const full = await f.app.inject({ method: 'GET', url })
  assert.equal(full.statusCode, 200)
  assert.equal(full.headers['content-type'], 'image/jpeg')
  assert.match(full.headers['content-disposition'], /zhangyu-file1\.jpg/)
  assert.equal(full.rawPayload.subarray(0, 3).toString('hex'), 'ffd8ff')
  const details = await sharp(full.rawPayload).metadata()
  assert.equal(details.width, 127); assert.equal(details.height, 83); assert.equal(details.exif, undefined)
  const pixels = await sharp(full.rawPayload).raw().toBuffer()
  assert(pixels.every(channel => channel >= 254), 'transparent areas should be white')
  assert.deepEqual(await readFile(path.join(f.filesRoot, 'original-key')), original)
  const head = await f.app.inject({ method: 'HEAD', url })
  assert.equal(head.headers['content-length'], String(full.rawPayload.length)); assert.equal(head.rawPayload.length, 0)
  const partial = await f.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-7' } })
  assert.equal(partial.statusCode, 206); assert.deepEqual(partial.rawPayload, full.rawPayload.subarray(0, 8))
  assert.equal(partial.headers['content-range'], `bytes 0-7/${full.rawPayload.length}`)
  const invalid = await f.app.inject({ method: 'HEAD', url, headers: { range: `bytes=${full.rawPayload.length}-` } })
  assert.equal(invalid.statusCode, 416)
  assert.equal((await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': full.headers.etag } })).statusCode, 304)
  const webp = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=webpublic', headers: { 'if-none-match': full.headers.etag } })
  assert.equal(webp.statusCode, 200); assert.equal(webp.headers['content-type'], 'image/webp'); assert.notEqual(webp.headers.etag, full.headers.etag)
  const originalDownload = await f.app.inject({ method: 'GET', url: '/files/original-key?format=jpeg' })
  assert.equal(originalDownload.headers['content-type'], 'image/jpeg')
  f.denyMedia()
  assertJsonError(await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': full.headers.etag } }), 404)
})

test('JPEG export keeps animations and videos intact and rejects damaged image bytes', async t => {
  const f = await fixture(t)
  const pixels = Buffer.concat([Buffer.alloc(48 * 48 * 3), Buffer.alloc(48 * 48 * 3, 255)])
  const animated = await sharp(pixels, { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } })
    .webp({ delay: [100, 200], loop: 0 }).toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), animated)
  Object.assign(f.media, { type: 'image/webp', properties: { communityImagePrivacy: { 'original-key': 1 } } })
  const response = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?format=jpeg' })
  assert.equal(response.headers['content-type'], 'image/webp'); assert.deepEqual(response.rawPayload, animated)
  assert.equal((await sharp(response.rawPayload, { animated: true }).metadata()).pages, 2)
  await writeFile(path.join(f.filesRoot, 'original-key'), 'damaged')
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1?format=jpeg' }), 503)
  Object.assign(f.media, { type: 'video/mp4', properties: { communityVideoPrivacy: { 'original-key': 1 } } })
  const video = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?format=jpeg' })
  assert.equal(video.headers['content-type'], 'video/mp4'); assert.equal(video.payload, 'damaged')
})

test('work cover preserves historical animation frames, timing and loop with bounded size and authorized caching', async t => {
  const f = await fixture(t)
  const pixels = Buffer.concat([Buffer.alloc(600 * 600 * 3), Buffer.alloc(600 * 600 * 3, 255)])
  const original = await sharp(pixels, { raw: { width: 600, height: 1200, channels: 3, pageHeight: 600 } })
    .webp({ delay: [160, 240], loop: 0 }).toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/webp', publiclyVisible: true,
    properties: { communityImagePrivacy: { 'original-key': 1 } } })
  const url = '/legacy-files/file1?variant=cover'
  const full = await f.app.inject({ method: 'GET', url })
  assert.equal(full.statusCode, 200)
  assert.equal(full.headers['content-type'], 'image/webp')
  const details = await sharp(full.rawPayload, { animated: true }).metadata()
  assert.equal(details.pages, 2); assert.deepEqual(details.delay, [160, 240]); assert.equal(details.loop, 0)
  assert.equal(details.width, 422); assert.equal(details.pageHeight, 422); assert.equal(details.exif, undefined)
  assert(full.rawPayload.length < original.length)
  assert.deepEqual(await readFile(path.join(f.filesRoot, 'original-key')), original)
  assert.match(full.headers.etag, /^W\//)
  assert.equal(full.headers['cache-control'], 'private, no-cache')
  const head = await f.app.inject({ method: 'HEAD', url })
  assert.equal(head.headers['content-length'], String(full.rawPayload.length)); assert.equal(head.rawPayload.length, 0)
  const part = await f.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-7' } })
  assert.equal(part.statusCode, 206); assert.deepEqual(part.rawPayload, full.rawPayload.subarray(0, 8))
  assert.equal((await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': full.headers.etag } })).statusCode, 304)
  const jpeg = await f.app.inject({ method: 'GET', url: url + '&format=jpeg' })
  assert.equal((await sharp(jpeg.rawPayload, { animated: true }).metadata()).pages, 2)
  const changed = await sharp(original, { animated: true }).webp({ delay: [300, 300], loop: 2 }).toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), changed)
  const updated = await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': full.headers.etag } })
  assert.equal(updated.statusCode, 200); assert.notEqual(updated.headers.etag, full.headers.etag)
  assert.deepEqual((await sharp(updated.rawPayload, { animated: true }).metadata()).delay, [300, 300])
  f.denyMedia()
  assertJsonError(await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': updated.headers.etag } }), 404)
})

test('work cover reuses static thumbnails and keeps video posters unchanged', async t => {
  const f = await fixture(t)
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: 'blue' } }).webp().toBuffer()
  const thumbnail = await readFile(path.join(f.filesRoot, 'thumbnail-key'))
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/webp', publiclyVisible: true,
    properties: { communityImagePrivacy: { 'original-key': 1, 'thumbnail-key': 1 } } })
  const response = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
  assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, thumbnail)
  assert.equal(response.headers['content-type'], 'image/jpeg')
  const thumb = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=thumbnail' })
  assert.deepEqual(thumb.rawPayload, thumbnail)
  f.media.type = 'video/mp4'
  const video = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=thumbnail' })
  assert.deepEqual(video.rawPayload, thumbnail)
  f.media.type = 'image/webp'; f.media.thumbnailAccessKey = 'missing-thumbnail'
  const fallback = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
  assert.equal(fallback.statusCode, 200); assert.deepEqual(fallback.rawPayload, original)
})

test('work cover privacy failure never exposes the original or a cached image', async t => {
  const f = await fixture(t)
  const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .withExif({ IFD0: { Artist: 'PRIVATE' } }).png().toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  Object.assign(f.media, { type: 'image/png', publiclyVisible: true, properties: {} })
  f.failMediaUpdate()
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' }), 503)
})

test('work cover uses surviving derivatives when an old original is missing', async t => {
  const f = await fixture(t)
  const pixels = Buffer.concat([Buffer.alloc(48 * 48 * 3), Buffer.alloc(48 * 48 * 3, 255)])
  const display = await sharp(pixels, { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } })
    .webp({ delay: [160, 240], loop: 0 }).toBuffer()
  await writeFile(path.join(f.filesRoot, 'display-key'), display)
  Object.assign(f.media, { type: 'image/webp', accessKey: 'missing-original', webpublicAccessKey: 'display-key', webpublicType: 'image/webp',
    properties: { communityImagePrivacy: { 'display-key': 1, 'thumbnail-key': 1 } } })
  const animated = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
  assert.equal(animated.statusCode, 200)
  assert.equal((await sharp(animated.rawPayload, { animated: true }).metadata()).pages, 2)
  f.media.webpublicAccessKey = 'missing-display'
  const thumbnail = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
  assert.equal(thumbnail.statusCode, 200)
  assert.deepEqual(thumbnail.rawPayload, await readFile(path.join(f.filesRoot, 'thumbnail-key')))
  f.media.thumbnailAccessKey = 'missing-thumbnail'
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' }), 404)
})

test('work cover keeps the safe original moving when the conversion queue is full', async t => {
  const f = await fixture(t)
  const source = path.join(f.filesRoot, 'original-key')
  const pixels = Buffer.concat([Buffer.alloc(48 * 48 * 3), Buffer.alloc(48 * 48 * 3, 255)])
  const original = await sharp(pixels, { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } })
    .webp({ delay: [160, 240], loop: 0 }).toBuffer()
  await writeFile(source, original)
  Object.assign(f.media, { type: 'image/webp', publiclyVisible: true,
    properties: { communityImagePrivacy: { 'original-key': 1 } } })
  const metadata = await stat(source), gate = deferred(), readMetadata = sharp.prototype.metadata
  const mocked = t.mock.method(sharp.prototype, 'metadata', function (...args) {
    return gate.promise.then(() => readMetadata.apply(this, args))
  })
  const queued = Array.from({ length: 16 }, (_, index) => coverImage(source, { ...metadata, mtimeMs: metadata.mtimeMs + index + 1 }))
  try {
    const response = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
    assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, original)
    assert.equal(response.headers.etag, undefined); assert.equal(response.headers['cache-control'], 'private, no-store')
  } finally {
    gate.resolve(); await Promise.all(queued); mocked.mock.restore()
  }
  const retried = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=cover' })
  assert.equal(retried.statusCode, 200); assert(retried.headers.etag)
  assert.equal((await sharp(retried.rawPayload, { animated: true }).metadata()).pages, 2)
})

test('public image downloads hide upload names and metadata on every original route', async t => {
  const { app, media, filesRoot, denyMedia, queries } = await fixture(t)
  Object.assign(media, { name: 'ComfyUI-private-customer-prompt.png', type: 'image/png', thumbnailAccessKey: null })
  let original = await sharp({ create: { width: 3001, height: 2, channels: 3, background: '#ff0000' } })
    .withExif({ IFD0: { Artist: 'PRIVATE-CUSTOMER', ImageDescription: 'PRIVATE-PROMPT' } }).png().toBuffer()
  for (const key of ['prompt', 'workflow']) {
    const data = Buffer.from(key + '\0PRIVATE-COMFYUI-WORKFLOW')
    const chunk = Buffer.alloc(data.length + 12)
    chunk.writeUInt32BE(data.length)
    chunk.write('tEXt', 4)
    data.copy(chunk, 8)
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
    original = Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)])
  }
  await writeFile(path.join(filesRoot, 'original-key'), original)
  let sanitized
  for (const url of ['/legacy-files/file1', '/legacy-files/file1?variant=original', '/files/original-key', '/legacy-files/file1?variant=web']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200)
    assert(!response.headers['content-disposition'].includes('ComfyUI'))
    assert(response.headers['content-disposition'].includes('zhangyu-file1.webp'))
    const metadata = await sharp(response.rawPayload).metadata()
    assert.equal(metadata.width, 3001)
    assert.equal(metadata.height, 2)
    for (const key of ['exif', 'xmp', 'iptc', 'comments']) assert.equal(metadata[key], undefined)
    assert(!response.rawPayload.includes(Buffer.from('PRIVATE-')))
    sanitized = response.rawPayload
  }
  const partial = await app.inject({ method: 'GET', url: '/files/original-key', headers: { range: 'bytes=2-5' } })
  assert.equal(partial.statusCode, 206)
  assert.deepEqual(partial.rawPayload, sanitized.subarray(2, 6))
  const head = await app.inject({ method: 'HEAD', url: '/legacy-files/file1' })
  assert.equal(Number(head.headers['content-length']), sanitized.length)
  assert.equal(queries.filter(entry => entry.sql.startsWith('UPDATE drive_file SET')).length, 1)
  assert.equal(media.size, sanitized.length)
  assert.deepEqual((await readdir(filesRoot)).sort(), ['original-key', 'thumbnail-key'])
  denyMedia()
  assertJsonError(await app.inject({ method: 'GET', url: '/files/original-key' }), 404)
  const other = await fixture(t)
  Object.assign(other.media, { type: 'image/png', name: 'PRIVATE.png' })
  assertJsonError(await other.app.inject({ method: 'GET', url: '/legacy-files/file1' }), 503)
})

test('a metadata write failure after atomic replacement recovers without retaining an unsafe copy', async t => {
  const f = await fixture(t)
  Object.assign(f.media, { type: 'image/png', name: 'PRIVATE.png', properties: undefined })
  const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .withExif({ IFD0: { Artist: 'PRIVATE-UPLOADER' } }).png().toBuffer()
  await writeFile(path.join(f.filesRoot, 'original-key'), original)
  f.failMediaUpdate()
  assertJsonError(await f.app.inject({ method: 'GET', url: '/legacy-files/file1' }), 503)
  const replaced = await readFile(path.join(f.filesRoot, 'original-key'))
  assert.equal((await sharp(replaced).metadata()).exif, undefined)
  assert.equal(f.media.properties, undefined)
  const retry = await f.app.inject({ method: 'GET', url: '/legacy-files/file1' })
  assert.equal(retry.statusCode, 200)
  assert.equal(f.media.type, 'image/webp')
  assert.equal(f.media.properties.communityImagePrivacy['original-key'], 1)
  assert.deepEqual((await readdir(f.filesRoot)).sort(), ['original-key', 'thumbnail-key'])
})

test('historical video downloads sanitize in place and synchronize the privacy marker and checksum', async t => {
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0) return t.skip('FFmpeg is unavailable')
  const f = await fixture(t)
  Object.assign(f.media, { name: 'PRIVATE-CUSTOMER.mp4', properties: undefined })
  const source = path.join(f.filesRoot, 'original-key')
  const generated = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=16x16:r=2:d=0.5',
    '-c:v', 'mpeg4', '-metadata', 'comment=PRIVATE-HISTORY', '-f', 'mp4', source], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  assert((await readFile(source)).includes(Buffer.from('PRIVATE-HISTORY')))
  const response = await f.app.inject({ method: 'GET', url: '/legacy-files/file1' })
  assert.equal(response.statusCode, 200)
  assert(response.headers['content-disposition'].includes('zhangyu-file1.mp4'))
  assert(!response.rawPayload.includes(Buffer.from('PRIVATE-HISTORY')))
  assert.deepEqual(response.rawPayload, await readFile(source))
  assert.equal(f.media.properties.communityVideoPrivacy['original-key'], 1)
  assert.equal(f.media.size, response.rawPayload.length)
  assert.equal(f.media.md5, createHash('md5').update(response.rawPayload).digest('hex'))
  assert.equal(f.media.name, 'zhangyu-file1.mp4')
  const head = await f.app.inject({ method: 'HEAD', url: '/files/original-key' })
  assert.equal(head.statusCode, 200)
  assert.equal(Number(head.headers['content-length']), response.rawPayload.length)
  assert.equal(f.queries.filter(query => query.sql.startsWith('UPDATE drive_file SET')).length, 1)
  assert.deepEqual((await readdir(f.filesRoot)).sort(), ['original-key', 'thumbnail-key'])
})

function assertJsonError(response, statusCode) {
  assert.equal(response.statusCode, statusCode)
  assert.match(response.headers['content-type'], /application\/json/)
  assert.equal(typeof response.json().error?.message, 'string')
  assert(response.json().error.message.length > 0)
}

test('Fastify keeps JSON errors, same-origin writes, guest session and logout cookies', async t => {
  const { app, queries } = await fixture(t)
  const anonymous = await app.inject({ method: 'GET', url: '/api/session' })
  assert.equal(anonymous.statusCode, 200)
  assert.deepEqual(anonymous.json(), { user: null, authentication: 'zhangyu', accountUrl: 'https://zhangyuapi.com' })
  assert.match(anonymous.headers['cache-control'], /no-store/)
  const registration = await app.inject({ method: 'GET', url: '/api/registration' })
  assert.equal(registration.statusCode, 200)
  assert.deepEqual(registration.json(), { enabled: false, authentication: 'zhangyu', accountUrl: 'https://zhangyuapi.com' })
  for (const url of ['/api/session/login', '/api/session/register']) {
    assertJsonError(await app.inject({ method: 'POST', url, headers: { origin: 'https://other.example',
      'content-type': 'application/json' }, payload: '{}' }), 403)
    const disabled = await app.inject({ method: 'POST', url, headers: jsonHeaders,
      payload: '{"login":"legacy","username":"legacy","password":"legacy-password"}' })
    assertJsonError(disabled, 410)
    assert.equal(disabled.json().error.code, 'ACCOUNT_LOGIN_REQUIRED')
  }
  assert.equal(queries.length, 0, 'disabled native authentication must not read or change legacy account data')

  for (const headers of [
    { 'content-type': 'application/json' },
    { origin: 'https://other.example', 'content-type': 'application/json' },
  ]) {
    assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers, payload: '{}' }), 403)
  }
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: { origin, 'content-type': 'text/plain' }, payload: '{}' }), 415)
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '{"broken":' }), 400)
  assertJsonError(await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '[]' }), 400)
  assertJsonError(await app.inject({ method: 'GET', url: '/api/missing-http-check' }), 404)

  const logout = await app.inject({ method: 'POST', url: '/api/session/logout', headers: jsonHeaders, payload: '{}' })
  assert.equal(logout.statusCode, 200)
  assert.deepEqual(logout.json(), { user: null })
  const cookies = [].concat(logout.headers['set-cookie'] || [])
  for (const name of ['community_session', 'octopus_new_api_session']) {
    const expired = cookies.find(value => value.startsWith(`${name}=`))
    assert(expired, `logout must forward the raw ${name} Set-Cookie header`)
    for (const attribute of [/Max-Age=0/i, /Path=\//i, /HttpOnly/i, /SameSite=Lax/i, /Secure/i]) assert.match(expired, attribute)
  }

  // A permitted upload body must reach authentication instead of Fastify's 1 MiB default cap.
  const upload = JSON.stringify({ name: 'creation.png', type: 'image/png', data: 'x'.repeat(1024 * 1024 + 1) })
  assertJsonError(await app.inject({ method: 'POST', url: '/api/uploads', headers: jsonHeaders, payload: upload }), 401)
  const oversized = JSON.stringify({ data: 'x'.repeat(28 * 1024 * 1024) })
  assertJsonError(await app.inject({ method: 'POST', url: '/api/uploads', headers: jsonHeaders, payload: oversized }), 413)

  const handoff = await app.inject({ method: 'GET', url: '/auth/newapi' })
  assert.equal(handoff.statusCode, 303)
  assert.equal(handoff.headers.location, '/account')
  const oldCallback = await app.inject({ method: 'GET', url: '/api/newapi/callback?code=old-code&state=old-state' })
  assert.equal(oldCallback.statusCode, 303)
  assert.equal(oldCallback.headers.location, '/account')
})

test('static assets and SPA routes preserve HEAD and never expose paths outside dist', async t => {
  const { app } = await fixture(t)
  const spa = await app.inject({ method: 'GET', url: '/work/legacy123' })
  assert.equal(spa.statusCode, 200)
  assert.equal(spa.payload, indexHtml)
  const head = await app.inject({ method: 'HEAD', url: '/work/legacy123' })
  assert.equal(head.statusCode, 200)
  assert.equal(head.payload, '')
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(indexHtml))
  const asset = await app.inject({ method: 'HEAD', url: '/assets/app.js' })
  assert.equal(asset.statusCode, 200)
  assert.equal(asset.payload, '')
  assert.match(asset.headers['content-type'], /javascript/)
  assert.match(asset.headers['cache-control'], /immutable/)
  assertJsonError(await app.inject({ method: 'GET', url: '/assets/missing.js' }), 404)
  for (const url of ['/assets/%2e%2e/%2e%2e/outside.txt', '/.env', '/assets/%5coutside.txt', '/assets/%00outside.txt']) {
    const blocked = await app.inject({ method: 'GET', url })
    assert([400, 404].includes(blocked.statusCode), `${url} must be rejected`)
    assert(!blocked.payload.includes('outside-must-not-be-served'))
  }
})

test('pages and static assets remain available during an account-store outage without weakening API or media checks', async t => {
  const { app, queries } = await fixture(t)
  const environment = {
    NEW_API_BASE_URL: 'https://accounts.example',
    NEW_API_SESSION_SECRET: 'http-account-outage-fixture'.repeat(3),
    NEW_API_REDIS_URL: 'redis://127.0.0.1:6379',
  }
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]))
  Object.assign(process.env, environment)
  t.after(async () => {
    await closeNewApiRedis()
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const redis = getNewApiRedis()
  t.mock.method(redis, 'set', async () => 'OK')
  t.mock.method(redis, 'eval', async () => 1)
  let reads = 0
  t.mock.method(redis, 'get', async key => {
    assert.equal(key, `octopus:new-api:${'a'.repeat(43)}`)
    reads++
    throw new Error('account store unavailable')
  })
  t.mock.method(console, 'error', () => {})
  const headers = { cookie: `octopus_new_api_session=${'a'.repeat(43)}` }
  for (const url of ['/account', '/discover', '/assets/app.js']) {
    for (const method of ['GET', 'HEAD']) {
      const result = await app.inject({ method, url, headers })
      assert.equal(result.statusCode, 200, `${method} ${url}`)
      if (method === 'HEAD') assert.equal(result.payload, '')
    }
  }
  assert.equal(reads, 0, 'serving static content must not read account sessions')
  assert.equal(queries.length, 0)
  for (const url of ['/api/library', '/api/admin/settings', '/legacy-files/file1', '/files/original-key']) {
    const result = await app.inject({ method: 'GET', url, headers })
    assertJsonError(result, 500)
  }
  assert.equal(reads, 4, 'private APIs and media still verify the caller')
  assert.equal(queries.length, 0, 'an unavailable session must not fall through to content access')
})

test('page policy permits local media and Turnstile without allowing arbitrary scripts or frames', async t => {
  const { app } = await fixture(t)
  for (const method of ['GET', 'HEAD']) {
    const page = await app.inject({ method, url: '/account?returnTo=/create/image' })
    assert.equal(page.statusCode, 200)
    const directives = new Map(page.headers['content-security-policy'].split(';').map(value => {
      const [name, ...sources] = value.trim().split(/\s+/)
      return [name, sources]
    }))
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      assert(directives.get(name).includes('https://challenges.cloudflare.com'), `${name} must allow account verification`)
      assert(!directives.get(name).some(value => ['*', 'https:', "'unsafe-inline'", "'unsafe-eval'"].includes(value)))
    }
    assert.deepEqual(directives.get('connect-src'), ["'self'", 'blob:', 'data:', 'https://challenges.cloudflare.com'])
    assert.deepEqual(directives.get('script-src'), ["'self'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com/beacon.min.js', 'https://static.cloudflareinsights.com/beacon.min.js/'])
    assert.deepEqual(directives.get('frame-src'), ["'self'", 'https://challenges.cloudflare.com'])
    assert.deepEqual(directives.get('default-src'), ["'self'"])
    assert.deepEqual(directives.get('frame-ancestors'), ["'self'"])
    assert.deepEqual(directives.get('object-src'), ["'none'"])
  }
})

test('temporary media keeps original, HEAD, range and thumbnail permission semantics', async t => {
  const { app, denyMedia } = await fixture(t)
  const full = await app.inject({ method: 'GET', url: '/legacy-files/file1' })
  assert.equal(full.statusCode, 200)
  assert.equal(full.payload, '0123456789abcdefghij')
  assert.equal(full.headers['content-type'], 'video/mp4')
  assert.equal(full.headers['accept-ranges'], 'bytes')
  assert.equal(Number(full.headers['content-length']), 20)
  const head = await app.inject({ method: 'HEAD', url: '/legacy-files/file1' })
  assert.equal(head.statusCode, 200)
  assert.equal(head.payload, '')
  assert.equal(Number(head.headers['content-length']), 20)
  const partial = await app.inject({ method: 'GET', url: '/legacy-files/file1', headers: { range: 'bytes=2-5' } })
  assert.equal(partial.statusCode, 206)
  assert.equal(partial.payload, '2345')
  assert.equal(partial.headers['content-range'], 'bytes 2-5/20')
  assert.equal(Number(partial.headers['content-length']), 4)
  const rangeHead = await app.inject({ method: 'HEAD', url: '/legacy-files/file1', headers: { range: 'bytes=-4' } })
  assert.equal(rangeHead.statusCode, 206)
  assert.equal(rangeHead.payload, '')
  assert.equal(rangeHead.headers['content-range'], 'bytes 16-19/20')
  const invalid = await app.inject({ method: 'GET', url: '/legacy-files/file1', headers: { range: 'bytes=20-' } })
  assert.equal(invalid.statusCode, 416)
  assert.equal(invalid.headers['content-range'], 'bytes */20')
  const thumbnail = await app.inject({ method: 'GET', url: '/legacy-files/file1?variant=thumbnail' })
  assert.equal(thumbnail.statusCode, 200)
  assert.equal(thumbnail.headers['content-type'], 'image/webp')
  assert.equal((await sharp(thumbnail.rawPayload).metadata()).width, 2)
  const byKey = await app.inject({ method: 'GET', url: '/files/thumbnail-key' })
  assert.equal(byKey.statusCode, 200)
  assert.deepEqual(byKey.rawPayload, thumbnail.rawPayload)
  denyMedia()
  for (const url of ['/legacy-files/file1', '/legacy-files/file1?variant=thumbnail', '/files/thumbnail-key']) {
    assertJsonError(await app.inject({ method: 'GET', url }), 404)
  }
})

test('visible image variants revalidate without retransmitting bytes and still check access on every request', async t => {
  const f = await fixture(t)
  Object.assign(f.media, { publiclyVisible: true, webpublicAccessKey: 'web-key', webpublicType: 'image/png' })
  await sharp({ create: { width: 3, height: 2, channels: 3, background: 'blue' } }).png().toFile(path.join(f.filesRoot, 'web-key'))
  for (const url of ['/legacy-files/file1?variant=thumbnail', '/files/thumbnail-key',
    '/legacy-files/file1?variant=web', '/legacy-files/file1?variant=webpublic', '/files/web-key']) {
    const full = await f.app.inject({ method: 'GET', url })
    assert.equal(full.statusCode, 200)
    assert.equal(full.headers['cache-control'], 'private, no-cache')
    assert.equal(full.headers.vary, 'Cookie, Authorization')
    const etag = full.headers.etag
    assert.match(etag, /^W\/"[A-Za-z0-9_-]+"$/)
    for (const method of ['GET', 'HEAD']) {
      for (const value of [etag, etag.slice(2), `"other", ${etag}`, '*']) {
        const before = f.queries.length
        const cached = await f.app.inject({ method, url, headers: { 'if-none-match': value, range: 'bytes=0-1' } })
        assert.equal(cached.statusCode, 304, `${method} ${url} ${value}`)
        assert.equal(cached.payload, '')
        assert.equal(cached.headers.etag, etag)
        assert.equal(cached.headers['content-length'], undefined)
        assert.equal(cached.headers['content-range'], undefined)
        assert.equal(f.queries.length, before + 1, 'each conditional request must query current file visibility')
      }
    }
    const changed = await f.app.inject({ method: 'GET', url, headers: { 'if-none-match': '"other"' } })
    assert.equal(changed.statusCode, 200)
    assert.deepEqual(changed.rawPayload, full.rawPayload)
    const partial = await f.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-1' } })
    assert.equal(partial.statusCode, 206)
    assert.deepEqual(partial.rawPayload, full.rawPayload.subarray(0, 2))
    for (const ifRange of [etag, etag.slice(2), 'Mon, 23 Nov 2026 00:00:00 GMT']) {
      const staleRange = await f.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-1', 'if-range': ifRange } })
      assert.equal(staleRange.statusCode, 200, 'weak validators and unverified dates cannot validate a partial response')
      assert.deepEqual(staleRange.rawPayload, full.rawPayload)
    }
  }
  const updates = f.queries.filter(query => query.sql.startsWith('UPDATE drive_file SET'))
  assert.equal(updates.length, 2, 'successful synchronous sanitization can issue validators before its snapshot is refreshed')
  f.denyMedia()
  assertJsonError(await f.app.inject({
    method: 'GET', url: '/files/thumbnail-key', headers: { 'if-none-match': '*' },
  }), 404)
})

test('private variants, originals and missing-variant fallbacks never reuse conditional cache entries', async t => {
  const f = await fixture(t)
  const url = '/legacy-files/file1?variant=thumbnail'
  f.media.publiclyVisible = true
  const publicResponse = await f.app.inject({ method: 'GET', url })
  assert.equal(publicResponse.statusCode, 200)
  assert(publicResponse.headers.etag)
  f.media.publiclyVisible = false
  for (const requestUrl of [url, '/files/thumbnail-key', '/legacy-files/file1', '/files/original-key']) {
    const response = await f.app.inject({ method: 'GET', url: requestUrl, headers: { 'if-none-match': publicResponse.headers.etag } })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'private, no-store')
    assert.equal(response.headers.etag, undefined)
  }
  f.media.publiclyVisible = true
  f.media.thumbnailAccessKey = 'missing-key'
  for (const requestUrl of ['/legacy-files/file1', '/files/original-key', url, '/files/missing-key']) {
    const response = await f.app.inject({ method: 'GET', url: requestUrl, headers: { 'if-none-match': '*' } })
    assert.equal(response.statusCode, 200)
    assert.equal(response.payload, '0123456789abcdefghij')
    assert.equal(response.headers['cache-control'], 'private, no-store')
    assert.equal(response.headers.etag, undefined)
  }
})

test('image validators change with actual storage and bytes, and safe ready variants skip metadata writes', async t => {
  const f = await fixture(t)
  f.media.publiclyVisible = true
  Object.assign(f.media.properties, { communityImagePrivacy: { 'thumbnail-key': 1, 'next-key': 1 } })
  const first = await f.app.inject({ method: 'GET', url: '/legacy-files/file1?variant=thumbnail' })
  assert.equal(first.statusCode, 200)
  assert(first.headers.etag)
  assert.equal(f.queries.filter(query => query.sql.startsWith('UPDATE drive_file SET')).length, 0)
  const original = await readFile(path.join(f.filesRoot, 'thumbnail-key'))
  await writeFile(path.join(f.filesRoot, 'thumbnail-key'), Buffer.concat([original, Buffer.from('changed-bytes')]))
  const changed = await f.app.inject({
    method: 'GET', url: '/legacy-files/file1?variant=thumbnail', headers: { 'if-none-match': first.headers.etag },
  })
  assert.equal(changed.statusCode, 200)
  assert.notEqual(changed.headers.etag, first.headers.etag)
  await writeFile(path.join(f.filesRoot, 'next-key'), changed.rawPayload)
  f.media.thumbnailAccessKey = 'next-key'
  const moved = await f.app.inject({
    method: 'GET', url: '/legacy-files/file1?variant=thumbnail', headers: { 'if-none-match': changed.headers.etag },
  })
  assert.equal(moved.statusCode, 200)
  assert.notEqual(moved.headers.etag, changed.headers.etag)
  assert.deepEqual(moved.rawPayload, changed.rawPayload)
})

test('conditional requests cannot bypass failed image sanitization or marker persistence', async t => {
  for (const failMarker of [true, false]) {
    const f = await fixture(t)
    f.media.publiclyVisible = true
    if (failMarker) f.failMediaUpdate()
    else await writeFile(path.join(f.filesRoot, 'thumbnail-key'), Buffer.from([0xff, 0xd8, 0xff]))
    const response = await f.app.inject({
      method: 'GET', url: '/legacy-files/file1?variant=thumbnail', headers: { 'if-none-match': '*' },
    })
    assertJsonError(response, 503)
    assert.equal(response.headers.etag, undefined)
    assert.equal(response.headers['cache-control'], 'private, no-store')
  }
})

test('native account adapters preserve the public URL, JSON body, cookies and separate Set-Cookie headers', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.post('/account-contract', async (request, reply) => {
    const req = new AccountRequest(applicationRequest(request, reply, origin))
    assert.equal(req.nextUrl.origin, origin)
    assert.equal(req.nextUrl.searchParams.get('returnTo'), '/create/image')
    assert.equal(req.headers.get('content-length'), null)
    assert.equal(req.cookies.get('octopus_new_api_session')?.value, 'session/value')
    assert.equal(req.cookies.get('pref')?.value, 'dark')
    assert.deepEqual(await req.json(), { username: 'root', password: 'opaque-test-only' })
    const response = AccountResponse.json({ success: true }, { status: 201 })
    response.cookies.set('octopus_new_api_session', 'new/session', {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
    })
    response.cookies.set('community_session', 'community/session', {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
    })
    response.headers.append('Set-Cookie', 'pref=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/')
    return sendWebResponse(reply, response)
  })
  const response = await app.inject({
    method: 'POST', url: '/account-contract?returnTo=%2Fcreate%2Fimage',
    headers: { 'content-type': 'application/json', cookie: 'octopus_new_api_session=session%2Fvalue; pref=dark' },
    payload: { username: 'root', password: 'opaque-test-only' },
  })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), { success: true })
  assert.deepEqual([].concat(response.headers['set-cookie'] || []), [
    'octopus_new_api_session=new%2Fsession; Path=/; HttpOnly; Secure; SameSite=lax; Max-Age=600',
    'community_session=community%2Fsession; Path=/; HttpOnly; Secure; SameSite=lax; Max-Age=600',
    'pref=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
  ])
})

test('native account response sends the first chunk before completion and aborts on client disconnect', { timeout: 10000 }, async t => {
  const finish = deferred()
  const requestAborted = deferred()
  const bodyCancelled = deferred()
  let streamEnded = false
  const app = Fastify({ forceCloseConnections: true })
  app.get('/native/:mode', async (request, reply) => {
    const req = new AccountRequest(applicationRequest(request, reply, origin))
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('first-chunk\n'))
        if (request.params.mode === 'cancel') {
          req.signal.addEventListener('abort', () => requestAborted.resolve(req.signal.aborted), { once: true })
          return
        }
        void finish.promise.then(() => {
          streamEnded = true
          controller.enqueue(encoder.encode('last-chunk\n'))
          controller.close()
        })
      },
      cancel() { bodyCancelled.resolve() },
    })
    return sendWebResponse(reply, new AccountResponse(stream, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    }))
  })
  t.after(async () => { finish.resolve(); await app.close() })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const openResponse = url => new Promise((resolve, reject) => {
    const request = http.get(url, res => { res.pause(); resolve(res) })
    request.once('error', reject)
  })
  const response = await openResponse(new URL('/native/stream', address))
  t.after(() => response.destroy())
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  const first = once(response, 'data')
  response.resume()
  await first
  assert.equal(streamEnded, false, 'native response must deliver data before its body has completed')
  assert(Buffer.concat(chunks).length > 0)
  const ended = once(response, 'end')
  finish.resolve()
  await ended
  assert.equal(Buffer.concat(chunks).toString(), 'first-chunk\nlast-chunk\n')

  const cancelResponse = await openResponse(new URL('/native/cancel', address))
  t.after(() => cancelResponse.destroy())
  const cancelFirst = once(cancelResponse, 'data')
  cancelResponse.resume()
  await cancelFirst
  cancelResponse.destroy()
  assert.equal(await requestAborted.promise, true, 'client disconnect must terminate the native account request')
  await bodyCancelled.promise
})

test('legacy Studio pages redirect to native creation and old POST requests are not proxied', async t => {
  const { app } = await fixture(t)
  for (const method of ['GET', 'HEAD']) {
    for (const url of ['/studio', '/studio/', '/studio/image?model=old', '/studio/api/raw-check']) {
      const response = await app.inject({ method, url })
      assert.equal(response.statusCode, 302)
      assert.equal(response.headers.location, '/create')
      if (method === 'HEAD') assert.equal(response.payload, '')
    }
  }
  for (const url of ['/studio', '/studio/image', '/studio/api/raw-check']) {
    assertJsonError(await app.inject({ method: 'POST', url, headers: jsonHeaders, payload: '{}' }), 405)
  }
})

test('native creation endpoints require the community account before upstream access', async t => {
  const { app } = await fixture(t)
  for (const url of ['/api/creation/models', '/api/creation/tasks/image/job_1',
    '/api/creation/tasks/video/job_1', '/api/creation/media?path=videos/job_1/content']) {
    assertJsonError(await app.inject({ method: 'GET', url }), 401)
  }
  assertJsonError(await app.inject({ method: 'POST', url: '/api/creation/generate', headers: jsonHeaders,
    payload: '{"kind":"image","model":"gpt-image-2","prompt":"Guest generation must be blocked"}' }), 401)
})


test('independent model group resolution is registered and requires same-origin authentication', async t => {
  const { app } = await fixture(t)
  const route = { method: 'POST', url: '/api/creation/models', payload: { group: 'text' } }
  const foreign = await app.inject({ ...route, headers: { ...jsonHeaders, origin: 'https://attacker.test' } })
  assert.equal(foreign.statusCode, 403)
  const anonymous = await app.inject({ ...route, headers: jsonHeaders })
  assert.equal(anonymous.statusCode, 401)
})
