import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkModerationMedia } from './moderation-media.ts';
import { privateMetadataFreeImage } from './image-privacy.ts';
import { writeFile } from 'node:fs/promises';

const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#5789a2' } }).png().toBuffer();
const policy = { enabled: true, sensitiveWords: [], reviewThreshold: 0.65, rejectThreshold: 0.95 };
function fixture(t) {
  const env = { COMMUNITY_MODERATION_URL: process.env.COMMUNITY_MODERATION_URL, COMMUNITY_MODERATION_TOKEN: process.env.COMMUNITY_MODERATION_TOKEN };
  process.env.COMMUNITY_MODERATION_URL = 'http://model.test'; process.env.COMMUNITY_MODERATION_TOKEN = 'fixture';
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const cache = new Map(), state = { version: 'v1', responseVersion: null, calls: 0, active: 0, peak: 0, score: 0.1, fail: false, delay: 0, scores: [] };
  const ctx = { redis: { get: async key => cache.get(key), set: async (key, value, mode, ttl) => { assert.equal(mode, 'EX'); assert.equal(ttl, 86400); cache.set(key, value); } } };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer fixture'); assert.equal(init.redirect, 'error');
    if (String(url).endsWith('/healthz')) return new Response(JSON.stringify({ ready: true, modelVersion: state.version }));
    assert.equal(String(url), 'http://model.test/check');
    state.calls++; state.active++; state.peak = Math.max(state.peak, state.active);
    try {
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.fail) throw new Error('offline');
      const detected = state.scores.length ? state.scores.shift() : state.score;
      return new Response(JSON.stringify({ nsfwScore: detected, text: '', modelVersion: state.responseVersion ?? state.version }));
    } finally { state.active--; }
  });
  const check = (bytes = image, type = 'image/png', owner = '7', settings = policy) => checkModerationMedia(ctx, owner, bytes, type, settings, Date.now() + 180000);
  return { state, cache, check };
}

test('prechecked pixels survive lossless upload conversion; owner, policy, image and model changes invalidate cache', async t => {
  const f = fixture(t), root = await mkdtemp(join(tmpdir(), 'moderation-cache-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await f.check()).decision, 'allow'); assert.equal(f.state.calls, 1);
  const file = join(root, 'image'); await writeFile(file, image); const sanitized = await privateMetadataFreeImage(file);
  assert.equal((await f.check(await readFile(file), sanitized.type)).decision, 'allow'); assert.equal(f.state.calls, 1);
  await f.check(image, 'image/png', '8'); assert.equal(f.state.calls, 2);
  await f.check(image, 'image/png', '7', { ...policy, reviewThreshold: 0.6 }); assert.equal(f.state.calls, 3);
  const changed = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#000000' } }).png().toBuffer();
  await f.check(changed); assert.equal(f.state.calls, 4);
  f.state.version = 'v2'; await f.check(); assert.equal(f.state.calls, 5);
  f.state.version = 'v3'; f.state.responseVersion = 'v2'; assert.equal((await f.check()).decision, 'review');
});

test('unavailable results are not cached and a successful retry can publish', async t => {
  const f = fixture(t); f.state.fail = true;
  assert.equal((await f.check()).decision, 'review'); assert.equal(f.cache.size, 0);
  f.state.fail = false; assert.equal((await f.check()).decision, 'allow'); assert.equal(f.state.calls, 2);
});

test('concurrent image requests use the model single slot', async t => {
  const f = fixture(t); f.state.delay = 20;
  const results = await Promise.all(['7', '8', '9'].map(owner => f.check(image, 'image/png', owner)));
  assert(results.every(result => result.decision === 'allow')); assert.equal(f.state.peak, 1);
});

test('full text, malformed UTF-8 and unknown packages cannot inherit an image decision', async t => {
  const f = fixture(t);
  assert.equal((await f.check(Buffer.from('safe text'), 'text/markdown')).decision, 'allow');
  assert.equal((await f.check(Buffer.from('safe'.repeat(1000) + 'ＢＬＯＣＫ'), 'text/plain', '7', { ...policy, sensitiveWords: ['block'] })).decision, 'reject');
  assert.equal((await f.check(Buffer.from([0xff, 0xfe]), 'text/plain')).decision, 'review');
  assert.equal((await f.check(image, 'application/zip')).decision, 'review');
  assert.equal(f.state.calls, 0);
});

test('APNG cannot silently inherit its first-frame pass', async t => {
  const f = fixture(t);
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write('acTL', 4); control.writeUInt32BE(2, 8);
  // The APNG marker is enough to reject unsupported animation before any static decoder/model is used.
  const apng = Buffer.concat([image.subarray(0, 33), control, image.subarray(33)]);
  const result = await f.check(apng); assert.equal(result.decision, 'review'); assert.match(result.reason, /APNG/); assert.equal(f.state.calls, 0);
});

test('real video extraction inspects beyond the cover and rejects a later sample', async t => {
  const f = fixture(t); f.state.scores = [0.1, 0.99];
  const bytes = await readFile(new URL('../tests/fixtures/poster-black-intro.mp4', import.meta.url));
  const result = await f.check(bytes, 'video/mp4');
  assert.equal(result.decision, 'reject'); assert.equal(f.state.calls, 2);
});
