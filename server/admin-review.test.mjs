import assert from 'node:assert/strict'
import test from 'node:test'
import { handleContent } from './content.ts'

function fixture(path, actor = { id: '17', isModerator: true }) {
  const statements = []
  let payload
  const query = async (sql, parameters = []) => {
    statements.push({ sql, parameters })
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 101 }] }
    if (sql.includes('FROM community_submission s')) {
      const requestedLimit = parameters.at(-1) - 1
      return { rows: Array.from({ length: requestedLimit + 1 }, (_, index) => ({
        id: `work${String(200 - index).padStart(4, '0')}`,
        authorId: '42', authorName: '作者', authorUsername: 'creator',
        category: 'resource', title: `作品 ${index}`, text: '内容', fileIds: [], tagIds: [],
        destination: 'community', submittedAt: '2026-11-14T00:00:00Z',
        status: 'pending', version: 1, generation: null, approvedNoteId: null,
      })) }
    }
    if (sql.includes('FROM external_account')) return { rows: [] }
    assert.fail(`Unexpected query ${sql}`)
  }
  return {
    statements, payload: () => payload,
    ctx: {
      req: { method: 'GET' }, url: new URL(path, 'https://community.example'),
      config: { url: 'https://community.example', newApiSso: { issuer: 'https://accounts.example' } },
      db: { query }, user: actor, body: {},
      requireUser() { if (!actor) throw Object.assign(new Error('Sign in required'), { statusCode: 401 }); return actor },
      json(status, body) { assert.equal(status, 200); payload = body },
    },
  }
}

test('review status and search filter before pagination while pending total remains independent', async () => {
  const { ctx, statements, payload } = fixture('/api/admin/submissions?status=pending&query=older%25&cursor=work0200&limit=30')
  await handleContent(ctx)
  const page = statements.find(item => item.sql.includes('ORDER BY'))
  assert(page.sql.includes(`s.status = 'pending' OR s."pendingRevision" IS NOT NULL`))
  assert(page.sql.includes('s.id<'))
  assert(page.sql.includes('ILIKE'))
  assert(page.parameters.includes('%older\\%%'))
  assert(page.parameters.includes('work0200'))
  assert.equal(page.parameters.at(-1), 31)
  assert.equal(payload().items.length, 30)
  assert.equal(payload().nextCursor, 'work0171')
  assert.equal(payload().pendingCount, 101)
  const total = statements.find(item => item.sql.includes('COUNT(*)::int AS count'))
  assert(!total.sql.includes('ILIKE'))
  assert(!total.sql.includes('s.id<'))
})

test('review default is bounded and ordinary users cannot read global pending totals', async () => {
  const allowed = fixture('/api/admin/submissions')
  await handleContent(allowed.ctx)
  assert.equal(allowed.payload().items.length, 30)
  for (const actor of [null, { id: '42', isAdmin: false, isModerator: false }]) {
    const denied = fixture('/api/admin/submissions', actor)
    await assert.rejects(handleContent(denied.ctx), error => [401, 403].includes(error.statusCode))
    assert.equal(denied.statements.length, 0)
  }
})

test('admin displayed statuses include approved published works and removed rejected works', async () => {
  for (const [status, expected] of [
    ['published', `(s.status='published' OR (s.status='approved' AND s."approvedNoteId" IS NOT NULL))`],
    ['rejected', `s.status IN ('rejected','removed')`],
  ]) {
    const result = fixture(`/api/admin/submissions?status=${status}`)
    await handleContent(result.ctx)
    assert(result.statements.find(item => item.sql.includes('ORDER BY')).sql.replace(/\s*([=,])\s*/g, '$1').includes(expected))
  }
})
