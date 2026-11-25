/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fsPromises, { mkdtemp, readFile, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fileDto, startMediaWorker, uploadLimitsFor, uploadMedia } from './media.ts';
import { privateMetadataFreeImage } from './image-privacy.ts';

async function uploadFixture(t, mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'community-upload-commit-'));
  t.after(async () => {
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
  });
  const state = { committed: false, released: false, discarded: undefined, statements: [], logs: [] };
  t.mock.method(console, 'error', value => state.logs.push(value));
  const connectionError = Object.assign(new Error('commit acknowledgement lost'), { code: 'ECONNRESET' });
  const query = async (sql, parameters = []) => {
    state.statements.push(sql);
    if (sql.startsWith('INSERT INTO drive_file')) state.inserted = parameters;
    if (sql.startsWith('SELECT policies')) return { rows: [{ policies: {}, clientOptions: {} }] };
    if (sql.startsWith('SELECT id,target') || sql.startsWith('SELECT "roleId"')) return { rows: [] };
    if (sql.startsWith('SELECT id,host')) return { rows: [{ id: '17', host: null }] };
    if (sql.startsWith('SELECT id FROM "user"')) return { rows: mode === 'rejected' ? [] : [{ id: '17' }] };
    if (sql.startsWith('SELECT COALESCE(SUM(size)')) return { rows: [{ size: '0' }] };
    if (sql === 'COMMIT') {
      state.committed = mode !== 'unknown';
      if (mode === 'committed-error' || mode === 'unknown') throw connectionError;
    }
    if (sql === 'ROLLBACK' && mode === 'committed-error') throw new Error('rollback connection closed');
    return { rows: [], rowCount: 1 };
  };
  const actor = { id: '17', host: null };
  const ctx = {
    user: actor, requireUser: () => actor, newId: () => 'upload1', config: { url: 'https://community.example' },
    filesRoot: root, request: { isMultipart: () => false },
    redis: { async eval() { return 1; }, async zrem() { return 1; } },
    body: { name: 'notes.txt', type: 'text/plain', data: Buffer.from('uploaded content').toString('base64') },
    db: { query, connect: async () => ({ query, release(discard) { state.released = true; state.discarded = discard; } }) },
  };
  return { ctx, state, root, files: () => readdir(root) };
}

test('image upload stores only sanitized bytes and records their actual size, type and checksum', async t => {
  const f = await uploadFixture(t);
  const original = await sharp({ create: { width: 12, height: 6, channels: 3, background: 'red' } })
    .withExif({ IFD0: { Artist: 'PRIVATE-UPLOADER' } }).png().toBuffer();
  f.ctx.body = { name: 'PRIVATE-WORKFLOW.png', type: 'image/png', data: original.toString('base64') };
  const dto = await uploadMedia(f.ctx);
  const files = await f.files();
  assert.equal(files.length, 1);
  const bytes = await readFile(join(f.root, files[0]));
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 12);
  assert.equal(metadata.format, 'webp');
  const [, , md5, name, type, size, , key, properties] = f.state.inserted;
  assert.equal(md5, createHash('md5').update(bytes).digest('hex'));
  assert.equal(size, bytes.length);
  assert.equal(type, 'image/webp');
  assert.equal(name, 'zhangyu-upload1.webp');
  assert.equal(dto.name, name);
  assert.equal(properties.communityImagePrivacy[key], 1);
});

test('skill ZIP and workflow text uploads work under default policy and obey explicit role restrictions', async t => {
  for (const [name, type, bytes] of [
    ['skill.zip', 'application/zip', Buffer.from('504b0506000000000000000000000000000000000000', 'hex')],
    ['workflow.json', 'application/json', Buffer.from('{"nodes":[]}')],
    ['SKILL.md', 'text/plain', Buffer.from('# Instructions\nUse the tool')],
    ['workflow.yaml', 'application/yaml', Buffer.from('nodes: []')],
  ]) await t.test(name, async t => {
    const f = await uploadFixture(t);
    f.ctx.body = { name, type, data: bytes.toString('base64') };
    const dto = await uploadMedia(f.ctx);
    assert.equal(dto.type, type); assert.equal(dto.name, name);
    assert.deepEqual(await readFile(join(f.root, (await f.files())[0])), bytes);
  });
  const f = await uploadFixture(t);
  const query = f.ctx.db.query;
  f.ctx.db.query = async (sql, values) => sql.startsWith('SELECT policies') ? { rows: [{ policies: { uploadableFileTypes: ['image/*'] }, clientOptions: {} }] } : query(sql, values);
  f.ctx.body = { name: 'skill.zip', type: 'application/zip', data: Buffer.from('504b0506000000000000000000000000000000000000', 'hex').toString('base64') };
  await assert.rejects(uploadMedia(f.ctx), error => [400, 403, 415].includes(error.statusCode));
  assert.equal(f.state.inserted, undefined);
});

