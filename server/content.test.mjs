/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { byteRange, handleContent, hiddenByTime, legacyIdTime, normalizeRevision, publicVisibilitySql, readWorkCursor } from './content.ts';
import { mediaState, sniffType, uploadLimitsFor } from './media.ts';

function context({ method = 'GET', path = '/api/works', body, user, query = async () => ({ rows: [] }) } = {}) {
  const result = {};
  return {
    req: { method, headers: {} }, res: {}, url: new URL(path, 'https://community.example'), body: body ?? {}, user,
    config: { url: 'https://community.example', id: 'aidx' },
    db: { query }, result,
    json(status, payload) { result.status = status; result.payload = payload; },
    requireUser() { if (!user) throw Object.assign(new Error('Sign in required'), { statusCode: 401 }); return user; },
  };
}

test('public content query preserves visitor, visibility, account and blocking constraints', async () => {
  let statement, values;
  const ctx = context({ query: async (sql, parameters) => { statement = sql; values = parameters; return { rows: [] }; } });
  assert.equal(await handleContent(ctx), true);
  assert.equal(ctx.result.status, 200);
  assert.deepEqual(ctx.result.payload.items, []);
  for (const guard of ['destination', 'visibility', 'isDeleted', 'isSuspended', 'requireSigninToViewContents', 'ugcVisibilityForVisitor', 'makeNotesHiddenBefore', 'makeNotesFollowersOnlyBefore', 'blocking']) assert(statement.includes(guard), guard);
  assert.equal(values[0], null);
  assert.equal(statement.includes('SELECT u.*'), false);
  assert.equal(statement.includes('password'), false);
  assert(publicVisibilitySql.includes("s.status IN ('published', 'approved')"));
});

test('admin status filters include the stored states displayed as published and rejected', async () => {
  for (const [status, expected] of [['published', 'approved'], ['rejected', 'removed']]) {
    let statement = '';
    const ctx = context({ path: `/api/admin/submissions?status=${status}`, user: { id: 'admin1', isAdmin: true },
      query: async (sql) => { if (/^\s*SELECT s\.\*/.test(sql)) statement = sql; return { rows: [] }; } });
    await handleContent(ctx);
    assert.match(statement.split('WHERE').slice(1).join('WHERE'), new RegExp(`s\\.status[^;]*'${expected}'`));
  }
});

test('an arbitrary account id never grants access to private library', async () => {
  let queried = false;
  const ctx = context({ path: '/api/library?userId=anotheruser', query: async () => { queried = true; return { rows: [] }; } });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 401);
  assert.equal(queried, false);
});

test('anonymous create and regular user moderation are rejected before database access', async () => {
  const create = context({ method: 'POST', body: { title: 'Test' } });
  await assert.rejects(handleContent(create), error => error.statusCode === 401);
  const review = context({ method: 'POST', path: '/api/admin/submissions/work1/review', user: { id: 'user1' }, body: { action: 'approve', version: 0 } });
  await assert.rejects(handleContent(review), error => error.statusCode === 403);
});

test('revision boundary rejects untrusted types, oversized fields and unsafe provenance URLs', () => {
  const base = { kind: 'resource', title: 'Notes', body: 'Useful text', fileIds: [] };
  assert.equal(normalizeRevision(base).text, 'Useful text');
  assert.equal(normalizeRevision({ ...base, sourceUrl: 'https://example.com/reference' }).sourceUrl, 'https://example.com/reference');
  assert.throws(() => normalizeRevision({ ...base, sourceUrl: 'javascript:alert(1)' }));
  assert.throws(() => normalizeRevision({ ...base, sourceUrl: 'https://user:password@example.com' }));
  assert.throws(() => normalizeRevision({ ...base, title: 'x'.repeat(101) }));
  assert.throws(() => normalizeRevision({ ...base, fileIds: ['id1', 'id1'] }));
  assert.throws(() => normalizeRevision({ ...base, fileIds: ['../secret'] }));
  assert.throws(() => normalizeRevision({ ...base, generation: { referenceFileIds: {} } }));
});

