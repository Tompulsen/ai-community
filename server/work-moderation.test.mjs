import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleContent } from './content.ts';
import { prepareWorkModeration, commitWorkModeration } from './work-moderation.ts';

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
const revision = { category: 'image', title: 'A landscape', text: '', model: '', license: '', sourceUrl: '', fileIds: ['image1'], generation: null, tagIds: ['tag1'] };
const file = { id: 'image1', userId: 'owner1', type: 'image/png', name: 'landscape.png', size: imageBytes.length, md5: 'digest1', accessKey: 'image-key', storedInternal: true, isLink: false, properties: null };

async function fixture(t, options = {}) {
  const filesRoot = await mkdtemp(join(tmpdir(), 'work-moderation-'));
  t.after(() => rm(filesRoot, { recursive: true, force: true }));
  const files = options.files ?? [{ ...file }];
  for (const item of files) if (item.accessKey && /^[\w-]+$/.test(item.accessKey)) await writeFile(join(filesRoot, item.accessKey), imageBytes);
  const state = { settings: options.settings ?? { enabled: true, sensitiveWords: [] }, inTransaction: false, calls: 0, ...options };
  const statements = [];
  const row = options.row ?? { ...revision, id: 'work1', authorId: 'owner1', authorName: 'Owner', authorUsername: 'owner',
    destination: 'community', submittedAt: new Date(), approvedNoteId: null, status: 'pending', version: 2, pendingRevision: null };
  const result = {};
  const actor = { id: 'owner1', isAdmin: options.admin ?? false };
  const query = async (sql, parameters = []) => {
    statements.push({ sql, parameters });
    if (sql === 'BEGIN') { state.inTransaction = true; options.onBegin?.(state, row, files); }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') state.inTransaction = false;
    if (sql.startsWith('SELECT "clientOptions"')) return { rows: [{ clientOptions: { communityModeration: state.settings, communityPublicationMode: options.mode ?? 'after' } }] };
    if (sql.includes('FROM drive_file')) return { rows: files.filter(item => parameters[0].includes(item.id) && (!parameters[1] || item.userId === parameters[1])) };
    if (sql.startsWith('SELECT * FROM community_submission')) return { rows: options.existing ? [options.existing] : [] };
    if (sql.includes('FROM community_submission s')) return { rows: [row] };
    if (sql.includes('FROM community_tag')) return { rows: [{ id: 'tag1', name: 'Nature', category: 'image' }] };
    if (sql.startsWith('SELECT id FROM "user"') || sql.startsWith('UPDATE "user" SET "notesCount" =')) return { rows: [{ id: 'owner1' }] };
    if (sql.startsWith('INSERT INTO community_submission')) return { rows: [{ id: 'work1' }] };
    if (sql.startsWith('SELECT id FROM note')) return { rows: [{ id: 'note1' }] };
    return { rows: [], rowCount: 1 };
  };
  const ctx = { filesRoot, req: { method: options.method ?? 'POST', headers: {} }, res: {},
    url: new URL(options.path ?? '/api/works', 'https://community.example'), config: { url: 'https://community.example', id: 'aidx' },
    body: { kind: 'image', title: revision.title, body: '', fileIds: ['image1'], tagIds: ['tag1'], idempotencyKey: 'once', ...options.body }, user: actor,
    db: { query, connect: async () => ({ query, release() {} }) }, newId: () => 'new1',
    json(status, payload) { result.status = status; result.payload = payload; }, requireUser: () => actor };
  const oldUrl = process.env.COMMUNITY_MODERATION_URL, oldToken = process.env.COMMUNITY_MODERATION_TOKEN;
  process.env.COMMUNITY_MODERATION_URL = 'http://moderation.internal:8090'; process.env.COMMUNITY_MODERATION_TOKEN = 'test-internal-secret';
  t.after(() => { oldUrl === undefined ? delete process.env.COMMUNITY_MODERATION_URL : process.env.COMMUNITY_MODERATION_URL = oldUrl; oldToken === undefined ? delete process.env.COMMUNITY_MODERATION_TOKEN : process.env.COMMUNITY_MODERATION_TOKEN = oldToken; });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    state.calls++;
    assert.equal(state.inTransaction, false, 'model inference must not hold database transaction locks');
    assert.equal(String(url), 'http://moderation.internal:8090/check');
    assert.equal(init.headers.Authorization, 'Bearer test-internal-secret');
    state.sentRejectThreshold = init.headers['X-Moderation-Reject-Threshold'];
    assert.equal(init.redirect, 'error');
    assert.deepEqual(Buffer.from(init.body), imageBytes);
    if (options.fetch) return options.fetch(url, init);
    return new Response(JSON.stringify({ nsfwScore: options.score ?? 0.1, text: options.ocr ?? '', modelVersion: 'test-v1' }), { status: 200 });
  });
  return { ctx, statements, state, result, row, files };
}
const hasPublicWrite = f => f.statements.some(({ sql }) => /^(INSERT INTO note|UPDATE note SET text)/.test(sql));
const hasReward = f => f.statements.some(({ sql }) => sql.includes('SET "firstPublishedAt"'));