test('upload capacity reservations reject before reading or writing and always release after an attempt', async t => {
  for (const result of [0, -1]) await t.test(String(result), async t => {
    const f = await uploadFixture(t);
    f.ctx.redis.eval = async (...args) => {
      assert.equal(args[1], 1);
      assert.equal(args[2], 'community-next:uploads:reserved');
      const reservation = JSON.parse(args[5]);
      assert.equal(reservation[0], '17');
      assert(reservation[3] > reservation[2]);
      return result;
    };
    await assert.rejects(uploadMedia(f.ctx), { statusCode: result === 0 ? 429 : 503 });
    assert.deepEqual(await f.files(), []);
    assert.equal(f.state.inserted, undefined);
  });
  for (const mode of ['success', 'rejected']) await t.test(mode, async t => {
    const f = await uploadFixture(t, mode);
    let released = 0;
    f.ctx.redis.zrem = async () => { released++; return 1; };
    if (mode === 'success') await uploadMedia(f.ctx);
    else await assert.rejects(uploadMedia(f.ctx), { statusCode: 403 });
    assert.equal(released, 1);
  });
});

test('video upload stores one sanitized file with the actual checksum and privacy marker', async t => {
  if (spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0) return t.skip('FFmpeg is unavailable');
  const f = await uploadFixture(t);
  const source = join(f.root, 'fixture');
  const generated = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=16x16:r=2:d=0.5',
    '-c:v', 'mpeg4', '-metadata', 'comment=PRIVATE-UPLOAD', '-f', 'mp4', source], { windowsHide: true, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const original = await readFile(source);
  assert(original.includes(Buffer.from('PRIVATE-UPLOAD')));
  await unlink(source);
  f.ctx.body = { name: 'PRIVATE-CUSTOMER.mp4', type: 'video/mp4', data: original.toString('base64') };
  const dto = await uploadMedia(f.ctx);
  const files = await f.files();
  assert.equal(files.length, 1);
  const bytes = await readFile(join(f.root, files[0]));
  assert(!bytes.includes(Buffer.from('PRIVATE-UPLOAD')));
  const [, , md5, name, type, size, , key, properties] = f.state.inserted;
  assert.equal(md5, createHash('md5').update(bytes).digest('hex'));
  assert.equal(size, bytes.length);
  assert.equal(type, 'video/mp4');
  assert.equal(name, 'zhangyu-upload1.mp4');
  assert.equal(dto.name, name);
  assert.equal(properties.communityVideoPrivacy[key], 1);
});

test('an upload never deletes its original after a lost commit acknowledgement', async t => {
  for (const mode of ['committed-error', 'unknown']) await t.test(mode, async t => {
    const f = await uploadFixture(t, mode);
    await assert.rejects(uploadMedia(f.ctx), /commit acknowledgement lost/);
    assert.equal((await f.files()).length, 1, 'a possibly committed file must survive');
    assert.equal(f.state.committed, mode === 'committed-error');
    assert.equal(f.state.released, true);
    assert.equal(f.state.discarded, true, 'an uncertain transaction must not reuse the connection');
    assert(f.state.logs.some(value => String(value).includes('UPLOAD_COMMIT_UNCERTAIN')));
  });
});

test('a confirmed upload succeeds and a pre-commit rejection removes the temporary original', async t => {
  for (const mode of ['success', 'rejected']) await t.test(mode, async t => {
    const f = await uploadFixture(t, mode);
    if (mode === 'success') {
      assert.equal((await uploadMedia(f.ctx)).id, 'upload1');
      assert.equal((await f.files()).length, 1);
    } else {
      await assert.rejects(uploadMedia(f.ctx), { statusCode: 403 });
      assert.deepEqual(await f.files(), []);
      assert.equal(f.state.statements.includes('COMMIT'), false);
    }
    assert.equal(f.state.released, true);
    assert.equal(f.state.discarded, false);
  });
});

test('media publishing preserves committed derivatives on a lost response but cleans a lost lease', async t => {
  for (const mode of ['committed-error', 'unknown', 'lost-lease']) await t.test(mode, async t => {
    const root = await mkdtemp(join(tmpdir(), 'community-media-publish-'));
    let stop = async () => {};
    t.after(async () => {
      await stop();
      await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
      await rmdir(root);
    });
    await sharp({ create: { width: 8, height: 4, channels: 3, background: '#60765d' } }).png().toFile(join(root, 'original'));
    let claimed = false, state = 'processing', published, completed;
    const logs = [];
    t.mock.method(console, 'error', value => logs.push(value));
    const done = new Promise(resolve => { completed = resolve; });
    const timeout = setTimeout(() => completed(false), 5000);
    t.after(() => clearTimeout(timeout));
    const db = { query: async (sql, params) => {
      if (sql.includes('WITH candidate AS')) {
        if (claimed) { completed(true); return { rows: [] }; }
        claimed = true;
        return { rows: [{ id: 'media1', name: 'Image', type: 'image/png', accessKey: 'original', url: '/legacy-files/media1',
          lease: params[1], properties: { communityMedia: { attempts: 1 } } }] };
      }
      if (sql.includes('"thumbnailAccessKey"=$2')) {
        published = [params[1], params[3]];
        if (mode === 'lost-lease') return { rows: [], rowCount: 0 };
        if (mode === 'committed-error') state = 'ready';
        throw new Error('media publication response lost');
      }
      if (sql.includes("'error','Media processing failed'")) {
        if (state === 'processing' || !sql.includes("AND properties->'communityMedia'->>'state'='processing'")) state = 'failed';
      }
      return { rows: [], rowCount: 1 };
    } };
    stop = startMediaWorker({ db, filesRoot: root });
    assert.equal(await done, true, 'worker must finish its attempt');
    await stop();
    const files = await readdir(root);
    if (mode === 'lost-lease') assert.deepEqual(files, ['original']);
    else {
      assert(published.every(key => files.includes(key)), 'possibly committed derivatives must survive');
      assert.equal(files.some(name => name.endsWith('.part')), false);
      assert(logs.some(value => String(value).includes('MEDIA_PUBLISH_UNCERTAIN')));
      assert.equal(state, mode === 'committed-error' ? 'ready' : 'failed');
    }
  });
});

