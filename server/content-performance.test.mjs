import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { handleContent } from './content.ts'

function fixture(path, method = 'GET') {
  const statements = [], result = {}
  const row = {
    id: 'work1', authorId: 'author1', authorName: 'Creator', authorUsername: 'creator',
    authorAvatarId: 'avatar1', category: 'resource', title: 'A resource', model: 'model1',
    text: 'First paragraph.\n\nSecond paragraph.\nThird paragraph.\n' + 'Large body '.repeat(1200),
    sourceUrl: 'https://source.example', license: 'CC-BY', fileIds: ['file1'], tagIds: ['tag1'],
    generation: { prompt: 'Large prompt '.repeat(1200), model: 'model1', referenceFileIds: ['reference1'],
      parameters: { size: '1024x1024' } },
    submittedAt: '2026-11-23T00:00:00Z', status: 'published', destination: 'community',
    approvedNoteId: 'note1', sourceCommentId: null, version: 3, viewsCount: 42,
    likes: 8, liked: true, saved: false,
  }
  const ctx = {
    req: { method, headers: {} }, res: {}, url: new URL(path, 'https://community.example'),
    body: { seed: 'performance', sort: 'latest' }, user: null,
    config: { url: 'https://community.example', id: 'aidx' },
    db: { async query(sql, values = []) {
      statements.push({ sql, values })
      if (sql.includes('SELECT s.*')) return { rows: [row] }
      if (sql.includes('FROM drive_file')) return { rows: values[0].map(id => ({
        id, userId: 'author1', name: `${id}.png`, type: 'image/png', size: 100, storedInternal: true,
        thumbnailAccessKey: `thumbnail-${id}`, properties: { previewAspectRatio: 1.25 },
      })) }
      if (sql.includes('FROM community_tag')) return { rows: [{ id: 'tag1', name: 'Skill', category: 'resource' }] }
      return { rows: [] }
    } },
    json(status, payload) { result.status = status; result.payload = payload },
  }
  return { ctx, row, statements, result }
}

test('public card pages omit heavy detail fields and reference reads while full detail stays complete', async t => {
  const full = fixture('/api/works?sort=latest')
  await handleContent(full.ctx)
  const complete = full.result.payload.items[0]
  assert.equal(complete.body, full.row.text)
  assert.equal(complete.prompt, full.row.generation.prompt)
  assert.deepEqual(complete.referenceFiles.map(file => file.id), ['reference1'])
  for (const [path, method] of [['/api/works?sort=latest&view=card', 'GET'], ['/api/works/feed', 'POST']]) {
    const card = fixture(path, method)
    await handleContent(card.ctx)
    const summary = card.result.payload.items[0]
    for (const key of ['prompt', 'generation', 'referenceFiles', 'files', 'fileIds', 'sourceUrl', 'license']) {
      assert.equal(Object.hasOwn(summary, key), false, `${path} must omit ${key}`)
    }
    assert.equal(summary.body, 'First paragraph. Second paragraph. Third paragraph.')
    for (const key of ['id', 'title', 'author', 'authorId', 'kind', 'cover', 'coverAspectRatio', 'tags',
      'likes', 'liked', 'saved', 'date', 'owned', 'status', 'version']) assert.deepEqual(summary[key], complete[key], key)
    assert(!card.statements.find(item => item.sql.includes('FROM drive_file')).values[0].includes('reference1'))
    const fullBytes = Buffer.byteLength(JSON.stringify(full.result.payload))
    const cardBytes = Buffer.byteLength(JSON.stringify(card.result.payload))
    assert(cardBytes < fullBytes / 10)
    t.diagnostic(`${method} ${path}: ${fullBytes} -> ${cardBytes} bytes`)
  }
  const detail = fixture('/api/works/work1')
  await handleContent(detail.ctx)
  assert.equal(detail.result.payload.work.body, full.row.text)
  assert.equal(detail.result.payload.work.prompt, full.row.generation.prompt)
  assert.deepEqual(detail.result.payload.work.referenceFiles.map(file => file.id), ['reference1'])
})

