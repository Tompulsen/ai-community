import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleContent } from './content.ts'

const owner = { id: 'owner1', host: null, isAdmin: false, isModerator: false }
const admin = { id: 'admin1', host: null, isAdmin: true, isModerator: true }
function fixture(actor = owner, overrides = {}) {
  const state = { work: { id: 'work1', authorId: 'owner1', authorName: '作者', authorUsername: 'owner',
    category: 'image', title: '原作品', text: '简介', model: '', sourceUrl: '', license: '', destination: 'community',
    status: 'approved', approvedNoteId: 'note1', version: 2, submittedAt: new Date('2026-11-22'), firstPublishedAt: new Date('2026-11-22'),
    fileIds: ['image1'], tagIds: ['tag1'], generation: { prompt: '原提示词', model: '', referenceFileIds: ['ref1'] } },
    mode: 'before', audits: [], deletedNotes: [], failAudit: false, authorActive: true, uploadWorkExists: true, ...overrides }
  const files = [{ id: 'image1', userId: 'owner1', type: 'image/png', name: '作品.png', storedInternal: true },
    { id: 'ref1', userId: 'owner1', type: 'image/png', name: '参考.png', storedInternal: true },
    { id: 'foreign1', userId: 'third1', type: 'image/png', storedInternal: true }]
  let snapshot, sequence = 0, result
  const statements = []
  const query = async (sql, args = []) => {
    const s = sql.trim(); statements.push({ sql: s, args })
    if (s === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] } }
    if (s === 'COMMIT') return { rows: [] }
    if (s === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] } }
    if (s.includes('FROM community_submission s')) return { rows: state.work ? [structuredClone(state.work)] : [] }
    if (s.startsWith('SELECT id FROM community_submission')) return { rows: state.uploadWorkExists && state.work?.authorId === args[1] ? [{ id: state.work.id }] : [] }
    if (s.includes('FROM drive_file') && !s.includes('SUM(size)')) return { rows: files.filter(f => args[0].includes(f.id) && f.userId === args[1]) }
    if (s.includes('FROM community_tag')) return { rows: [{ id: 'tag1', name: '图片', category: 'image' }].filter(t => args[0].includes(t.id)) }
    if (s.includes('FROM external_account')) return { rows: [] }
    if (s.startsWith('SELECT u.id')) return { rows: [{ ...owner, username: 'owner', token: 'fixture-only', createdAt: new Date(), isDeleted: false,
      isSuspended: false, roles: [], assignedRoleIds: ['limited'], rootUserId: 'admin1' }] }
    if (s.includes('FROM meta')) return { rows: [{ rootUserId: 'admin1', clientOptions: { communityPublicationMode: state.mode }, policies: {} }] }
    if (s.includes('FROM role_assignment')) return { rows: args[0] === 'owner1' ? [{ roleId: 'limited' }] : [] }
    if (s.includes('FROM role')) return { rows: s.includes('policies') ? [{ id: 'limited', target: 'manual', policies: { maxFileSizeMb: { value: 5, priority: 2 }, driveCapacityMb: { value: 10, priority: 2 } } }] : [] }
    if (s.startsWith('SELECT id,host')) return { rows: [owner] }
    if (s.startsWith('SELECT id FROM "user"')) return { rows: state.authorActive ? [{ id: 'owner1' }] : [] }
    if (s.startsWith('SELECT COALESCE(SUM(size)')) return { rows: [{ size: '0' }] }
    if (s.startsWith('SELECT id FROM note')) return { rows: [{ id: 'note1' }] }
    if (s.startsWith('UPDATE community_submission SET "pendingRevision"')) { state.work.pendingRevision = args[1]; state.work.version++; return { rows: [] } }
    if (s.startsWith('UPDATE community_submission SET category')) {
      Object.assign(state.work, { category: args[1], title: args[2], text: args[3], model: args[4], sourceUrl: args[5], license: args[6], fileIds: args[7], tagIds: args[8], generation: args[9], pendingRevision: args[10], status: args[11], approvedNoteId: args[12], version: state.work.version + 1 })
      return { rows: [] }
    }
    if (s.startsWith('INSERT INTO note')) return { rows: [] }
    if (s.includes('SET "firstPublishedAt"')) return { rows: [] }
    if (s.startsWith('UPDATE note SET')) return { rows: [] }
    if (s.startsWith('DELETE FROM note')) { state.deletedNotes.push(args[0]); return { rows: [{ userId: 'owner1', replyId: null, renoteId: null }] } }
    if (s.startsWith('UPDATE "user" SET')) return { rows: [{ id: 'owner1' }] }
    if (s.startsWith('DELETE FROM community_submission')) { state.work = null; return { rows: [] } }
    if (s.startsWith('INSERT INTO moderation_log')) {
      if (state.failAudit) throw new Error('audit failed')
      state.audits.push(args); return { rows: [] }
    }
    if (s.startsWith('INSERT INTO drive_file')) { state.upload = args; return { rows: [] } }
    assert.fail(`Unexpected query: ${s}`)
  }
  const ctx = { req: { method: 'PATCH', headers: {} }, res: {}, url: new URL('https://community.test/api/works/work1'),
    config: { url: 'https://community.test' }, user: actor, body: { version: 2, title: '新标题' },
    db: { query, connect: async () => ({ query, release() {} }) }, newId: () => `event${++sequence}`,
    requireUser() { if (!actor) throw Object.assign(new Error('Sign in'), { statusCode: 401 }); return actor },
    json(status, payload) { result = { status, payload } },
    request: { isMultipart: () => false }, redis: { async eval(...args) { state.reservation = JSON.parse(args[5]); return 1 }, async zrem() {} } }
  return { ctx, state, files, statements, result: () => result }
}
const writes = f => f.statements.filter(s => /^(INSERT|UPDATE|DELETE)/.test(s.sql))

