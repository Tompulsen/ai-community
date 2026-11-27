/* SPDX-License-Identifier: AGPL-3.0-only */
import sharp from 'sharp';
import type { Database } from './types.ts';

interface Identity {
  version: 1;
  md5: string;
  state: 'ready' | 'skipped' | 'failed';
  group?: string;
  hash?: string;
  ratio?: number;
  readyAt?: number;
  transactionId?: string;
  attempts?: number;
  retryAt?: number;
}
interface IdentityFile {
  id: string;
  userId: string;
  md5: string;
  accessKey: string;
  properties: { communityImageIdentity?: Identity } | null;
  anchorValid?: boolean;
}
interface ImageSample { pixels: Buffer; hash: string; ratio: number }
const side = 512;

export async function sampleImage(source: string | Buffer): Promise<ImageSample | null> {
  const image = sharp(source, { limitInputPixels: 100_000_000, failOn: 'warning' }).timeout({ seconds: 5 });
  const info = await image.metadata();
  if ((info.pages ?? 1) !== 1 || !info.width || !info.height || Math.min(info.width, info.height) < 64) return null;
  const swapped = (info.orientation ?? 0) >= 5;
  const ratio = swapped ? info.height / info.width : info.width / info.height;
  const normalized = image.rotate().toColourspace('srgb');
  const pixels = await normalized.clone().resize(side, side, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const gray = await normalized.clone().resize(9, 8, { fit: 'fill' }).removeAlpha().greyscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? 1n : 0n);
  return { pixels, hash: bits.toString(16).padStart(16, '0'), ratio };
}

export function sameImage(left: ImageSample, right: ImageSample): boolean {
  if (Math.abs(Math.log(left.ratio / right.ratio)) > 0.003 || left.pixels.length !== side * side * 4 || right.pixels.length !== left.pixels.length) return false;
  let sum = 0, squared = 0, changed = 0;
  const blocks = new Float64Array((side / 8) ** 2);
  for (let index = 0; index < left.pixels.length; index++) {
    const delta = Math.abs(left.pixels[index]! - right.pixels[index]!);
    sum += delta; squared += delta * delta;
    if (delta > 20) changed++;
    const pixel = Math.floor(index / 4);
    blocks[Math.floor(pixel / side / 8) * (side / 8) + Math.floor(pixel % side / 8)]! += delta;
  }
  // Conservative pixel checks also reject colour, small text and local edits that share a perceptual hash.
  return sum / left.pixels.length <= 2 && squared / left.pixels.length <= 9 &&
    changed / left.pixels.length <= 0.001 && blocks.every(value => value / (8 * 8 * 4) <= 6);
}

function needsIdentity(file: IdentityFile, now: number): boolean {
  const identity = file.properties?.communityImageIdentity;
  return !identity || identity.version !== 1 || identity.md5 !== file.md5 ||
    identity.state === 'ready' && file.anchorValid === false ||
    identity.state === 'failed' && (identity.attempts ?? 0) < 3 && (identity.retryAt ?? 0) <= now;
}

