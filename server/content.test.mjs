/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
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

test('popup announcements filter before the limit and retain public visibility and expiry restrictions', async () => {
  for (const popup of [false, true]) {
    let statement, values
    const ctx = context({ path: '/api/announcements' + (popup ? '?popup=1' : ''), query: async (sql, args) => { statement = sql; values = args; return { rows: [] } } })
    assert.equal(await handleContent(ctx), true)
    assert.deepEqual(values, [null, popup])
    assert.match(statement, /WHERE "isActive"/)
    assert.match(statement, /"autoArchiveAt">NOW\(\)/)
    assert.match(statement, /NOT "forExistingUsers"/)
    assert.match(statement, /NOT \$2::boolean OR \("userId" IS NULL AND display='dialog'\)/)
    assert(statement.indexOf("display='dialog'") < statement.indexOf('LIMIT 100'))
  }
})

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

test('related works match any requested tag while keeping category and public visibility guards', async () => {
  let statement, values;
  const ctx = context({ path: '/api/works?kind=image&sort=latest&tag=摄影&tag=光影&limit=20', query: async (sql, parameters) => { statement = sql; values = parameters; return { rows: [] }; } });
  await handleContent(ctx);
  assert.equal(ctx.result.status, 200);
  assert(values.includes('image'));
  assert(values.includes('摄影'));
  assert(values.includes('光影'));
  assert.match(statement, /t\.id=ANY\(s\."tagIds"\) AND NOT t\."isDeleted"/);
  assert.match(statement, /\(t\.id = \$\d+ OR t\.name = \$\d+\) OR \(t\.id = \$\d+ OR t\.name = \$\d+\)/);
  assert(statement.includes(publicVisibilitySql));
  const tooMany = context({ path: '/api/works?sort=latest&tag=a&tag=b&tag=c&tag=d' });
  await assert.rejects(handleContent(tooMany), error => error.statusCode === 400);
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

function publicationContext(body, { row = { ...workRow, status: 'pending', approvedNoteId: null }, existing, path = '/api/works', method = 'POST', admin = false, mode = 'before', authorActive = true, attachments = [] } = {}) {
  const statements = [];
  const tagOptions = [1, 2, 3].map(i => ({ id: `tag${i}`, name: `标签${i}`, category: 'resource' }));
  const ctx = context({ path, method, body: { kind: 'resource', title: row.title, body: row.text, idempotencyKey: 'once', ...body },
    user: { id: 'owner1', isAdmin: admin }, query: async (sql, parameters = []) => {
      statements.push({ sql, parameters });
      if (sql.includes('FROM drive_file')) return { rows: attachments.filter(file => parameters[0].includes(file.id)) };
      if (sql.startsWith('SELECT * FROM community_submission')) return { rows: existing ? [existing] : [] };
      if (sql.includes('FROM community_submission s')) return { rows: [row] };
      if (sql.includes('FROM community_tag')) return { rows: tagOptions.filter(tag => parameters[0].includes(sql.includes('WHERE name') ? tag.name : tag.id) && (!parameters[1] || parameters[1] === tag.category)) };
      if (sql.startsWith('INSERT INTO community_submission')) return { rows: [{ id: row.id }] };
      if (sql.startsWith('SELECT id FROM "user"')) return { rows: [{ id: 'owner1' }] };
      if (sql.startsWith('UPDATE "user" SET "notesCount" =')) return { rows: authorActive ? [{ id: 'owner1' }] : [] };
      if (sql.includes('FROM meta')) return { rows: [{ clientOptions: { communityPublicationMode: mode } }] };
      if (sql.startsWith('SELECT id FROM note')) return { rows: [{ id: 'note1' }] };
      return { rows: [], rowCount: 1 };
    } });
  ctx.db.connect = async () => ({ query: ctx.db.query, release() {} });
  ctx.newId = () => 'generated1';
  return { ctx, statements };
}

test('new community publications require tags before any insert, including legacy API aliases', async () => {
  for (const path of ['/api/works', '/api/community/submissions/create']) for (const selection of [{}, { tags: [] }, { tagIds: [] }]) {
    const { ctx, statements } = publicationContext(selection, { path });
    await assert.rejects(handleContent(ctx), error => error.statusCode === 400 && error.code === 'WORK_TAGS_REQUIRED');
    assert(!statements.some(({ sql }) => sql.startsWith('INSERT')));
    assert(statements.some(({ sql }) => sql === 'ROLLBACK'));
  }
});

test('manual skill and media metadata survive without a prompt and preserve source-comment provenance on partial edits', () => {
  const skill = { platform: ' ComfyUI ', version: '0.3+', installation: 'Import workflow.json', secret: 'private' };
  const revision = normalizeRevision({ kind: 'resource', title: 'Workflow', skill });
  assert.deepEqual(revision.generation.skill, { platform: 'ComfyUI', version: '0.3+', installation: 'Import workflow.json' });
  const parameters = { version: 1, kind: 'image', size: '1024x1024' };
  assert.deepEqual(normalizeRevision({ kind: 'image', title: 'Image', parameters }).generation.parameters, parameters);
  const previous = { ...workRow, category: 'image', generation: { prompt: 'source', model: 'm', referenceFileIds: [], sourceWorkId: 'original1', shareToSource: true, parameters } };
  const edited = normalizeRevision({ parameters: { ...parameters, size: '2048x2048' } }, previous);
  assert.equal(edited.generation.shareToSource, true);
  assert.equal(edited.generation.sourceWorkId, 'original1');
  assert.equal(edited.generation.parameters.size, '2048x2048');
  assert.equal(normalizeRevision({ parameters: null }, previous).generation.parameters, undefined);
  for (const invalid of [{ kind: 'image', skill }, { skill: { platform: 'x'.repeat(101) } }, { skill, generation: { sourceWorkId: 'original1' } }, { skill, parameters: { version: 1, kind: 'text' } }]) {
    assert.throws(() => normalizeRevision({ kind: 'resource', title: 'Skill', ...invalid }), error => error.statusCode === 400);
  }
});

test('skill publication validates tool, instructions, owned supported files or a resource link and allows incomplete drafts', async () => {
  const base = { skill: { platform: 'ComfyUI' }, body: 'Import the workflow', tagIds: ['tag1'] };
  for (const [name, type] of [['skill.zip', 'application/zip'], ['workflow.json', 'application/json'], ['SKILL.md', 'text/plain'], ['workflow.yaml', 'text/plain'], ['workflow.yml', 'application/yaml'], ['guide.txt', 'text/plain']]) {
    const entry = { id: 'skill1', name, type };
    const f = publicationContext({ ...base, fileIds: [entry.id] }, { attachments: [entry] });
    await handleContent(f.ctx);
    assert.equal(f.ctx.result.status, 201);
    assert.equal(f.statements.find(({ sql }) => sql.startsWith('INSERT INTO community_submission')).parameters[12].skill.platform, 'ComfyUI');
  }
  const link = publicationContext({ ...base, sourceUrl: 'https://example.com/workflow' });
  await handleContent(link.ctx); assert.equal(link.ctx.result.status, 201);
  const draft = publicationContext({ skill: {}, body: '', status: 'draft' });
  await handleContent(draft.ctx); assert.equal(draft.ctx.result.status, 201);
  for (const body of [{}, { sourceUrl: 'https://example.com', body: '' }, { sourceUrl: 'https://example.com', skill: {} }, { fileIds: ['otheraccount'] }]) {
    const f = publicationContext({ ...base, ...body });
    await assert.rejects(handleContent(f.ctx), error => error.statusCode === 400);
    assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT')));
  }
  for (const [name, type] of [['picture.png', 'image/png'], ['run.exe', 'text/plain'], ['workflow.json', 'application/octet-stream']]) {
    const f = publicationContext({ ...base, fileIds: ['skill1'] }, { attachments: [{ id: 'skill1', name, type }] });
    await assert.rejects(handleContent(f.ctx), error => error.statusCode === 400);
  }
});

test('skill metadata round-trips through detail, pending review and compact card DTOs without exposing arbitrary fields', async () => {
  const skill = { platform: 'ComfyUI', version: '0.3+', installation: 'Import workflow.json' };
  const row = { ...workRow, generation: { prompt: '', model: '', referenceFileIds: [], skill: { ...skill, secret: 'hidden' } } };
  for (const path of ['/api/works/work1', '/api/works?view=card', '/api/admin/submissions']) {
    const ctx = context({ path, user: { id: 'owner1', isAdmin: true }, query: async sql => ({ rows: sql.includes('FROM community_submission s') ? [row] : [] }) });
    await handleContent(ctx);
    const packed = ctx.result.payload.work ?? ctx.result.payload.items[0];
    assert.equal(packed.isSkill, true);
    if (path.includes('view=card')) assert.equal(packed.generation, undefined);
    if (packed.generation) assert.deepEqual(packed.generation.skill, skill);
    assert(!JSON.stringify(packed).includes('hidden'));
  }
});

test('publication accepts one to three existing category tags by id or name', async () => {
  for (const selection of [{ tagIds: ['tag1'] }, { tagIds: ['tag3', 'tag1', 'tag2'] }, { tags: ['标签1'] }]) {
    const { ctx, statements } = publicationContext(selection);
    await handleContent(ctx);
    assert.equal(ctx.result.status, 201);
    const saved = statements.find(({ sql }) => sql.startsWith('INSERT INTO community_submission'));
    assert.deepEqual(saved.parameters[11], selection.tagIds?.toSorted() ?? ['tag1']);
  }
});

test('required tags still reject excessive, duplicate, unavailable and ambiguous legacy choices', async () => {
  for (const selection of [{ tagIds: ['tag1', 'tag2', 'tag3', 'tag4'] }, { tagIds: ['tag1', 'tag1'] }, { tagIds: ['deleted'] }, { tags: ['不存在'] }, { kind: 'image', status: 'draft', tags: ['标签1'] }]) {
    const { ctx, statements } = publicationContext(selection);
    await assert.rejects(handleContent(ctx), error => error.statusCode === 400);
    assert(!statements.some(({ sql }) => sql.startsWith('INSERT')));
  }
});

test('empty-tag drafts can be saved but submission and removal of published tags are rejected', async () => {
  const draft = publicationContext({ status: 'draft', body: '' });
  await handleContent(draft.ctx);
  assert.equal(draft.ctx.result.status, 201);
  for (const status of ['draft', 'approved']) {
    const { ctx, statements } = publicationContext({ version: 2, status: 'pending', tagIds: [] }, { method: 'PATCH', path: '/api/works/work1', row: { ...workRow, status, tagIds: ['tag1'] } });
    await assert.rejects(handleContent(ctx), error => error.code === 'WORK_TAGS_REQUIRED');
    assert(!statements.some(({ sql }) => sql.startsWith('UPDATE')));
  }
  const edit = publicationContext({ version: 2, status: 'draft', tagIds: [] }, { method: 'PATCH', path: '/api/works/work1', row: { ...workRow, status: 'draft', approvedNoteId: null } });
  await handleContent(edit.ctx);
  assert.equal(edit.ctx.result.status, 200);
});

test('legacy no-tag retries return the original submission and keep payload conflict protection', async () => {
  const existing = { ...workRow, status: 'pending' };
  const retry = publicationContext({}, { existing });
  await handleContent(retry.ctx);
  assert.equal(retry.ctx.result.status, 201);
  assert(!retry.statements.some(({ sql }) => sql.startsWith('INSERT')));
  const conflict = publicationContext({ title: 'Changed' }, { existing });
  await assert.rejects(handleContent(conflict.ctx), error => error.statusCode === 409);
});

test('source comments and approval of legacy untagged works remain available', async () => {
  const comment = publicationContext({ destination: 'source-comment', resultId: 'result1', model: 'model1', generation: { model: 'model1', prompt: 'Text', sourceWorkId: 'work1' } });
  await handleContent(comment.ctx);
  assert.equal(comment.ctx.result.status, 201);
  const review = publicationContext({ version: 2, action: 'approve' }, { path: '/api/admin/submissions/work1/review', admin: true });
  await handleContent(review.ctx);
  assert.equal(review.ctx.result.status, 200);
  assert(review.statements.some(({ sql }) => sql.startsWith('INSERT INTO note')));
});

test('approving a public unreviewed work updates its existing note without publishing a duplicate', async () => {
  const row = { ...workRow, status: 'published', approvedNoteId: 'note1' };
  const review = publicationContext({ version: 2, action: 'approve' }, { row, path: '/api/admin/submissions/work1/review', admin: true });
  await handleContent(review.ctx);
  assert.equal(review.ctx.result.status, 200);
  assert(review.statements.some(({ sql }) => sql.startsWith('UPDATE note')));
  assert(!review.statements.some(({ sql }) => sql.startsWith('INSERT INTO note')));
  assert(!review.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')));
  assert(review.statements.some(({ sql, parameters }) => sql.startsWith('UPDATE community_submission') && parameters.includes('approved')));
  const reject = publicationContext({ version: 2, action: 'reject', reason: 'Reason' }, { row, path: '/api/admin/submissions/work1/review', admin: true });
  await assert.rejects(handleContent(reject.ctx), error => error.statusCode === 409);
});

test('publication reward hook runs for first public works, not pending, drafts, retries or source comments', async () => {
  for (const mode of ['before', 'after']) for (const status of ['draft', 'pending']) {
    const f = publicationContext({ status, tagIds: ['tag1'] }, { mode });
    await handleContent(f.ctx);
    assert.equal(f.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')), mode === 'after' && status !== 'draft');
  }
  const approval = publicationContext({ version: 2, action: 'approve' }, { path: '/api/admin/submissions/work1/review', admin: true });
  await handleContent(approval.ctx);
  assert(approval.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')));
  const retry = publicationContext({}, { mode: 'after', existing: { ...workRow, status: 'pending' } });
  await handleContent(retry.ctx);
  assert(!retry.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')));
  const comment = publicationContext({ destination: 'source-comment', resultId: 'result1', model: 'model1', generation: { model: 'model1', prompt: 'Text', sourceWorkId: 'work1' } }, { mode: 'after' });
  await handleContent(comment.ctx);
  assert(!comment.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')));
});

test('author suspension while publication waits for the author lock rolls back before awarding', async () => {
  const f = publicationContext({ tagIds: ['tag1'] }, { mode: 'after', authorActive: false });
  await assert.rejects(handleContent(f.ctx), error => error.statusCode === 409);
  assert(f.statements.some(({ sql }) => sql === 'ROLLBACK'));
  assert(!f.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"')));
  assert.match(f.statements.find(({ sql }) => sql.startsWith('UPDATE "user" SET "notesCount" =')).sql, /NOT "isSuspended".*RETURNING id/);
});

test('a full work page batches attachments, reference images and tags into four queries', async () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({ ...workRow, id: `work${index}`, category: 'image',
    fileIds: [`file${index}`], tagIds: ['tag1'], generation: { prompt: 'Image', model: '', referenceFileIds: [`ref${index}`] } }));
  const statements = [];
  const ctx = context({ path: '/api/works?sort=latest&limit=24', query: async (sql, args) => {
    statements.push(sql);
    if (sql.includes('SELECT s.*')) return { rows };
    if (sql.includes('FROM drive_file')) {
      assert.match(sql, /\(id,"userId"\) IN \(SELECT \* FROM unnest/);
      assert.equal(args[0].length, 48);
      return { rows: args[0].map((id, index) => ({ id, userId: args[1][index], name: id, type: 'image/png', size: 10, storedInternal: true })) };
    }
    if (sql.includes('FROM community_tag')) return { rows: [{ id: 'tag1', name: 'Tag', category: 'image' }] };
    return { rows: [] };
  } });
  await handleContent(ctx);
  assert.equal(statements.length, 4);
  assert.equal(ctx.result.payload.items.length, 24);
  for (const [index, item] of ctx.result.payload.items.entries()) {
    assert.equal(item.id, `work${index}`);
    assert.deepEqual(item.files.map(file => file.id), [`file${index}`]);
    assert.deepEqual(item.referenceFiles.map(file => file.id), [`ref${index}`]);
    assert.deepEqual(item.tags, ['Tag']);
  }
});

test('batched work media preserves owner isolation and references while retaining cross-category tags', async () => {
  const rows = [{ ...workRow, category: 'image', fileIds: ['image1', 'foreign2'], tagIds: ['imageTag', 'videoTag'],
    generation: { prompt: '', model: '', referenceFileIds: ['ref1', 'foreign2', 'refLink', 'video1'] } },
  { ...workRow, id: 'work2', authorId: 'owner2', category: 'video', fileIds: ['foreign2'], tagIds: ['imageTag', 'videoTag'] }];
  const files = [
    { id: 'image1', userId: 'owner1', type: 'image/png', storedInternal: true },
    { id: 'foreign2', userId: 'owner2', type: 'image/png', storedInternal: true },
    { id: 'ref1', userId: 'owner1', type: 'image/png', storedInternal: true },
    { id: 'refLink', userId: 'owner1', type: 'image/png', storedInternal: false },
    { id: 'video1', userId: 'owner1', type: 'video/mp4', storedInternal: true },
  ];
  const ctx = context({ path: '/api/works?sort=latest', query: async sql => {
    if (sql.includes('SELECT s.*')) return { rows };
    if (sql.includes('FROM drive_file')) return { rows: files };
    if (sql.includes('FROM community_tag')) {
      assert.match(sql, /NOT "isDeleted"/);
      return { rows: [{ id: 'imageTag', name: 'Image', category: 'image' }, { id: 'videoTag', name: 'Video', category: 'video' }] };
    }
    return { rows: [] };
  } });
  await handleContent(ctx);
  const [first, second] = ctx.result.payload.items;
  assert.deepEqual(first.files.map(file => file.id), ['image1']);
  assert.deepEqual(first.referenceFiles.map(file => file.id), ['ref1']);
  assert.deepEqual(first.tags, ['Image', 'Video']);
  assert.deepEqual(second.files.map(file => file.id), ['foreign2']);
  assert.deepEqual(second.tags, ['Image', 'Video']);
});

test('admin work batches select pending revision media and category without mixing published assets', async () => {
  const ctx = context({ path: '/api/admin/submissions', user: { id: 'admin', isAdmin: true }, query: async (sql, args) => {
    if (sql.includes('SELECT s.*')) return { rows: [{ ...workRow, fileIds: ['published1'], tagIds: ['publishedTag'],
      pendingRevision: { ...workRow, category: 'video', fileIds: ['pending1'], tagIds: ['pendingTag'], title: 'Pending' } }] };
    if (sql.includes('FROM drive_file')) {
      assert.deepEqual(args, [['pending1'], ['owner1']]);
      return { rows: [{ id: 'pending1', userId: 'owner1', type: 'video/mp4', storedInternal: true }] };
    }
    if (sql.includes('FROM community_tag')) {
      assert.deepEqual(args, [['pendingTag']]);
      return { rows: [{ id: 'pendingTag', name: 'Video', category: 'video' }] };
    }
    return { rows: [] };
  } });
  await handleContent(ctx);
  const item = ctx.result.payload.items[0];
  assert.equal(item.title, 'Pending');
  assert.equal(item.kind, 'video');
  assert.deepEqual(item.files.map(file => file.id), ['pending1']);
  assert.deepEqual(item.tags, ['Video']);
});

test('work authors and comments use the current local nickname while retaining verified account fields and content ownership', async () => {
  let nickname = '章鱼小白';
  const query = async sql => {
    if (sql.includes('FROM external_account')) return { rows: [{ userId: 'owner1', subject: '17', username: 'root' }] };
    if (sql.includes('FROM community_submission s')) return { rows: [{ ...workRow, authorName: nickname }] };
    if (sql.includes('FROM note n JOIN "user"')) return { rows: [{
      id: 'comment1', userId: 'owner1', name: nickname, username: 'oldLoginName', text: '你好', fileIds: [], replyId: 'note1',
    }] };
    return { rows: [] };
  };
  for (const name of ['章鱼小白', '修改后的社区昵称']) {
    nickname = name;
    for (const path of ['/api/works?sort=latest', '/api/works/work1/comments']) {
      const ctx = context({ path, query });
      await handleContent(ctx);
      const item = ctx.result.payload.items[0];
      assert.equal(item.author, name);
      assert.equal(item.authorUsername, 'root');
      assert.equal(item.authorAccountId, '17');
      assert.equal(item.authorId, 'owner1');
    }
  }
});

test('comment pages batch media and visible sources without mixing owners, comments or pagination', async () => {
  const base = { text: 'Comment', name: 'Reader', username: 'reader', replyId: 'note1', repliesCount: 0, likes: 0 };
  const comments = [
    { ...base, id: 'comment4', userId: 'reader1', fileIds: ['file2', 'file1', 'file3'], renoteId: 'source1' },
    { ...base, id: 'comment3', userId: 'reader2', fileIds: ['file3'], renoteId: 'hiddenSource' },
    { ...base, id: 'comment2', userId: 'reader1', fileIds: ['file4'], renoteId: 'source1' },
    { ...base, id: 'comment1', userId: 'reader1', fileIds: [], renoteId: null },
    { ...base, id: 'comment0', userId: 'reader1', fileIds: ['nextPageFile'], renoteId: 'nextPageSource' },
  ];
  const assets = [
    { id: 'file1', userId: 'reader1' }, { id: 'file2', userId: 'reader1' },
    { id: 'file3', userId: 'reader2' }, { id: 'file4', userId: 'reader1' },
  ].map(file => ({ ...file, name: `${file.id}.png`, type: 'image/png', size: 10,
    url: '', thumbnailAccessKey: null, properties: { communityMedia: { state: 'pending' } } }));
  const statements = [];
  const ctx = context({ path: '/api/works/work1/comments?limit=4', user: { id: 'reader1' }, query: async (sql, args) => {
    statements.push(sql);
    if (sql.includes('SELECT s.id')) {
      assert(sql.includes(publicVisibilitySql));
      const ids = Array.isArray(args[1]) ? args[1] : [args[1]];
      assert(!ids.includes('nextPageSource'));
      return { rows: ids.includes('source1') ? [{ id: 'remixed1', noteId: 'source1' }] : [] };
    }
    if (sql.includes('FROM community_submission s')) return { rows: [workRow] };
    if (sql.includes('FROM note n JOIN "user"')) return { rows: comments };
    if (sql.includes('FROM external_account')) return { rows: [] };
    if (sql.includes('FROM drive_file')) {
      assert(!args[0].includes('nextPageFile'));
      const owners = Array.isArray(args[1]) ? args[1] : args[0].map(() => args[1]);
      if (Array.isArray(args[1])) assert.match(sql, /\(id,"userId"\) IN \(SELECT \* FROM unnest/);
      return { rows: assets.filter(file => args[0].some((id, index) => id === file.id && owners[index] === file.userId)) };
    }
    assert.fail('Unexpected query: ' + sql);
  } });
  await handleContent(ctx);
  assert.equal(ctx.result.status, 200);
  assert.deepEqual(ctx.result.payload.items.map(item => item.id), ['comment4', 'comment3', 'comment2', 'comment1']);
  assert.deepEqual(ctx.result.payload.items.map(item => item.files.map(file => file.id)), [['file1', 'file2'], ['file3'], ['file4'], []]);
  assert.deepEqual(ctx.result.payload.items.map(item => item.sourceWorkId), ['remixed1', undefined, 'remixed1', undefined]);
  assert.equal(ctx.result.payload.items[0].files[0].processing, 'pending');
  assert.equal(ctx.result.payload.nextCursor, 'comment1');
  assert.equal(statements.length, 5, 'a comment page must not add database queries per comment');
});

test('comment attachment refresh enforces work/comment visibility and attachment ownership', async () => {
  const ctx = context({ path: '/api/works/work1/comments/comment1/files', query: async (sql, args) => {
    if (sql.includes('FROM community_submission s')) { assert(sql.includes('blocking')); return { rows: [workRow] }; }
    if (sql.includes('FROM note n JOIN')) {
      assert.deepEqual(args, [null, 'comment1', 'note1']);
      assert(sql.includes('(n."replyId"=$3 OR n."threadId"=$3)'));
      assert(sql.includes("n.visibility='public'")); assert(sql.includes('isSuspended'));
      return { rows: [{ id: 'comment1', userId: 'reader1', fileIds: ['file1'] }] };
    }
    if (sql.includes('FROM drive_file')) {
      assert.deepEqual(args, [['file1'], 'reader1']); assert(sql.includes('"userId"=$2'));
      return { rows: [{ id: 'file1', name: 'clip.mp4', type: 'video/mp4', size: 50, thumbnailAccessKey: 'thumb', properties: { communityMedia: { state: 'processing' } } }] };
    }
    return { rows: [] };
  } });
  await handleContent(ctx);
  assert.deepEqual(ctx.result.payload.files, [{ id: 'file1', name: 'zhangyu-file1.mp4', type: 'video/mp4', size: 50, url: '/legacy-files/file1', thumbnailUrl: '/legacy-files/file1?variant=thumbnail', processing: 'processing' }]);
  for (const hidden of ['work', 'comment']) {
    let readFiles = false;
    const denied = context({ path: '/api/works/work1/comments/comment1/files', query: async sql => {
      if (sql.includes('FROM drive_file')) readFiles = true;
      return { rows: hidden === 'comment' && sql.includes('FROM community_submission s') ? [workRow] : [] };
    } });
    await assert.rejects(handleContent(denied), error => error.statusCode === 404);
    assert.equal(readFiles, false);
  }
});

test('comments accept uploaded media before processing finishes and retain file locks and ownership checks', async () => {
  for (const owned of [true, false]) {
    const statements = [];
    const ctx = context({ method: 'POST', path: '/api/works/work1/comments', user: { id: 'reader1', name: 'Reader', username: 'reader' },
      body: { text: 'media comment', fileIds: ['file1'] }, query: async (sql, args) => {
        statements.push(sql);
        if (sql.includes('FROM community_submission s')) return { rows: [workRow] };
        if (sql.includes('FROM drive_file')) {
          assert.match(sql, /FOR KEY SHARE$/); assert.deepEqual(args, [['file1'], 'reader1']);
          return { rows: owned ? [{ id: 'file1', name: 'clip.mp4', type: 'video/mp4', size: 50, properties: { communityMedia: { state: 'pending' } } }] : [] };
        }
        return { rows: [] };
      } });
    ctx.db.connect = async () => ({ query: ctx.db.query, release() {} }); ctx.newId = () => 'savedcomment';
    if (owned) {
      await handleContent(ctx);
      assert.equal(ctx.result.status, 201); assert.equal(ctx.result.payload.comment.files[0].processing, 'pending');
      assert(statements.includes('COMMIT')); assert(statements.some(sql => sql.startsWith('INSERT INTO note')));
    } else {
      await assert.rejects(handleContent(ctx), error => error.statusCode === 400);
      assert(statements.includes('ROLLBACK')); assert(!statements.some(sql => sql.startsWith('INSERT INTO note')));
    }
  }
});

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
        id: 'cover1', userId: 'owner1', name: 'Cover', type: 'image/jpeg', storedInternal: true, thumbnailAccessKey: 'thumbnail1',
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

test('owner visibility and date filters are applied before pagination and keep drafts separate', async () => {
  for (const visibility of ['public', 'private']) {
    let statement, parameters;
    const ctx = context({ path: `/api/library?visibility=${visibility}&kind=image&from=2026-11-01T00:00:00Z&to=2026-11-17T00:00:00Z&cursor=work8&limit=2&authorId=other`,
      user: { id: 'owner1' }, query: async (sql, values) => { statement = sql; parameters = values; return { rows: [] }; } });
    await handleContent(ctx);
    assert(statement.includes('s."authorId" = $1'));
    assert(statement.includes(`s.status IN ('published', 'approved')`));
    assert(statement.includes(`COALESCE(n.visibility='public',false)`));
    assert.equal(statement.includes(`s.status<>'draft' AND NOT`), visibility === 'private');
    assert(statement.indexOf('s."submittedAt">=to_timestamp(') < statement.indexOf('ORDER BY'));
    assert(statement.includes('s."submittedAt"<to_timestamp('));
    assert.deepEqual(parameters, ['owner1', 'image', Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-17T00:00:00Z'), 'work8', 3]);
    assert(!parameters.includes('other'));
  }
  let sql;
  await handleContent(context({ path: '/api/library?status=draft', user: { id: 'owner1' }, query: async statement => { sql = statement; return { rows: [] }; } }));
  assert(sql.includes('s.status = $2'));
});

test('visibility and date filters reject invalid values and never expose another owner', async () => {
  for (const path of ['/api/library?visibility=hidden', '/api/library?from=invalid', '/api/library?from=2026-11-17&to=2026-11-16']) {
    await assert.rejects(handleContent(context({ path, user: { id: 'owner1' } })), { statusCode: 400 });
  }
  for (const path of ['/api/works?visibility=private&authorId=owner1', '/api/library?tab=saved&visibility=private', '/api/library?tab=liked&visibility=private']) {
    await assert.rejects(handleContent(context({ path, user: { id: 'other1' } })), { statusCode: 403 });
  }
  await assert.rejects(handleContent(context({ path: '/api/library?visibility=private' })), { statusCode: 401 });
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

test('missing legacy derivatives sanitize the authorized original in place', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-media-fallback-'));
  const original = join(root, 'original-key');
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
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
      assert.equal(headers['Content-Type'], 'image/webp');
      assert(headers['Content-Length'] > 0);
      assert(headers['Content-Disposition'].includes('zhangyu-file1.webp'));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('cross-category tag ids survive creating, editing and reading a work without changing its kind', async () => {
  const row = { ...workRow, category: 'image', status: 'draft', approvedNoteId: null, tagIds: ['tag1'] };
  for (const options of [
    { row },
    { row, path: '/api/works/work1', method: 'PATCH' },
    { row, path: '/api/works/work1', method: 'GET' },
  ]) {
    const { ctx, statements } = publicationContext({ kind: 'image', status: 'draft', version: 2, tagIds: ['tag1'] }, options);
    await handleContent(ctx);
    assert.equal(ctx.result.payload.work.kind, 'image');
    assert.deepEqual(ctx.result.payload.work.tagIds, ['tag1']);
    assert.deepEqual(ctx.result.payload.work.tags, ['标签1']);
    for (const { sql } of statements.filter(({ sql }) => sql.includes('FROM community_tag'))) {
      assert.match(sql, /NOT "isDeleted"/);
      assert.doesNotMatch(sql, /AND category/);
    }
  }
});

test('work search and tag filters retain work kind and visibility while matching tags from any admin category', async () => {
  let statement;
  const ctx = context({ path: '/api/works?kind=image&query=Tag&tag=videoTag', query: async sql => { statement = sql; return { rows: [] }; } });
  await handleContent(ctx);
  assert.match(statement, /s.category =/);
  assert.match(statement, /t.name ILIKE/);
  assert.match(statement, /t.id =/);
  assert.doesNotMatch(statement, /t.category=/);
  assert(statement.includes(publicVisibilitySql));
});
