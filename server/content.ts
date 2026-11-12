/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { PoolClient } from 'pg';
import type { Database, Queryable, RequestContext, SessionUser } from './types.ts';
import { notifyUser } from './social.ts';
import { sniffType, uploadMedia, uploadLimitsFor, mediaState, fileDto } from './media.ts';
import { getUser } from './auth.ts';

const kinds = ['image', 'video', 'resource'] as const;
type WorkKind = typeof kinds[number];
type SubmissionStatus = 'draft' | 'pending' | 'published' | 'approved' | 'rejected' | 'removed';
type ReviewAction = 'approve' | 'reject' | 'remove';
type ContentScope = 'public' | 'mine' | 'saved' | 'admin';
type Body = Record<string, unknown>;

interface Generation {
  prompt: string;
  model: string;
  referenceFileIds: string[];
  sourceWorkId?: string;
  shareToSource?: boolean;
}

interface CommunityRevision {
  category: WorkKind;
  title: string;
  text: string;
  model: string;
  sourceUrl: string;
  license: string;
  fileIds: string[];
  tagIds?: string[];
  generation: Generation | null;
}

interface CommunityRow extends CommunityRevision {
  id: string;
  authorId: string;
  authorName: string | null;
  authorUsername: string;
  approvedNoteId: string | null;
  pendingRevision: CommunityRevision | null;
  sourceCommentId: string | null;
  submittedAt: Date | string;
  status: SubmissionStatus;
  destination: 'community' | 'source-comment';
  payloadHash: string;
  version: number;
  rejectionReason: string | null;
  likes?: number;
  liked?: boolean;
  saved?: boolean;
  viewsCount: number;
  repliesCount?: number;
  renotesCount?: number;
  authorAvatarId?: string | null;
  authorBannerId?: string | null;
  rank?: string;
  heat?: string | number;
  renoted?: boolean;
  renoteCount?: number;
}

interface IdRow { id: string }
interface AttachmentRow extends IdRow { type: string }
interface DriveFileRow extends AttachmentRow {
  name: string;
  size: number;
  storedInternal: boolean;
  thumbnailAccessKey: string | null;
  properties?: Record<string, unknown>;
}
interface MediaRow extends AttachmentRow {
  name: string;
  accessKey: string | null;
  thumbnailAccessKey: string | null;
  webpublicAccessKey: string | null;
  webpublicType: string | null;
}
interface TagRow extends IdRow { name: string; category: WorkKind }
interface PublicationRow extends IdRow {
  authorId: string;
  approvedNoteId?: string | null;
  sourceCommentId?: string | null;
  destination?: 'community' | 'source-comment';
}
interface RevisionState {
  status: SubmissionStatus;
  noteId?: string | null;
  pendingRevision?: CommunityRevision | null;
  rejectionReason?: string | null;
}
interface CommunityOptions {
  communityPublicationMode?: unknown;
  communityViolationThreshold?: unknown;
  communityAutoBanEnabled?: unknown;
  communityFeedMode?: unknown;
  communityFeedPoolSize?: unknown;
}
interface CommentRow extends IdRow {
  userId: string;
  text: string | null;
  fileIds: string[];
  renoteId: string | null;
  name: string | null;
  username: string;
  replyId: string | null;
  repliesCount: number;
  likes: number;
  liked: boolean;
  avatarId: string | null;
}
interface CreatorRow extends IdRow {
  name: string | null;
  username: string;
  count: number;
  followed: boolean;
  bio: string | null;
  avatarId?: string | null;
  bannerId?: string | null;
  followersCount?: number;
  followingCount?: number;
}
interface AnnouncementRow extends IdRow {
  title: string;
  text: string;
  icon: string;
  display: string;
  updatedAt: Date | null;
}
interface ByteRange { start: number; end: number }

function isRecord(value: unknown): value is Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKind(value: unknown): value is WorkKind {
  return typeof value === 'string' && kinds.includes(value as WorkKind);
}

function errorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : undefined;
}
const heart = '\u2764';
const idPattern = /^[a-zA-Z0-9]{1,32}$/;
const inlineTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav']);

export function legacyIdTime(id: string, method = 'aidx'): number {
  if (method.toLowerCase() === 'meidg' && /^g[0-9a-f]{23}$/.test(id)) return parseInt(id.slice(1, 12), 16);
  if (id.length === 24 && /[g-z]/.test(id.slice(0, 8))) return parseInt(id.slice(0, 8), 36) + 946684800000;
  switch (method.toLowerCase()) {
    case 'aid': case 'aidx': return parseInt(id.slice(0, 8), 36) + 946684800000;
    case 'objectid': return parseInt(id.slice(0, 8), 16) * 1000;
    case 'meid': return parseInt(id.slice(0, 12), 16) - 0x800000000000;
    case 'meidg': return parseInt(id.slice(1, 12), 16);
    case 'ulid': return [...id.slice(0, 10)].reduce((time, char) => time * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(char), 0);
    default: return NaN;
  }
}

export function hiddenByTime(rule: number | null | undefined, createdAt: number, now = Date.now()): boolean {
  return rule == null ? false : rule <= 0 ? (now - createdAt) / 1000 >= Math.abs(rule) : createdAt / 1000 <= rule;
}

function idTimeSql(column: string, method = 'aidx'): string {
  method = method.toLowerCase();
  const number = (alphabet: string, start: number, length: number) => `(SELECT SUM((strpos('${alphabet}',substring(${column} FROM digit FOR 1))-1)::numeric*power(${alphabet.length}::numeric,${start + length - 1}-digit)) FROM generate_series(${start},${start + length - 1}) digit)`;
  const aid = `(${number('0123456789abcdefghijklmnopqrstuvwxyz', 1, 8)}+946684800000)`;
  let legacy = aid;
  if (method === 'objectid') legacy = `(${number('0123456789abcdef', 1, 8)}*1000)`;
  if (method === 'meid') legacy = `(${number('0123456789abcdef', 1, 12)}-140737488355328)`;
  if (method === 'meidg') legacy = number('0123456789abcdef', 2, 11);
  if (method === 'ulid') legacy = number('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1, 10);
  return `(CASE WHEN length(${column})=24 AND substring(${column} FROM 1 FOR 8)~'[g-z]'${method === 'meidg' ? ` AND ${column}!~'^g[0-9a-f]{23}$'` : ''} THEN ${aid} ELSE ${legacy} END)`;
}

function privacySql(method = 'aidx', author = 'u', note = 'n'): string {
  const created = `(${idTimeSql(`${note}.id`, method)}/1000)`;
  const hidden = (field: string) => `(${author}."${field}" IS NOT NULL AND CASE WHEN ${author}."${field}"<=0 THEN EXTRACT(EPOCH FROM NOW())-${created}>=ABS(${author}."${field}"::bigint) ELSE ${created}<=${author}."${field}" END)`;
  return `(${author}.id=$1 OR (NOT ${hidden('makeNotesHiddenBefore')} AND (NOT ${hidden('makeNotesFollowersOnlyBefore')} OR EXISTS (SELECT 1 FROM following privacy_follow WHERE privacy_follow."followerId"=$1 AND privacy_follow."followeeId"=${author}.id))))`;
}

function visibilitySql(ctx?: RequestContext): string {
  const method = ((ctx?.config as { id?: string } | undefined)?.id ?? 'aidx').toLowerCase();
  return `
  s.status IN ('published', 'approved') AND s.destination = 'community'
  AND n.id IS NOT NULL AND n.visibility = 'public'
  AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
  AND ($1::varchar IS NOT NULL OR NOT u."requireSigninToViewContents")
  AND ($1::varchar IS NOT NULL OR EXISTS (SELECT 1 FROM meta WHERE "ugcVisibilityForVisitor" <> 'none'))
  AND ${privacySql(method)}
  AND NOT EXISTS (SELECT 1 FROM blocking b WHERE
    (b."blockerId" = $1 AND b."blockeeId" = u.id) OR (b."blockeeId" = $1 AND b."blockerId" = u.id))`;
}
export const publicVisibilitySql = visibilitySql();

async function inform(ctx: RequestContext, input: Parameters<typeof notifyUser>[1]): Promise<void> {
  try { await notifyUser(ctx, input); } catch { /* The committed interaction remains valid when notification delivery fails. */ }
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status, statusCode: status });
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(400, 'Invalid identifier');
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) fail(400, 'Invalid number');
  return value;
}

function text(value: unknown, maximum: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) fail(400, 'Invalid text');
  return value.trim();
}

function viewer(ctx: RequestContext): string | null {
  return ctx.user?.id ?? null;
}

function user(ctx: RequestContext): SessionUser {
  ctx.requireUser();
  if (!ctx.user) fail(401, 'Sign in required');
  return ctx.user;
}

function moderator(ctx: RequestContext): SessionUser {
  const actor = user(ctx);
  if (!actor.isAdmin && !actor.isModerator) fail(403, 'Moderator permission required');
  return actor;
}

function newId(ctx: RequestContext): string {
  return ctx.newId?.() ?? `${Math.max(0, Date.now() - 946684800000).toString(36).padStart(8, '0')}${randomBytes(8).toString('hex')}`;
}

function send(ctx: RequestContext, status: number, payload: unknown): true {
  ctx.json(status, payload);
  return true;
}

export async function transaction<T>(db: Database, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function settings(db: Queryable): Promise<CommunityOptions> {
  return (await db.query<{ clientOptions: CommunityOptions | null }>('SELECT "clientOptions" FROM meta LIMIT 1')).rows[0]?.clientOptions ?? {};
}

interface WorkCursor {
  v: 1;
  id: string;
  order: string;
  heat?: number;
  seed?: string;
  boundary?: string;
  anchor?: number;
}

export function readWorkCursor(value: string | null): WorkCursor | null {
  if (!value) return null;
  if (idPattern.test(value)) return { v: 1, id: value, order: 'latest' };
  if (value.length > 1600 || !/^[A-Za-z0-9_-]+$/.test(value)) fail(400, 'Invalid page cursor');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { fail(400, 'Invalid page cursor'); }
  if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.id !== 'string' || !idPattern.test(parsed.id) ||
    !['latest', 'featured', 'popular', 'random'].includes(String(parsed.order))) fail(400, 'Invalid page cursor');
  if (parsed.heat !== undefined && (typeof parsed.heat !== 'number' || !Number.isSafeInteger(parsed.heat) || parsed.heat < 0)) fail(400, 'Invalid page cursor');
  if (parsed.order === 'random' && (typeof parsed.seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(parsed.seed) ||
    typeof parsed.boundary !== 'string' || !idPattern.test(parsed.boundary) || typeof parsed.anchor !== 'number' ||
    !Number.isSafeInteger(parsed.anchor) || parsed.anchor <= 0 || parsed.anchor > Date.now() + 60000)) fail(400, 'Invalid page cursor');
  return parsed as unknown as WorkCursor;
}

