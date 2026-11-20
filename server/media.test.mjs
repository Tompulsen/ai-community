/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startMediaWorker, uploadLimitsFor, uploadMedia } from './media.ts';

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
    .withMetadata({ orientation: 6 }).jpeg().toFile(join(root, 'original'));
  let claimed = false, complete;
  const processed = new Promise(resolve => { complete = resolve; });
  const db = { query: async (sql, params) => {
    if (sql.includes('WITH candidate AS') && !claimed) {
      claimed = true;
      return { rows: [{ id: 'file1', name: 'Cover', type: 'image/jpeg', accessKey: 'original', url: '/legacy-files/file1',
        lease: params[1], properties: { communityMedia: { attempts: 1 } } }], rowCount: 1 };
    }
    if (sql.includes('RETURNING id') && sql.includes('"thumbnailAccessKey"=$2')) {
      complete(params[6]);
      return { rows: [{ id: 'file1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const timeout = setTimeout(() => complete(null), 5000);
  t.after(() => clearTimeout(timeout));
  stop = startMediaWorker({ db, filesRoot: root });
  const properties = await processed;
  assert(properties, 'Media worker must complete successfully');
  assert.equal(properties.width, 120);
  assert.equal(properties.height, 60);
  assert.equal(properties.previewAspectRatio, 1 / 2);
});
