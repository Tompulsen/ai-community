/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * Local follow approval adapted from UserFollowingService and settings/privacy.
 */
import { createHash } from 'node:crypto'
import { httpError } from './auth.ts'
import { transaction } from './content.ts'
import { notifyUser } from './social.ts'
import { readPublicIdentities } from './public-identity.ts'
import type { Queryable, RequestContext } from './types.ts'

type Visibility = 'public' | 'followers' | 'private'
interface Privacy {
  isLocked: boolean; autoAcceptFollowed: boolean; followApprovalLocalSeconds: number | null
  followingVisibility: Visibility; followersVisibility: Visibility
}
interface FollowUser extends Privacy {
  id: string; createdAt: Date | string; isBot: boolean; carefulBot: boolean
}
const privacyKeys = ['isLocked', 'autoAcceptFollowed', 'followApprovalLocalSeconds', 'followingVisibility', 'followersVisibility'] as const
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(value)) throw httpError(400, '账号或申请编号无效。')
  return value
}
const privacyColumns = 'u."isLocked",p."autoAcceptFollowed",p."followApprovalLocalSeconds",p."followingVisibility",p."followersVisibility"'
const privacyValue = (row: Privacy): Privacy => Object.fromEntries(privacyKeys.map(key => [key, row[key]])) as unknown as Privacy
const version = (value: Privacy) => createHash('sha256').update(JSON.stringify(privacyValue(value))).digest('hex')
function mutationUser(ctx: RequestContext) {
  const user = ctx.requireUser()
  if (ctx.req.headers['x-new-api-user'] !== (user.accountId || user.id)) throw httpError(409, '登录账号已变化，请刷新页面后重试。')
  return user
}

export function needsFollowApproval(target: Pick<FollowUser, 'isLocked' | 'autoAcceptFollowed' | 'followApprovalLocalSeconds' | 'carefulBot'>,
  actor: Pick<FollowUser, 'createdAt' | 'isBot'>, followedByTarget: boolean, now = Date.now()): boolean {
  if (target.autoAcceptFollowed && followedByTarget) return false
  const age = now - new Date(actor.createdAt).getTime()
  return target.isLocked || Boolean(target.carefulBot && actor.isBot)
    || Boolean((target.followApprovalLocalSeconds ?? 0) > 0 && (!Number.isFinite(age) || age < target.followApprovalLocalSeconds! * 1000))
}

export async function readRelationship(ctx: RequestContext, db: Queryable, targetId: string) {
  const result = await db.query<{ id: string; followed: boolean; requested: boolean; followsYou: boolean; isLocked: boolean;
    followersCount: number; followingCount: number; viewerFollowingCount: number; viewerFollowersCount: number }>(`SELECT u.id,u."isLocked",u."followersCount",u."followingCount",
    EXISTS(SELECT 1 FROM following WHERE "followerId"=$1 AND "followeeId"=u.id) AS followed,
    EXISTS(SELECT 1 FROM follow_request WHERE "followerId"=$1 AND "followeeId"=u.id) AS requested,
    EXISTS(SELECT 1 FROM following WHERE "followerId"=u.id AND "followeeId"=$1) AS "followsYou",
    COALESCE((SELECT "followingCount" FROM "user" WHERE id=$1),0) AS "viewerFollowingCount",
    COALESCE((SELECT "followersCount" FROM "user" WHERE id=$1),0) AS "viewerFollowersCount"
    FROM "user" u WHERE u.id=$2 AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
    AND NOT EXISTS(SELECT 1 FROM blocking WHERE ("blockerId"=$1 AND "blockeeId"=u.id) OR ("blockerId"=u.id AND "blockeeId"=$1))`, [ctx.user?.id ?? null, targetId])
  if (!result.rows[0]) throw httpError(404, '此账号暂时不可用。')
  return result.rows[0]
}

async function lockPair(db: Queryable, actorId: string, targetId: string): Promise<FollowUser[]> {
  if (actorId === targetId) throw httpError(400, '不能关注自己。')
  await db.query('SELECT id FROM "user" WHERE id=ANY($1::varchar[]) ORDER BY id FOR UPDATE', [[actorId, targetId]])
  // Read profile rules after acquiring the user locks: a concurrent privacy save may have just committed.
  const rows = (await db.query<FollowUser>(`SELECT u.id,u."createdAt",u."isBot",p."carefulBot",${privacyColumns}
    FROM "user" u JOIN user_profile p ON p."userId"=u.id
    WHERE u.id=ANY($1::varchar[]) AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
    ORDER BY u.id`, [[actorId, targetId]])).rows
  if (rows.length !== 2) throw httpError(404, '此账号暂时不可用。')
  if ((await db.query('SELECT 1 FROM blocking WHERE ("blockerId"=$1 AND "blockeeId"=$2) OR ("blockerId"=$2 AND "blockeeId"=$1)', [actorId, targetId])).rows.length) {
    throw httpError(403, '当前无法更改与此账号的关注关系。')
  }
  return rows
}