function writeWorkCursor(cursor: WorkCursor): string {
  return cursor.order === 'latest' ? cursor.id : Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

async function contentPage(ctx: RequestContext, { scope = 'public', workId, authorId, limit = 100 }: { scope?: ContentScope; workId?: string; authorId?: string; limit?: number } = {}): Promise<{ rows: CommunityRow[]; nextCursor: string | null }> {
  const params: (string | number | null)[] = [viewer(ctx)];
  const conditions = [scope === 'mine' ? 's."authorId" = $1' : scope === 'admin' ? 'TRUE' : `(${visibilitySql(ctx)})`];
  const add = (value: string | number | null) => { params.push(value); return `$${params.length}`; };
  if (scope === 'saved') conditions.push('EXISTS (SELECT 1 FROM note_favorite f WHERE f."noteId"=s."approvedNoteId" AND f."userId"=$1)');
  const requestedOrder = workId || scope !== 'public' ? 'latest' : ctx.url.searchParams.get('sort') || 'recommended';
  if (!['latest', 'recommended', 'featured', 'popular', 'following'].includes(requestedOrder)) fail(400, 'Invalid work order');
  const options = requestedOrder === 'recommended' && !authorId ? await settings(ctx.db) : {};
  const cursor = workId ? null : readWorkCursor(ctx.url.searchParams.get('cursor'));
  const order = requestedOrder === 'recommended' && !authorId && (cursor?.order === 'random' || !cursor && options.communityFeedMode !== 'latest')
    ? 'random' : ['popular', 'featured'].includes(requestedOrder) ? requestedOrder : 'latest';
  if (cursor && cursor.order !== order) fail(400, 'Page cursor does not match this work order');
  const likesFor = (note: string) => `(SELECT COUNT(*) FROM note_reaction cr WHERE cr."noteId"=${note} AND cr.reaction IN ('${heart}','${heart}\ufe0f'))`;
  const heat = order === 'popular' ? likesFor('n.id') : `(COALESCE(n."repliesCount",0)::bigint+COALESCE(n."renoteCount",0)::bigint+COALESCE((SELECT SUM(reaction.value::bigint) FROM jsonb_each_text(n.reactions) reaction),0))`;
  if (scope === 'public' && requestedOrder === 'following') {
    user(ctx);
    conditions.push('EXISTS (SELECT 1 FROM following f WHERE f."followerId"=$1 AND f."followeeId"=s."authorId")');
  }
  if (workId) conditions.push(`s.id = ${add(identifier(workId))}`);
  if (authorId) conditions.push(`s."authorId" = ${add(identifier(authorId))}`);
  if (!workId) {
    const privateScope = scope === 'mine' || scope === 'admin';
    const category = privateScope ? `COALESCE(s."pendingRevision"->>'category',s.category)` : 's.category';
    const tagMembership = privateScope ? `COALESCE(s."pendingRevision"->'tagIds',to_jsonb(s."tagIds")) ? t.id` : 't.id=ANY(s."tagIds")';
    const kind = ctx.url.searchParams.get('kind') || ctx.url.searchParams.get('category');
    if (kind && kind !== 'all') {
      if (!isKind(kind)) fail(400, 'Invalid work category');
      conditions.push(`${category} = ${add(kind)}`);
    }
    const query = text(ctx.url.searchParams.get('query') ?? ctx.url.searchParams.get('q') ?? '', 200);
    if (query) {
      const parameter = add(`%${query.replace(/[\\%_]/g, '\\$&')}%`);
      const title = privateScope ? `COALESCE(s."pendingRevision"->>'title',s.title)` : 's.title';
      const body = privateScope ? `COALESCE(s."pendingRevision"->>'text',s.text)` : 's.text';
      const prompt = privateScope ? `CASE WHEN s."pendingRevision" ? 'generation' THEN s."pendingRevision"->'generation'->>'prompt' ELSE s.generation->>'prompt' END` : `s.generation->>'prompt'`;
      conditions.push(`(${title} ILIKE ${parameter} OR ${body} ILIKE ${parameter} OR (${prompt}) ILIKE ${parameter} OR u.name ILIKE ${parameter} OR u.username ILIKE ${parameter}
        OR EXISTS (SELECT 1 FROM community_tag t WHERE ${tagMembership} AND t.category=${category} AND NOT t."isDeleted" AND t.name ILIKE ${parameter}))`);
    }
    const tag = ctx.url.searchParams.get('tag');
    if (tag) conditions.push(`EXISTS (SELECT 1 FROM community_tag t WHERE ${tagMembership} AND t.category=${category} AND NOT t."isDeleted" AND (t.id = ${add(text(tag, 100))} OR t.name = $${params.length}))`);
    const status = ctx.url.searchParams.get('status');
    if ((scope === 'mine' || scope === 'admin') && status && status !== 'all') {
      if (status === 'pending') conditions.push(`(s.status = 'pending' OR s."pendingRevision" IS NOT NULL)`);
      else if (['draft', 'published', 'approved', 'rejected', 'removed'].includes(status)) conditions.push(`s.status = ${add(status)}`);
      else fail(400, 'Invalid work status');
    }
  }
  const pageLimit = integer(!workId && ctx.url.searchParams.has('limit') ? Number(ctx.url.searchParams.get('limit')) : limit, 1, 200);
  const from = `FROM community_submission s JOIN "user" u ON u.id=s."authorId" LEFT JOIN note n ON n.id=s."approvedNoteId"`;
  let rank = "''";
  let seed: string | undefined, boundary: string | undefined, anchor: number | undefined;
  if (order === 'random') {
    seed = cursor?.seed ?? ctx.url.searchParams.get('feedSeed') ?? randomBytes(16).toString('hex');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(seed)) fail(400, 'Invalid feed seed');
    anchor = cursor?.anchor ?? Date.now();
    conditions.push(`s."submittedAt"<=to_timestamp(${add(anchor)}/1000.0)`);
    boundary = cursor?.boundary;
    if (!boundary) {
      const pool = typeof options.communityFeedPoolSize === 'number' && Number.isInteger(options.communityFeedPoolSize)
        ? Math.min(5000, Math.max(1, options.communityFeedPoolSize)) : 200;
      const result = await ctx.db.query<IdRow>(`SELECT s.id ${from} WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC OFFSET ${pool - 1} LIMIT 1`, params);
      boundary = result.rows[0]?.id ?? '0';
    }
    const boundaryParam = add(boundary), seedParam = add(seed);
    rank = `CASE WHEN s.id>=${boundaryParam} THEN md5(s.id||${seedParam}) ELSE 'z' END`;
    if (cursor) {
      const oldRank = cursor.id >= boundary ? createHash('md5').update(cursor.id + seed).digest('hex') : 'z';
      const rankParam = add(oldRank), idParam = add(cursor.id);
      conditions.push(`((${rank})>${rankParam} OR ((${rank})=${rankParam} AND s.id<${idParam}))`);
    }
  } else if (cursor) {
    if (order === 'featured' || order === 'popular') {
      if (cursor.heat === undefined) fail(400, 'Invalid ranking cursor');
      conditions.push(`(${heat},s.id)<(${add(cursor.heat)},${add(cursor.id)})`);
    } else conditions.push(`s.id<${add(cursor.id)}`);
  }
  params.push(pageLimit + 1);
  const result = await ctx.db.query<CommunityRow>(`
    SELECT s.*, u.name AS "authorName", u.username AS "authorUsername", u."avatarId" AS "authorAvatarId",
      n.visibility AS "noteVisibility", n."repliesCount", n."renoteCount" AS "renotesCount",${heat} AS heat,${rank} AS rank,
      (SELECT COUNT(*)::int FROM note_reaction r WHERE r."noteId" = n.id AND r.reaction IN ('${heart}', '${heart}\ufe0f')) AS likes,
      EXISTS (SELECT 1 FROM note_reaction r WHERE r."noteId" = n.id AND r."userId" = $1 AND r.reaction IN ('${heart}', '${heart}\ufe0f')) AS liked,
      EXISTS (SELECT 1 FROM note_favorite f WHERE f."noteId" = n.id AND f."userId" = $1) AS saved,
      n."renoteCount",
      EXISTS (SELECT 1 FROM note r WHERE r."renoteId"=n.id AND r."userId"=$1 AND r.text IS NULL AND r."replyId" IS NULL AND cardinality(r."fileIds")=0) AS renoted
    ${from}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${order === 'random' ? 'rank ASC,' : order === 'featured' || order === 'popular' ? 'heat DESC,' : ''} s.id DESC LIMIT $${params.length}`, params);
  const rows = result.rows.slice(0, pageLimit);
  const last = rows.at(-1);
  const nextCursor = result.rows.length > pageLimit && last ? writeWorkCursor({
    v: 1, id: last.id, order, ...(order === 'featured' || order === 'popular' ? { heat: Number(last.heat ?? 0) } : {}),
    ...(order === 'random' ? { seed, boundary, anchor } : {}),
  }) : null;
  return { rows, nextCursor };
}

async function contentRows(ctx: RequestContext, options: Parameters<typeof contentPage>[1] = {}): Promise<CommunityRow[]> {
  return (await contentPage(ctx, options)).rows;
}

async function packWork(ctx: RequestContext, row: CommunityRow, includeRevision = false) {
  const content = includeRevision && row.pendingRevision ? { ...row, ...row.pendingRevision } : row;
  const ids = content.fileIds ?? [];
  const files = ids.length ? (await ctx.db.query<DriveFileRow>('SELECT id, name, type, size, "thumbnailAccessKey", "storedInternal",properties FROM drive_file WHERE id = ANY($1::varchar[]) AND "userId" = $2', [ids, row.authorId])).rows : [];
  const referenceIds = content.generation?.referenceFileIds ?? [];
  const references = referenceIds.length ? (await ctx.db.query<Pick<DriveFileRow, 'id' | 'name' | 'type' | 'storedInternal'>>('SELECT id,name,type,"storedInternal" FROM drive_file WHERE id=ANY($1::varchar[]) AND "userId"=$2', [referenceIds, row.authorId])).rows : [];
  const ordered = ids.flatMap(id => files.filter(file => file.id === id));
  const mediaUrl = (file: DriveFileRow | undefined) => file?.storedInternal ? `/legacy-files/${file.id}` : '';
  const image = ordered.find(file => file.type.startsWith('image/'));
  const video = ordered.find(file => file.type.startsWith('video/'));
  const coverAspectRatio = (image || video)?.properties?.previewAspectRatio;
  const tagIds = content.tagIds ?? [];
  const tags = tagIds.length ? (await ctx.db.query<TagRow>('SELECT id, name, category FROM community_tag WHERE id = ANY($1::varchar[]) AND NOT "isDeleted" AND category = $2 ORDER BY id', [tagIds, content.category])).rows : [];
  const publicStatus = ['published', 'approved'].includes(row.status) && row.approvedNoteId;
  return {
    id: row.id, title: content.title, author: row.authorName || row.authorUsername || '',
    avatar: (row.authorName || row.authorUsername || '?').slice(0, 1), authorId: row.authorId, authorUsername: row.authorUsername,
    avatarUrl: row.authorAvatarId ? `/legacy-files/${row.authorAvatarId}?variant=thumbnail` : null,
    kind: content.category, cover: image?.thumbnailAccessKey ? `${mediaUrl(image)}?variant=thumbnail` : mediaUrl(image) || (video?.thumbnailAccessKey ? `${mediaUrl(video)}?variant=thumbnail` : ''),
    ...(typeof coverAspectRatio === 'number' && Number.isFinite(coverAspectRatio) && coverAspectRatio > 0 ? { coverAspectRatio } : {}),
    tags: tags.map(tag => tag.name), tagIds: tags.map(tag => tag.id),
    prompt: content.generation?.prompt ?? '', model: content.model, body: content.text,
    sourceUrl: content.sourceUrl, license: content.license, generation: content.generation ?? null,
    referenceFiles: referenceIds.flatMap(id => references.filter(file => file.id === id && file.storedInternal && file.type.startsWith('image/')).map(file => ({ id: file.id, name: file.name, type: file.type, url: new URL(`/legacy-files/${file.id}`, ctx.config.url).href }))),
    fileIds: ids, files: ordered.map(file => ({ id: file.id, name: file.name, type: file.type, size: file.size, url: mediaUrl(file), thumbnailUrl: file.thumbnailAccessKey ? `${mediaUrl(file)}?variant=thumbnail` : '', processing: mediaState(file.properties) })),
    likes: Number(row.likes ?? 0), liked: Boolean(row.liked), saved: Boolean(row.saved),
    renoted: Boolean(row.renoted), renotes: Number(row.renoteCount ?? 0), views: Number(row.viewsCount ?? 0),
    viewsCount: Number(row.viewsCount ?? 0), repliesCount: Number(row.repliesCount ?? 0), renotesCount: Number(row.renotesCount ?? row.renoteCount ?? 0),
    date: new Date(row.submittedAt).toISOString(), owned: viewer(ctx) === row.authorId,
    status: publicStatus ? 'published' : row.status === 'removed' ? 'rejected' : row.status,
    originalStatus: row.status, noteId: row.approvedNoteId, version: row.version,
    revisionPending: includeRevision && Boolean(row.pendingRevision),
    destination: row.destination, sourceCommentStatus: row.sourceCommentId ? 'shared' : row.destination === 'source-comment' || content.generation?.shareToSource ? row.status === 'pending' ? 'pending' : 'unavailable' : 'none',
    ...(includeRevision ? { rejectionReason: row.rejectionReason } : {}),
    ...(video && mediaUrl(video) ? { video: mediaUrl(video) } : {}),
  };
}