test('range parser handles bounded, open and suffix ranges and rejects ambiguous or invalid ranges', () => {
  assert.equal(byteRange(undefined, 100), null);
  assert.deepEqual(byteRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(byteRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=10-1000', 100), { start: 10, end: 99 });
  for (const range of ['bytes=100-', 'bytes=10-9', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=-', 'bytes=x-y']) assert.equal(byteRange(range, 100), false, range);
  assert.equal(byteRange('bytes=0-', 0), false);
});

test('unauthorized legacy media lookup remains a 404 without touching filesystem', async () => {
  let statement, parameters;
  const ctx = context({ path: '/legacy-files/file1', query: async (sql, values) => { statement = sql; parameters = values; return { rows: [] }; } });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 404);
  assert(statement.includes('f."userId"=$1'));
  assert(statement.includes(publicVisibilitySql));
  assert.deepEqual(parameters, [null, 'file1', false, 'https://community.example']);
});

test('unknown API is not claimed by content handler', async () => {
  assert.equal(await handleContent(context({ path: '/api/unknown' })), false);
});

function transactionalContext({ path, method, body, actor, row }) {
  const statements = [];
  const ctx = context({
    path, method, body, user: actor,
    query: async (sql, parameters) => {
      statements.push({ sql, parameters });
      if (sql.includes('FROM community_submission s')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  });
  ctx.db.connect = async () => ({ query: ctx.db.query, release() { statements.push({ sql: 'RELEASE' }); } });
  ctx.newId = () => 'generated1';
  return { ctx, statements };
}

const workRow = {
  id: 'work1', authorId: 'owner1', authorName: 'Owner', authorUsername: 'owner',
  category: 'resource', title: 'Published title', text: 'Published body', model: '', sourceUrl: '', license: '',
  fileIds: [], tagIds: [], generation: null, destination: 'community', submittedAt: new Date('2026-11-12T00:00:00Z'),
  approvedNoteId: 'note1', status: 'approved', version: 2,
};

test('generation recipes survive normalization with public options only and reject invalid values', () => {
  const parameters = { version: 1, kind: 'video', group: '视频', size: '720x1280', aspect_ratio: '9:16', n: 1, duration: 8,
    tokenId: 99, apiKey: 'private', videoOptions: { mode: 'text-to-video', seed: '42', openaiImageUrl: 'https://private.example/image', openaiFileId: 'private',
      customParameters: JSON.stringify({ steps: 30, metadata: { seed: 42, authorization: 'secret' }, api_key: 'secret', webhook: 'https://private.example' }) } };
  const revision = normalizeRevision({ kind: 'video', title: '同款', prompt: '视频', model: 'sora-2', generation: { parameters } });
  assert.equal(revision.generation.parameters.group, '视频');
  assert.equal(revision.generation.parameters.videoOptions.seed, '42');
  assert.equal(revision.generation.parameters.tokenId, undefined);
  assert.equal(revision.generation.parameters.videoOptions.openaiImageUrl, undefined);
  assert.deepEqual(JSON.parse(revision.generation.parameters.videoOptions.customParameters), { steps: 30, metadata: { seed: 42 } });
  assert.throws(() => normalizeRevision({ kind: 'video', title: 'X', generation: { parameters: { ...parameters, n: 100 } } }), error => error.statusCode === 400);
  assert.throws(() => normalizeRevision({ kind: 'image', title: 'X', generation: { parameters } }), error => error.statusCode === 400);
});

test('public work recipes strip historical credentials and conversation contents on read', async () => {
  const ctx = context({ query: async sql => sql.includes('FROM community_submission s') ? { rows: [{ ...workRow, model: 'gpt-5', generation: {
    prompt: '公开提示词', model: 'gpt-5', referenceFileIds: [], tokenId: 71, apiKey: 'private',
    parameters: { version: 1, kind: 'text', tokenId: 71, chatOptions: { temperature: 0.2, messages: [{ role: 'user', content: 'private' }], mcpServers: ['private-server'] } },
  } }] } : { rows: [] } });
  await handleContent(ctx);
  assert.deepEqual(ctx.result.payload.items[0].generation, { prompt: '公开提示词', model: 'gpt-5', referenceFileIds: [],
    parameters: { version: 1, kind: 'text', chatOptions: { temperature: 0.2 } } });
});

test('work covers expose only valid processed preview ratios', async () => {
  for (const ratio of [16 / 9, 9 / 16, undefined, 0, -1, NaN, '1.5']) {
    const ctx = context({ query: async sql => {
      if (sql.includes('FROM community_submission s')) return { rows: [{ ...workRow, category: 'image', fileIds: ['cover1'] }] };
      if (sql.includes('FROM drive_file')) return { rows: [{
        id: 'cover1', name: 'Cover', type: 'image/jpeg', storedInternal: true, thumbnailAccessKey: 'thumbnail1',
        properties: { width: 900, height: 300, previewAspectRatio: ratio },
      }] };
      return { rows: [] };
    } });
    await handleContent(ctx);
    const cover = ctx.result.payload.items[0];
    assert.equal(cover.coverAspectRatio, typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : undefined);
    assert.equal(cover.cover, '/legacy-files/cover1?variant=thumbnail');
  }
});

test('stale owner edits roll back without updating published content', async () => {
  const { ctx, statements } = transactionalContext({
    path: '/api/works/work1', method: 'PATCH', actor: { id: 'owner1' },
    body: { version: 1, title: 'Stale edit' }, row: { ...workRow },
  });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 409);
  assert(statements.some(item => item.sql === 'ROLLBACK'));
  assert.equal(statements.some(item => item.sql.startsWith('UPDATE')), false);
  assert.equal(statements.at(-1).sql, 'RELEASE');
});

test('rejecting a pending revision retains original public columns and note id', async () => {
  const { ctx, statements } = transactionalContext({
    path: '/api/admin/submissions/work1/review', method: 'POST',
    actor: { id: 'admin1', isAdmin: true }, body: { version: 2, action: 'reject', reason: 'Needs revision' },
    row: { ...workRow, pendingRevision: { ...workRow, title: 'Unapproved private title' } },
  });
  await handleContent(ctx);
  const update = statements.find(item => item.sql.startsWith('UPDATE community_submission SET category'));
  assert.equal(update.parameters[2], 'Published title');
  assert.equal(update.parameters[10], null);
  assert.equal(update.parameters[11], 'approved');
  assert.equal(update.parameters[12], 'note1');
  assert(statements.some(item => item.sql.includes('INSERT INTO announcement')));
  assert(statements.some(item => item.sql.includes('INSERT INTO moderation_log')));
  assert(statements.some(item => item.sql === 'COMMIT'));
  assert.equal(statements.some(item => item.sql.startsWith('DELETE FROM note')), false);
});

test('own-work likes are rejected in the transaction before any reaction write', async () => {
  const { ctx, statements } = transactionalContext({
    path: '/api/works/work1/like', method: 'POST', actor: { id: 'owner1' }, body: { active: true }, row: { ...workRow },
  });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 400);
  assert.equal(statements.some(item => item.sql.startsWith('INSERT INTO note_reaction')), false);
  assert(statements.some(item => item.sql === 'ROLLBACK'));
});

test('legacy create alias keeps authentication checks instead of trusting body i or userId', async () => {
  const ctx = context({ path: '/api/community/submissions/create', method: 'POST', body: { i: 'spoofed', userId: 'owner1', category: 'resource', title: 'Title', idempotencyKey: 'once' } });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 401);
});

test('a database file key cannot escape the mounted storage root', async () => {
  const ctx = context({
    path: '/legacy-files/file1',
    query: async () => ({ rows: [{ id: 'file1', name: 'secret', type: 'text/plain', accessKey: '../outside' }] }),
  });
  await assert.rejects(handleContent(ctx), error => error.statusCode === 404);
});

test('saved library filtering and cursor are applied in SQL before the page limit', async () => {
  let statement, parameters;
  const ctx = context({ path: '/api/library?status=saved&cursor=work8', user: { id: 'reader1' },
    query: async (sql, values) => { statement = sql; parameters = values; return { rows: [] }; } });
  await handleContent(ctx);
  assert(statement.includes('EXISTS (SELECT 1 FROM note_favorite f WHERE f."noteId"=s."approvedNoteId"'));
  assert(statement.indexOf('EXISTS (SELECT 1 FROM note_favorite') < statement.indexOf('ORDER BY'));
  assert(statement.includes('s.id<$2'));
  assert.deepEqual(parameters, ['reader1', 'work8', 101]);
  assert.equal(ctx.result.payload.nextCursor, null);
});

test('profile received likes share public visibility and count works without amplifying them by reactions', async () => {
  for (const viewer of [null, { id: '17' }]) {
    const statements = [];
    const ctx = context({ path: '/api/users/3', user: viewer, query: async (sql, values) => {
      statements.push({ sql, values });
      if (sql.includes('FROM "user" u JOIN user_profile')) return { rows: [{
        id: '3', username: 'root', name: 'Creator', bio: 'Profile',
        followersCount: 4, followingCount: 2, followed: false,
      }] };
      if (sql.includes('FROM external_account')) return { rows: [] };
      assert(sql.includes(publicVisibilitySql));
      assert(sql.includes('s."authorId"=$2'));
      assert.match(sql, /COUNT\(DISTINCT s\.id\)::int AS count/);
      assert.match(sql, /COUNT\(DISTINCT r\.id\)::int AS "receivedLikesCount"/);
      assert.match(sql, /LEFT JOIN note_reaction r ON r\."noteId"=n\.id AND r\.reaction IN \('❤','❤️'\)/);
      assert.deepEqual(values, [viewer?.id ?? null, '3']);
      return { rows: [{ count: 2, receivedLikesCount: 7 }] };
    } });
    await handleContent(ctx);
    assert.equal(ctx.result.payload.user.worksCount, 2);
    assert.equal(ctx.result.payload.user.receivedLikesCount, 7);
    assert.equal(ctx.result.payload.user.isSelf, false);
    assert.equal(statements.length, 3, 'Profile, public identity and one aggregate are sufficient');
    assert.equal(statements.filter(item => item.sql.includes('note_reaction')).length, 1);
  }
});

test('liked and saved libraries enforce the current viewer and public filters before category and pagination', async () => {
  for (const selector of ['tab=liked', 'status=liked', 'tab=saved', 'status=saved']) {
    const guest = context({ path: `/api/library?${selector}&userId=91`,
      query() { assert.fail('Private collections must reject guests before database access'); } });
    await assert.rejects(handleContent(guest), { statusCode: 401 });
    let statement, parameters;
    const ctx = context({
      path: `/api/library?${selector}&kind=image&cursor=work8&limit=2&userId=91&authorId=91`,
      user: { id: '17' },
      query: async (sql, values) => { statement = sql; parameters = values; return { rows: [] }; },
    });
    await handleContent(ctx);
    assert(statement.includes(publicVisibilitySql));
    const expected = selector.endsWith('liked')
      ? `EXISTS (SELECT 1 FROM note_reaction lr WHERE lr."noteId"=s."approvedNoteId" AND lr."userId"=$1 AND lr.reaction IN ('❤','❤️'))`
      : 'EXISTS (SELECT 1 FROM note_favorite f WHERE f."noteId"=s."approvedNoteId" AND f."userId"=$1)';
    assert(statement.includes(expected), selector);
    assert(statement.indexOf(expected) < statement.indexOf('ORDER BY'));
    assert(statement.includes('s.category = $2'));
    assert(statement.includes('s.id<$3'));
    assert.deepEqual(parameters, ['17', 'image', 'work8', 3]);
    assert.equal(ctx.result.payload.nextCursor, null);
  }
  const publicPage = context({ path: '/api/works?authorId=3&tab=liked&sort=latest', user: { id: '17' },
    query: async sql => {
      assert(!sql.includes('EXISTS (SELECT 1 FROM note_reaction lr'), 'Public works must not expose whose collection is being queried');
      return { rows: [] };
    } });
  await handleContent(publicPage);
});

test('legacy timestamp codecs preserve relative, absolute and expired privacy boundaries', () => {
  const now = Date.UTC(2026, 10, 12);
  const aidx = (now - 946684800000).toString(36).padStart(8, '0') + '0123456789abcdef';
  assert.equal(legacyIdTime(aidx), now);
  assert.equal(legacyIdTime(aidx, 'objectid'), now);
  assert.equal(legacyIdTime('00000001' + '0'.repeat(16), 'objectid'), 1000);
  assert.equal(legacyIdTime('800000000001' + '0'.repeat(12), 'meid'), 1);
  assert.equal(legacyIdTime('g' + '00000000001' + '0'.repeat(12), 'meidg'), 1);
  assert.equal(legacyIdTime('0000000001' + '0'.repeat(16), 'ulid'), 1);
  assert.equal(hiddenByTime(null, now - 100000, now), false);
  assert.equal(hiddenByTime(-60, now - 59000, now), false);
  assert.equal(hiddenByTime(-60, now - 60000, now), true);
  assert.equal(hiddenByTime(now / 1000, now, now), true);
  assert.equal(hiddenByTime((now - 1000) / 1000, now, now), false);
  assert(publicVisibilitySql.includes('privacy_follow."followerId"=$1'));
  assert(publicVisibilitySql.includes('u.id=$1'));
});

test('ranking cursors reject tampering and retain the random feed seed, boundary and anchor', () => {
  const source = { v: 1, id: 'work7', order: 'random', seed: 'refresh-1', boundary: 'work2', anchor: Date.now() };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.deepEqual(readWorkCursor(encode(source)), source);
  assert.deepEqual(readWorkCursor('work7'), { v: 1, id: 'work7', order: 'latest' });
  for (const value of [{ ...source, boundary: '../secret' }, { ...source, anchor: Date.now() + 3600000 }, { ...source, seed: "'" }, { ...source, order: 'unsafe' }]) {
    assert.throws(() => readWorkCursor(encode(value)), error => error.statusCode === 400);
  }
});

test('featured feed includes reactions, replies and reposts; following feed requires sign-in', async () => {
  let statement;
  const ctx = context({ path: '/api/works?sort=featured', query: async sql => { statement = sql; return { rows: [] }; } });
  await handleContent(ctx);
  for (const part of ['repliesCount', 'renoteCount', 'jsonb_each_text', 'heat DESC']) assert(statement.includes(part));
  await assert.rejects(handleContent(context({ path: '/api/works?sort=following' })), error => error.statusCode === 401);
});

test('view deduplication uses the original server identity and only increments once in thirty minutes', async () => {
  let count = 10, updates = 0;
  const keys = new Set();
  const ctx = context({ method: 'POST', path: '/api/works/work1/view', query: async sql => {
    if (sql.startsWith('UPDATE community_submission')) { updates++; return { rows: [{ viewsCount: ++count }] }; }
    return { rows: [{ ...workRow, viewsCount: count }] };
  } });
  ctx.ip = '192.0.2.5';
  ctx.redis = { async set(key, _value, expiry, ttl, mode) {
    assert.equal(expiry, 'EX'); assert.equal(ttl, 1800); assert.equal(mode, 'NX');
    assert.equal(key.includes(ctx.ip), false);
    const exists = keys.has(key); keys.add(key); return exists ? null : 'OK';
  } };
  await handleContent(ctx);
  assert.equal(ctx.result.payload.viewsCount, 11);
  await handleContent(ctx);
  assert.equal(ctx.result.payload.viewsCount, 11);
  assert.equal(updates, 1);
});

test('upload limits resolve role priority without reducing configured limits to twenty MiB', async () => {
  const ctx = context({ user: { id: 'reader1' }, query: async sql => {
    if (sql.includes('FROM meta')) return { rows: [{ policies: { maxFileSizeMb: 300, driveCapacityMb: 1000 },
      clientOptions: { uploadLimits: { image: 80, video: 256, audio: 40, document: 50, other: 30 } } }] };
    if (sql.includes('FROM role_assignment')) return { rows: [{ roleId: 'role1' }, { roleId: 'role2' }] };
    if (sql.includes('FROM role')) return { rows: [
      { id: 'role1', target: 'manual', policies: { maxFileSizeMb: { priority: 2, useDefault: false, value: 100 } } },
      { id: 'role2', target: 'manual', policies: { maxFileSizeMb: { priority: 1, useDefault: false, value: 512 } } },
    ] };
    return { rows: [{ id: 'reader1', host: null }] };
  } });
  const limits = await uploadLimitsFor(ctx);
  assert.equal(limits.maxFileSizeMb, 100);
  assert.equal(limits.imagesMb, 80);
  assert.equal(limits.videosMb, 100);
  assert.equal(limits.documentsMb, 50);
});

test('media type detection trusts file signatures and legacy files do not enter processing', () => {
  assert.equal(sniffType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'application/json'), 'image/png');
  assert.equal(sniffType(Buffer.from('<script>bad</script>'), 'image/png'), 'application/octet-stream');
  assert.equal(mediaState({ width: 300 }), 'ready');
  assert.equal(mediaState({ communityMedia: { state: 'pending', version: 1 } }), 'pending');
  assert.equal(mediaState({ communityMedia: { state: 'failed', attempts: 3 } }), 'failed');
});

test('missing legacy derivatives fall back to the already authorized original with its MIME and size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-media-fallback-'));
  const original = join(root, 'original-key');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(original, png);
  try {
    for (const variant of ['', '?variant=web', '?variant=webpublic', '?variant=thumbnail']) {
      const ctx = context({ method: 'HEAD', path: `/legacy-files/file1${variant}`, query: async () => ({ rows: [{
        id: 'file1', name: 'legacy.png', type: 'image/png', accessKey: 'original-key',
        thumbnailAccessKey: 'missing-thumbnail', webpublicAccessKey: 'missing-web', webpublicType: 'image/webp',
      }] }) });
      const headers = {};
      ctx.filesRoot = root;
      ctx.reply = {
        header(name, value) { headers[name] = value; return this; },
        code(value) { ctx.result.status = value; return this; },
        send() { return this; },
      };
      await handleContent(ctx);
      assert.equal(ctx.result.status, 200);
      assert.equal(headers['Content-Type'], 'image/png');
      assert.equal(headers['Content-Length'], png.length);
    }
  } finally { await unlink(original); await rmdir(root); }
});