async function addFollowing(ctx: RequestContext, db: Queryable, followerId: string, followeeId: string): Promise<boolean> {
  const added = await db.query('INSERT INTO following (id,"followerId","followeeId") VALUES ($1,$2,$3) ON CONFLICT ("followerId","followeeId") DO NOTHING RETURNING id', [ctx.newId(), followerId, followeeId])
  await db.query('DELETE FROM follow_request WHERE "followerId"=$1 AND "followeeId"=$2', [followerId, followeeId])
  if (added.rowCount) {
    await db.query('UPDATE "user" SET "followingCount"="followingCount"+1 WHERE id=$1', [followerId])
    await db.query('UPDATE "user" SET "followersCount"="followersCount"+1 WHERE id=$1', [followeeId])
  }
  return Boolean(added.rowCount)
}

async function removeFollowing(db: Queryable, followerId: string, followeeId: string) {
  const removed = await db.query('DELETE FROM following WHERE "followerId"=$1 AND "followeeId"=$2 RETURNING id', [followerId, followeeId])
  await db.query('DELETE FROM follow_request WHERE "followerId"=$1 AND "followeeId"=$2', [followerId, followeeId])
  if (removed.rowCount) {
    await db.query('UPDATE "user" SET "followingCount"=GREATEST(0,"followingCount"-1) WHERE id=$1', [followerId])
    await db.query('UPDATE "user" SET "followersCount"=GREATEST(0,"followersCount"-1) WHERE id=$1', [followeeId])
  }
}

async function changeFollowing(ctx: RequestContext, targetId: string, removeFollower = false) {
  const actor = mutationUser(ctx)
  if (!removeFollower && (typeof ctx.body.active !== 'boolean' || Object.keys(ctx.body).some(key => key !== 'active'))) throw httpError(400, '关注操作无效。')
  let notice: 'follow' | 'receiveFollowRequest' | undefined
  const relationship = await transaction(ctx.db, async db => {
    const rows = await lockPair(db, actor.id, targetId)
    const target = rows.find(row => row.id === targetId)!, currentActor = rows.find(row => row.id === actor.id)!
    const previous = await readRelationship(ctx, db, targetId)
    if (removeFollower) await removeFollowing(db, targetId, actor.id)
    else if (!ctx.body.active) await removeFollowing(db, actor.id, targetId)
    else if (!previous.followed) {
      if (needsFollowApproval(target, currentActor, previous.followsYou)) {
        const added = await db.query('INSERT INTO follow_request (id,"followerId","followeeId") VALUES ($1,$2,$3) ON CONFLICT ("followerId","followeeId") DO NOTHING RETURNING id', [ctx.newId(), actor.id, targetId])
        if (added.rowCount) notice = 'receiveFollowRequest'
      } else if (await addFollowing(ctx, db, actor.id, targetId)) notice = 'follow'
    }
    return readRelationship(ctx, db, targetId)
  })
  if (notice) await notifyUser(ctx, { recipientId: targetId, actorId: actor.id, type: notice })
  return relationship
}