type PackedWork = Awaited<ReturnType<typeof packWork>>;

export async function accessibleWork(ctx: RequestContext, workId: unknown, { lock = false, db = ctx.db, publicOnly = false }: { lock?: boolean; db?: Queryable; publicOnly?: boolean } = {}): Promise<CommunityRow> {
  const result = await db.query<CommunityRow>(`
    SELECT s.*, u.name AS "authorName", u.username AS "authorUsername"
    FROM community_submission s JOIN "user" u ON u.id = s."authorId"
    LEFT JOIN note n ON n.id = s."approvedNoteId"
    WHERE s.id = $2 AND (${publicOnly ? `(${visibilitySql(ctx)})` : `(s."authorId" = $1 OR $3::boolean OR (${visibilitySql(ctx)}))`})
    ${lock ? 'FOR UPDATE OF s' : ''}`, publicOnly ? [viewer(ctx), identifier(workId)] : [viewer(ctx), identifier(workId), Boolean(ctx.user?.isAdmin || ctx.user?.isModerator)]);
  if (!result.rows[0]) fail(404, 'Work not found');
  return result.rows[0];
}

async function workResponse(ctx: RequestContext, id: string, includeRevision = true): Promise<{ work: PackedWork }> {
  const scope = ctx.user?.isAdmin || ctx.user?.isModerator ? 'admin' : 'mine';
  const rows = await contentRows(ctx, { scope, workId: id });
  if (!rows[0]) fail(404, 'Work not found');
  return { work: await packWork(ctx, rows[0], includeRevision) };
}

export function normalizeRevision(body: Body, previous: Partial<CommunityRevision> = {}): CommunityRevision {
  const category = body.kind ?? body.category ?? previous.category;
  if (!isKind(category)) fail(400, 'Invalid work category');
  const title = text(body.title, 100, previous.title ?? '');
  if (!title) fail(400, 'A title is required');
  const rawFileIds = body.fileIds ?? previous.fileIds ?? [];
  if (!Array.isArray(rawFileIds) || rawFileIds.length > 16 || new Set(rawFileIds).size !== rawFileIds.length) fail(400, 'Invalid attachment list');
  const fileIds = rawFileIds.map(identifier);
  const sourceUrl = text(body.sourceUrl, 2000, previous.sourceUrl ?? '');
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { fail(400, 'Invalid source URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, 'Invalid source URL');
  }
  const rawGeneration = body.generation === null ? null : body.generation ?? previous.generation ?? {};
  if (rawGeneration !== null && !isRecord(rawGeneration)) fail(400, 'Invalid generation metadata');
  const generation = rawGeneration;
  const prompt = text(body.prompt ?? generation?.prompt, 100000, '');
  const model = text(body.model, 100, previous.model ?? '');
  const rawReferences = body.referenceFileIds ?? generation?.referenceFileIds ?? [];
  if (!Array.isArray(rawReferences) || rawReferences.length > 16 || new Set(rawReferences).size !== rawReferences.length) fail(400, 'Invalid reference files');
  const references = rawReferences.map(identifier);
  const sourceWorkId = generation?.sourceWorkId ? identifier(generation.sourceWorkId) : undefined;
  return {
    category, title, text: text(body.body ?? body.text, 20000, previous.text ?? ''), model, sourceUrl,
    license: text(body.license, 200, previous.license ?? ''), fileIds,
    generation: body.generation === null ? null : prompt || references.length || sourceWorkId ? {
      prompt, model, referenceFileIds: references, ...(sourceWorkId ? { sourceWorkId, ...(generation?.shareToSource === true ? { shareToSource: true } : {}) } : {}),
    } : null,
  };
}

async function validateRevision(db: Queryable, actorId: string, revision: CommunityRevision, body: Body, draft = false, noteId?: string | null): Promise<AttachmentRow[]> {
  const fileIds = [...new Set([...revision.fileIds, ...(revision.generation?.referenceFileIds ?? [])])];
  const files = fileIds.length ? (await db.query<AttachmentRow>('SELECT id, type FROM drive_file WHERE id = ANY($1::varchar[]) AND "userId" = $2 ORDER BY id FOR KEY SHARE', [fileIds, actorId])).rows : [];
  if (files.length !== fileIds.length) fail(400, 'An attachment is missing or belongs to another account');
  if (revision.generation?.referenceFileIds.some(id => !files.find(file => file.id === id)?.type.startsWith('image/'))) fail(400, 'References must be images');
  const attachments = files.filter(file => revision.fileIds.includes(file.id));
  if (!draft && (!revision.text && !revision.fileIds.length ||
    revision.category === 'image' && !attachments.some(file => file.type.startsWith('image/')) ||
    revision.category === 'video' && !attachments.some(file => file.type.startsWith('video/')))) fail(400, 'The work needs valid content and attachments');
  if (attachments.some(file => file.type.startsWith('video/'))) {
    if (revision.generation?.shareToSource) fail(400, 'Videos cannot be shared as source comments');
    if (noteId) {
      const quoted = await db.query(`WITH RECURSIVE quoted AS (
        SELECT id, "replyId", "threadId" FROM note WHERE "renoteId" = $1
        UNION SELECT n.id, n."replyId", n."threadId" FROM note n JOIN quoted q ON n."renoteId" = q.id)
        SELECT 1 FROM quoted q JOIN community_submission s ON s."approvedNoteId" IN (q."replyId", q."threadId") WHERE s.destination = 'community' LIMIT 1`, [noteId]);
      if (quoted.rows.length) fail(400, 'A quoted work cannot gain a video attachment');
    }
  }
  let tagIds = body.tagIds;
  if (tagIds === undefined && body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 3 || body.tags.some(name => typeof name !== 'string')) fail(400, 'Choose at most three existing tags');
    const names = [...new Set(body.tags.map((name: unknown) => {
      if (typeof name !== 'string') fail(400, 'Choose at most three existing tags');
      return name.normalize('NFC').trim();
    }))];
    const tags = names.length ? (await db.query<IdRow>('SELECT id FROM community_tag WHERE name = ANY($1::varchar[]) AND category = $2 AND NOT "isDeleted" ORDER BY id FOR KEY SHARE', [names, revision.category])).rows : [];
    if (tags.length !== names.length) fail(400, 'An existing tag in this category is required');
    tagIds = tags.map(tag => tag.id);
  }
  tagIds ??= revision.tagIds ?? [];
  if (!Array.isArray(tagIds) || tagIds.length > 3 || new Set(tagIds).size !== tagIds.length) fail(400, 'Choose at most three tags');
  const selectedTagIds = tagIds.map(identifier);
  const tags = selectedTagIds.length ? (await db.query<IdRow>('SELECT id FROM community_tag WHERE id = ANY($1::varchar[]) AND category = $2 AND NOT "isDeleted" ORDER BY id FOR KEY SHARE', [selectedTagIds, revision.category])).rows : [];
  if (tags.length !== selectedTagIds.length) fail(400, 'A selected tag is unavailable');
  revision.tagIds = [...selectedTagIds].sort();
  return attachments;
}

function noteText(revision: CommunityRevision): string {
  return [revision.title, revision.text, revision.model && `Model: ${revision.model}`, revision.sourceUrl && `Source: ${revision.sourceUrl}`, revision.license && `License: ${revision.license}`].filter(Boolean).join('\n\n');
}

function samePayload(row: CommunityRow, revision: CommunityRevision): boolean {
  const previous = normalizeRevision({}, row);
  previous.tagIds = [...(row.tagIds ?? [])].sort();
  return JSON.stringify(previous) === JSON.stringify(revision);
}