test('clear image permits the existing after-review publication, while before-review stays pending', async t => {
  for (const mode of ['before', 'after']) await t.test(mode, async t => {
    const f = await fixture(t, { mode }); await handleContent(f.ctx);
    assert.equal(f.result.status, 201); assert.equal(hasPublicWrite(f), mode === 'after'); assert.equal(hasReward(f), mode === 'after'); assert.equal(f.state.calls, 1);
    assert(f.statements.some(({ sql }) => sql.includes('FROM drive_file') && sql.endsWith('FOR SHARE')));
    assert(f.statements.some(({ sql }) => sql.includes('FROM meta') && sql.endsWith('FOR SHARE')));
  });
});

test('high-confidence image rejection returns a stable error without submission, public note or reward writes', async t => {
  for (const path of ['/api/works', '/api/community/submissions/create']) await t.test(path, async t => {
    const f = await fixture(t, { score: 0.96, path });
    await assert.rejects(handleContent(f.ctx), error => error.statusCode === 422 && error.code === 'WORK_MODERATION_REJECTED' && /疑似/.test(error.message));
    assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT'))); assert(!hasPublicWrite(f)); assert(!hasReward(f));
    assert(f.statements.some(({ sql }) => sql === 'ROLLBACK'));
  });
});

test('borderline, unavailable, malformed, oversized and unsupported responses all retain pending status', async t => {
  const cases = [
    { score: 0.7 }, { fetch: () => new Response('', { status: 503 }) }, { fetch: () => new Response('', { status: 422 }) },
    { fetch: () => { throw new Error('offline'); } }, { fetch: () => new Response('{"nsfwScore":0}') },
    { fetch: () => new Response('x'.repeat(128 * 1024 + 1)) }, { fetch: () => new Response('{"nsfwScore":2,"text":"","modelVersion":"v1"}') },
  ];
  for (const [i, options] of cases.entries()) await t.test(String(i), async t => {
    const f = await fixture(t, options); await handleContent(f.ctx);
    assert.equal(f.result.status, 201); assert(!hasPublicWrite(f)); assert(!hasReward(f));
    assert.equal(f.statements.find(({ sql }) => sql.startsWith('INSERT INTO community_submission')).parameters[13], 'pending');
  });
});

test('early NSFW results reject at the current threshold without requiring OCR', async t => {
  for (const rejectThreshold of [0.8, 0.95, 1]) await t.test(String(rejectThreshold), async t => {
    const f = await fixture(t, { settings: { enabled: true, sensitiveWords: ['blocked'], rejectThreshold },
      fetch: () => new Response(JSON.stringify({ nsfwScore: rejectThreshold, text: '', modelVersion: 'test-v1', ocrSkipped: true })) });
    await assert.rejects(handleContent(f.ctx), error => error.statusCode === 422 && error.code === 'WORK_MODERATION_REJECTED');
    assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT')));
    assert(!hasPublicWrite(f)); assert(!hasReward(f)); assert.equal(f.state.calls, 1);
    assert.equal(f.state.sentRejectThreshold, String(rejectThreshold));
  });
});

test('skipped OCR below the rejection threshold and malformed skip flags never publish', async t => {
  for (const sensitiveWords of [[], ['blocked']]) for (const ocrSkipped of [true, 'true', 1, null]) {
    await t.test(JSON.stringify({ sensitiveWords, ocrSkipped }), async t => {
      const f = await fixture(t, { settings: { enabled: true, sensitiveWords },
        fetch: () => new Response(JSON.stringify({ nsfwScore: 0.1, text: '', modelVersion: 'test-v1', ocrSkipped })) });
      await handleContent(f.ctx);
      assert.equal(f.result.status, 201); assert(!hasPublicWrite(f)); assert(!hasReward(f));
      assert.equal(f.statements.find(({ sql }) => sql.startsWith('INSERT INTO community_submission')).parameters[13], 'pending');
    });
  }
});