test('numeric accounts apply age based upload limits from the independent creation timestamp', async () => {
  let createdAt = new Date(Date.now() - 10_000);
  const db = { async query(sql) {
    if (sql.startsWith('SELECT policies')) return { rows: [{ policies: { maxFileSizeMb: 30 }, clientOptions: {} }] };
    if (sql.startsWith('SELECT id,target')) return { rows: [{
      id: 'new-account-role', target: 'conditional', condFormula: { type: 'createdLessThan', sec: 60 },
      policies: { maxFileSizeMb: { priority: 1, useDefault: false, value: 5 } },
    }] };
    if (sql.startsWith('SELECT "roleId"')) return { rows: [] };
    if (sql.startsWith('SELECT id,host')) {
      assert.match(sql, /"createdAt"/);
      return { rows: [{ id: '17', host: null, createdAt }] };
    }
    assert.fail('Unexpected upload policy query: ' + sql);
  } };
  const ctx = { db, config: {}, user: { id: '17' } };
  assert.equal((await uploadLimitsFor(ctx)).maxFileSizeMb, 5);
  createdAt = new Date(Date.now() - 7200_000);
  assert.equal((await uploadLimitsFor(ctx)).maxFileSizeMb, 30);
});

test('preview ratio describes the rotated thumbnail rather than original EXIF dimensions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-cover-ratio-'));
  let stop = async () => {};
  t.after(async () => {
    await stop();
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
  });
  await sharp({ create: { width: 120, height: 60, channels: 3, background: '#60765d' } })
    .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: 'PRIVATE-DERIVATIVE' } }).jpeg().toFile(join(root, 'original'));
  let claimed = false, complete;
  const processed = new Promise(resolve => { complete = resolve; });
  const db = { query: async (sql, params) => {
    if (sql.includes('WITH candidate AS') && !claimed) {
      claimed = true;
      return { rows: [{ id: 'file1', name: 'Cover', type: 'image/jpeg', accessKey: 'original', url: '/legacy-files/file1',
        lease: params[1], properties: { communityMedia: { attempts: 1 } } }], rowCount: 1 };
    }
    if (sql.includes('RETURNING id') && sql.includes('"thumbnailAccessKey"=$2')) {
      assert.match(sql, /COALESCE\(properties->'communityImagePrivacy','\{\}'::jsonb\)\|\|\$10::jsonb/);
      assert.match(sql, /properties->'communityMedia'->>'lease'=\$9/);
      complete({ properties: params[6], thumbnail: params[1], webpublic: params[3], markers: params[9] });
      return { rows: [{ id: 'file1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const timeout = setTimeout(() => complete(null), 5000);
  t.after(() => clearTimeout(timeout));
  stop = startMediaWorker({ db, filesRoot: root });
  const result = await processed;
  assert(result, 'Media worker must complete successfully');
  const { properties } = result;
  assert.equal(properties.width, 120);
  assert.equal(properties.height, 60);
  assert.equal(properties.previewAspectRatio, 1 / 2);
  assert.deepEqual(result.markers, { [result.thumbnail]: 1, [result.webpublic]: 1 });
  for (const key of [result.thumbnail, result.webpublic]) {
    const bytes = await readFile(join(root, key)), metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 60);
    assert.equal(metadata.height, 120);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert(!bytes.includes(Buffer.from('PRIVATE-DERIVATIVE')));
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    assert(Math.abs(data[0] - 96) < 8 && Math.abs(data[1] - 118) < 8 && Math.abs(data[2] - 93) < 8);
  }
});

test('MP4 duration metadata stays bounded and optional while thumbnails publish successfully', async t => {
  if (['ffprobe', 'ffmpeg'].some(command => spawnSync(command, ['-version'], { windowsHide: true, stdio: 'ignore' }).status !== 0)) return t.skip('FFmpeg is unavailable');
  for (const scenario of [
    { name: 'fractional ready duration', size: 1, reads: 1, duration: 2.5 },
    { name: '64 MiB boundary', size: 64 * 1024 * 1024, reads: 1, duration: 2.5 },
    { name: 'over 64 MiB', size: 64 * 1024 * 1024 + 1, reads: 0 },
    { name: 'zero bytes', size: 0, reads: 0 },
    { name: 'optional source read fails', size: 1, reads: 1, readError: true },
  ]) await t.test(scenario.name, async t => {
    const root = await mkdtemp(join(tmpdir(), 'community-video-duration-'));
    const source = join(root, 'original');
    await writeFile(source, await readFile(new URL('../tests/fixtures/poster-black-intro.mp4', import.meta.url)));
    const actualReadFile = fsPromises.readFile;
    let sourceReads = 0;
    const readMock = t.mock.method(fsPromises, 'readFile', async (path, ...options) => {
      if (path === source) {
        sourceReads++;
        if (scenario.readError) throw new Error('optional source read failed');
      }
      return actualReadFile(path, ...options);
    });
    syncBuiltinESMExports();
    let stop = async () => {};
    t.after(async () => {
      await stop();
      readMock.mock.restore();
      syncBuiltinESMExports();
      await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
      await rmdir(root);
    });
    let claimed = false, completed;
    const done = new Promise(resolve => { completed = resolve; });
    const timeout = setTimeout(() => completed(null), 10000);
    t.after(() => clearTimeout(timeout));
    const db = { async query(sql, params) {
      if (sql.includes('WITH candidate AS') && !claimed) {
        claimed = true;
        return { rows: [{ id: 'video1', name: 'Video', type: 'video/mp4', size: scenario.size,
          accessKey: 'original', url: '/legacy-files/video1', lease: params[1], properties: { communityMedia: { attempts: 1 } } }] };
      }
      if (sql.includes('RETURNING id') && sql.includes('"thumbnailAccessKey"=$2')) {
        completed(params[6]);
        return { rows: [{ id: 'video1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    } };
    stop = startMediaWorker({ db, filesRoot: root });
    const measured = await done;
    assert(measured, 'video worker must finish successfully');
    assert.equal(sourceReads, scenario.reads);
    assert.equal(measured.durationSeconds, scenario.duration);
    const file = { id: 'video1', type: 'video/mp4', name: 'Video', size: scenario.size, properties: { ...measured, communityMedia: { state: 'ready' } } };
    assert.equal(fileDto(file).durationSeconds, scenario.duration);
    assert.equal(fileDto({ ...file, properties: { ...measured, communityMedia: { state: 'processing' } } }).durationSeconds, undefined);
    assert.equal(fileDto({ ...file, properties: { durationSeconds: Infinity } }).durationSeconds, undefined);
    assert.equal(fileDto({ ...file, type: 'audio/wav' }).durationSeconds, undefined);
  });
});

test('failed derivative processing never publishes safety markers or removes the original', async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-invalid-derivative-'));
  let stop = async () => {};
  t.after(async () => {
    await stop();
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
  });
  await writeFile(join(root, 'original'), 'invalid image');
  let claimed = false, completed, published = false, failed = false;
  const done = new Promise(resolve => { completed = resolve; });
  const timeout = setTimeout(() => completed(false), 5000);
  t.after(() => clearTimeout(timeout));
  const db = { async query(sql, params) {
    if (sql.includes('WITH candidate AS')) {
      if (claimed) { completed(true); return { rows: [] }; }
      claimed = true;
      return { rows: [{ id: 'invalid1', name: 'Invalid', type: 'image/png', accessKey: 'original', url: '/legacy-files/invalid1',
        lease: params[1], properties: { communityMedia: { attempts: 1 } } }] };
    }
    if (sql.includes('"thumbnailAccessKey"=$2')) published = true;
    if (sql.includes("'error','Media processing failed'")) failed = true;
    return { rows: [], rowCount: 1 };
  } };
  stop = startMediaWorker({ db, filesRoot: root });
  assert.equal(await done, true);
  await stop();
  assert.equal(published, false);
  assert.equal(failed, true);
  assert.deepEqual(await readdir(root), ['original']);
  assert.equal(await readFile(join(root, 'original'), 'utf8'), 'invalid image');
});

test('GIF comment display variants retain frames and timing while thumbnails remain still', async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-comment-animation-'));
  const cachedFiles = sharp.cache().files.max;
  sharp.cache({ files: 0 });
  let stop = async () => {};
  t.after(async () => {
    await stop();
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
    sharp.cache({ files: cachedFiles });
  });
  await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } })
    .gif({ delay: [160, 240], loop: 0 }).toFile(join(root, 'original'));
  let claimed = false, complete;
  const processed = new Promise(resolve => { complete = resolve; });
  const db = { query: async (sql, params) => {
    if (sql.includes('WITH candidate AS') && !claimed) {
      claimed = true;
      return { rows: [{ id: 'animation1', name: 'Animation', type: 'image/gif', accessKey: 'original', url: '/legacy-files/animation1',
        lease: params[1], properties: { communityMedia: { attempts: 1 } } }], rowCount: 1 };
    }
    if (sql.includes('RETURNING id') && sql.includes('"thumbnailAccessKey"=$2')) {
      complete({ thumbnail: params[1], webpublic: params[3], markers: params[9] });
      return { rows: [{ id: 'animation1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const timeout = setTimeout(() => complete(null), 5000);
  t.after(() => clearTimeout(timeout));
  stop = startMediaWorker({ db, filesRoot: root });
  const variants = await processed;
  assert(variants, 'Media worker must complete successfully');
  assert.deepEqual(variants.markers, { [variants.thumbnail]: 1, [variants.webpublic]: 1 });
  const display = await sharp(await readFile(join(root, variants.webpublic)), { animated: true }).metadata();
  const thumbnail = await sharp(await readFile(join(root, variants.thumbnail)), { animated: true }).metadata();
  assert.equal(display.pages, 2);
  assert.deepEqual(display.delay, [160, 240]);
  assert.equal(display.loop, 0);
  assert.equal(thumbnail.pages ?? 1, 1);
});

async function historicalFixture(t, rows, hooks = {}) {
  const root = await mkdtemp(join(tmpdir(), 'community-history-privacy-'));
  const state = { rows, claims: [], marked: [], failed: [], statements: [], pages: [], generated: [], stops: [] };
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const timeout = setTimeout(() => complete(false), 5000);
  t.after(async () => {
    clearTimeout(timeout);
    await Promise.all(state.stops.map(stop => stop()));
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
  });
  const db = { async query(sql, params = []) {
    state.statements.push(sql);
    if (sql.includes('WITH candidate AS')) {
      const file = hooks.normalTasks?.shift();
      return { rows: file ? [{ ...file, lease: params[1] }] : [] };
    }
    if (sql.startsWith('UPDATE drive_file SET "thumbnailAccessKey"=$2')) {
      state.generated.push(params[0]);
      if (state.generated.length === 2) complete(true);
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    if (sql.includes('ORDER BY id LIMIT 16')) {
      assert.match(sql, /WHERE id>\$1 ORDER BY id LIMIT 16/);
      state.pages.push(params[0]);
      const page = rows.filter(row => row.id > params[0]).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 16);
      setImmediate(() => { if (!state.claims.length) complete(true); });
      return { rows: structuredClone(page) };
    }
    if (sql.includes('WITH privacy_candidate AS')) {
      assert.match(sql, /FOR UPDATE SKIP LOCKED/);
      assert.match(sql, /'attempts'\)::int,0\)<3/);
      const row = rows.find(row => row.id === params[0]), job = row?.properties.communityImagePrivacyJob;
      if (!row || job?.state === 'processing' && job.updatedAt >= params[1] - 900000) return { rows: [] };
      row.properties.communityImagePrivacyJob = { ...job, state: 'processing', lease: params[2], attempts: (job?.attempts || 0) + 1, updatedAt: params[1] };
      state.claims.push(row.id);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id,name,type') && sql.includes("properties->'communityImagePrivacyJob'")) {
      const row = rows.find(row => row.id === params[0]);
      if (hooks.beforeRead) await hooks.beforeRead(row, root, state);
      const job = row?.properties.communityImagePrivacyJob;
      return { rows: job?.lease === params[1] && job.state === 'processing' ? [structuredClone(row)] : [] };
    }
    if (sql.includes('jsonb_build_object($2::text,1)')) {
      assert.match(sql, /properties->'communityImagePrivacyJob'->>'lease'=\$3/);
      const column = /AND "(accessKey|thumbnailAccessKey|webpublicAccessKey)"=\$2/.exec(sql)?.[1];
      assert(column, 'safety updates must check the current storage key');
      const row = rows.find(row => row.id === params[0]);
      if (hooks.beforeMark) await hooks.beforeMark(row, params, state);
      const job = row?.properties.communityImagePrivacyJob;
      if (row?.[column] !== params[1] || job?.lease !== params[2] || job.state !== 'processing') return { rows: [], rowCount: 0 };
      row.properties.communityImagePrivacy = { ...row.properties.communityImagePrivacy, [params[1]]: 1 };
      if (row.accessKey === params[1]) Object.assign(row, { type: params[3], size: params[4], md5: params[5], name: params[6] });
      if (row.webpublicAccessKey === params[1]) row.webpublicType = params[3];
      state.marked.push(params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("'{communityImagePrivacyJob}'") && (sql.includes("'state','ready'") || sql.includes('Image privacy processing failed'))) {
      const row = rows.find(row => row.id === params[0]), job = row?.properties.communityImagePrivacyJob;
      if (job?.lease === params[1] && job.state === 'processing') {
        const failed = sql.includes('Image privacy processing failed');
        Object.assign(job, { state: failed ? 'failed' : 'ready', updatedAt: params[2], ...(failed ? { retryAt: params[3] } : {}) });
        if (failed) state.failed.push(row.id);
      }
      complete(true);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  return { root, state, done, start() { const stop = startMediaWorker({ db, filesRoot: root }); state.stops.push(stop); return stop; } };
}

function legacyImage(id = 'legacy1', extra = {}) {
  return { id, name: 'PRIVATE-LEGACY.png', type: 'image/png', size: 1, accessKey: 'original', thumbnailAccessKey: null,
    webpublicAccessKey: null, webpublicType: null, storedInternal: true, isLink: false, properties: {}, ...extra };
}

test('the idle worker safely backfills historical originals and image variants without regenerating their sizes', async t => {
  const row = legacyImage('legacy1', { thumbnailAccessKey: 'thumbnail', webpublicAccessKey: 'display', webpublicType: 'image/png' });
  const f = await historicalFixture(t, [row]);
  for (const [key, width] of [['original', 12], ['thumbnail', 6], ['display', 10]]) {
    await sharp({ create: { width, height: 4, channels: 3, background: 'red' } })
      .withExif({ IFD0: { Artist: 'PRIVATE-HISTORY' } }).png().toFile(join(f.root, key));
  }
  f.start();
  assert.equal(await f.done, true);
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.claims, ['legacy1']);
  assert.deepEqual(f.state.marked, ['original', 'thumbnail', 'display']);
  assert.equal(row.properties.communityImagePrivacyJob.state, 'ready');
  for (const [key, width] of [['original', 12], ['thumbnail', 6], ['display', 10]]) {
    const bytes = await readFile(join(f.root, key)), metadata = await sharp(bytes).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, 4);
    assert(!bytes.includes(Buffer.from('PRIVATE-HISTORY')));
  }
  const original = await readFile(join(f.root, 'original'));
  assert.equal(row.size, original.length);
  assert.equal(row.md5, createHash('md5').update(original).digest('hex'));
  assert.equal(row.type, 'image/webp');
  assert.equal(row.webpublicType, 'image/webp');
  assert.equal(row.name, 'zhangyu-legacy1.webp');
  assert.deepEqual(await readdir(f.root), ['display', 'original', 'thumbnail']);
});

test('historical scans skip clean, linked, remote, busy, exhausted and cooling files', async t => {
  const now = Date.now();
  const rows = [
    legacyImage('a', { properties: { communityImagePrivacy: { original: 1 } } }),
    legacyImage('b', { isLink: true }),
    legacyImage('c', { storedInternal: false }),
    legacyImage('d', { properties: { communityMedia: { state: 'pending' } } }),
    legacyImage('e', { properties: { communityImagePrivacyJob: { attempts: 3, state: 'failed' } } }),
    legacyImage('f', { properties: { communityImagePrivacyJob: { attempts: 1, retryAt: now + 60000 } } }),
    legacyImage('g', { properties: { communityImagePrivacyJob: { attempts: 1, state: 'processing', updatedAt: now } } }),
  ];
  const f = await historicalFixture(t, rows);
  const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await writeFile(join(f.root, 'original'), bytes);
  f.start();
  assert.equal(await f.done, true);
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.claims, []);
  assert.deepEqual(f.state.marked, []);
  assert.deepEqual(await readFile(join(f.root, 'original')), bytes);
});

test('history processing rechecks and preserves safety markers already written by a GET', async t => {
  const row = legacyImage();
  let accepted;
  const f = await historicalFixture(t, [row], { async beforeRead(current, root) {
    if (accepted) return;
    const safe = await privateMetadataFreeImage(join(root, current.accessKey));
    current.type = safe.type;
    current.properties.communityImagePrivacy = { [current.accessKey]: 1 };
    accepted = await stat(join(root, current.accessKey), { bigint: true });
  } });
  await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } }).png().toFile(join(f.root, 'original'));
  f.start();
  assert.equal(await f.done, true);
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.marked, []);
  assert.equal((await stat(join(f.root, 'original'), { bigint: true })).mtimeNs, accepted.mtimeNs);
  assert.equal(row.properties.communityImagePrivacy.original, 1);
});

for (const change of ['lease', 'pointer']) {
  test(`history safety markers reject a changed ${change} after conversion`, async t => {
    const row = legacyImage();
    const f = await historicalFixture(t, [row], { beforeMark(current) {
      if (change === 'lease') current.properties.communityImagePrivacyJob.lease = 'replacement-lease';
      else current.accessKey = 'replacement';
    } });
    await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } }).png().toFile(join(f.root, 'original'));
    await writeFile(join(f.root, 'replacement'), 'replacement must remain untouched');
    f.start();
    assert.equal(await f.done, true);
    await Promise.all(f.state.stops.map(stop => stop()));
    assert.deepEqual(f.state.marked, []);
    assert.equal(row.properties.communityImagePrivacy, undefined);
    assert.equal(await readFile(join(f.root, 'replacement'), 'utf8'), 'replacement must remain untouched');
    assert.deepEqual(await readdir(f.root), ['original', 'replacement']);
    assert.equal(row.properties.communityImagePrivacyJob.state, change === 'lease' ? 'processing' : 'failed');
  });
}

test('history failures keep the original and use the claimed attempt for retry backoff', async t => {
  const row = legacyImage('failed1', { properties: { communityImagePrivacyJob: { attempts: 1, state: 'failed', retryAt: 0 } } });
  const f = await historicalFixture(t, [row]);
  await writeFile(join(f.root, 'original'), 'invalid image');
  f.start();
  assert.equal(await f.done, true);
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.marked, []);
  assert.equal(row.properties.communityImagePrivacy, undefined);
  const job = row.properties.communityImagePrivacyJob;
  assert.equal(job.state, 'failed');
  assert.equal(job.attempts, 2);
  assert.equal(job.retryAt - job.updatedAt, 60000);
  assert.equal(await readFile(join(f.root, 'original'), 'utf8'), 'invalid image');
  assert.deepEqual(await readdir(f.root), ['original']);
});

test('competing history workers use one lease and can reclaim an expired lease', async t => {
  const row = legacyImage('expired1', { properties: {
    communityImagePrivacyJob: { attempts: 1, state: 'processing', lease: 'expired-lease', updatedAt: Date.now() - 900001 },
  } });
  const f = await historicalFixture(t, [row]);
  await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } }).png().toFile(join(f.root, 'original'));
  f.start(); f.start();
  assert.equal(await f.done, true);
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.claims, ['expired1']);
  assert.deepEqual(f.state.marked, ['original']);
  assert.equal(row.properties.communityImagePrivacyJob.attempts, 2);
  assert.notEqual(row.properties.communityImagePrivacyJob.lease, 'expired-lease');
});