async function publish(ctx: RequestContext, db: Queryable, row: PublicationRow, revision: CommunityRevision, attachments: AttachmentRow[], notifications: Parameters<typeof notifyUser>[1][] = []): Promise<string> {
  const author = (await db.query<IdRow>('SELECT id FROM "user" WHERE id=$1 AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" AND "movedToUri" IS NULL', [row.authorId])).rows[0];
  if (!author) fail(409, 'The author is unavailable');
  if (row.approvedNoteId) {
    await db.query('SELECT id FROM note WHERE id = $1 FOR UPDATE', [row.approvedNoteId]);
    await db.query('UPDATE note SET text = $2, "fileIds" = $3, "attachedFileTypes" = $4 WHERE id = $1', [row.approvedNoteId, noteText(revision), revision.fileIds, attachments.map(file => file.type)]);
    return row.approvedNoteId;
  }
  const id = newId(ctx);
  const authorContext: RequestContext = { ...ctx, user: { ...user(ctx), id: row.authorId } };
  const source = row.destination === 'source-comment' ? await sourceWork(authorContext, db, revision.generation?.sourceWorkId) : null;
  await db.query('INSERT INTO note (id, "userId", text, visibility, "localOnly", "fileIds", "attachedFileTypes","replyId","threadId","replyUserId") VALUES ($1,$2,$3,\'public\',true,$4,$5,$6,$6,$7)', [id, row.authorId, noteText(revision), revision.fileIds, attachments.map(file => file.type), source?.approvedNoteId ?? null, source?.authorId ?? null]);
  await db.query('UPDATE "user" SET "notesCount" = "notesCount" + 1 WHERE id = $1', [row.authorId]);
  if (source) {
    await db.query('UPDATE note SET "repliesCount"="repliesCount"+1 WHERE id=$1', [source.approvedNoteId]);
    await db.query('UPDATE community_submission SET "sourceCommentId"=$2 WHERE id=$1', [row.id, id]);
    notifications.push({ recipientId: source.authorId, type: 'comment', actorId: row.authorId, workId: source.id, commentId: id });
  } else if (revision.generation?.shareToSource && revision.generation.sourceWorkId && revision.generation.sourceWorkId !== row.id && !row.sourceCommentId) {
    let original: CommunityRow | undefined;
    try { original = await sourceWork(authorContext, db, revision.generation.sourceWorkId); } catch (error) { if (errorStatus(error) !== 404) throw error; }
    if (original) {
      const commentId = newId(ctx);
      await db.query(`INSERT INTO note (id,"userId",text,visibility,"localOnly","replyId","threadId","replyUserId","renoteId","renoteUserId")
        VALUES ($1,$2,$3,'public',true,$4,$4,$5,$6,$2)`, [commentId, row.authorId, `My remix\n${new URL(`/work/${row.id}`, ctx.config.url).href}`, original.approvedNoteId, original.authorId, id]);
      await db.query('UPDATE note SET "repliesCount"="repliesCount"+1 WHERE id=$1', [original.approvedNoteId]);
      await db.query('UPDATE note SET "renoteCount"="renoteCount"+1 WHERE id=$1', [id]);
      await db.query('UPDATE "user" SET "notesCount"="notesCount"+1 WHERE id=$1', [row.authorId]);
      await db.query('UPDATE community_submission SET "sourceCommentId"=$2 WHERE id=$1', [row.id, commentId]);
      notifications.push({ recipientId: original.authorId, type: 'comment', actorId: row.authorId, workId: original.id, commentId });
    }
  }
  return id;
}

async function sourceWork(ctx: RequestContext, db: Queryable, id: unknown): Promise<CommunityRow> {
  if (!id) fail(400, 'A source work is required');
  const target = await accessibleWork(ctx, id, { db, publicOnly: true });
  await accessibleWork({ ...ctx, user: null }, id, { db, publicOnly: true });
  const note = (await db.query<IdRow>('SELECT id FROM note WHERE id=$1 AND visibility=\'public\' FOR KEY SHARE', [target.approvedNoteId])).rows[0];
  if (!note) fail(404, 'Source work unavailable');
  return target;
}

async function writeRevision(db: Queryable, id: string, revision: CommunityRevision, extra: RevisionState): Promise<void> {
  await db.query(`UPDATE community_submission SET category=$2,title=$3,text=$4,model=$5,"sourceUrl"=$6,license=$7,"fileIds"=$8,"tagIds"=$9,
    generation=$10,"pendingRevision"=$11,status=$12,"approvedNoteId"=$13,version=version+1,"rejectionReason"=$14 WHERE id=$1`,
  [id, revision.category, revision.title, revision.text, revision.model, revision.sourceUrl, revision.license, revision.fileIds, revision.tagIds, revision.generation, extra.pendingRevision ?? null, extra.status, extra.noteId ?? null, extra.rejectionReason ?? null]);
}

export async function removeNote(db: Queryable, noteId: string | null | undefined): Promise<void> {
  if (!noteId) return;
  const removed = await db.query<{ userId: string; replyId: string | null; renoteId: string | null }>('DELETE FROM note WHERE id = $1 RETURNING "userId","replyId","renoteId"', [noteId]);
  if (removed.rows[0]) await db.query('UPDATE "user" SET "notesCount" = GREATEST(0, "notesCount" - 1) WHERE id = $1', [removed.rows[0].userId]);
  if (removed.rows[0]?.replyId) await db.query('UPDATE note SET "repliesCount"=GREATEST(0,"repliesCount"-1) WHERE id=$1', [removed.rows[0].replyId]);
  if (removed.rows[0]?.renoteId) await db.query('UPDATE note SET "renoteCount"=GREATEST(0,"renoteCount"-1) WHERE id=$1', [removed.rows[0].renoteId]);
}

async function createWork(ctx: RequestContext): Promise<true> {
  const actor = user(ctx);
  const body = ctx.body ?? {};
  const destination = body.destination ?? 'community';
  if (destination !== 'community' && destination !== 'source-comment') fail(400, 'Invalid publication destination');
  let requestId = body.idempotencyKey ?? body.requestId;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) fail(400, 'An idempotency key is required');
  if (body.status !== undefined && (typeof body.status !== 'string' || !['draft', 'pending', 'published'].includes(body.status))) fail(400, 'Invalid publication state');
  const draft = body.status === 'draft';
  const revision = normalizeRevision(body);
  const notifications: Parameters<typeof notifyUser>[1][] = [];
  if (destination === 'source-comment') {
    if (draft || revision.category === 'video' || !revision.generation?.sourceWorkId || !revision.generation.model || typeof body.resultId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.resultId)) fail(400, 'Invalid source comment');
    revision.generation.referenceFileIds = [];
    revision.generation.shareToSource = false;
    requestId = `source-comment-${createHash('sha256').update(`${revision.generation.sourceWorkId}:${body.resultId}`).digest('hex').slice(0, 48)}`;
  }
  const id = await transaction(ctx.db, async db => {
    const attachments = await validateRevision(db, actor.id, revision, body, draft);
    if (destination === 'source-comment') {
      if (attachments.some(file => file.type.startsWith('video/'))) fail(400, 'Video comments are unavailable');
      await sourceWork(ctx, db, revision.generation?.sourceWorkId);
    }
    const payloadHash = createHash('sha256').update(JSON.stringify(revision)).digest('hex');
    const existing = (await db.query<CommunityRow>('SELECT * FROM community_submission WHERE "authorId"=$1 AND "idempotencyKey"=$2 FOR UPDATE', [actor.id, requestId])).rows[0];
    if (existing) {
      if (existing.destination !== destination || (destination === 'source-comment' ? existing.generation?.sourceWorkId !== revision.generation?.sourceWorkId : existing.payloadHash !== payloadHash && !samePayload(existing, revision) || (existing.status === 'draft') !== draft)) fail(409, 'This request key was used for different content');
      return existing.id;
    }
    const mode = (await settings(db)).communityPublicationMode === 'after' ? 'after' : 'before';
    const workId = newId(ctx);
    const inserted = await db.query<IdRow>(`INSERT INTO community_submission
      (id,"authorId","idempotencyKey","payloadHash",destination,category,title,text,model,"sourceUrl",license,"fileIds","tagIds",generation,status,"publicationMode","submittedAt",version)
      VALUES ($1,$2,$3,$4,$16,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),0)
      ON CONFLICT ("authorId","idempotencyKey") DO NOTHING RETURNING id`,
    [workId, actor.id, requestId, payloadHash, revision.category, revision.title, revision.text, revision.model, revision.sourceUrl, revision.license, revision.fileIds, revision.tagIds, revision.generation, draft ? 'draft' : 'pending', mode, destination]);
    if (!inserted.rows.length) {
      const retry = (await db.query<CommunityRow>('SELECT * FROM community_submission WHERE "authorId"=$1 AND "idempotencyKey"=$2', [actor.id, requestId])).rows[0];
      if (!retry || retry.destination !== destination || (destination === 'source-comment' ? retry.generation?.sourceWorkId !== revision.generation?.sourceWorkId : retry.payloadHash !== payloadHash && !samePayload(retry, revision) || (retry.status === 'draft') !== draft)) fail(409, 'Request conflict');
      return retry.id;
    }
    if (!draft && mode === 'after') {
      const noteId = await publish(ctx, db, { id: workId, destination, authorId: actor.id }, revision, attachments, notifications);
      await db.query('UPDATE community_submission SET status=\'published\',"approvedNoteId"=$2 WHERE id=$1', [workId, noteId]);
    }
    return workId;
  });
  for (const notification of notifications) await inform(ctx, notification);
  return send(ctx, 201, await workResponse(ctx, id));
}

async function updateWork(ctx: RequestContext, workId: string): Promise<true> {
  const actor = user(ctx);
  const body = ctx.body ?? {};
  const version = integer(body.version, 0, 2147483647);
  await transaction(ctx.db, async db => {
    const row = await accessibleWork(ctx, workId, { lock: true, db });
    if (row.authorId !== actor.id) fail(403, 'Only the owner may edit this work');
    if (row.version !== version) fail(409, 'Work changed; refresh before editing');
    if (row.destination === 'source-comment' && (row.sourceCommentId || row.status !== 'pending')) fail(409, 'A completed source comment cannot be reposted');
    const previous = row.pendingRevision ?? row;
    const revision = normalizeRevision(body, previous);
    if (row.destination === 'source-comment' && (!revision.generation || revision.generation.sourceWorkId !== row.generation?.sourceWorkId || revision.generation.referenceFileIds.length || !revision.generation.model)) fail(400, 'Invalid source comment revision');
    revision.tagIds = previous.tagIds ?? row.tagIds;
    const isPublished = ['approved', 'published'].includes(row.status) && row.approvedNoteId;
    const draft = !isPublished && body.status === 'draft';
    const attachments = await validateRevision(db, actor.id, revision, body, draft, row.approvedNoteId);
    const mode = (await settings(db)).communityPublicationMode === 'after' ? 'after' : 'before';
    if (isPublished && (row.pendingRevision || mode !== 'after')) {
      await db.query('UPDATE community_submission SET "pendingRevision"=$2,version=version+1,"rejectionReason"=NULL WHERE id=$1', [row.id, revision]);
    } else {
      const noteId = isPublished ? await publish(ctx, db, row, revision, attachments) : null;
      await writeRevision(db, row.id, revision, { noteId, status: isPublished ? 'published' : draft ? 'draft' : 'pending' });
    }
  });
  return send(ctx, 200, await workResponse(ctx, workId));
}

