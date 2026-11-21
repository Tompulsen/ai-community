import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { handleContent, readWorkCursor, publicVisibilitySql } from './content.ts'

function context(db, body = {}, actor = 'reader') {
  const result = {}
  return { db, req: { method: 'POST' }, url: new URL('https://community.test/api/works/feed'), body: { seed: 'test-batch', ...body },
    user: actor ? { id: actor } : null, config: { url: 'https://community.test', id: 'aidx' }, result,
    requireUser() { if (!this.user) throw Object.assign(new Error('login'), { statusCode: 401 }); return this.user },
    json(status, payload) { result.status = status; result.payload = payload } }
}
test('feed validates bounds before querying and never writes preference or search history', async () => {
  const statements = [], db = { async query(sql, params = []) {
    statements.push(sql)
    assert(sql.trim().startsWith('SELECT'))
    for (let i = 1; i <= params.length; i++) assert(new RegExp(`\\$${i}(?!\\d)`).test(sql), `unused parameter ${i}`)
    return { rows: [] }
  } }
  for (const sort of ['recommended', 'latest', 'featured', 'following']) {
    const ctx = context(db, { sort, query: '海报', tag: 'tag1', kind: 'image', interests: [{ kind: 'image', name: '海报', score: 3 }], previous: ['work1'], seen: ['work2'] })
    await handleContent(ctx)
    const sql = statements.findLast(value => value.includes('FROM community_submission s'))
    assert(sql.includes(publicVisibilitySql)); assert(sql.includes('t.name')); assert(sql.includes('s.category ='))
    assert.equal(ctx.result.payload.replaced, false)
  }
  await assert.rejects(handleContent(context(db, { seen: Array(121).fill('work1') })), { statusCode: 400 })
  await assert.rejects(handleContent(context(db, { sort: 'following' }, null)), { statusCode: 401 })
  const cursor = Buffer.from(JSON.stringify({ v: 1, id: 'w1', order: 'hot', remaining: ['../bad'], context: 'a'.repeat(64), anchor: Date.now() })).toString('base64url')
  assert.throws(() => readWorkCursor(cursor), { statusCode: 400 })
})