test('history backfill advances its bounded cursor and handles at most one file every thirty seconds', async t => {
  let now = Date.now(), tick, nextMarked;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return { unref() {} }; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const secondMarked = new Promise(resolve => { nextMarked = resolve; });
  const rows = [legacyImage('a', { accessKey: 'first' }), legacyImage('b', { accessKey: 'second' })];
  const f = await historicalFixture(t, rows, { beforeMark(row) { if (row.id === 'b') nextMarked(); } });
  for (const key of ['first', 'second']) await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } }).png().toFile(join(f.root, key));
  const stop = f.start();
  assert.equal(await f.done, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.claims, ['a']);
  assert.deepEqual(f.state.pages, ['']);
  now += 29000; tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.pages, ['']);
  now += 1000; tick();
  await secondMarked;
  await stop();
  assert.deepEqual(f.state.claims, ['a', 'b']);
  assert.deepEqual(f.state.pages, ['', 'a']);
});

test('new upload derivatives take priority over historical backfill', async t => {
  const normal = id => ({ ...legacyImage(id), url: `/legacy-files/${id}`, properties: { communityMedia: { attempts: 1 } } });
  const f = await historicalFixture(t, [legacyImage()], { normalTasks: [normal('new1'), normal('new2')] });
  const original = await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  await writeFile(join(f.root, 'original'), original);
  f.start();
  assert.equal(await f.done, true);
  await new Promise(resolve => setImmediate(resolve));
  await Promise.all(f.state.stops.map(stop => stop()));
  assert.deepEqual(f.state.generated, ['new1', 'new2']);
  assert.deepEqual(f.state.pages, []);
  assert.deepEqual(f.state.claims, []);
  assert.deepEqual(await readFile(join(f.root, 'original')), original, 'generating previews must not reprocess an uploaded original');
});