async function reviewWork(ctx: RequestContext, workId: string): Promise<true> {
  const actor = moderator(ctx);
  const body = ctx.body ?? {};
  const requestedAction = body.action === 'published' ? 'approve' : body.action === 'rejected' ? 'reject' : body.action;
  if (requestedAction !== 'approve' && requestedAction !== 'reject' && requestedAction !== 'remove') fail(400, 'Invalid review action');
  const action: ReviewAction = requestedAction;
  const reason = text(body.reason, 1000);
  if (action !== 'approve' && !reason) fail(400, 'A review reason is required');
  const version = integer(body.version, 0, 2147483647);
  const notifications: Parameters<typeof notifyUser>[1][] = [];
  await transaction(ctx.db, async db => {
    const row = await accessibleWork(ctx, workId, { lock: true, db });
    if (row.version !== version || row.status === 'draft') fail(409, 'Work changed or is still a private draft');
    const editing = Boolean(row.pendingRevision);
    const allowed = action === 'approve' ? ['pending', 'published'] : action === 'reject' ? ['pending'] : ['published', 'approved'];
    if (!allowed.includes(row.status) && !(editing && action !== 'remove')) fail(409, 'This work cannot receive that decision');
    let revision = row;
    let noteId = row.approvedNoteId;
    if (action === 'approve') {
      revision = editing ? { ...row, ...row.pendingRevision } : row;
      const attachments = await validateRevision(db, row.authorId, revision, { tagIds: revision.tagIds }, false, noteId);
      noteId = await publish(ctx, db, row, revision, attachments, notifications);
    } else if (action === 'remove') {
      await removeNote(db, noteId);
      noteId = null;
    }
    const status = action === 'approve' ? 'approved' : action === 'remove' ? 'removed' : editing ? row.status : 'rejected';
    await writeRevision(db, row.id, revision, { status, noteId, rejectionReason: reason || null });
    await db.query('UPDATE community_submission SET "reviewedAt"=NOW(),"reviewedById"=$2 WHERE id=$1', [row.id, actor.id]);
    await db.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4)', [newId(ctx), actor.id, 'communityReview', { submissionId: row.id, action, reason, version }]);
    if (action === 'remove' || action === 'reject' && body.recordViolation === true) await recordViolation(ctx, db, row.authorId, `work:${row.id}`, reason);
    if (action !== 'approve') await db.query(`INSERT INTO announcement (id,title,text,"userId",icon,display,"needConfirmationToRead")
      VALUES ($1,$2,$3,$4,'warning','banner',true)`, [newId(ctx), editing && action === 'reject' ? 'Edit rejected; original kept' : action === 'remove' ? 'Work removed' : 'Submission rejected', `${row.title}\n${reason}`, row.authorId]);
    notifications.push({ recipientId: row.authorId, type: 'review', actorId: actor.id, workId: row.id, text: action === 'approve' ? '作品已通过审核。' : reason });
  });
  for (const notification of notifications) await inform(ctx, notification);
  return send(ctx, 200, await workResponse(ctx, workId));
}

export async function recordViolation(ctx: RequestContext, db: Queryable, userId: string, contentKey: string, reason: string): Promise<void> {
  const actor = user(ctx);
  await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
  const inserted = await db.query(`INSERT INTO community_violation ("contentKey","userId","moderatorId",reason,"createdAt")
    VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT ("contentKey") DO NOTHING RETURNING "contentKey"`, [contentKey, userId, actor.id, reason]);
  if (!inserted.rows.length) return;
  await db.query('UPDATE "user" SET "communityViolationCount"="communityViolationCount"+1 WHERE id=$1', [userId]);
  const options = await settings(db);
  const threshold = typeof options.communityViolationThreshold === 'number' && Number.isInteger(options.communityViolationThreshold) && options.communityViolationThreshold >= 1 && options.communityViolationThreshold <= 1000 ? options.communityViolationThreshold : 3;
  if (options.communityAutoBanEnabled === false) return;
  if ((await getUser(db, userId))?.isModerator) return;
  const suspended = await db.query(`UPDATE "user" SET "isSuspended"=true WHERE id=$1 AND NOT "isSuspended"
    AND NOT "isDeleted" AND host IS NULL AND "communityViolationCount"-"communityViolationBaseline">=$2 RETURNING id`, [userId, threshold]);
  if (suspended.rows.length) await db.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4)', [newId(ctx), actor.id, 'suspend', { userId, reason: 'Community violation threshold', contentKey }]);
}

async function interaction(ctx: RequestContext, workId: string, type: 'like' | 'save'): Promise<true> {
  const actor = user(ctx);
  if (typeof ctx.body?.active !== 'boolean') fail(400, 'An explicit active state is required');
  const notification = await transaction(ctx.db, async db => {
    const row = await accessibleWork(ctx, workId, { lock: true, db, publicOnly: true });
    if (!row.approvedNoteId) fail(409, 'The work is not published');
    await db.query('SELECT id FROM note WHERE id=$1 FOR UPDATE', [row.approvedNoteId]);
    if (type === 'save') {
      if (ctx.body.active) await db.query('INSERT INTO note_favorite (id,"userId","noteId") VALUES ($1,$2,$3) ON CONFLICT ("userId","noteId") DO NOTHING', [newId(ctx), actor.id, row.approvedNoteId]);
      else await db.query('DELETE FROM note_favorite WHERE "userId"=$1 AND "noteId"=$2', [actor.id, row.approvedNoteId]);
    } else {
      if (actor.id === row.authorId) fail(400, 'You cannot like your own work');
      if (ctx.body.active) {
        const existing = (await db.query<{ reaction: string }>('SELECT reaction FROM note_reaction WHERE "userId"=$1 AND "noteId"=$2', [actor.id, row.approvedNoteId])).rows[0];
        if (existing && ![heart, `${heart}\ufe0f`].includes(existing.reaction)) fail(409, 'Remove the existing reaction first');
        const added = await db.query('INSERT INTO note_reaction (id,"userId","noteId",reaction) VALUES ($1,$2,$3,$4) ON CONFLICT ("userId","noteId") DO NOTHING RETURNING id', [newId(ctx), actor.id, row.approvedNoteId, heart]);
        if (added.rowCount) {
          await syncReactions(db, row.approvedNoteId);
          return { recipientId: row.authorId, type: 'like', actorId: actor.id, workId: row.id };
        }
      } else await db.query('DELETE FROM note_reaction WHERE "userId"=$1 AND "noteId"=$2 AND reaction IN ($3,$4)', [actor.id, row.approvedNoteId, heart, `${heart}\ufe0f`]);
      await syncReactions(db, row.approvedNoteId);
    }
    return null;
  });
  if (notification) await inform(ctx, notification);
  const rows = await contentRows(ctx, { workId });
  return send(ctx, 200, { work: await packWork(ctx, rows[0]) });
}

async function syncReactions(db: Queryable, noteId: string): Promise<void> {
  await db.query(`UPDATE note SET reactions=COALESCE((SELECT jsonb_object_agg(reaction,amount) FROM
    (SELECT reaction,COUNT(*)::int AS amount FROM note_reaction WHERE "noteId"=$1 GROUP BY reaction) counted),'{}'::jsonb) WHERE id=$1`, [noteId]);
}

async function follow(ctx: RequestContext, targetId: string): Promise<true> {
  const actor = user(ctx);
  if (actor.id === targetId || typeof ctx.body?.active !== 'boolean') fail(400, 'Invalid follow request');
  const changed = await transaction(ctx.db, async db => {
    const targets = await db.query<IdRow & { isLocked: boolean }>(`SELECT id,"isLocked" FROM "user" WHERE id=ANY($1::varchar[]) AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" ORDER BY id FOR UPDATE`, [[actor.id, targetId]]);
    const target = targets.rows.find(row => row.id === targetId);
    if (!target || targets.rows.length !== 2) fail(404, 'Account not found');
    if ((await db.query('SELECT 1 FROM blocking WHERE ("blockerId"=$1 AND "blockeeId"=$2) OR ("blockerId"=$2 AND "blockeeId"=$1)', [actor.id, targetId])).rows.length) fail(403, 'Following is unavailable');
    if (ctx.body.active && target.isLocked) fail(409, 'This account requires follow approval');
    let changed: number | null;
    if (ctx.body.active) changed = (await db.query('INSERT INTO following (id,"followerId","followeeId") VALUES ($1,$2,$3) ON CONFLICT ("followerId","followeeId") DO NOTHING RETURNING id', [newId(ctx), actor.id, targetId])).rowCount;
    else changed = (await db.query('DELETE FROM following WHERE "followerId"=$1 AND "followeeId"=$2 RETURNING id', [actor.id, targetId])).rowCount;
    if (changed) {
      const delta = ctx.body.active ? 1 : -1;
      await db.query('UPDATE "user" SET "followingCount"=GREATEST(0,"followingCount"+$2) WHERE id=$1', [actor.id, delta]);
      await db.query('UPDATE "user" SET "followersCount"=GREATEST(0,"followersCount"+$2) WHERE id=$1', [targetId, delta]);
    }
    return Boolean(changed);
  });
  if (changed && ctx.body.active) await inform(ctx, { recipientId: targetId, type: 'follow', actorId: actor.id });
  return send(ctx, 200, { followed: ctx.body.active });
}

async function upload(ctx: RequestContext): Promise<true> {
  user(ctx);
  return send(ctx, 201, { file: await uploadMedia(ctx) });
}

export function byteRange(header: string | undefined, size: number): ByteRange | false | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || start >= size || (!match[1] && Number(match[2]) === 0)) return false;
  return { start, end };
}

function visibleAccountSql(alias: string): string {
  return `${alias}.host IS NULL AND NOT ${alias}."isDeleted" AND NOT ${alias}."isSuspended" AND ${alias}."movedToUri" IS NULL
    AND ($1::varchar IS NOT NULL OR NOT ${alias}."requireSigninToViewContents")
    AND NOT EXISTS (SELECT 1 FROM blocking blocked WHERE
      (blocked."blockerId"=$1 AND blocked."blockeeId"=${alias}.id) OR (blocked."blockeeId"=$1 AND blocked."blockerId"=${alias}.id))`;
}

function commentVisibilitySql(ctx: RequestContext, author = 'u', note = 'n'): string {
  return `${note}.visibility='public' AND ${visibleAccountSql(author)} AND ${privacySql(ctx.config?.id ?? 'aidx', author, note)}`;
}