test('PostgreSQL evaluates search matches and recommendation tag interests once per page', {
  skip: !process.env.FOLLOWING_TEST_DATABASE_URL, timeout: 20000,
}, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  const url = new URL(connectionString)
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || process.env.CI === 'true' && url.hostname === 'postgres')
  assert.equal(url.pathname, '/community_follow_test')
  const db = new pg.Client({ connectionString })
  await db.connect()
  const schema = `content_performance_${randomBytes(6).toString('hex')}`
  await db.query(`CREATE SCHEMA "${schema}"`)
  t.after(async () => { try { await db.query(`DROP SCHEMA "${schema}" CASCADE`) } finally { await db.end() } })
  await db.query(`SET search_path TO "${schema}";
    CREATE TABLE "user" (id varchar(32) PRIMARY KEY,username text,name text,"avatarId" varchar(32),host text,
      "isDeleted" boolean DEFAULT false,"isSuspended" boolean DEFAULT false,"movedToUri" text,
      "requireSigninToViewContents" boolean DEFAULT false,"makeNotesHiddenBefore" bigint,"makeNotesFollowersOnlyBefore" bigint);
    CREATE TABLE meta ("ugcVisibilityForVisitor" text DEFAULT 'all',"clientOptions" jsonb DEFAULT '{}');
    CREATE TABLE blocking ("blockerId" varchar(32),"blockeeId" varchar(32));
    CREATE TABLE following ("followerId" varchar(32),"followeeId" varchar(32));
    CREATE TABLE external_account (issuer text,subject text,username text,"userId" varchar(32));
    CREATE TABLE community_tag (id varchar(32) PRIMARY KEY,name text,category text,"isDeleted" boolean DEFAULT false);
    CREATE TABLE note (id varchar(32) PRIMARY KEY,visibility text DEFAULT 'public',"userId" varchar(32),
      "repliesCount" int DEFAULT 0,"renoteCount" int DEFAULT 0,reactions jsonb DEFAULT '{}',
      "renoteId" varchar(32),text text,"replyId" varchar(32),"fileIds" varchar[] DEFAULT '{}');
    CREATE TABLE note_reaction ("noteId" varchar(32),"userId" varchar(32),reaction text);
    CREATE TABLE note_favorite ("noteId" varchar(32),"userId" varchar(32));
    CREATE TABLE community_submission (id varchar(32) PRIMARY KEY,"authorId" varchar(32),"approvedNoteId" varchar(32),
      status text DEFAULT 'published',destination text DEFAULT 'community',category text DEFAULT 'image',
      "tagIds" varchar[] DEFAULT '{}',"fileIds" varchar[] DEFAULT '{}',title text DEFAULT 'Work',
      text text DEFAULT '',generation jsonb,"submittedAt" timestamptz,version int DEFAULT 1);
    INSERT INTO meta DEFAULT VALUES;
    INSERT INTO "user" (id,username) SELECT 'author'||i,'creator'||i FROM generate_series(1,80) i;
    INSERT INTO external_account SELECT 'https://zhangyuapi.com',i::text,
      CASE WHEN i=1 THEN 'target-author' ELSE 'account'||i END,'author'||i FROM generate_series(1,80) i;
    INSERT INTO community_tag SELECT 'tag'||i,CASE WHEN i=1 THEN 'target-tag' ELSE 'Tag'||i END,'image',false FROM generate_series(1,64) i;
    INSERT INTO note (id,"userId") SELECT 'n'||i,'author'||(i%80+1) FROM generate_series(1,2400) i;
    INSERT INTO community_submission (id,"authorId","approvedNoteId","tagIds","submittedAt")
      SELECT 'w'||lpad(i::text,5,'0'),'author'||(i%80+1),'n'||i,ARRAY['tag'||(i%64+1)],
        NOW()-i*INTERVAL '1 hour' FROM generate_series(1,2400) i;
    ANALYZE "user",meta,blocking,following,external_account,community_tag,note,note_reaction,note_favorite,community_submission`)
  const plans = []
  function nodes(node) { return [node, ...(node.Plans || []).flatMap(nodes)] }
  async function explain(path, body) {
    let statement
    const ctx = {
      req: { method: body ? 'POST' : 'GET', headers: {} }, res: {},
      url: new URL(path, 'https://community.example'), body, user: null,
      config: { url: 'https://community.example', id: 'aidx' },
      db: { async query(sql, values = []) {
        if (sql.includes('SELECT s.*')) { statement = { sql, values }; return { rows: [] } }
        return db.query(sql, values)
      } },
      json() {},
    }
    await handleContent(ctx)
    assert(statement)
    const plan = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, statement.values)).rows[0]['QUERY PLAN'][0]
    const related = nodes(plan.Plan).filter(node => ['community_tag', 'external_account'].includes(node['Relation Name']))
    plans.push({ path, milliseconds: plan['Execution Time'],
      scans: related.map(node => ({ relation: node['Relation Name'], loops: node['Actual Loops'] })) })
    return { statement, plan, related }
  }
  const search = await explain('/api/works?sort=latest&query=target')
  const expected = (await db.query(`SELECT s.id FROM community_submission s JOIN "user" u ON u.id=s."authorId"
    WHERE u.id='author1' OR 'tag1'=ANY(s."tagIds") ORDER BY s.id DESC LIMIT 101`)).rows.map(row => row.id)
  assert.deepEqual((await db.query(search.statement.sql, search.statement.values)).rows.map(row => row.id), expected)
  const ranked = await explain('/api/works/feed', {
    sort: 'recommended', seed: 'performance', interests: [{ kind: 'image', name: 'target-tag', score: 3 }],
  })
  const tagged = await explain('/api/works?sort=latest&tag=target-tag')
  t.diagnostic(JSON.stringify(plans))
  assert(search.related.every(node => node['Actual Loops'] <= 1), 'Search matches must not rescan tags or account aliases for each work')
  assert(ranked.related.filter(node => node['Relation Name'] === 'community_tag').every(node => node['Actual Loops'] <= 1),
    'Recommendation interests must resolve tags once per page')
  assert(tagged.related.every(node => node['Actual Loops'] <= 1), 'A selected tag must resolve once per page')
})