test('discovery PostgreSQL replacement, ranking, stable pages and permissions', { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  assert.equal(new URL(connectionString).pathname, '/community_follow_test')
  const schema = `discovery_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Pool({ connectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ connectionString, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
  await db.query(`CREATE TABLE "user" (id varchar(32) PRIMARY KEY, username text, name text, "avatarId" varchar(32), host text,
    "isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text,"requireSigninToViewContents" boolean DEFAULT false,
    "makeNotesHiddenBefore" bigint,"makeNotesFollowersOnlyBefore" bigint);
    CREATE TABLE meta ("ugcVisibilityForVisitor" text DEFAULT 'all', "clientOptions" jsonb DEFAULT '{}');
    CREATE TABLE blocking ("blockerId" varchar(32),"blockeeId" varchar(32));
    CREATE TABLE following ("followerId" varchar(32),"followeeId" varchar(32));
    CREATE TABLE external_account (issuer text,subject text,username text,"userId" varchar(32));
    CREATE TABLE community_tag (id varchar(32),name text,category text,"isDeleted" boolean DEFAULT false);
    CREATE TABLE note (id varchar(32) PRIMARY KEY,visibility text DEFAULT 'public',"userId" varchar(32),"repliesCount" int DEFAULT 0,"renoteCount" int DEFAULT 0,
      reactions jsonb DEFAULT '{}',"renoteId" varchar(32),text text,"replyId" varchar(32),"fileIds" varchar[] DEFAULT '{}');
    CREATE TABLE note_reaction ("noteId" varchar(32),"userId" varchar(32),reaction text);
    CREATE TABLE note_favorite ("noteId" varchar(32),"userId" varchar(32));
    CREATE TABLE community_submission (id varchar(32) PRIMARY KEY,"authorId" varchar(32),"approvedNoteId" varchar(32),status text DEFAULT 'published',
      destination text DEFAULT 'community',category text DEFAULT 'image',"tagIds" varchar[] DEFAULT '{}',"fileIds" varchar[] DEFAULT '{}',
      title text DEFAULT 'test',text text DEFAULT '',generation jsonb,"submittedAt" timestamptz,version int DEFAULT 1);
    INSERT INTO meta DEFAULT VALUES;
    INSERT INTO "user" (id,username) VALUES ('author','author'),('reader','reader'),('other','other');
    INSERT INTO following VALUES ('reader','author');
    INSERT INTO community_tag (id,name,category) VALUES ('tag1','海报','image'),('tag2','风景','image');`)
  async function reset(count = 35) {
    await db.query('TRUNCATE community_submission,note,blocking,note_reaction,note_favorite')
    await db.query(`INSERT INTO note (id,"userId","repliesCount") SELECT 'n'||i,'author',i FROM generate_series(1,$1::int) i;
    `.trim(), [count])
    await db.query(`INSERT INTO community_submission (id,"authorId","approvedNoteId","tagIds","submittedAt")
      SELECT 'w'||lpad(i::text,4,'0'),'author','n'||i,ARRAY[CASE WHEN i%2=0 THEN 'tag1' ELSE 'tag2' END],now()-i*interval '1 hour' FROM generate_series(1,$1::int) i`, [count])
  }
  async function call(body = {}, actor = 'reader') { const ctx = context(db, body, actor); await handleContent(ctx); return ctx.result.payload }
  await t.test('each mode replaces the first page, with old catalogue works eligible beyond the previous pool', async () => {
    await reset(35)
    for (const sort of ['recommended', 'latest', 'featured', 'following']) {
      const first = await call({ sort }), previous = first.items.map(item => item.id)
      const refreshed = await call({ sort, previous, seen: previous })
      assert.equal(first.items.length, 12); assert.equal(refreshed.replaced, true)
      assert(refreshed.items.every(item => !previous.includes(item.id)))
    }
    await reset(13)
    const result = await call({ previous: Array.from({ length: 12 }, (_, i) => `w${String(i + 1).padStart(4, '0')}`) })
    assert.equal(result.items[0].id, 'w0013')
  })
  await t.test('interest, recent publication and hot ranks match their purpose', async () => {
    await reset(35)
    const personalized = await call({ interests: [{ kind: 'image', name: '海报', score: 100 }] })
    assert(personalized.items.every(item => item.tags.includes('海报')))
    assert.equal((await call({ sort: 'latest' })).items[0].id, 'w0001')
    assert.equal((await call({ sort: 'featured' })).items[0].id, 'w0035')
  })
  await t.test('cross-category labels remain searchable and contribute to image interests', async () => {
    await reset(35)
    await db.query("UPDATE community_tag SET category='video' WHERE id='tag1'")
    try {
      for (const filters of [{ tag: 'tag1' }, { query: '海报' }, { interests: [{ kind: 'image', name: '海报', score: 100 }] }]) {
        const result = await call({ kind: 'image', ...filters })
        assert.equal(result.items.length, 12)
        assert(result.items.every(item => item.kind === 'image' && item.tags.includes('海报') && item.tagIds.includes('tag1')))
      }
    } finally { await db.query("UPDATE community_tag SET category='image' WHERE id='tag1'") }
  })
  await t.test('all modes retain pages after heat changes and deletion of the cursor item; context changes reject', async () => {
    for (const sort of ['recommended', 'latest', 'featured', 'following']) {
      await reset(35)
      const first = await call({ sort }), ids = new Set(first.items.map(item => item.id))
      await db.query('DELETE FROM community_submission WHERE id=$1', [first.items.at(-1).id])
      await db.query('UPDATE note SET "repliesCount"=1000-"repliesCount"')
      let cursor = first.nextCursor
      for (let page = 0; cursor && page < 10; page++) {
        const value = await call({ sort, cursor }); cursor = value.nextCursor
        for (const item of value.items) { assert(!ids.has(item.id), `${sort}: duplicate ${item.id}`); ids.add(item.id) }
      }
      assert.equal(ids.size, 35)
      await assert.rejects(call({ sort, cursor: first.nextCursor, tag: '海报' }), { statusCode: 409 })
    }
  })
  await t.test('visibility and filters apply to both ranked pages and the hot snapshot', async () => {
    await reset(35)
    const first = await call({ sort: 'featured', tag: '海报', kind: 'image' })
    assert(first.items.every(item => item.tags.includes('海报')))
    await db.query("INSERT INTO blocking VALUES ('reader','author')")
    assert.equal((await call({ sort: 'featured', tag: '海报', kind: 'image', cursor: first.nextCursor })).items.length, 0)
    assert.equal((await call({ sort: 'following' }, 'other')).items.length, 0)
    await db.query('UPDATE "user" SET "requireSigninToViewContents"=true')
    assert.equal((await call({}, null)).items.length, 0)
    await db.query('UPDATE "user" SET "requireSigninToViewContents"=false')
  })
  await t.test('zero, one and small inventories refill without inventing new content', async () => {
    for (const count of [0, 1, 5, 12]) {
      await reset(count)
      const first = await call(), previous = first.items.map(item => item.id)
      const next = await call({ previous })
      assert.equal(next.items.length, count); assert.equal(next.nextCursor, null)
      if (count) assert.equal(next.replaced, false)
    }
  })
})