async function media(ctx: RequestContext, value: string, byKey = false): Promise<true> {
  const requestedVariant = ctx.url.searchParams.get('variant') ?? 'original';
  const variant = requestedVariant === 'web' ? 'webpublic' : requestedVariant;
  if (!['original', 'thumbnail', 'webpublic'].includes(variant)) fail(400, 'Invalid media variant');
  if (byKey ? !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(value) : !idPattern.test(value)) fail(404, 'File not found');
  const keyWhere = byKey ? '(f."accessKey"=$2 OR f."thumbnailAccessKey"=$2 OR f."webpublicAccessKey"=$2)' : 'f.id=$2';
  const result = await ctx.db.query<MediaRow>(`
    SELECT f.id,f.name,f.type,f."accessKey",f."thumbnailAccessKey",f."webpublicAccessKey",f."webpublicType"
    FROM drive_file f WHERE ${keyWhere} AND f."storedInternal" AND NOT f."isLink"
    AND (f."userId"=$1 OR $3::boolean OR EXISTS (
      SELECT 1 FROM community_submission s JOIN "user" u ON u.id=s."authorId"
      JOIN note n ON n.id=s."approvedNoteId" WHERE (${visibilitySql(ctx)}) AND f."userId"=s."authorId"
      AND (f.id=ANY(s."fileIds") OR (s.generation->'referenceFileIds') ? f.id))
      OR EXISTS (SELECT 1 FROM note comment JOIN "user" ca ON ca.id=comment."userId"
        JOIN community_submission s ON s."approvedNoteId"=comment."replyId" OR s."approvedNoteId"=comment."threadId"
        JOIN "user" u ON u.id=s."authorId" JOIN note n ON n.id=s."approvedNoteId"
        WHERE (${visibilitySql(ctx)}) AND (${commentVisibilitySql(ctx, 'ca', 'comment')})
        AND f."userId"=comment."userId" AND f.id=ANY(comment."fileIds"))
      OR EXISTS (SELECT 1 FROM "user" profile WHERE f."userId"=profile.id
        AND (profile."avatarId"=f.id OR profile."bannerId"=f.id) AND ${visibleAccountSql('profile')})
      OR EXISTS (SELECT 1 FROM chat_message dm JOIN "user" sender ON sender.id=dm."fromUserId"
        JOIN "user" recipient ON recipient.id=dm."toUserId"
        WHERE dm."fileId"=f.id AND dm."toRoomId" IS NULL AND f."userId"=dm."fromUserId"
        AND (dm."fromUserId"=$1 OR dm."toUserId"=$1) AND sender.host IS NULL AND recipient.host IS NULL
        AND NOT sender."isDeleted" AND NOT sender."isSuspended" AND NOT recipient."isDeleted" AND NOT recipient."isSuspended"
        AND NOT EXISTS (SELECT 1 FROM blocking blocked WHERE
          (blocked."blockerId"=sender.id AND blocked."blockeeId"=recipient.id) OR (blocked."blockeeId"=sender.id AND blocked."blockerId"=recipient.id))))`,
  [viewer(ctx), value, Boolean(ctx.user?.isAdmin || ctx.user?.isModerator)]);
  const file = result.rows[0];
  if (!file) fail(404, 'File not found');
  const preferred = byKey ? value === file.thumbnailAccessKey ? 'thumbnail' : value === file.webpublicAccessKey ? 'webpublic' : 'original' : variant;
  let role = preferred === 'thumbnail' && file.thumbnailAccessKey ? 'thumbnail' : preferred === 'webpublic' && file.webpublicAccessKey ? 'webpublic' : 'original';
  const key = role === 'thumbnail' ? file.thumbnailAccessKey : role === 'webpublic' ? file.webpublicAccessKey : file.accessKey;
  const storedFile = async (accessKey: string | null): Promise<{ path: string; metadata: Stats }> => {
    if (typeof accessKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(accessKey) || accessKey === '.' || accessKey === '..') fail(404, 'File not found');
    const root = await realpath(ctx.filesRoot);
    const path = await realpath(resolve(root, accessKey));
    const displacement = relative(root, path);
    if (displacement === '..' || displacement.startsWith(`..${sep}`) || resolve(root, displacement) !== path) fail(404, 'File not found');
    const metadata = await stat(path);
    if (!metadata.isFile()) fail(404, 'File not found');
    return { path, metadata };
  };
  let path: string, metadata: Stats;
  try { ({ path, metadata } = await storedFile(key)); }
  catch (error) {
    if (role === 'original' || !isRecord(error) || error.code !== 'ENOENT') fail(404, 'File not found');
    role = 'original';
    try { ({ path, metadata } = await storedFile(file.accessKey)); } catch { fail(404, 'File not found'); }
  }
  let type = role === 'webpublic' ? file.webpublicType : file.type;
  if (role === 'thumbnail') {
    const descriptor = await open(path, 'r');
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await descriptor.read(header, 0, header.length, 0);
      type = sniffType(header.subarray(0, bytesRead), 'application/octet-stream');
    } finally { await descriptor.close(); }
  }
  const mime = type && inlineTypes.has(type) ? type : 'application/octet-stream';
  ctx.reply.header('Content-Type', mime);
  ctx.reply.header('X-Content-Type-Options', 'nosniff');
  ctx.reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
  ctx.reply.header('Cache-Control', 'private, no-store');
  ctx.reply.header('Accept-Ranges', 'bytes');
  ctx.reply.header('Content-Disposition', `${type && inlineTypes.has(type) ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`);
  const range = byteRange(ctx.req.headers.range, metadata.size);
  if (range === false) {
    ctx.reply.code(416).header('Content-Range', `bytes */${metadata.size}`).send();
    return true;
  }
  if (range) ctx.reply.header('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
  ctx.reply.header('Content-Length', range ? range.end - range.start + 1 : metadata.size);
  ctx.reply.code(range ? 206 : 200);
  if (ctx.req.method === 'HEAD') { ctx.reply.send(); return true; }
  const stream = createReadStream(path, range || {});
  const cancel = () => { stream.destroy(); };
  ctx.res.once('close', cancel);
  stream.once('close', () => ctx.res.removeListener('close', cancel));
  ctx.reply.send(stream);
  return true;
}

async function comments(ctx: RequestContext, workId: string): Promise<true> {
  const work = await accessibleWork(ctx, workId, { publicOnly: true });
  if (!work.approvedNoteId) fail(404, 'Work not found');
  if (ctx.req.method === 'GET') {
    const parent = ctx.url.searchParams.get('parentId');
    if (parent) await visibleComment(ctx, ctx.db, work, identifier(parent));
    const cursor = ctx.url.searchParams.get('cursor');
    if (cursor) identifier(cursor);
    const limit = ctx.url.searchParams.has('limit') ? integer(Number(ctx.url.searchParams.get('limit')), 1, 100) : 50;
    const result = await ctx.db.query<CommentRow>(`SELECT n.id,n.text,n."userId",n."fileIds",n."renoteId",n."replyId",n."repliesCount",u.name,u.username,u."avatarId",
      (SELECT COUNT(*)::int FROM note_reaction r WHERE r."noteId"=n.id AND r.reaction IN ('${heart}','${heart}\ufe0f')) AS likes,
      EXISTS (SELECT 1 FROM note_reaction r WHERE r."noteId"=n.id AND r."userId"=$1 AND r.reaction IN ('${heart}','${heart}\ufe0f')) AS liked
      FROM note n JOIN "user" u ON u.id=n."userId"
      WHERE n."replyId"=$3 AND (n."replyId"=$2 OR n."threadId"=$2) AND (${commentVisibilitySql(ctx)})
      AND ($4::varchar IS NULL OR n.id<$4) ORDER BY n.id DESC LIMIT $5`,
    [viewer(ctx), work.approvedNoteId, parent || work.approvedNoteId, cursor || null, limit + 1]);
    const items = [];
    for (const row of result.rows.slice(0, limit)) {
      const files = row.fileIds?.length ? (await ctx.db.query<Pick<DriveFileRow, 'id' | 'name' | 'type' | 'size'>>('SELECT id,name,type,size FROM drive_file WHERE id=ANY($1::varchar[]) AND "userId"=$2 ORDER BY id', [row.fileIds, row.userId])).rows : [];
      const remixed = row.renoteId ? (await ctx.db.query<IdRow>(`SELECT s.id FROM community_submission s JOIN "user" u ON u.id=s."authorId"
        JOIN note n ON n.id=s."approvedNoteId" WHERE n.id=$2 AND (${visibilitySql(ctx)})`, [viewer(ctx), row.renoteId])).rows[0] : null;
      items.push({ id: row.id, text: row.text, userId: row.userId, author: row.name || row.username,
        parentId: row.replyId !== work.approvedNoteId ? row.replyId : null,
        authorId: row.userId, authorAvatarUrl: row.avatarId ? `/legacy-files/${row.avatarId}?variant=thumbnail` : null,
        date: new Date(legacyIdTime(row.id, ctx.config?.id) || Date.now()).toISOString(),
        likes: Number(row.likes ?? 0), likesCount: Number(row.likes ?? 0), liked: Boolean(row.liked), repliesCount: Number(row.repliesCount ?? 0),
        files: files.map(file => ({ ...file, url: `/legacy-files/${file.id}` })), ...(remixed ? { sourceWorkId: remixed.id } : {}),
        owned: row.userId === viewer(ctx), removable: row.userId === viewer(ctx) || work.authorId === viewer(ctx) || Boolean(ctx.user?.isModerator || ctx.user?.isAdmin) });
    }
    return send(ctx, 200, { items, nextCursor: result.rows.length > limit ? result.rows[limit - 1].id : null });
  }
  const actor = user(ctx), body = text(ctx.body?.text, 3000);
  const rawIds = ctx.body.fileIds ?? [];
  if (!Array.isArray(rawIds) || rawIds.length > 16 || new Set(rawIds).size !== rawIds.length) fail(400, 'Invalid comment attachments');
  const fileIds = rawIds.map(identifier);
  if (!body && !fileIds.length) fail(400, 'A comment is required');
  const id = newId(ctx);
  const reply = ctx.body.replyToId ?? ctx.body.parentId;
  const result = await transaction(ctx.db, async db => {
    const locked = await accessibleWork(ctx, workId, { db, lock: true, publicOnly: true });
    const parentId = reply ? identifier(reply) : locked.approvedNoteId;
    let recipient = locked.authorId;
    if (parentId !== locked.approvedNoteId) {
      const parent = await visibleComment(ctx, db, locked, identifier(parentId), true);
      recipient = parent.userId;
    }
    const files = fileIds.length ? (await db.query<Pick<DriveFileRow, 'id' | 'name' | 'type' | 'size'>>('SELECT id,name,type,size FROM drive_file WHERE id=ANY($1::varchar[]) AND "userId"=$2 FOR KEY SHARE', [fileIds, actor.id])).rows : [];
    if (files.length !== fileIds.length) fail(400, 'An attachment is missing or belongs to another account');
    await db.query('INSERT INTO note (id,"userId",text,visibility,"localOnly","replyId","threadId","replyUserId","fileIds","attachedFileTypes") VALUES ($1,$2,$3,\'public\',true,$4,$5,$6,$7,$8)', [id, actor.id, body || null, parentId, locked.approvedNoteId, recipient, fileIds, files.map(file => file.type)]);
    await db.query('UPDATE note SET "repliesCount"=LEAST(32767,"repliesCount"+1) WHERE id=$1', [parentId]);
    await db.query('UPDATE "user" SET "notesCount"="notesCount"+1 WHERE id=$1', [actor.id]);
    return { recipient, parentId, files };
  });
  await inform(ctx, { recipientId: result.recipient, type: 'comment', actorId: actor.id, workId, commentId: id, text: body.slice(0, 300) });
  return send(ctx, 201, { comment: { id, text: body, parentId: result.parentId === work.approvedNoteId ? null : result.parentId,
    userId: actor.id, authorId: actor.id, author: actor.name || actor.username, authorAvatarUrl: actor.avatarId ? `/legacy-files/${actor.avatarId}?variant=thumbnail` : null,
    date: new Date().toISOString(), fileIds, files: result.files.map(file => ({ ...file, url: `/legacy-files/${file.id}` })), likesCount: 0, likes: 0, liked: false, repliesCount: 0,
    owned: true, removable: true } });
}

async function visibleComment(ctx: RequestContext, db: Queryable, work: CommunityRow, commentId: string, lock = false): Promise<CommentRow> {
  const result = await db.query<CommentRow>(`SELECT n.id,n.text,n."userId",n."fileIds",n."replyId",n."renoteId",n."repliesCount",u.name,u.username,u."avatarId"
    FROM note n JOIN "user" u ON u.id=n."userId" WHERE n.id=$2 AND (n."replyId"=$3 OR n."threadId"=$3)
    AND (${commentVisibilitySql(ctx)}) ${lock ? 'FOR KEY SHARE OF n' : ''}`, [viewer(ctx), commentId, work.approvedNoteId]);
  if (!result.rows[0]) fail(404, 'Comment not found');
  return result.rows[0];
}