for (const method of ['PATCH', 'DELETE']) {
  test(`${method} denies guests, other users, moderators and forged owner flags`, async () => {
    for (const actor of [null, { id: 'other1' }, { id: 'moderator1', isModerator: true }]) {
      const f = fixture(actor); f.ctx.req.method = method
      Object.assign(f.ctx.body, { authorId: actor?.id, owned: true, isAdmin: true })
      await assert.rejects(handleContent(f.ctx), { statusCode: actor ? 403 : 401 })
      assert.equal(writes(f).length, 0)
    }
  })
  test(`${method} rejects stale versions and changed login before changes`, async () => {
    for (const actor of [owner, admin]) {
      const stale = fixture(actor); stale.ctx.req.method = method; stale.ctx.body.version = 1
      await assert.rejects(handleContent(stale.ctx), { statusCode: 409 }); assert.equal(writes(stale).length, 0)
      const switched = fixture(actor); switched.ctx.req.method = method; switched.ctx.req.headers['x-new-api-user'] = 'previous1'
      await assert.rejects(handleContent(switched.ctx), { statusCode: 409 }); assert.equal(switched.statements.length, 0)
    }
  })
}

test('author and administrator edits keep authorship, media ownership, review policy and publication history', async () => {
  for (const actor of [owner, admin]) for (const mode of ['before', 'after']) {
    const f = fixture(actor, { mode }); const originalFirst = f.state.work.firstPublishedAt
    f.ctx.body = { ...f.ctx.body, authorId: 'impostor1', fileIds: ['image1'], referenceFileIds: ['ref1'] }
    await handleContent(f.ctx)
    assert.equal(f.result().status, 200)
    assert.equal(f.state.work.authorId, 'owner1'); assert.equal(f.state.work.firstPublishedAt, originalFirst)
    assert.equal(f.state.work.version, 3); assert.equal(f.state.work.approvedNoteId, 'note1')
    assert.equal(f.state.work.title, '新标题')
    assert.equal(f.state.work.pendingRevision, null)
    assert(f.statements.filter(s => s.sql.includes('FROM drive_file')).every(s => s.args[1] === 'owner1'))
    assert(!f.statements.some(s => /lottery|firstPublishedAt|INSERT INTO note/.test(s.sql)))
    assert.equal(f.state.audits.length, actor.isAdmin ? 1 : 0)
    if (actor.isAdmin) assert.deepEqual(f.state.audits[0].slice(1), ['admin1', 'communityWorkEdit', { submissionId: 'work1', userId: 'owner1', version: 2 }])
  }
})

test('administrator cannot attach private files of unrelated accounts', async () => {
  for (const field of ['fileIds', 'referenceFileIds']) {
    const f = fixture(admin); f.ctx.body[field] = ['foreign1']
    await assert.rejects(handleContent(f.ctx), { statusCode: 400 }); assert.equal(writes(f).length, 0)
  }
})