export async function indexImageIdentity(db: Database, file: IdentityFile, sourcePath: (key: string) => Promise<string>): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // One author at a time prevents simultaneous uploads from choosing separate anchors.
    const locked = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked`, [`community-image-identity:${file.userId}`]);
    if (!locked.rows[0]?.locked) { await client.query('ROLLBACK'); return; }
    const current = (await client.query<IdentityFile>(`SELECT f.id,f."userId",f.md5,f."accessKey",f.properties,
      COALESCE(a.md5=split_part(f.properties->'communityImageIdentity'->>'group',':',2)
        AND a.properties->'communityImageIdentity'->>'group'=f.properties->'communityImageIdentity'->>'group',false) AS "anchorValid"
      FROM drive_file f LEFT JOIN drive_file a ON a.id=split_part(f.properties->'communityImageIdentity'->>'group',':',1) AND a."userId"=f."userId"
      WHERE f.id=$1 AND f."userId"=$2`, [file.id, file.userId])).rows[0];
    if (!current || !needsIdentity(current, Date.now())) { await client.query('ROLLBACK'); return; }
    const sample = await sampleImage(await sourcePath(current.accessKey));
    const identity: Identity = { version: 1, md5: current.md5, state: sample ? 'ready' : 'skipped' };
    if (sample) {
      identity.hash = sample.hash; identity.ratio = sample.ratio;
      identity.group = `${current.id}:${current.md5}`;
      const candidates = await client.query<IdentityFile>(`SELECT id,"userId",md5,"accessKey",properties FROM drive_file
        WHERE "userId"=$1 AND id<>$2 AND "storedInternal" AND NOT "isLink"
          AND properties->'communityImageIdentity'->>'version'='1'
          AND properties->'communityImageIdentity'->>'state'='ready'
          AND properties->'communityImageIdentity'->>'md5'=md5
          AND properties->'communityImageIdentity'->>'group'=id||':'||md5
          AND CASE WHEN properties->'communityImageIdentity'->>'hash' ~ '^[0-9a-f]{16}$'
            THEN bit_count(('x'||(properties->'communityImageIdentity'->>'hash'))::bit(64) # ('x'||$3)::bit(64))<=4 ELSE false END
        ORDER BY (md5=$4) DESC,id LIMIT 16`, [current.userId, current.id, sample.hash, current.md5]);
      const deadline = Date.now() + 8000;
      for (const candidate of candidates.rows) {
        // shortcut: cap ambiguous candidates; widen only if measured misses justify more background decoding.
        if (Date.now() >= deadline) break;
        const otherRatio = candidate.properties?.communityImageIdentity?.ratio;
        if (!otherRatio || Math.abs(Math.log(sample.ratio / otherRatio)) > 0.003) continue;
        try {
          const other = await sampleImage(await sourcePath(candidate.accessKey));
          if (other && sameImage(sample, other)) { identity.group = `${candidate.id}:${candidate.md5}`; break; }
        } catch { /* An unavailable anchor must not hide a new work. */ }
      }
    }
    identity.readyAt = Date.now();
    identity.transactionId = (await client.query<{ id: string }>('SELECT pg_current_xact_id()::text AS id')).rows[0]!.id;
    await client.query(`UPDATE drive_file SET properties=jsonb_set(COALESCE(properties,'{}'::jsonb),'{communityImageIdentity}',$3::jsonb)
      WHERE id=$1 AND md5=$2 AND "accessKey"=$4`, [current.id, current.md5, identity, current.accessKey]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function imageIdentityBackfill(db: Database, sourcePath: (key: string) => Promise<string>): () => Promise<void> {
  let cursor = '';
  return async () => {
    // Index only published image attachments, one decode job per media-worker tick; no request-time image reads.
    const page = await db.query<IdentityFile & { submissionId: string }>(`WITH submissions AS MATERIALIZED (
        SELECT id,"authorId","fileIds",category,destination,status FROM community_submission WHERE id>$1 ORDER BY id LIMIT 16)
      SELECT s.id AS "submissionId",f.id,f."userId",f.md5,f."accessKey",f.properties,
        COALESCE(a.md5=split_part(f.properties->'communityImageIdentity'->>'group',':',2)
          AND a.properties->'communityImageIdentity'->>'group'=f.properties->'communityImageIdentity'->>'group',false) AS "anchorValid"
      FROM submissions s
      LEFT JOIN drive_file f ON f."userId"=s."authorId" AND f.id=ANY(s."fileIds")
        AND f."storedInternal" AND NOT f."isLink" AND f.type LIKE 'image/%'
        AND s.category='image' AND s.destination='community' AND s.status IN ('published','approved')
      LEFT JOIN drive_file a ON a.id=split_part(f.properties->'communityImageIdentity'->>'group',':',1) AND a."userId"=f."userId"
      ORDER BY s.id,f.id`, [cursor]);
    const file = page.rows.find(item => item.id && needsIdentity(item, Date.now()));
    // Stay before a partially indexed multi-image work until every attachment has been considered.
    cursor = file ? page.rows.findLast(item => item.submissionId < file.submissionId)?.submissionId ?? cursor : page.rows.at(-1)?.submissionId ?? '';
    if (!file) return;
    try { await indexImageIdentity(db, file, sourcePath); } catch {
      const previous = file.properties?.communityImageIdentity;
      const attempts = (previous?.md5 === file.md5 ? previous.attempts ?? 0 : 0) + 1;
      const identity: Identity = { version: 1, state: 'failed', md5: file.md5, attempts, retryAt: Date.now() + attempts * 30000 };
      await db.query(`UPDATE drive_file SET properties=jsonb_set(COALESCE(properties,'{}'::jsonb),'{communityImageIdentity}',$3::jsonb)
        WHERE id=$1 AND md5=$2 AND properties->'communityImageIdentity' IS NOT DISTINCT FROM $4::jsonb`,
      [file.id, file.md5, identity, previous ?? null]);
    }
  };
}

export function feedRepresentatives(from: string, conditions: string[], anchor: string, boundary: string): string {
  return `feed_representatives AS MATERIALIZED (
    SELECT DISTINCT ON (eligible."authorId",eligible.signature) eligible.id FROM (
      SELECT s.id,s."authorId",CASE WHEN s.category='image' AND cardinality(s."fileIds")>0 THEN COALESCE((
        SELECT string_agg(f.properties->'communityImageIdentity'->>'group',',' ORDER BY attachment.position)
        FROM unnest(s."fileIds") WITH ORDINALITY attachment(id,position)
        LEFT JOIN drive_file f ON f.id=attachment.id AND f."userId"=s."authorId"
        HAVING bool_and(COALESCE(f.properties->'communityImageIdentity'->>'version'='1'
          AND f.properties->'communityImageIdentity'->>'state'='ready'
          AND f.properties->'communityImageIdentity'->>'md5'=f.md5
          AND f.properties->'communityImageIdentity'->>'group' IS NOT NULL
          AND (f.properties->'communityImageIdentity'->>'transactionId')::numeric<${boundary}::numeric
          AND (f.properties->'communityImageIdentity'->>'readyAt')::bigint<=${anchor}::bigint,false))
      ),'work:'||s.id) ELSE 'work:'||s.id END AS signature
      ${from} WHERE ${conditions.join(' AND ')}
    ) eligible ORDER BY eligible."authorId",eligible.signature,eligible.id DESC
  )`;
}
