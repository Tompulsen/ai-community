/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { handleContent } from './content.ts'

test('PostgreSQL media visibility retains viewer permissions and identifies only visible publication paths',
  { skip: !process.env.FOLLOWING_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.FOLLOWING_TEST_DATABASE_URL
  const url = new URL(connectionString)
  assert.equal(url.pathname, '/community_follow_test')
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || process.env.CI === 'true' && url.hostname === 'postgres')
  const schema = `media_visibility_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Pool({ connectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Client({ connectionString, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
  await db.connect()
  await db.query(`CREATE TABLE "user" (
    id varchar(32) PRIMARY KEY, host text, "isDeleted" boolean DEFAULT false, "isSuspended" boolean DEFAULT false,
    "movedToUri" text, "requireSigninToViewContents" boolean DEFAULT false,
    "makeNotesHiddenBefore" bigint, "makeNotesFollowersOnlyBefore" bigint, "avatarId" varchar(32), "bannerId" varchar(32)
  );
  CREATE TABLE meta ("clientOptions" jsonb DEFAULT '{}', "iconUrl" text, "ugcVisibilityForVisitor" text DEFAULT 'all');
  CREATE TABLE drive_file (
    id varchar(32) PRIMARY KEY, name text, type text, "userId" varchar(32), "accessKey" text, "thumbnailAccessKey" text,
    "webpublicAccessKey" text, "webpublicType" text, properties jsonb DEFAULT '{}',
    "storedInternal" boolean DEFAULT true, "isLink" boolean DEFAULT false, "isSensitive" boolean DEFAULT false
  );
  CREATE TABLE community_submission (
    id varchar(32) PRIMARY KEY, "authorId" varchar(32), "approvedNoteId" varchar(32),
    status text DEFAULT 'published', destination text DEFAULT 'community', "fileIds" varchar[] DEFAULT '{}', generation jsonb, "pendingRevision" jsonb
  );
  CREATE TABLE note (
    id varchar(32) PRIMARY KEY, "userId" varchar(32), visibility text DEFAULT 'public',
    "fileIds" varchar[] DEFAULT '{}', "replyId" varchar(32), "threadId" varchar(32)
  );
  CREATE TABLE chat_message ("fileId" varchar(32), "fromUserId" varchar(32), "toUserId" varchar(32), "toRoomId" varchar(32));
  CREATE TABLE blocking ("blockerId" varchar(32), "blockeeId" varchar(32));
  CREATE TABLE following ("followerId" varchar(32), "followeeId" varchar(32))`)
  async function reset() {
    await db.query(`TRUNCATE "user",meta,drive_file,community_submission,note,chat_message,blocking,following;
      INSERT INTO "user" (id) VALUES ('owner'),('reader'),('commenter'),('administrator'),('other');
      INSERT INTO meta DEFAULT VALUES;
      INSERT INTO drive_file (id,name,type,"userId","accessKey","thumbnailAccessKey","webpublicAccessKey","webpublicType")
        VALUES ('file1','image.png','image/png','owner','original-key','thumbnail-key','web-key','image/webp')`)
  }
  async function publish({ comment = false, references = false } = {}) {
    await db.query(`INSERT INTO note (id,"userId") VALUES ('00000000aaaaaaaaaaaaaaaa','owner');
      INSERT INTO community_submission (id,"authorId","approvedNoteId") VALUES ('work1','owner','00000000aaaaaaaaaaaaaaaa')`)
    if (comment) await db.query(`UPDATE drive_file SET "userId"='commenter';
      INSERT INTO note (id,"userId","replyId","fileIds") VALUES ('00000001aaaaaaaaaaaaaaaa','commenter','00000000aaaaaaaaaaaaaaaa',ARRAY['file1'])`)
    else if (references) await db.query(`UPDATE community_submission SET generation='{"referenceFileIds":["file1"]}'`)
    else await db.query(`UPDATE community_submission SET "fileIds"=ARRAY['file1']`)
  }
  async function lookup(actor = null, { key = 'file1', byKey = false } = {}) {
    let statement
    const ctx = { req: { method: 'GET', headers: {} },
      url: new URL(`${byKey ? '/files/' : '/legacy-files/'}${key}?variant=thumbnail`, 'https://community.test'),
      config: { url: 'https://community.test' }, user: actor ? { id: actor, isAdmin: actor === 'administrator', isModerator: actor === 'moderator' } : null,
      db: { async query(sql, values) {
        assert.equal(statement, undefined, 'Denied mock lookup must stop before any file access')
        statement = { sql, values }
        return { rows: [] }
      } } }
    await assert.rejects(handleContent(ctx), { statusCode: 404 })
    return (await db.query(statement.sql, statement.values)).rows
  }
  async function visible(actor, expected, options) {
    const rows = await lookup(actor, options)
    if (expected === null) assert.deepEqual(rows, [])
    else {
      assert.equal(rows.length, 1)
      assert.equal(rows[0].publiclyVisible, expected)
    }
  }

  await t.test('owner, administrator and direct-message permissions remain separate from publication visibility', async () => {
    await reset()
    await visible('owner', false)
    await visible('administrator', false)
    await visible('reader', null)
    await visible(null, null)
    await db.query(`INSERT INTO chat_message VALUES ('file1','owner','reader',NULL)`)
    await visible('reader', false)
    await visible('other', null)
    await visible(null, null)
    for (const mutation of [
      `UPDATE chat_message SET "toRoomId"='room1'`,
      `UPDATE chat_message SET "fromUserId"='other'`,
      `UPDATE "user" SET "isSuspended"=true WHERE id='owner'`,
      `INSERT INTO blocking VALUES ('owner','reader')`,
    ]) {
      await db.query('BEGIN')
      try { await db.query(mutation); await visible('reader', null) } finally { await db.query('ROLLBACK') }
    }
  })
  await t.test('published files and references are visible through IDs and existing storage-key routes', async () => {
    await reset()
    await publish()
    for (const actor of [null, 'reader', 'owner', 'administrator']) await visible(actor, true)
    for (const key of ['original-key', 'thumbnail-key', 'web-key']) await visible(null, true, { key, byKey: true })
    await visible(null, null, { key: 'unknown-key', byKey: true })
    await reset()
    await publish({ references: true })
    await visible(null, true)
  })
  await t.test('private skill sources cannot escape through a storage key, public reuse, DM or work deletion', async () => {
    await reset(); await publish();
    await db.query(`UPDATE drive_file SET name='SKILL.md',type='text/plain';
      UPDATE community_submission SET generation='{"skill":{"sourcePublic":false}}';
      INSERT INTO chat_message VALUES ('file1','owner','reader',NULL);
      INSERT INTO note (id,"userId","replyId","fileIds") VALUES ('00000001aaaaaaaaaaaaaaaa','owner','00000000aaaaaaaaaaaaaaaa',ARRAY['file1'])`);
    for (const actor of [null, 'reader', 'moderator']) {
      await visible(actor, null);
      for (const key of ['original-key', 'thumbnail-key', 'web-key']) await visible(actor, null, { key, byKey: true });
    }
    await visible('owner', true); await visible('administrator', true);
    await db.query(`UPDATE community_submission SET generation='{"skill":{"sourcePublic":true}}',"pendingRevision"='{"generation":{"skill":{"sourcePublic":false}},"fileIds":["file1"]}'`);
    await visible('reader', null);
    await db.query(`UPDATE drive_file SET properties='{"communitySkillPrivate":true}'; DELETE FROM community_submission`);
    await visible('reader', null); await visible('moderator', null);
    await visible('owner', false); await visible('administrator', false);
    await db.query(`UPDATE drive_file SET properties='{}'`);
    await visible('reader', false);
  });
  await t.test('only public approval releases a source with no other private formal or pending references', async () => {
    const filesRoot = await mkdtemp(join(tmpdir(), 'skill-approval-sql-'));
    t.after(() => rm(filesRoot, { recursive: true, force: true }));
    await writeFile(join(filesRoot, 'source-key'), '---\nname: helper\ndescription: Help users\n---\nBe useful.');
    const row = { id: 'work1', authorId: 'owner', status: 'pending', version: 1, submittedAt: new Date(), category: 'resource',
      title: 'Public skill', text: 'Instructions', model: 'chat-test', sourceUrl: '', license: '', fileIds: ['cover1','file1'], tagIds: [], approvedNoteId: 'note1',
      generation: { prompt: '', model: 'chat-test', referenceFileIds: [], skill: { platform: 'chat-test', group: 'text', sourcePublic: true, coverFileId: 'cover1' } } };
    const attachments = [{ id: 'cover1', name: 'cover.png', type: 'image/png' }, { id: 'file1', name: 'SKILL.md', type: 'text/plain', accessKey: 'source-key', storedInternal: true, isLink: false }];
    let clearance;
    const mock = { async query(sql, values) {
      if (sql.startsWith('UPDATE drive_file f SET properties=')) clearance = { sql, values };
      return { rows: sql.includes('FROM community_submission s') ? [row] : sql.includes('FROM drive_file') ? attachments.filter(file => values[0].includes(file.id)) : sql.startsWith('SELECT id FROM "user"') ? [{ id: 'owner' }] : [] };
    }, async connect() { return { query: this.query, release() {} } } };
    const user = { id: 'administrator', isAdmin: true };
    await handleContent({ req: { method: 'POST', headers: {} }, url: new URL('/api/admin/submissions/work1/review', 'https://community.test'),
      body: { action: 'approve', version: 1 }, config: { url: 'https://community.test' }, filesRoot, db: mock, user, requireUser: () => user,
      newId: () => 'generated1', json() {} });
    assert(clearance, 'Use the actual public-approval query');
    await reset(); await publish();
    await db.query(`UPDATE drive_file SET type='text/plain',properties='{"communitySkillPrivate":true,"other":1}';
      UPDATE community_submission SET generation='{"skill":{"sourcePublic":true}}'`);
    for (const pending of [false, true]) {
      await db.query(`INSERT INTO community_submission (id,"authorId","fileIds",generation,"pendingRevision") VALUES ('other','owner',ARRAY['file1'],$1,$2)`,
        pending ? [null, { fileIds: ['file1'], generation: { skill: { sourcePublic: false } } }] : [{ skill: { sourcePublic: false } }, null]);
      await db.query(clearance.sql, clearance.values);
      assert.equal((await db.query('SELECT properties FROM drive_file')).rows[0].properties.communitySkillPrivate, true);
      await db.query("DELETE FROM community_submission WHERE id='other'");
    }
    await db.query(clearance.sql, clearance.values);
    assert.deepEqual((await db.query('SELECT properties FROM drive_file')).rows[0].properties, { other: 1 });
  });
  await t.test('publication removal, note privacy and unavailable authors revoke access before cache classification', async () => {
    await reset()
    await publish()
    for (const mutation of [
      `UPDATE community_submission SET status='rejected'`,
      `UPDATE community_submission SET destination='source-comment'`,
      `UPDATE note SET visibility='followers'`,
      `UPDATE "user" SET "isDeleted"=true WHERE id='owner'`,
      `UPDATE "user" SET "isSuspended"=true WHERE id='owner'`,
      `UPDATE "user" SET host='remote.test' WHERE id='owner'`,
      `UPDATE "user" SET "movedToUri"='https://moved.test' WHERE id='owner'`,
      `UPDATE "user" SET "makeNotesHiddenBefore"=2147483647 WHERE id='owner'`,
    ]) {
      await db.query('BEGIN')
      try { await db.query(mutation); await visible('reader', null); await visible(null, null) }
      finally { await db.query('ROLLBACK') }
    }
    await db.query(`UPDATE community_submission SET status='rejected'`)
    await visible('owner', false)
    await visible('administrator', false)
  })
  await t.test('login, follower-only history and blocking rules remain specific to the current viewer', async () => {
    await reset()
    await publish()
    for (const mutation of [
      `UPDATE "user" SET "requireSigninToViewContents"=true WHERE id='owner'`,
      `UPDATE meta SET "ugcVisibilityForVisitor"='none'`,
    ]) {
      await db.query('BEGIN')
      try { await db.query(mutation); await visible(null, null); await visible('reader', true) }
      finally { await db.query('ROLLBACK') }
    }
    await db.query(`UPDATE "user" SET "makeNotesFollowersOnlyBefore"=2147483647 WHERE id='owner'`)
    await visible(null, null)
    await visible('reader', null)
    await db.query(`INSERT INTO following VALUES ('reader','owner')`)
    await visible('reader', true)
    await db.query(`INSERT INTO blocking VALUES ('reader','owner')`)
    await visible('reader', null)
    await db.query(`UPDATE blocking SET "blockerId"='owner',"blockeeId"='reader'`)
    await visible('reader', null)
  })
  await t.test('comment attachments require a visible parent and comment from their actual file owner', async () => {
    await reset()
    await publish({ comment: true })
    await visible(null, true)
    await visible('reader', true)
    for (const mutation of [
      `UPDATE community_submission SET status='rejected'`,
      `UPDATE note SET visibility='followers' WHERE "userId"='commenter'`,
      `UPDATE drive_file SET "userId"='other'`,
      `UPDATE "user" SET "isSuspended"=true WHERE id='commenter'`,
      `INSERT INTO blocking VALUES ('reader','commenter')`,
    ]) {
      await db.query('BEGIN')
      try { await db.query(mutation); await visible('reader', null) } finally { await db.query('ROLLBACK') }
    }
  })
  await t.test('profile images keep login, blocking and account visibility guards', async () => {
    await reset()
    for (const column of ['avatarId', 'bannerId']) {
      await db.query(`UPDATE "user" SET "${column}"='file1' WHERE id='owner'`)
      await visible(null, true)
      await db.query(`UPDATE "user" SET "${column}"=NULL WHERE id='owner'`)
    }
    await db.query(`UPDATE "user" SET "avatarId"='file1',"requireSigninToViewContents"=true WHERE id='owner'`)
    await visible(null, null)
    await visible('reader', true)
    await db.query(`INSERT INTO blocking VALUES ('owner','reader')`)
    await visible('reader', null)
  })
  await t.test('branding and base storage guards retain existing public and private boundaries', async () => {
    await reset()
    await db.query(`UPDATE meta SET "clientOptions"='{"communityLogoFileId":"file1"}'`)
    await visible(null, true)
    await db.query(`UPDATE drive_file SET "isSensitive"=true`)
    await visible(null, null)
    await visible('owner', false)
    await db.query(`UPDATE drive_file SET "isSensitive"=false;
      UPDATE meta SET "clientOptions"='{}',"iconUrl"='https://community.test/files/thumbnail-key?variant=thumbnail'`)
    await visible(null, true)
    for (const mutation of [`UPDATE drive_file SET "storedInternal"=false`, `UPDATE drive_file SET "isLink"=true`]) {
      await db.query('BEGIN')
      try { await db.query(mutation); await visible('owner', null); await visible('administrator', null) }
      finally { await db.query('ROLLBACK') }
    }
  })
})