test('completed OCR with an explicit false flag still permits a clear image', async t => {
  const f = await fixture(t, { fetch: () => new Response(JSON.stringify({ nsfwScore: 0.1, text: '', modelVersion: 'test-v1', ocrSkipped: false })) });
  await handleContent(f.ctx); assert.equal(f.result.status, 201); assert(hasPublicWrite(f)); assert(hasReward(f));
});

test('default and administrator thresholds gate publication at their inclusive boundaries', async t => {
  for (const thresholds of [undefined, { reviewThreshold: 0.3, rejectThreshold: 0.8 }, { reviewThreshold: 0.85, rejectThreshold: 1 }]) {
    const { reviewThreshold, rejectThreshold } = thresholds ?? { reviewThreshold: 0.65, rejectThreshold: 0.95 };
    for (const [score, decision] of [[reviewThreshold - 0.001, 'allow'], [reviewThreshold, 'review'], [rejectThreshold - 0.001, 'review'], [rejectThreshold, 'reject']]) {
      await t.test(`${thresholds ? 'custom' : 'default'} ${reviewThreshold}/${rejectThreshold}: ${score} ${decision}`, async t => {
        const f = await fixture(t, { score, settings: { enabled: true, sensitiveWords: [], ...thresholds } });
        if (decision === 'reject') {
          await assert.rejects(handleContent(f.ctx), error => error.statusCode === 422 && error.code === 'WORK_MODERATION_REJECTED');
          assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT')));
        } else {
          await handleContent(f.ctx);
          assert.equal(f.result.status, 201);
          if (decision === 'review') assert.equal(f.statements.find(({ sql }) => sql.startsWith('INSERT INTO community_submission')).parameters[13], 'pending');
        }
        assert.equal(hasPublicWrite(f), decision === 'allow');
        assert.equal(hasReward(f), decision === 'allow');
        assert.equal(f.state.calls, 1);
        assert.equal(f.state.sentRejectThreshold, String(rejectThreshold));
      });
    }
  }
});

test('text rules use normalized literal matching on public text and OCR without reading private packages', async t => {
  for (const scenario of [{ body: { title: 'ＡＢＣ' } }, { ocr: 'abc' }, { body: { generation: { prompt: 'abc', referenceFileIds: [] } } }]) await t.test(JSON.stringify(scenario), async t => {
    const f = await fixture(t, { settings: { enabled: true, sensitiveWords: ['abc'] }, ...scenario });
    await assert.rejects(handleContent(f.ctx), error => error.code === 'WORK_MODERATION_REJECTED'); assert(!hasPublicWrite(f));
  });
  await t.test('regex metacharacters remain literal', async t => {
    const f = await fixture(t, { settings: { enabled: true, sensitiveWords: ['a.*b'] }, body: { title: 'a nice b' } });
    await handleContent(f.ctx); assert(hasPublicWrite(f));
  });
  await t.test('public installation text is included and private source bytes are never sent', async t => {
    const privateFile = { ...file, id: 'package1', name: 'SKILL.md', type: 'text/plain', accessKey: 'package-key' };
    const f = await fixture(t, { files: [privateFile], settings: { enabled: true, sensitiveWords: ['abc'] } });
    await writeFile(join(f.ctx.filesRoot, 'package-key'), 'abc private package text');
    const content = { ...revision, fileIds: ['package1'], generation: { prompt: '', referenceFileIds: [], skill: { sourcePublic: false, installation: 'Instructions' } } };
    const checked = await prepareWorkModeration(f.ctx, 'owner1', content); assert.equal(checked.decision, 'review'); assert.equal(f.state.calls, 0);
    const blocked = await prepareWorkModeration(f.ctx, 'owner1', { ...content, generation: { ...content.generation, skill: { sourcePublic: false, installation: 'ＡＢＣ' } } });
    assert.equal(blocked.decision, 'reject'); assert.equal(f.state.calls, 0);
  });
});