async function commentLike(ctx: RequestContext, workId: string, commentId: string): Promise<true> {
  const actor = user(ctx);
  if (typeof ctx.body.active !== 'boolean') fail(400, 'An explicit active state is required');
  const result = await transaction(ctx.db, async db => {
    const work = await accessibleWork(ctx, workId, { db, lock: true, publicOnly: true });
    const comment = await visibleComment(ctx, db, work, commentId, true);
    if (comment.userId === actor.id) fail(400, 'You cannot like your own comment');
    await db.query('SELECT id FROM note WHERE id=$1 FOR UPDATE', [commentId]);
    let changed = false;
    if (ctx.body.active) {
      const previous = (await db.query<{ reaction: string }>('SELECT reaction FROM note_reaction WHERE "userId"=$1 AND "noteId"=$2', [actor.id, commentId])).rows[0];
      if (previous && ![heart, `${heart}\ufe0f`].includes(previous.reaction)) fail(409, 'Remove the existing reaction first');
      const inserted = await db.query(`INSERT INTO note_reaction (id,"userId","noteId",reaction) VALUES ($1,$2,$3,$4)
        ON CONFLICT ("userId","noteId") DO NOTHING RETURNING id`, [newId(ctx), actor.id, commentId, heart]);
      changed = Boolean(inserted.rowCount);
    } else await db.query('DELETE FROM note_reaction WHERE "userId"=$1 AND "noteId"=$2 AND reaction IN ($3,$4)', [actor.id, commentId, heart, `${heart}\ufe0f`]);
    await syncReactions(db, commentId);
    const count = (await db.query<{ likes: number }>('SELECT COUNT(*)::int AS likes FROM note_reaction WHERE "noteId"=$1 AND reaction IN ($2,$3)', [commentId, heart, `${heart}\ufe0f`])).rows[0]?.likes ?? 0;
    return { recipientId: comment.userId, changed, count };
  });
  if (result.changed) await inform(ctx, { recipientId: result.recipientId, type: 'commentLike', actorId: actor.id, workId, commentId });
  return send(ctx, 200, { liked: ctx.body.active, likesCount: result.count, likes: result.count });
}

async function viewWork(ctx: RequestContext, workId: string): Promise<true> {
  const work = await accessibleWork(ctx, workId, { publicOnly: true });
  const identity = viewer(ctx) ? `user:${viewer(ctx)}` : ctx.ip ? `ip:${ctx.ip}` : null;
  let viewsCount = Number(work.viewsCount ?? 0);
  if (identity) {
    const key = `community:view:${work.id}:${createHash('sha256').update(identity).digest('hex')}`;
    if (await ctx.redis.set(key, '1', 'EX', 1800, 'NX') === 'OK') {
      try {
        const result = await ctx.db.query<{ viewsCount: number }>(`UPDATE community_submission SET "viewsCount"=LEAST("viewsCount"::bigint+1,2147483647)
          WHERE id=$1 AND status IN ('approved','published') AND "approvedNoteId"=$2 RETURNING "viewsCount"`, [work.id, work.approvedNoteId]);
        if (!result.rows[0]) fail(404, 'Work not found');
        viewsCount = result.rows[0].viewsCount;
      } catch (error) { await ctx.redis.del(key); throw error; }
    }
  }
  return send(ctx, 200, { viewsCount, views: viewsCount });
}

async function repost(ctx: RequestContext, workId: string): Promise<true> {
  const actor = user(ctx), active = ctx.body.active ?? true;
  if (typeof active !== 'boolean' || ctx.body.requestId !== undefined &&
    (typeof ctx.body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ctx.body.requestId))) fail(400, 'Invalid repost request');
  const result = await transaction(ctx.db, async db => {
    const work = await accessibleWork(ctx, workId, { db, lock: true, publicOnly: true });
    if (!work.approvedNoteId) fail(409, 'The work is not published');
    await db.query('SELECT id FROM note WHERE id=$1 FOR UPDATE', [work.approvedNoteId]);
    const previous = (await db.query<IdRow>(`SELECT id FROM note WHERE "userId"=$1 AND "renoteId"=$2
      AND text IS NULL AND "replyId" IS NULL AND cardinality("fileIds")=0`, [actor.id, work.approvedNoteId])).rows;
    const changed = active && !previous.length;
    if (changed) {
      await db.query(`INSERT INTO note (id,"userId","renoteId","renoteUserId",visibility,"localOnly")
        VALUES ($1,$2,$3,$4,'public',true)`, [newId(ctx), actor.id, work.approvedNoteId, work.authorId]);
      await db.query('UPDATE note SET "renoteCount"=LEAST(32767,"renoteCount"+1) WHERE id=$1', [work.approvedNoteId]);
      await db.query('UPDATE "user" SET "notesCount"="notesCount"+1 WHERE id=$1', [actor.id]);
    } else if (!active) for (const note of previous) await removeNote(db, note.id);
    return { changed, recipientId: work.authorId };
  });
  if (result.changed) await inform(ctx, { recipientId: result.recipientId, type: 'repost', actorId: actor.id, workId });
  const rows = await contentRows(ctx, { workId });
  const work = await packWork(ctx, rows[0]);
  return send(ctx, 200, { active, count: work.renotesCount, renoted: active, renotesCount: work.renotesCount, work });
}

interface ProfileRow extends CreatorRow {
  followingVisibility: 'public' | 'followers' | 'private';
  followersVisibility: 'public' | 'followers' | 'private';
}

async function profileRow(ctx: RequestContext, userId: string): Promise<ProfileRow> {
  const result = await ctx.db.query<ProfileRow>(`SELECT u.id,u.name,u.username,u."avatarId",u."bannerId",u."followersCount",u."followingCount",
    p.description AS bio,p."followingVisibility",p."followersVisibility",
    EXISTS (SELECT 1 FROM following f WHERE f."followerId"=$1 AND f."followeeId"=u.id) AS followed
    FROM "user" u JOIN user_profile p ON p."userId"=u.id WHERE u.id=$2 AND (${visibleAccountSql('u')})`, [viewer(ctx), userId]);
  if (!result.rows[0]) fail(404, 'Account not found');
  return result.rows[0];
}

async function profile(ctx: RequestContext, userId: string): Promise<true> {
  const row = await profileRow(ctx, userId);
  const count = (await ctx.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM community_submission s JOIN "user" u ON u.id=s."authorId"
    JOIN note n ON n.id=s."approvedNoteId" WHERE s."authorId"=$2 AND (${visibilitySql(ctx)})`, [viewer(ctx), userId])).rows[0]?.count ?? 0;
  return send(ctx, 200, { user: {
    id: row.id, username: row.username, name: row.name || row.username, bio: row.bio || '',
    avatarUrl: row.avatarId ? `/legacy-files/${row.avatarId}?variant=thumbnail` : null,
    bannerUrl: row.bannerId ? `/legacy-files/${row.bannerId}?variant=web` : null,
    followersCount: row.followersCount ?? 0, followingCount: row.followingCount ?? 0, worksCount: count,
    followed: Boolean(row.followed), isSelf: row.id === viewer(ctx),
  } });
}

async function followList(ctx: RequestContext, userId: string, mode: 'followers' | 'following'): Promise<true> {
  const account = await profileRow(ctx, userId), privacy = mode === 'followers' ? account.followersVisibility : account.followingVisibility;
  if (userId !== viewer(ctx) && privacy !== 'public' && !(privacy === 'followers' && account.followed)) fail(403, 'This list is private');
  const cursor = ctx.url.searchParams.get('cursor');
  if (cursor) identifier(cursor);
  const limit = ctx.url.searchParams.has('limit') ? integer(Number(ctx.url.searchParams.get('limit')), 1, 100) : 50;
  const result = await ctx.db.query<CreatorRow & { relationId: string }>(`SELECT u.id,u.name,u.username,u."avatarId",p.description AS bio,f.id AS "relationId",
    EXISTS (SELECT 1 FROM following own WHERE own."followerId"=$1 AND own."followeeId"=u.id) AS followed
    FROM following f JOIN "user" u ON u.id=f."${mode === 'followers' ? 'followerId' : 'followeeId'}" JOIN user_profile p ON p."userId"=u.id
    WHERE f."${mode === 'followers' ? 'followeeId' : 'followerId'}"=$2 AND (${visibleAccountSql('u')})
    AND ($3::varchar IS NULL OR f.id<$3) ORDER BY f.id DESC LIMIT $4`, [viewer(ctx), userId, cursor || null, limit + 1]);
  return send(ctx, 200, {
    items: result.rows.slice(0, limit).map(row => ({ id: row.id, username: row.username, name: row.name || row.username,
      bio: row.bio || '', avatarUrl: row.avatarId ? `/legacy-files/${row.avatarId}?variant=thumbnail` : null, followed: Boolean(row.followed) })),
    nextCursor: result.rows.length > limit ? result.rows[limit - 1].relationId : null,
  });
}

async function report(ctx: RequestContext, workId: string): Promise<true> {
  const actor = user(ctx), reason = text(ctx.body.reason, 1000);
  if (!reason) fail(400, 'A report reason is required');
  const work = await accessibleWork(ctx, workId, { publicOnly: true });
  const comment = ctx.body.commentId ? await visibleComment(ctx, ctx.db, work, identifier(ctx.body.commentId)) : null;
  const targetId = comment?.userId ?? work.authorId;
  if (targetId === actor.id || (await getUser(ctx.db, targetId))?.isAdmin) fail(403, 'This account cannot be reported');
  const rateKey = `community:report:${actor.id}:${Math.floor(Date.now() / 60000)}`;
  const attempts = await ctx.redis.incr(rateKey);
  if (attempts === 1) await ctx.redis.expire(rateKey, 120);
  if (attempts > 5) fail(429, 'Too many reports; try again later');
  const contentKey = comment ? `note:${comment.id}` : `work:${work.id}`;
  const id = await transaction(ctx.db, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`community-report:${actor.id}:${contentKey}`]);
    const existing = (await db.query<IdRow>('SELECT id FROM abuse_user_report WHERE "reporterId"=$1 AND "contentKey"=$2 AND NOT resolved LIMIT 1', [actor.id, contentKey])).rows[0];
    if (existing) return existing.id;
    const id = newId(ctx);
    await db.query(`INSERT INTO abuse_user_report (id,"targetUserId","reporterId",comment,"contentKey","contentSnapshot")
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, targetId, actor.id,
      `${new URL(`/work/${work.id}`, ctx.config.url).href}${comment ? `#comment-${comment.id}` : ''}\n${reason}`, contentKey,
      JSON.stringify(comment ? { workId: work.id, noteId: comment.id, userId: comment.userId, text: comment.text, fileIds: comment.fileIds }
        : { workId: work.id, noteId: work.approvedNoteId, title: work.title, text: work.text, fileIds: work.fileIds })]);
    return id;
  });
  return send(ctx, 201, { id, accepted: true });
}

function legacyWork(work: PackedWork) {
  return {
    ...work, category: work.kind, text: work.body, status: work.originalStatus,
    author: { id: work.authorId, name: work.author, username: work.authorUsername ?? '' },
    tags: work.tags.map((name, index) => ({ id: work.tagIds[index], category: work.kind, name })),
    approvedNoteId: work.noteId, submittedAt: work.date, likesCount: work.likes,
    sourceCommentStatus: work.sourceCommentStatus ?? 'none',
  };
}