test('PostgreSQL executes media publication and historical privacy guards', {
  skip: !process.env.COMMUNITY_MEDIA_TEST_DATABASE_URL,
  timeout: 20000,
}, async t => {
  const connectionString = process.env.COMMUNITY_MEDIA_TEST_DATABASE_URL;
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname), 'use a dedicated local test database');
  const cachedFiles = sharp.cache().files.max;
  sharp.cache({ files: 0 });
  t.after(() => sharp.cache({ files: cachedFiles }));
  const { Client } = await import('pg');
  const client = new Client({ connectionString }), schema = `media_privacy_test_${randomBytes(6).toString('hex')}`;
  await client.connect();
  t.after(async () => {
    try { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await client.end(); }
  });
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`CREATE TABLE drive_file (
    id varchar(32) PRIMARY KEY, name varchar(256) NOT NULL, type varchar(128) NOT NULL,
    size bigint NOT NULL DEFAULT 0, md5 varchar(32), "storedInternal" boolean NOT NULL DEFAULT true,
    "isLink" boolean NOT NULL DEFAULT false, url text, "accessKey" varchar(256),
    "thumbnailAccessKey" varchar(256), "thumbnailUrl" text,
    "webpublicAccessKey" varchar(256), "webpublicUrl" text, "webpublicType" varchar(128),
    properties jsonb NOT NULL DEFAULT '{}'
  )`);
  for (const mode of ['derivatives', 'history', 'pointer', 'lease', 'invalid']) await t.test(mode, async t => {
    await client.query('TRUNCATE drive_file');
    const root = await mkdtemp(join(tmpdir(), 'community-real-pg-media-'));
    let stop = async () => {}, completed, guarded = false;
    const done = new Promise(resolve => { completed = resolve; });
    const timeout = setTimeout(() => completed(false), 5000);
    t.after(async () => {
      clearTimeout(timeout);
      await stop();
      await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
      await rmdir(root);
    });
    const historical = mode === 'history', fresh = mode === 'derivatives';
    const original = await sharp({ create: { width: 12, height: 6, channels: 3, background: 'red' } })
      .withExif({ IFD0: { Artist: 'PRIVATE-PG-MEDIA' } }).png().toBuffer();
    await writeFile(join(root, 'original'), mode === 'invalid' ? Buffer.from('invalid image') : original);
    await writeFile(join(root, 'replacement'), original);
    let originalType = 'image/png', acceptedOriginal = original;
    if (fresh) {
      originalType = (await privateMetadataFreeImage(join(root, 'original'))).type;
      acceptedOriginal = await readFile(join(root, 'original'));
    }
    if (historical) {
      await writeFile(join(root, 'thumbnail'), original);
      await writeFile(join(root, 'display'), original);
    }
    const properties = {
      keep: { value: 'preserved' }, communityImagePrivacy: { 'other-safe-key': 1, ...(fresh ? { original: 1 } : {}) },
      ...(fresh ? { communityMedia: { version: 1, state: 'pending', attempts: 0, updatedAt: Date.now() } } : {}),
      ...(historical ? { communityImagePrivacyJob: { state: 'processing', lease: 'expired-lease', attempts: 1, updatedAt: Date.now() - 900001 } } : {}),
      ...(mode === 'invalid' ? { communityImagePrivacyJob: { state: 'failed', attempts: 1, retryAt: 0 } } : {}),
    };
    await client.query(`INSERT INTO drive_file
      (id,name,type,url,"accessKey","thumbnailAccessKey","webpublicAccessKey","webpublicType",properties)
      VALUES ('file1','PRIVATE.png',$5,'/legacy-files/file1','original',$1,$2,$3,$4)`,
    [historical ? 'thumbnail' : null, historical ? 'display' : null, historical ? 'image/png' : null, properties, originalType]);
    const db = { async query(sql, params) {
      const marker = sql.includes('jsonb_build_object($2::text,1)');
      if (marker && !guarded && ['pointer', 'lease'].includes(mode)) {
        guarded = true;
        if (mode === 'pointer') await client.query(`UPDATE drive_file SET "accessKey"='replacement' WHERE id='file1'`);
        else await client.query(`UPDATE drive_file SET properties=jsonb_set(properties,'{communityImagePrivacyJob,lease}','"replacement-lease"') WHERE id='file1'`);
      }
      const result = await client.query(sql, params);
      if (marker && ['pointer', 'lease'].includes(mode)) assert.equal(result.rowCount, 0);
      if ((fresh && sql.startsWith('UPDATE drive_file SET "thumbnailAccessKey"=$2')) ||
        (sql.includes("'{communityImagePrivacyJob}'") && (sql.includes("'state','ready'") || sql.includes('Image privacy processing failed')))) completed(true);
      return result;
    } };
    stop = startMediaWorker({ db, filesRoot: root });
    assert.equal(await done, true, `${mode} worker must finish the real database operation`);
    await stop();
    const row = (await client.query(`SELECT * FROM drive_file WHERE id='file1'`)).rows[0];
    assert.deepEqual(row.properties.keep, { value: 'preserved' });
    assert.equal(row.properties.communityImagePrivacy['other-safe-key'], 1);
    if (fresh) {
      assert.equal(row.properties.communityMedia.state, 'ready');
      assert.equal(row.properties.communityMedia.attempts, 1);
      assert.equal(row.properties.communityImagePrivacy.original, 1);
      assert.equal(row.properties.communityImagePrivacy[row.thumbnailAccessKey], 1);
      assert.equal(row.properties.communityImagePrivacy[row.webpublicAccessKey], 1);
      assert.equal(row.webpublicType, 'image/webp');
      assert.deepEqual(await readFile(join(root, 'original')), acceptedOriginal);
      for (const key of [row.thumbnailAccessKey, row.webpublicAccessKey]) assert.equal((await sharp(await readFile(join(root, key))).metadata()).exif, undefined);
    } else if (historical) {
      for (const key of ['original', 'thumbnail', 'display']) {
        assert.equal(row.properties.communityImagePrivacy[key], 1);
        assert.equal((await sharp(await readFile(join(root, key))).metadata()).exif, undefined);
      }
      const bytes = await readFile(join(root, 'original'));
      assert.equal(Number(row.size), bytes.length);
      assert.equal(row.md5, createHash('md5').update(bytes).digest('hex'));
      assert.equal(row.type, 'image/webp');
      assert.equal(row.webpublicType, 'image/webp');
      assert.equal(row.name, 'zhangyu-file1.webp');
      assert.equal(row.properties.communityImagePrivacyJob.state, 'ready');
      assert.equal(row.properties.communityImagePrivacyJob.attempts, 2);
      assert.notEqual(row.properties.communityImagePrivacyJob.lease, 'expired-lease');
    } else {
      assert.equal(row.properties.communityImagePrivacy.original, undefined);
      assert.deepEqual(await readFile(join(root, 'replacement')), original);
      const job = row.properties.communityImagePrivacyJob;
      assert.equal(job.state, mode === 'lease' ? 'processing' : 'failed');
      if (mode === 'lease') assert.equal(job.lease, 'replacement-lease');
      else assert.equal(job.retryAt - job.updatedAt, mode === 'invalid' ? 60000 : 30000);
      if (mode === 'pointer') assert.equal(row.accessKey, 'replacement');
      if (mode === 'invalid') assert.equal(await readFile(join(root, 'original'), 'utf8'), 'invalid image');
    }
    assert.equal((await readdir(root)).some(name => name.endsWith('.part')), false);
  });
});