test('administrator preserves drafts and immediately publishes checked submissions and revisions', async () => {
  for (const status of ['draft', 'pending', 'rejected']) {
    const f = fixture(admin); Object.assign(f.state.work, { status, approvedNoteId: null, firstPublishedAt: null })
    if (status === 'draft') f.ctx.body.status = 'draft'
    await handleContent(f.ctx)
    assert.equal(f.state.work.title, '新标题'); assert.equal(f.state.work.status, status === 'draft' ? 'draft' : 'approved')
    assert.equal(Boolean(f.state.work.approvedNoteId), status !== 'draft')
  }
  const f = fixture(admin, { mode: 'after' }); f.state.work.pendingRevision = { ...f.state.work, title: '待审核版本' }
  await handleContent(f.ctx)
  assert.equal(f.state.work.title, '新标题'); assert.equal(f.state.work.pendingRevision, null)
})

test('author and administrator deletion preserve media and rewards, and administrator audit is transactional', async () => {
  for (const actor of [owner, admin]) {
    const f = fixture(actor); f.ctx.req.method = 'DELETE'
    await handleContent(f.ctx)
    assert.equal(f.state.work, null); assert.deepEqual(f.state.deletedNotes, ['note1'])
    assert.equal(f.files.length, 3); assert(!writes(f).some(s => /lottery|drive_file/.test(s.sql)))
    if (actor.isAdmin) assert.deepEqual(f.state.audits[0].slice(1), ['admin1', 'communityWorkDelete', { submissionId: 'work1', userId: 'owner1', version: 2 }])
  }
  for (const method of ['PATCH', 'DELETE']) {
    const f = fixture(admin, { failAudit: true, mode: 'after' }); f.ctx.req.method = method
    await assert.rejects(handleContent(f.ctx), /audit failed/)
    assert.equal(f.state.work.title, '原作品'); assert.equal(f.state.work.version, 2)
    assert.deepEqual(f.state.deletedNotes, [])
  }
})

test('delegated upload and limits require an administrator and a valid community work', async () => {
  for (const path of ['/api/uploads', '/api/uploads/limits']) {
    for (const actor of [null, owner, { id: 'moderator1', isModerator: true }]) {
      const f = fixture(actor); f.ctx.url = new URL(path + '?workId=work1', f.ctx.config.url); f.ctx.req.method = path.endsWith('limits') ? 'GET' : 'POST'
      await assert.rejects(handleContent(f.ctx), { statusCode: actor ? 403 : 401 }); assert.equal(f.statements.length, 0)
    }
  }
  const f = fixture(admin); f.ctx.url = new URL('/api/uploads/limits?workId=work1', f.ctx.config.url); f.ctx.req.method = 'GET'
  await handleContent(f.ctx)
  assert.equal(f.result().payload.maxFileSizeMb, 5)
  assert(f.statements.filter(s => s.sql.includes('role_assignment')).every(s => s.args[0] === 'owner1'))
  f.state.work.destination = 'source-comment'
  await assert.rejects(handleContent(f.ctx), { statusCode: 400 })
})

test('delegated upload stores files under the original author with quota and deletion/suspension race protection', async t => {
  for (const outcome of ['success', 'work-deleted', 'author-suspended']) await t.test(outcome, async t => {
    const f = fixture(admin, { uploadWorkExists: outcome !== 'work-deleted', authorActive: outcome !== 'author-suspended' })
    const dir = await mkdtemp(join(tmpdir(), 'work-admin-upload-'))
    t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir) })
    Object.assign(f.ctx, { filesRoot: dir, url: new URL('/api/uploads?workId=work1', f.ctx.config.url),
      body: { name: 'notes.txt', type: 'text/plain', data: Buffer.from('content').toString('base64') } })
    f.ctx.req.method = 'POST'
    if (outcome === 'success') {
      await handleContent(f.ctx)
      assert.equal(f.result().status, 201); assert.equal(f.state.upload[1], 'owner1')
      assert.equal(f.state.reservation[0], 'owner1')
      const workLock = f.statements.findIndex(s => s.sql.includes('FOR SHARE'))
      assert(workLock < f.statements.findIndex(s => s.sql.startsWith('SELECT id FROM "user"')))
    } else {
      await assert.rejects(handleContent(f.ctx), { statusCode: outcome === 'work-deleted' ? 409 : 403 })
      assert.equal(f.state.upload, undefined); assert.deepEqual(await readdir(dir), [])
    }
  })
})
