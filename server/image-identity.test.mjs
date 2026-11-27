import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { sampleImage, sameImage, imageIdentityBackfill, feedRepresentatives } from './image-identity.ts';

const artwork = Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop stop-color="#638fb5"/><stop offset="1" stop-color="#eed7bd"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#a)"/><circle cx="750" cy="470" r="260" fill="#eeaa77"/><path d="M100,1100L500,280L730,1100" fill="#409e5c"/><rect x="60" y="50" width="500" height="180" fill="#4c315e"/></svg>`);

test('resizing and JPEG encoding match; changed scenes, local edits, colour, alpha and aspect ratio do not', async () => {
  const original = await sharp(artwork).png().toBuffer();
  const sample = await sampleImage(original);
  const scaled = await sampleImage(await sharp(original).resize(900).webp({ quality: 85 }).toBuffer());
  const jpeg = await sampleImage(await sharp(original).resize(600).jpeg({ quality: 85 }).toBuffer());
  assert(sameImage(sample, scaled)); assert(sameImage(sample, jpeg));
  const patch = Buffer.from('<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><rect x="300" y="300" width="25" height="50" fill="black"/></svg>');
  const edit = await sampleImage(await sharp(original).composite([{ input: patch }]).png().toBuffer());
  assert(!sameImage(sample, edit));
  assert(!sameImage(sample, await sampleImage(await sharp(original).flop().png().toBuffer())));
  assert(!sameImage(sample, await sampleImage(await sharp(original).modulate({ hue: 45 }).png().toBuffer())));
  assert(!sameImage(sample, { ...sample, ratio: 1.1 }));
  const transparent = await sampleImage(await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff00' } }).png().toBuffer());
  const white = await sampleImage(await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer());
  assert(!sameImage(transparent, white));
  assert.equal(await sampleImage(await sharp(original).resize(32).png().toBuffer()), null);
  const animated = await sharp(Buffer.from([255,0,0,0,0,255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100, 200] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  assert.equal(await sampleImage(animated), null);
});

test('changing a small price label keeps an otherwise identical poster separate', async () => {
  // Explicit digit outlines keep this regression independent of installed fonts (including Alpine CI).
  const poster = (price, font) => Buffer.from(`<svg width="2048" height="2048" xmlns="http://www.w3.org/2000/svg"><rect width="2048" height="2048" fill="#e4eaf1"/><rect x="200" y="200" width="1600" height="1200" fill="#457385"/><circle cx="1024" cy="800" r="400" fill="#eed2a1"/><g transform="translate(900,1600) scale(${font/24})"><path d="${price===100?'M5 5L12 2V23M5 23H19':'M3 2H20L8 23'}" fill="none" stroke="black" stroke-width="2.5"/></g></svg>`);
  for (const font of [24,32,40]) {
    const left = await sampleImage(poster(100,font)), right = await sampleImage(poster(700,font));
    assert(!sameImage(left,right), `Keep changed ${font}px text`);
  }
});

test('background indexing groups same-author copies, preserves other authors, skips unpublished files and bounds failures', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  const query = (sql, values = []) => values.length ? pg.query(sql, values) : pg.exec(sql).then(results => results.at(-1));
  const db = { query, connect: async () => ({ query, release() {} }) };
  await query(`CREATE TABLE drive_file (id text PRIMARY KEY,"userId" text,md5 text,"accessKey" text,properties jsonb DEFAULT '{}',
    "storedInternal" boolean DEFAULT true,"isLink" boolean DEFAULT false,type text DEFAULT 'image/webp');
    CREATE TABLE community_submission (id text,"authorId" text,"fileIds" text[],category text DEFAULT 'image',destination text DEFAULT 'community',status text DEFAULT 'published')`);
  const pictures = {
    a: await sharp(artwork).png().toBuffer(),
    b: await sharp(artwork).resize(900).jpeg({ quality: 85 }).toBuffer(),
    c: await sharp(artwork).flop().png().toBuffer(),
  };
  const reads = [];
  const index = imageIdentityBackfill(db, async key => { reads.push(key); if (key==='missing') throw new Error('missing'); return pictures[key]; });
  for (const [id, author, key, published] of [['f1','author','a',true],['f2','author','b',true],['f3','author','c',true],['f4','other','b',true],['f5','author','missing',true],['f6','author','a',false]]) {
    const md5 = createHash('md5').update(pictures[key] ?? key).digest('hex');
    await query('INSERT INTO drive_file (id,"userId",md5,"accessKey") VALUES ($1,$2,$3,$4)', [id,author,md5,key]);
    if (published) await query('INSERT INTO community_submission (id,"authorId","fileIds") VALUES ($1,$2,ARRAY[$1])', [id,author]);
  }
  await index();
  assert.equal((await query("SELECT count(*)::int AS n FROM drive_file WHERE properties ? 'communityImageIdentity'")).rows[0].n, 1);
  for (let i=0;i<6;i++) await index();
  const identities = Object.fromEntries((await query('SELECT id,properties FROM drive_file ORDER BY id')).rows.map(row => [row.id,row.properties.communityImageIdentity]));
  assert.equal(identities.f1.state, 'ready'); assert.equal(identities.f1.group, identities.f2.group);
  assert.notEqual(identities.f1.group, identities.f3.group); assert.notEqual(identities.f1.group, identities.f4.group);
  assert.equal(identities.f5.state, 'failed'); assert.equal(identities.f5.attempts, 1); assert.equal(identities.f6, undefined);
  const previousReads = reads.length;
  for (let i=0;i<3;i++) await index();
  assert.equal(reads.length, previousReads);
  await query(`UPDATE drive_file SET md5='changed' WHERE id='f2'`);
  for (let i=0;i<3;i++) await index();
  assert.equal((await query("SELECT properties->'communityImageIdentity'->>'md5' AS md5 FROM drive_file WHERE id='f2'")).rows[0].md5, 'changed');
  await query(`UPDATE drive_file SET md5='anchor-changed' WHERE id='f1'`);
  for (let i=0;i<8;i++) await index();
  const repaired = (await query(`SELECT properties->'communityImageIdentity'->>'group' AS identity FROM drive_file WHERE id IN ('f1','f2') ORDER BY id`)).rows;
  assert.equal(repaired[0].identity, repaired[1].identity);
  assert.equal((await query('SELECT count(*)::int AS n FROM community_submission')).rows[0].n, 5);
});

test('a late index commit cannot change representatives in an already started feed snapshot', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE community_submission(id text,"authorId" text,category text,"fileIds" text[]);
    CREATE TABLE drive_file(id text,"userId" text,md5 text,properties jsonb);
    INSERT INTO community_submission VALUES ('w1','author','image',ARRAY['f1']),('w2','author','image',ARRAY['f2']);
    INSERT INTO drive_file VALUES ('f1','author','md51','{}'),('f2','author','md52','{}')`);
  await db.exec('BEGIN');
  const writer = (await db.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id;
  const boundary = (await db.query('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS id')).rows[0].id;
  const sql = `WITH ${feedRepresentatives('FROM community_submission s', ['TRUE'], '$1', '$2')} SELECT id FROM feed_representatives ORDER BY id`;
  const first = await db.query(sql, [2001, boundary]);
  await db.query(`UPDATE drive_file SET properties=jsonb_build_object('communityImageIdentity',jsonb_build_object(
    'version',1,'state','ready','md5',md5,'group','same','readyAt',2000,'transactionId',$1::text))`, [writer]);
  await db.exec('COMMIT');
  assert.deepEqual((await db.query(sql, [2001,boundary])).rows, first.rows);
  const refreshed = (await db.query('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS id')).rows[0].id;
  assert.deepEqual((await db.query(sql, [2001,refreshed])).rows, [{ id: 'w2' }]);
});
