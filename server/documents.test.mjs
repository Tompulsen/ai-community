import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { handleDocuments } from './documents.ts'

const plan = { schemaVersion: 1, kind: 'create_word', fileName: '会议.docx', blocks: [{ type: 'paragraph', text: '会议内容' }] }
const request = { sessionId: 'chat-a', instruction: '制作会议文档', model: 'text-model', provider: 'community', format: 'docx' }
function env(t, key, value) {
  const original = process.env[key]
  process.env[key] = value
  t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original })
}
function context(path = 'capabilities', method = 'GET', body = {}) {
  const result = { status: 0, data: null, headers: {}, stream: null }
  const ctx = { url: new URL('https://community.test/api/documents/' + path), req: { method, headers: { 'x-new-api-user': '17' } },
    body, user: { id: 'profile', accountId: '17' }, requireUser() { if (!this.user) throw Object.assign(new Error('Login required'), { status: 401 }); return this.user },
    redis: { eval: async () => 1 }, json(status, data) { result.status = status; result.data = data },
    reply: { header(key, value) { result.headers[key] = value; return this }, send(stream) { result.stream = stream } },
  }
  return { ctx, result }
}
test('document proxy keeps private owners and service credentials server-side', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const { ctx, result } = context('assets?sessionId=chat-a')
  ctx.req.headers['x-document-owner'] = 'user-99'; ctx.req.headers.authorization = 'Bearer attacker'
  await handleDocuments(ctx, async (url, init) => {
    assert.equal(url.href, 'http://documents:3010/assets?sessionId=chat-a')
    assert.equal(init.headers['X-Document-Owner'], 'user-17'); assert.equal(init.headers.Authorization, 'Bearer ' + 's'.repeat(40))
    return Response.json({ assets: [] })
  })
  assert.equal(result.status, 200); assert.deepEqual(result.data, { assets: [] })
})
test('guest, stale account, cross-site and unknown routes never reach documents', async () => {
  let calls = 0
  const fetcher = async () => { calls++; return Response.json({}) }
  const { ctx } = context()
  ctx.user = null; await assert.rejects(() => handleDocuments(ctx, fetcher), { status: 401 })
  ctx.user = { accountId: '17' }; ctx.req.headers['x-new-api-user'] = '99'; await assert.rejects(() => handleDocuments(ctx, fetcher), { statusCode: 409 })
  ctx.req.headers['x-new-api-user'] = '17'; ctx.req.headers['sec-fetch-site'] = 'cross-site'; await assert.rejects(() => handleDocuments(ctx, fetcher), { statusCode: 403 })
  assert.equal(await handleDocuments(context('assets/../../secret').ctx, fetcher), false)
  assert.equal(await handleDocuments(context('jobs/not-a-uuid').ctx, fetcher), false); assert.equal(calls, 0)
})
test('unconfigured engine reports unavailable without a paid path', async t => {
  env(t, 'DOCUMENT_SERVICE_SECRET', '')
  const { ctx, result } = context()
  await handleDocuments(ctx, () => assert.fail('No upstream calls'))
  assert.equal(result.data.enabled, false)
})
test('valid plans preserve the task id and reject extra executable fields before forwarding', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const key = randomUUID(), { ctx } = context('jobs', 'POST', { key, request, plan })
  await handleDocuments(ctx, async (_, init) => { assert.equal(init.headers['Idempotency-Key'], key); assert.equal(JSON.parse(init.body).request.model, 'text-model'); return Response.json({ status: 'queued' }, { status: 202 }) })
  ctx.body.plan = { ...plan, script: 'process.exit()' }; await assert.rejects(() => handleDocuments(ctx, () => assert.fail('Invalid plan forwarded')), { statusCode: 400 })
})
test('uploads decode actual ZIP bytes and reject traversal, non-ZIP and oversized data', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const { ctx } = context('upload', 'POST', { key: randomUUID(), sessionId: 'chat-a', fileName: '原件.docx', data: Buffer.from([80, 75, 3, 4, 1]).toString('base64') })
  await handleDocuments(ctx, async (_, init) => { assert.deepEqual([...init.body], [80,75,3,4,1]); assert.equal(init.headers['X-File-Name'], encodeURIComponent('原件.docx')); return Response.json({ status: 'queued' }) })
  for (const data of ['AAAA', 'data:application/zip;base64,UEsDBA==', 'A'.repeat(28 * 1024 ** 2)]) {
    ctx.body.data = data; await assert.rejects(() => handleDocuments(ctx, () => assert.fail('Invalid upload forwarded')), { statusCode: 400 })
  }
})
test('busy and unavailable responses remain retriable without exposing the secret', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const { ctx, result } = context('jobs', 'POST', { key: randomUUID(), request, plan })
  await handleDocuments(ctx, async () => Response.json({ error: '正在处理其他文件' }, { status: 429 }))
  assert.equal(result.status, 429); assert.match(result.data.error.message, /其他文件/)
  await assert.rejects(() => handleDocuments(ctx, async () => { throw new Error('Bearer SECRET') }), error => error.statusCode === 502 && !error.message.includes('SECRET'))
})

test('a valid 20 MiB Office upload does not overflow base64 validation', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const file = Buffer.alloc(20 * 1024 * 1024, 1); file.writeUInt32LE(0x04034b50)
  const { ctx } = context('upload', 'POST', { key: randomUUID(), sessionId: 'chat-a', fileName: '大文件.xlsx', data: file.toString('base64') })
  await handleDocuments(ctx, async (_, init) => { assert.equal(init.body.byteLength, file.length); return Response.json({ status: 'queued' }, { status: 202 }) })
})
test('download retains MIME and filename and uses private no-store streaming', async t => {
  env(t, 'DOCUMENT_SERVICE_URL', 'http://documents:3010'); env(t, 'DOCUMENT_SERVICE_SECRET', 's'.repeat(40))
  const { ctx, result } = context(`assets/${randomUUID()}/1/download`)
  await handleDocuments(ctx, async () => new Response('file-bytes', { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename=file.docx', 'Content-Length': '10' } }))
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  let text = ''; for await (const chunk of result.stream) text += chunk.toString()
  assert.equal(text, 'file-bytes'); assert.match(result.headers['content-disposition'], /file.docx/)
})