async function requests(ctx: RequestContext) {
  const owner = ctx.requireUser().id
  const direction = ctx.url.searchParams.get('direction') || 'received'
  if (!['received', 'sent'].includes(direction)) throw httpError(400, '请选择收到或发出的申请。')
  const cursor = ctx.url.searchParams.get('cursor')
  if (cursor) identifier(cursor)
  const received = direction === 'received'
  const where = `r."${received ? 'followeeId' : 'followerId'}"=$1 AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
    AND NOT EXISTS(SELECT 1 FROM blocking WHERE ("blockerId"=$1 AND "blockeeId"=u.id) OR ("blockerId"=u.id AND "blockeeId"=$1))`
  const join = `FROM follow_request r JOIN "user" u ON u.id=r."${received ? 'followerId' : 'followeeId'}"`
  const rows = (await ctx.db.query<{ id: string; userId: string; username: string; name: string | null; avatarId: string | null }>(`SELECT r.id,u.id AS "userId",u.username,u.name,u."avatarId" ${join}
    WHERE ${where} AND ($2::varchar IS NULL OR r.id<$2) ORDER BY r.id DESC LIMIT 31`, [owner, cursor])).rows
  const total = (await ctx.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count ${join} WHERE ${where}`, [owner])).rows[0]?.count ?? 0
  const identities = await readPublicIdentities(ctx, rows.slice(0, 30).map(row => row.userId))
  return { items: rows.slice(0, 30).map(row => ({ id: row.id, user: {
    id: row.userId, username: identities.get(row.userId)?.username ?? row.username,
    name: row.name || identities.get(row.userId)?.username || row.username,
    accountId: identities.get(row.userId)?.accountId,
    avatarUrl: row.avatarId ? `/legacy-files/${row.avatarId}?variant=thumbnail` : null,
  } })), nextCursor: rows.length > 30 ? rows[29]!.id : null, total }
}

async function resolveRequest(ctx: RequestContext, requestId: string) {
  const actor = mutationUser(ctx)
  if (!['accept', 'reject', 'cancel'].includes(String(ctx.body.action)) || Object.keys(ctx.body).some(key => key !== 'action')) throw httpError(400, '申请处理方式无效。')
  const cancel = ctx.body.action === 'cancel'
  const request = (await ctx.db.query<{ followerId: string; followeeId: string }>(`SELECT "followerId","followeeId" FROM follow_request WHERE id=$1 AND "${cancel ? 'followerId' : 'followeeId'}"=$2`, [requestId, actor.id])).rows[0]
  if (!request) throw httpError(404, '申请已处理或已撤回，请刷新列表。')
  let accepted = false
  const targetId = cancel ? request.followeeId : request.followerId
  const relationship = await transaction(ctx.db, async db => {
    await lockPair(db, actor.id, targetId)
    const exists = await db.query('SELECT id FROM follow_request WHERE id=$1 AND "followerId"=$2 AND "followeeId"=$3 FOR UPDATE', [requestId, request.followerId, request.followeeId])
    if (!exists.rows.length) throw httpError(404, '申请已处理或已撤回，请刷新列表。')
    if (ctx.body.action === 'accept') accepted = await addFollowing(ctx, db, request.followerId, request.followeeId)
    else await db.query('DELETE FROM follow_request WHERE id=$1', [requestId])
    return readRelationship(ctx, db, targetId)
  })
  if (accepted) await notifyUser(ctx, { recipientId: request.followerId, actorId: actor.id, type: 'followRequestAccepted' })
  return relationship
}

async function privacy(ctx: RequestContext) {
  const owner = (ctx.req.method === 'GET' ? ctx.requireUser() : mutationUser(ctx)).id
  const read = async (db: Queryable) => {
    const row = (await db.query<Privacy>(`SELECT ${privacyColumns} FROM "user" u JOIN user_profile p ON p."userId"=u.id WHERE u.id=$1`, [owner])).rows[0]
    if (!row) throw httpError(404, '账号设置暂时不可用。')
    return privacyValue(row)
  }
  if (ctx.req.method === 'GET') { const settings = await read(ctx.db); return { settings, version: version(settings) } }
  if (Object.keys(ctx.body).some(key => ![...privacyKeys, 'version'].includes(key))) throw httpError(400, '隐私设置字段无效。')
  if (typeof ctx.body.isLocked !== 'boolean' || typeof ctx.body.autoAcceptFollowed !== 'boolean'
    || !['public', 'followers', 'private'].includes(String(ctx.body.followingVisibility))
    || !['public', 'followers', 'private'].includes(String(ctx.body.followersVisibility))
    || !(ctx.body.followApprovalLocalSeconds === null || Number.isInteger(ctx.body.followApprovalLocalSeconds) && Number(ctx.body.followApprovalLocalSeconds) >= 0 && Number(ctx.body.followApprovalLocalSeconds) <= 2147483647)) {
    throw httpError(400, '请检查审批时间和列表公开范围。')
  }
  return transaction(ctx.db, async db => {
    await db.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [owner])
    const before = await read(db)
    if (ctx.body.version !== version(before)) throw httpError(409, '隐私设置已在其他页面修改，请重新加载后再保存。')
    await db.query('UPDATE "user" SET "isLocked"=$2 WHERE id=$1', [owner, ctx.body.isLocked])
    await db.query('UPDATE user_profile SET "autoAcceptFollowed"=$2,"followApprovalLocalSeconds"=$3,"followingVisibility"=$4,"followersVisibility"=$5 WHERE "userId"=$1',
      [owner, ctx.body.autoAcceptFollowed, ctx.body.followApprovalLocalSeconds, ctx.body.followingVisibility, ctx.body.followersVisibility])
    const settings = await read(db)
    return { settings, version: version(settings) }
  })
}

export async function handleFollowing(ctx: RequestContext): Promise<boolean> {
  const path = ctx.url.pathname, method = ctx.req.method
  let match: RegExpExecArray | null, result: unknown
  if (path === '/api/account/privacy' && (method === 'GET' || method === 'PATCH')) result = await privacy(ctx)
  else if (path === '/api/follow-requests' && method === 'GET') result = await requests(ctx)
  else if ((match = /^\/api\/follow-requests\/([a-zA-Z0-9]{1,32})$/.exec(path)) && method === 'POST') result = await resolveRequest(ctx, identifier(match[1]))
  else if ((match = /^\/api\/users\/([a-zA-Z0-9]{1,32})\/(follow|relationship|remove-follower)$/.exec(path))) {
    ctx.requireUser()
    if (match[2] === 'relationship' && method === 'GET') result = await readRelationship(ctx, ctx.db, identifier(match[1]))
    else if (match[2] !== 'relationship' && method === 'POST') result = await changeFollowing(ctx, identifier(match[1]), match[2] === 'remove-follower')
    else return false
  } else return false
  ctx.json(200, result)
  return true
}