test('reference images receive the same detection as work attachments', async t => {
  const reference = { ...file, id: 'reference1', accessKey: 'reference-key' };
  let calls = 0;
  const f = await fixture(t, { files: [file, reference], body: { generation: { referenceFileIds: ['reference1'] } }, fetch: () => new Response(JSON.stringify({ nsfwScore: ++calls === 2 ? 0.99 : 0.1, text: '', modelVersion: 'test-v1' })) });
  await assert.rejects(handleContent(f.ctx), error => error.code === 'WORK_MODERATION_REJECTED');
  assert.equal(f.state.calls, 2); assert(!hasPublicWrite(f));
});

test('only sanitized public generation parameter string values participate in word checks', async t => {
  const parameters = { version: 1, kind: 'text', chatOptions: { stop: '测试禁词' } };
  const blocked = await fixture(t, { settings: { enabled: true, sensitiveWords: ['测试禁词'] }, body: { kind: 'resource', body: 'Public text', fileIds: [], generation: { parameters } } });
  await assert.rejects(handleContent(blocked.ctx), error => error.code === 'WORK_MODERATION_REJECTED' && error.statusCode === 422);
  assert(!hasPublicWrite(blocked)); assert.equal(blocked.state.calls, 0);
  const ignored = await fixture(t, { settings: { enabled: true, sensitiveWords: ['messages', '测试禁词', 'stop'] }, body: { kind: 'resource', body: 'Public text', fileIds: [], generation: {
    parameters: { version: 1, kind: 'text', chatOptions: { stop: 'safe', messages: [{ role: 'user', content: '测试禁词' }] }, privateHistory: '测试禁词' },
  } } });
  await handleContent(ignored.ctx);
  assert(hasPublicWrite(ignored)); assert.equal(ignored.state.calls, 0);
});

test('video, GIF, processing files and oversized files go to review without an inference call', async t => {
  for (const changes of [{ type: 'video/mp4' }, { type: 'image/gif' }, { properties: { communityMedia: { state: 'pending' } } }, { size: 21 * 1024 * 1024 }, { isLink: true }, { storedInternal: false }]) await t.test(JSON.stringify(changes), async t => {
    const f = await fixture(t, { files: [{ ...file, ...changes }], body: { kind: changes.type === 'video/mp4' ? 'video' : 'image' } });
    await handleContent(f.ctx); assert(!hasPublicWrite(f)); assert.equal(f.state.calls, 0);
  });
});

test('drafts and completed idempotent retries do not trigger inference; disabled policy preserves existing behavior', async t => {
  await t.test('draft', async t => { const f = await fixture(t, { score: 0.99, body: { status: 'draft' } }); await handleContent(f.ctx); assert.equal(f.state.calls, 0); assert(!hasPublicWrite(f)); });
  await t.test('retry', async t => {
    const existing = { ...revision, id: 'old1', authorId: 'owner1', destination: 'community', status: 'pending' };
    const f = await fixture(t, { existing }); await handleContent(f.ctx); assert.equal(f.state.calls, 0); assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT')));
  });
  await t.test('disabled', async t => { const f = await fixture(t, { settings: { enabled: false, sensitiveWords: [] }, score: 0.99 }); await handleContent(f.ctx); assert.equal(f.state.calls, 0); assert(hasPublicWrite(f)); });
});

test('published edits are blocked or kept as pending revisions without altering the original', async t => {
  for (const score of [0.99, 0.7, 0.1]) await t.test(String(score), async t => {
    const f = await fixture(t, { score, method: 'PATCH', path: '/api/works/work1', body: { version: 2, title: 'Edited landscape' } });
    f.row.status = 'approved'; f.row.approvedNoteId = 'note1';
    if (score >= 0.95) await assert.rejects(handleContent(f.ctx), error => error.code === 'WORK_MODERATION_REJECTED'); else await handleContent(f.ctx);
    assert.equal(hasPublicWrite(f), score < 0.65);
    assert.equal(f.statements.some(({ sql }) => sql.startsWith('UPDATE community_submission SET "pendingRevision"')), score === 0.7);
    assert(!hasReward(f));
  });
});

