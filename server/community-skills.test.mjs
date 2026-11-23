import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'
import { ZipFile } from 'yazl'
import { readSkillPackage, skillDocument } from './skill-package.ts'
import { approvedCommunitySkills, handleCommunitySkills } from './community-skills.ts'

const document = '---\nname: image-composition\ndescription: 构图建议\n---\n先分析主体，再给出构图建议。\n'
async function zip(entries) {
  const writer = new ZipFile(), chunks = []
  for (const [name, value, options] of entries) writer.addBuffer(Buffer.from(value), name, options)
  writer.end()
  for await (const chunk of writer.outputStream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
test('Markdown and full ZIP retain references and scripts without executing them; edits and retries are deterministic', async () => {
  assert.equal((await readSkillPackage('SKILL.md', Buffer.from(document))).name, 'image-composition')
  const source = await zip([['pack/SKILL.md', document], ['pack/references/guide.md', 'guide'], ['pack/scripts/task.js', 'throw new Error("must not execute")']])
  const edited = document.replace('构图建议', '新版构图')
  const a = await readSkillPackage('skill.zip', source, edited), b = await readSkillPackage('skill.zip', source, edited)
  assert.deepEqual(a.archive, b.archive)
  assert.deepEqual(a.files.map(file => file.path), ['pack/SKILL.md', 'pack/references/guide.md', 'pack/scripts/task.js'])
  assert.equal((await readSkillPackage('download.zip', a.archive)).body, edited)
  assert.equal((await readSkillPackage('download.zip', a.archive)).sha256, a.sha256)
})
test('invalid documents, unsafe ZIP paths, duplicate documents, secrets, symlinks and bombs are rejected', async () => {
  for (const value of ['', 'no metadata', '---\nname: test\n---\nbody', '---\nname: &a [*a]\ndescription: test\n---\nbody', document + '\0']) assert.throws(() => skillDocument(Buffer.from(value)))
  assert.throws(() => skillDocument(Buffer.from([0xff, 0xff])))
  assert.throws(() => skillDocument(Buffer.alloc(65537, 97)))
  for (const entries of [
    [['guide.md', 'no skill']], [['SKILL.md', document], ['other/SKILL.md', document]],
    [['SKILL.md', document], ['.env', 'SECRET=never-store']],
    [['SKILL.md', document], ['x.md', 'a'], ['X.md', 'b']],
    [['SKILL.md', document], ['link', 'target', { mode: 0o120777 }]],
    [['SKILL.md', document], ['huge.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 97)]],
    [['SKILL.md', document], ...Array.from({ length: 200 }, (_, i) => [`file${i}.md`, 'a'])],
  ]) await assert.rejects(readSkillPackage('bad.zip', await zip(entries)), error => error.statusCode === 400)
  const valid = await zip([['SKILL.md', document], ['safe/file', 'x']])
  const traversal = Buffer.from(valid.toString('latin1').replaceAll('safe/file', '../x/file'), 'latin1')
  await assert.rejects(readSkillPackage('bad.zip', traversal))
  await assert.rejects(readSkillPackage('bad.zip', Buffer.from('not zip')))
})

test('skills moderation, privacy, idempotency and quotas in real PostgreSQL', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL, url = new URL(connectionString)
  assert.equal(url.pathname, '/community_follow_test')
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || process.env.CI === 'true' && url.hostname === 'postgres')
  const schema = `skills_test_${randomBytes(6).toString('hex')}`, control = new pg.Pool({ connectionString })
  await control.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 })
  t.after(async () => { await db.end(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end() })
  await db.query(`CREATE TABLE "user" (id varchar(32) PRIMARY KEY,name text,"isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false);
    CREATE TABLE external_account (issuer text,subject text,username text,"userId" varchar(32));
    CREATE TABLE moderation_log (id text,"userId" text,type text,info jsonb);
    INSERT INTO "user" (id,name) VALUES ('alice','Alice'),('bob','Bob'),('admin','Admin');`)
  const migration = await readFile(new URL('../migration/20261123-community-skills.up.sql', import.meta.url), 'utf8')
  await db.query(migration)
  const alice = { id: 'alice', accountId: '17' }, bob = { id: 'bob', accountId: '18' }, admin = { id: 'admin', isAdmin: true }
  let rate = 1
  async function request(method, path, user, body = {}, headers = {}) {
    let result; const responseHeaders = {}
    const ctx = { db, user, body, url: new URL(path, 'https://community.test'), req: { method, headers },
      config: { url: 'https://community.test', newApiSso: { issuer: 'https://accounts.test' } },
      redis: { eval: async () => rate }, newId: () => randomBytes(12).toString('hex'),
      requireUser() { if (!user) throw Object.assign(new Error('login'), { statusCode: 401 }); return user },
      requireAdmin() { if (!user?.isAdmin) throw Object.assign(new Error('admin'), { statusCode: 403 }); return user },
      json(status, data) { result = { status, data } },
      reply: { header(key, value) { responseHeaders[key] = value; return this }, send(data) { result = { status: 200, data, headers: responseHeaders } } } }
    assert.equal(await handleCommunitySkills(ctx), true)
    return result
  }
  const payload = () => ({ name: '构图技能', description: '作品构图分析', body: document, requestId: randomUUID(), upload: { filename: 'SKILL.md', data: Buffer.from(document).toString('base64') } })
  const fails = (promise, code) => assert.rejects(promise, error => error.statusCode === code)
  const detail = async (id, user = alice, manage = false) => (await request('GET', `/api/${manage ? 'admin/' : ''}skills/${id}`, user)).data.skill
  const create = payload(), saved = (await request('POST', '/api/skills', alice, create)).data
  const id = saved.id
  await t.test('pending is private even when regular works allow immediate publication', async () => {
    assert.equal(saved.status, 'pending')
    assert.equal((await request('GET', '/api/skills')).data.items.length, 0)
    assert.equal((await request('GET', '/api/skills?scope=mine', alice)).data.items.length, 1)
    assert.equal((await detail(id)).body, document)
    for (const actor of [undefined, bob]) for (const suffix of ['', '/download']) await fails(request('GET', `/api/skills/${id}${suffix}`, actor), 404)
    await fails(request('POST', '/api/skills', undefined, payload()), 401)
    await fails(request('GET', '/api/admin/skills', alice), 403)
    await fails(request('POST', '/api/skills', alice, { ...payload(), publish: true }), 400)
    await fails(request('PATCH', `/api/skills/${id}`, bob, { name: 'x', description: 'y', body: document, version: 1 }), 404)
    await fails(request('GET', '/api/skills?scope=mine', alice, {}, { 'x-new-api-user': '18' }), 409)
  })
  await t.test('concurrent retries create only one skill and the additive migration preserves it', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/api/skills', alice, create)))
    assert(results.every(result => result.data.id === id))
    assert.equal((await db.query('SELECT count(*)::int AS n FROM community_skill')).rows[0].n, 1)
    await fails(request('POST', '/api/skills', alice, { ...create, name: 'different' }), 409)
    await db.query(migration)
    assert.equal((await detail(id)).body, document)
  })
  await t.test('approval enables list/catalog/download; user edits require review and invalidate old versions', async () => {
    await request('POST', `/api/admin/skills/${id}/review`, admin, { action: 'approve', version: 1 })
    assert.equal((await request('GET', '/api/skills')).data.items.length, 1)
    assert.equal((await approvedCommunitySkills(db))[0].id, `community-${id}`)
    const download = await request('GET', `/api/skills/${id}/download`)
    assert.equal(download.data.toString(), document)
    assert.equal(download.headers['X-Content-Type-Options'], 'nosniff')
    assert.match(download.headers['Content-Disposition'], /^attachment/)
    assert.match(download.headers['Cache-Control'], /no-store/)
    await fails(request('POST', `/api/admin/skills/${id}/review`, admin, { action: 'reject', reason: 'old', version: 1 }), 409)
    await request('PATCH', `/api/skills/${id}`, alice, { name: 'new', description: 'new', body: document + '新增规则', version: 2 })
    assert.equal((await detail(id)).status, 'pending')
    assert.equal((await approvedCommunitySkills(db)).length, 0)
    await fails(request('GET', `/api/skills/${id}`), 404)
    await fails(request('POST', `/api/admin/skills/${id}/review`, admin, { action: 'reject', version: 3 }), 400)
    await request('POST', `/api/admin/skills/${id}/review`, admin, { action: 'reject', reason: '请补充来源', version: 3 })
    assert.equal((await detail(id)).reviewNote, '请补充来源')
  })
  await t.test('admin ZIP upload and edit retain attachments; removed and suspended skills are inaccessible', async () => {
    const archive = await zip([['SKILL.md', document], ['scripts/run.py', 'print("unused")']])
    const item = (await request('POST', '/api/admin/skills', admin, { ...payload(), publish: true, upload: { filename: 'tool.zip', data: archive.toString('base64') } })).data
    let skill = await detail(item.id, undefined)
    assert.equal(skill.official, true); assert.equal(skill.files.length, 2)
    await request('PATCH', `/api/admin/skills/${item.id}`, admin, { name: 'edited', description: 'edited', body: document + 'edited', publish: true, version: 1 })
    skill = await detail(item.id, undefined)
    assert.equal(skill.version, 2); assert.equal(skill.files.length, 2)
    const pack = await request('GET', `/api/skills/${item.id}/download`)
    assert.equal((await readSkillPackage('tool.zip', pack.data)).body, document + 'edited')
    await db.query('UPDATE "user" SET "isSuspended"=true WHERE id=\'admin\'')
    await fails(request('GET', `/api/skills/${item.id}`), 404)
    assert.equal((await approvedCommunitySkills(db)).length, 0)
    await db.query('UPDATE "user" SET "isSuspended"=false WHERE id=\'admin\'')
    await request('POST', `/api/admin/skills/${item.id}/review`, admin, { action: 'remove', reason: '更新内容', version: 2 })
    await fails(request('GET', `/api/skills/${item.id}/download`), 404)
    await fails(request('DELETE', `/api/skills/${item.id}`, bob, { version: 3 }), 404)
    await request('DELETE', `/api/admin/skills/${item.id}`, admin, { version: 3 })
    await fails(request('GET', `/api/admin/skills/${item.id}`, admin), 404)
  })
  await t.test('quota and rate limits are enforced without extra writes', async () => {
    await db.query(`INSERT INTO community_skill SELECT 'quota'||n,"authorId",name,description,body,sha256,filename,archive,size,files,status,official,'quota-request-'||n,"requestHash",version,"reviewNote","reviewedBy","createdAt","updatedAt" FROM community_skill CROSS JOIN generate_series(1,99) n WHERE id=$1`, [id])
    await fails(request('POST', '/api/skills', alice, payload()), 413)
    rate = 61
    await fails(request('POST', '/api/skills/inspect', alice, create.upload), 429)
    assert((await db.query('SELECT count(*)::int AS n FROM moderation_log')).rows[0].n >= 7)
  })
})