function legacyAlias(ctx: RequestContext): RequestContext | null {
  if (ctx.req.method !== 'POST') return null;
  const names: Record<string, [path: string, method: string, format?: 'receipt' | 'work' | 'list']> = {
    '/api/community/submissions/create': ['/api/works', 'POST', 'receipt'],
    '/api/community/submissions/update': [`/api/works/${ctx.body?.submissionId}`, 'PATCH', 'work'],
    '/api/community/submissions/delete': [`/api/works/${ctx.body?.submissionId}`, 'DELETE'],
    '/api/community/submissions/show': [`/api/works/${ctx.body?.submissionId}`, 'GET', 'work'],
    '/api/community/submissions/mine': ['/api/library', 'GET', 'list'],
    '/api/community/works': ['/api/works', 'GET', 'list'],
    '/api/community/works/show': [`/api/works/${ctx.body?.submissionId}`, 'GET', 'work'],
    '/api/community/tags': ['/api/tags', 'GET'],
    '/api/community/comments/delete': [`/api/works/${ctx.body?.submissionId}/comments/${ctx.body?.noteId}`, 'DELETE'],
    '/api/admin/community/submissions': ['/api/admin/submissions', 'GET', 'list'],
    '/api/admin/community/submissions/review': [`/api/admin/submissions/${ctx.body?.submissionId}/review`, 'POST', 'work'],
  };
  const route = names[ctx.url.pathname];
  if (!route) return null;
  const url = new URL(route[0], ctx.url);
  for (const key of ['category', 'query', 'authorId', 'status']) if (typeof ctx.body?.[key] === 'string') url.searchParams.set(key, ctx.body[key]);
  if (typeof ctx.body?.untilId === 'string') url.searchParams.set('cursor', ctx.body.untilId);
  const req = Object.create(ctx.req) as IncomingMessage;
  req.method = route[1];
  return {
    ...ctx, url, req,
    body: { ...ctx.body, action: ctx.body?.action ?? ctx.body?.decision },
    json(status: number, payload: unknown) {
      const response = payload as { work?: PackedWork; items?: PackedWork[] };
      if (route[2] === 'receipt' && response.work) ctx.json(status, { id: response.work.id, status: response.work.originalStatus, submittedAt: response.work.date, sourceCommentStatus: response.work.sourceCommentStatus ?? 'none' });
      else if (route[2] === 'work' && response.work) ctx.json(status, legacyWork(response.work));
      else if (route[2] === 'list' && response.items) ctx.json(status, { ...response, items: response.items.map(legacyWork) });
      else ctx.json(status, payload);
    },
  };
}

export async function handleContent(ctx: RequestContext): Promise<boolean> {
  const alias = legacyAlias(ctx);
  if (alias) return handleContent(alias);
  const path = ctx.url.pathname, method = ctx.req.method;
  let match: RegExpExecArray | null;
  if ((match = /^\/(?:legacy-files|files)\/([^/]+)$/.exec(path)) && (method === 'GET' || method === 'HEAD')) return media(ctx, decodeURIComponent(match[1]), path.startsWith('/files/'));
  if (path === '/api/uploads' && method === 'POST') return upload(ctx);
  if (path === '/api/uploads/limits' && method === 'GET') return send(ctx, 200, await uploadLimitsFor(ctx));
  if ((match = /^\/api\/uploads\/([a-zA-Z0-9]+)$/.exec(path)) && method === 'GET') {
    const actor = user(ctx);
    const file = (await ctx.db.query<DriveFileRow & { url: string }>('SELECT id,name,type,size,url,"thumbnailAccessKey",properties,"storedInternal" FROM drive_file WHERE id=$1 AND "userId"=$2 AND "storedInternal" AND NOT "isLink"', [identifier(match[1]), actor.id])).rows[0];
    if (!file) fail(404, 'File not found');
    return send(ctx, 200, { file: fileDto({ ...file, properties: file.properties ?? null }) });
  }
  if ((path === '/api/works' || path === '/api/community/works') && method === 'GET') {
    const { rows, nextCursor } = await contentPage(ctx, { authorId: ctx.url.searchParams.get('authorId') || undefined });
    return send(ctx, 200, { items: await Promise.all(rows.map(row => packWork(ctx, row))), nextCursor });
  }
  if (path === '/api/works' && method === 'POST') return createWork(ctx);
  if (path === '/api/library' && method === 'GET') {
    user(ctx);
    const { rows, nextCursor } = await contentPage(ctx, { scope: ctx.url.searchParams.get('status') === 'saved' ? 'saved' : 'mine' });
    return send(ctx, 200, { items: await Promise.all(rows.map(row => packWork(ctx, row, row.authorId === viewer(ctx)))), nextCursor });
  }
  if (path === '/api/admin/submissions' && method === 'GET') {
    moderator(ctx);
    const { rows, nextCursor } = await contentPage(ctx, { scope: 'admin' });
    return send(ctx, 200, { items: await Promise.all(rows.map(row => packWork(ctx, row, true))), nextCursor });
  }
  if ((match = /^\/api\/admin\/submissions\/([a-zA-Z0-9]+)\/review$/.exec(path)) && method === 'POST') return reviewWork(ctx, identifier(match[1]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/(like|save)$/.exec(path)) && method === 'POST') return interaction(ctx, identifier(match[1]), match[2] as 'like' | 'save');
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/view$/.exec(path)) && method === 'POST') return viewWork(ctx, identifier(match[1]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/repost$/.exec(path)) && method === 'POST') return repost(ctx, identifier(match[1]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/report$/.exec(path)) && method === 'POST') return report(ctx, identifier(match[1]));
  if (path === '/api/reports' && method === 'POST') return report(ctx, identifier(ctx.body.workId));
  if ((match = /^\/api\/users\/([a-zA-Z0-9]+)$/.exec(path)) && method === 'GET') return profile(ctx, identifier(match[1]));
  if ((match = /^\/api\/users\/([a-zA-Z0-9]+)\/(followers|following)$/.exec(path)) && method === 'GET') return followList(ctx, identifier(match[1]), match[2] as 'followers' | 'following');
  if ((match = /^\/api\/users\/([a-zA-Z0-9]+)\/follow$/.exec(path)) && method === 'POST') return follow(ctx, identifier(match[1]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/comments$/.exec(path)) && (method === 'GET' || method === 'POST')) return comments(ctx, identifier(match[1]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/comments\/([a-zA-Z0-9]+)\/like$/.exec(path)) && method === 'POST') return commentLike(ctx, identifier(match[1]), identifier(match[2]));
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)\/comments\/([a-zA-Z0-9]+)$/.exec(path)) && method === 'DELETE') {
    const actor = user(ctx);
    const workId = identifier(match[1]), commentId = identifier(match[2]);
    await transaction(ctx.db, async db => {
      const work = await accessibleWork(ctx, workId, { db, lock: true });
      const comment = (await db.query<IdRow & { userId: string }>('SELECT id,"userId" FROM note WHERE id=$1 AND ("replyId"=$2 OR "threadId"=$2) FOR UPDATE', [commentId, work.approvedNoteId])).rows[0];
      if (!comment) fail(404, 'Comment not found');
      if (comment.userId !== actor.id && work.authorId !== actor.id && !actor.isAdmin && !actor.isModerator) fail(403, 'Only the comment or work owner may remove this comment');
      await removeNote(db, comment.id);
    });
    return send(ctx, 200, { deleted: true });
  }
  if ((match = /^\/api\/works\/([a-zA-Z0-9]+)$/.exec(path))) {
    const id = identifier(match[1]);
    if (method === 'GET') {
      const row = await accessibleWork(ctx, id);
      if (row.authorId === viewer(ctx) || ctx.user?.isAdmin || ctx.user?.isModerator) return send(ctx, 200, await workResponse(ctx, id));
      const rows = await contentRows(ctx, { workId: id });
      return send(ctx, 200, { work: await packWork(ctx, rows[0]) });
    }
    if (method === 'PATCH') return updateWork(ctx, id);
    if (method === 'DELETE') {
      const actor = user(ctx);
      const version = integer(ctx.body?.version, 0, 2147483647);
      await transaction(ctx.db, async db => {
        const row = await accessibleWork(ctx, id, { lock: true, db: db });
        if (row.authorId !== actor.id) fail(403, 'Only the owner may delete this work');
        if (row.version !== version) fail(409, 'Work changed; refresh before deleting');
        await removeNote(db, row.approvedNoteId);
        if (row.destination === 'source-comment') await db.query('UPDATE community_submission SET status=\'removed\',"approvedNoteId"=NULL,version=version+1 WHERE id=$1', [id]);
        else await db.query('DELETE FROM community_submission WHERE id=$1', [id]);
      });
      return send(ctx, 200, { deleted: true });
    }
  }
  if (path === '/api/tags' && method === 'GET') {
    const kind = ctx.url.searchParams.get('kind') || ctx.url.searchParams.get('category');
    if (kind && !isKind(kind)) fail(400, 'Invalid category');
    const result = await ctx.db.query<TagRow>('SELECT id,name,category FROM community_tag WHERE NOT "isDeleted" AND ($1::varchar IS NULL OR category=$1) ORDER BY category,id', [kind || null]);
    return send(ctx, 200, { items: result.rows });
  }
  if (path === '/api/creators' && method === 'GET') {
    const result = await ctx.db.query<CreatorRow>(`SELECT u.id,u.name,u.username,u."avatarId",p.description AS bio,COUNT(s.id)::int AS count,
      EXISTS (SELECT 1 FROM following f WHERE f."followerId"=$1 AND f."followeeId"=u.id) AS followed
      FROM community_submission s JOIN "user" u ON u.id=s."authorId" JOIN user_profile p ON p."userId"=u.id JOIN note n ON n.id=s."approvedNoteId"
      WHERE (${visibilitySql(ctx)}) AND ($2::varchar IS NULL OR u.id=$2)
      GROUP BY u.id,p.description ORDER BY count DESC,u.id LIMIT 100`, [viewer(ctx), ctx.url.searchParams.has('authorId') ? identifier(ctx.url.searchParams.get('authorId')) : null]);
    return send(ctx, 200, { items: result.rows.map(row => ({ id: row.id, authorId: row.id, name: row.name || row.username, username: row.username,
      avatar: (row.name || row.username).slice(0, 1), avatarUrl: row.avatarId ? `/legacy-files/${row.avatarId}?variant=thumbnail` : null, count: row.count, followed: row.followed, bio: row.bio || '' })) });
  }
  if (path === '/api/announcements' && method === 'GET') {
    const result = await ctx.db.query<AnnouncementRow>(`SELECT id,title,text,icon,display,"updatedAt" FROM announcement
      WHERE "isActive" AND ("userId" IS NULL OR "userId"=$1) AND ("autoArchiveAt" IS NULL OR "autoArchiveAt">NOW())
      AND (NOT "forExistingUsers" OR "userId"=$1) ORDER BY id DESC LIMIT 100`, [viewer(ctx)]);
    return send(ctx, 200, { items: result.rows });
  }
  return false;
}