test('policy, attachment identity, storage bytes and work version changes invalidate a preflight result', async t => {
  await t.test('policy', async t => { const f = await fixture(t, { onBegin: state => { state.settings = { enabled: true, sensitiveWords: ['new'] }; } }); await assert.rejects(handleContent(f.ctx), e => e.code === 'WORK_MODERATION_CHANGED'); assert(!hasPublicWrite(f)); });
  for (const [threshold, value] of [['reviewThreshold', 0.05], ['rejectThreshold', 0.98]]) await t.test(`changed ${threshold}`, async t => {
    const f = await fixture(t, { score: threshold === 'reviewThreshold' ? 0.1 : 0.96, onBegin: state => { state.settings = { ...state.settings, [threshold]: value }; } });
    await assert.rejects(handleContent(f.ctx), error => error.statusCode === 409 && error.code === 'WORK_MODERATION_CHANGED');
    assert(!f.statements.some(({ sql }) => sql.startsWith('INSERT'))); assert(!hasPublicWrite(f)); assert(!hasReward(f));
  });
  await t.test('equivalent default thresholds remain valid', async t => {
    const f = await fixture(t, { onBegin: state => { state.settings = { ...state.settings, reviewThreshold: 0.65, rejectThreshold: 0.95 }; } });
    await handleContent(f.ctx); assert(hasPublicWrite(f));
  });
  await t.test('enabled during disabled preflight', async t => { const f = await fixture(t, { settings: { enabled: false, sensitiveWords: [] }, onBegin: state => { state.settings = { enabled: true, sensitiveWords: [] }; } }); await assert.rejects(handleContent(f.ctx), e => e.code === 'WORK_MODERATION_CHANGED'); assert(!hasPublicWrite(f)); });
  await t.test('attachment', async t => { const f = await fixture(t, { onBegin: (_state, _row, files) => { files[0].md5 = 'changed'; } }); await assert.rejects(handleContent(f.ctx), e => e.code === 'WORK_MODERATION_CHANGED'); assert(!hasPublicWrite(f)); });
  await t.test('bytes', async t => { const f = await fixture(t); const prepared = await prepareWorkModeration(f.ctx, 'owner1', revision); await writeFile(join(f.ctx.filesRoot, 'image-key'), 'replacement'); await assert.rejects(commitWorkModeration(f.ctx, f.ctx.db, prepared), e => e.code === 'WORK_MODERATION_CHANGED'); });
  await t.test('version', async t => { const f = await fixture(t, { method: 'PATCH', path: '/api/works/work1', body: { version: 2 }, onBegin: (_state, row) => { row.version = 3; } }); await assert.rejects(handleContent(f.ctx), e => e.statusCode === 409); assert(!hasPublicWrite(f)); });
});

test('unauthorized attachments are rejected before contacting the detector', async t => {
  const f = await fixture(t, { files: [{ ...file, userId: 'someoneElse' }] });
  await assert.rejects(handleContent(f.ctx), e => e.statusCode === 400); assert.equal(f.state.calls, 0); assert(!hasPublicWrite(f));
});

test('source-comment works cannot bypass automatic rejection and human approval remains explicit', async t => {
  await t.test('source comment', async t => {
    const f = await fixture(t, { score: 0.99, body: { destination: 'source-comment', resultId: 'result1', model: 'model1', generation: { model: 'model1', sourceWorkId: 'source1', prompt: 'Landscape' } } });
    await assert.rejects(handleContent(f.ctx), e => e.code === 'WORK_MODERATION_REJECTED'); assert(!hasPublicWrite(f));
  });
  await t.test('explicit moderator approval', async t => {
    const f = await fixture(t, { score: 0.99, admin: true, path: '/api/admin/submissions/work1/review', body: { version: 2, action: 'approve' } });
    await handleContent(f.ctx); assert(hasPublicWrite(f)); assert.equal(f.state.calls, 0);
  });
});

test('missing service configuration cannot publish an unchecked image', async t => {
  const f = await fixture(t); delete process.env.COMMUNITY_MODERATION_TOKEN;
  await handleContent(f.ctx); assert(!hasPublicWrite(f)); assert.equal(f.state.calls, 0);
});

test('a detector timeout aborts the request and keeps the work private', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t, { fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    t.mock.timers.tick(12001);
  }) });
  await handleContent(f.ctx); assert(!hasPublicWrite(f)); assert(!hasReward(f)); assert.equal(f.state.calls, 1);
});

test('storage keys cannot cause the detector to read outside the authorized media directory', async t => {
  const f = await fixture(t, { files: [{ ...file, accessKey: '../private-key' }] });
  await handleContent(f.ctx); assert(!hasPublicWrite(f)); assert.equal(f.state.calls, 0);
});
