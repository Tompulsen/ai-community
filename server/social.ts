/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto'
import { handleNotifications } from './notification-inbox.ts'
export { compareStreamIds } from './notification-inbox.ts'
import { accessibleWork, legacyIdTime, transaction } from './content.ts'
import { getUser, httpError, roleCondition } from './auth.ts'
import { readPublicIdentities, type PublicIdentity } from './public-identity.ts'
import type { Queryable, RequestContext, SessionUser } from './types.ts'

const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(value)) throw httpError(400, '编号无效。')
  return value
}
interface NoticeInput { recipientId: string; type: string; actorId?: string; workId?: string; commentId?: string; text?: string }
export async function notifyUser(ctx: RequestContext, input: NoticeInput): Promise<void> {
  if (input.recipientId === input.actorId) return
  try {
    const recipient = (await ctx.db.query<{ notificationRecieveConfig: Record<string, { type?: string; userListId?: string }> }>(`SELECT p."notificationRecieveConfig"
      FROM user_profile p JOIN "user" u ON u.id=p."userId" WHERE p."userId"=$1 AND u.host IS NULL
      AND NOT u."isDeleted" AND NOT u."isSuspended"`, [input.recipientId])).rows[0]
    if (!recipient) return
    const originalTypes: Record<string, string> = { like: 'reaction', comment: 'reply', commentLike: 'reaction', repost: 'renote' }
    const preference = recipient.notificationRecieveConfig?.[input.type] || recipient.notificationRecieveConfig?.[originalTypes[input.type] || input.type]
    if (preference?.type === 'never') return
    if (input.actorId) {
      const hidden = await ctx.db.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM blocking
        WHERE ("blockerId"=$1 AND "blockeeId"=$2) OR ("blockerId"=$2 AND "blockeeId"=$1))
        OR EXISTS (SELECT 1 FROM muting WHERE "muterId"=$1 AND "muteeId"=$2 AND ("expiresAt" IS NULL OR "expiresAt">NOW()))`,
      [input.recipientId, input.actorId])
      if (hidden.rowCount) return
      if (preference?.type && ['following', 'follower', 'mutualFollow', 'followingOrFollower', 'list'].includes(preference.type)) {
        const relation = (await ctx.db.query<{ following: boolean; follower: boolean; member: boolean }>(`SELECT
          EXISTS(SELECT 1 FROM following WHERE "followerId"=$1 AND "followeeId"=$2) AS following,
          EXISTS(SELECT 1 FROM following WHERE "followerId"=$2 AND "followeeId"=$1) AS follower,
          EXISTS(SELECT 1 FROM user_list_membership WHERE "userListId"=$3 AND "userId"=$2 AND "userListUserId"=$1) AS member`,
        [input.recipientId, input.actorId, preference.userListId || null])).rows[0]
        if (!relation || preference.type === 'following' && !relation.following || preference.type === 'follower' && !relation.follower
          || preference.type === 'mutualFollow' && !(relation.following && relation.follower)
          || preference.type === 'followingOrFollower' && !(relation.following || relation.follower)
          || preference.type === 'list' && !relation.member) return
      }
    }
    await ctx.redis.xadd(`notificationTimeline:${input.recipientId}`, 'MAXLEN', '~', 1000, '*', 'data', JSON.stringify({
      id: ctx.newId(), type: input.type, notifierId: input.actorId, workId: input.workId, commentId: input.commentId,
      text: input.text?.slice(0, 500), createdAt: new Date().toISOString(),
    }))
  } catch { console.error(JSON.stringify({ code: 'NOTIFICATION_DELIVERY_FAILED' })) }
}

interface ChatRow { id: string; fromUserId: string; toUserId: string; text: string | null; reads: string[]; fileId?: string | null }
interface ChatFile { id: string; userId: string; name: string; type: string; size: number }
interface ChatPeer { id: string; username: string; name: string | null; avatarId: string | null; chatScope: string }
async function chatAvailability(ctx: RequestContext, db: Queryable, userId: string, write: boolean): Promise<boolean> {
  const [meta, roles, assignments, users] = await Promise.all([
    db.query<{ policies: { chatAvailability?: string } }>('SELECT policies FROM meta LIMIT 1'),
    db.query<{ id: string; target: string; condFormula: unknown; policies: { chatAvailability?: { useDefault?: boolean; value?: string; priority?: number } } }>('SELECT id,target,"condFormula",policies FROM role'),
    db.query<{ roleId: string }>('SELECT "roleId" FROM role_assignment WHERE "userId"=$1 AND ("expiresAt" IS NULL OR "expiresAt">NOW())', [userId]),
    db.query<SessionUser>('SELECT * FROM "user" WHERE id=$1', [userId]),
  ])
  const assigned = new Set(assignments.rows.map(row => row.roleId))
  const policies = roles.rows.filter(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, users.rows[0] || {}, assigned))
    .flatMap(role => role.policies.chatAvailability && !role.policies.chatAvailability.useDefault ? [role.policies.chatAvailability] : [])
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  const policy = policies[0]?.value || meta.rows[0]?.policies?.chatAvailability || 'available'
  return policy === 'available' || (!write && policy === 'readonly')
}
async function peer(ctx: RequestContext, db: Queryable, otherId: string, lock = false): Promise<ChatPeer> {
  const me = ctx.requireUser()
  if (otherId === me.id) throw httpError(400, '不能向自己发送私信。')
  const result = await db.query<ChatPeer>(`SELECT id,username,name,"avatarId","chatScope" FROM "user"
    WHERE id=$1 AND host IS NULL AND NOT "isSuspended" AND NOT "isDeleted" AND "movedToUri" IS NULL ${lock ? 'FOR UPDATE' : ''}`, [otherId])
  if (!result.rows[0]) throw httpError(404, '用户不可用。')
  const blocked = await db.query(`SELECT 1 FROM blocking WHERE ("blockerId"=$1 AND "blockeeId"=$2) OR ("blockerId"=$2 AND "blockeeId"=$1)`, [me.id, otherId])
  if (blocked.rowCount) throw httpError(403, '当前无法访问此会话。')
  if (!await chatAvailability(ctx, db, me.id, false)) throw httpError(403, '当前账号没有私信权限。')
  return result.rows[0]
}
async function sending(ctx: RequestContext, db: Queryable, other: ChatPeer): Promise<string> {
  const me = ctx.requireUser()
  const mutual = await db.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM following WHERE "followerId"=$1 AND "followeeId"=$2)
    AND EXISTS (SELECT 1 FROM following WHERE "followerId"=$2 AND "followeeId"=$1)`, [me.id, other.id])
  if (!mutual.rowCount) return '双方互相关注后，可以分享作品和表情。'
  if (other.chatScope === 'none') return '对方已关闭私信。'
  if (!await chatAvailability(ctx, db, me.id, true) || !await chatAvailability(ctx, db, other.id, true)) return '当前会话暂时不能发送消息。'
  return ''
}
function sharedId(text: string | null, site: string): string | undefined {
  if (!text) return
  for (const prefix of ['/work/', '/community/work/']) {
    const base = new URL(prefix, site).href
    if (text.startsWith(base) && /^[a-zA-Z0-9]{1,32}$/.test(text.slice(base.length))) return text.slice(base.length)
  }
}
export function builtinEmoji(text: string): boolean {
  return text.length <= 32 && /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D)*$/u.test(text)
}
async function chatContent(ctx: RequestContext, db: Queryable, text: string, recipient: SessionUser): Promise<{ text: string; sharedWorkId?: string }> {
  const workId = sharedId(text, ctx.config.url)
  if (workId) {
    await accessibleWork(ctx, workId, { db, publicOnly: true })
    await accessibleWork({ ...ctx, user: recipient }, workId, { db, publicOnly: true })
    return { text: new URL(`/work/${workId}`, ctx.config.url).href, sharedWorkId: workId }
  }
  if (builtinEmoji(text)) return { text }
  const custom = /^:([\w+-]{1,100}):$/.exec(text)
  if (custom && (await db.query(`SELECT id FROM emoji WHERE name=$1 AND host IS NULL
    AND cardinality("roleIdsThatCanBeUsedThisEmojiAsReaction")=0`, [custom[1]])).rowCount) return { text }
  throw httpError(400, '私信支持本站作品链接和内置表情。')
}
async function messageFiles(ctx: RequestContext, rows: ChatRow[]): Promise<Map<string, ChatFile>> {
  const ids = [...new Set(rows.flatMap(row => row.fileId ? [row.fileId] : []))]
  const files = ids.length ? (await ctx.db.query<ChatFile>('SELECT id,"userId",name,type,size FROM drive_file WHERE id=ANY($1::varchar[])', [ids])).rows : []
  return new Map(files.map(file => [file.id, file]))
}
function packedMessage(ctx: RequestContext, row: ChatRow, files = new Map<string, ChatFile>()) {
  const file = row.fileId ? files.get(row.fileId) : undefined
  return { id: row.id, text: row.text || '', owned: row.fromUserId === ctx.user!.id,
    read: row.reads.includes(row.toUserId), date: new Date(legacyIdTime(row.id, ctx.config.id)).toISOString(),
    sharedWorkId: sharedId(row.text, ctx.config.url), ...(file && file.userId === row.fromUserId
      ? { file: { id: file.id, name: file.name, type: file.type, size: file.size, url: `/legacy-files/${file.id}` } } : {}) }
}
function peerDto(other: ChatPeer, identity?: PublicIdentity) {
  const username = identity?.username ?? other.username
  return { id: other.id, username, ...(identity ? { accountId: identity.accountId } : {}),
    name: other.name || username || '章鱼用户',
    avatarUrl: other.avatarId ? `/legacy-files/${other.avatarId}?variant=thumbnail` : null }
}

export async function handleSocial(ctx: RequestContext): Promise<boolean> {
  const path = ctx.url.pathname, method = ctx.req.method
  if (path.startsWith('/api/notifications')) return handleNotifications(ctx)
  if (!path.startsWith('/api/messages')) return false
  const me = ctx.requireUser()
  if ((path === '/api/messages/threads' || path === '/api/messages') && method === 'GET') {
    if (!await chatAvailability(ctx, ctx.db, me.id, false)) throw httpError(403, '当前账号没有私信权限。')
    const cursor = ctx.url.searchParams.get('cursor')
    if (cursor) id(cursor)
    const [page, unread] = await Promise.all([
      ctx.db.query<ChatRow & ChatPeer & { messageId: string; unread: number }>(`WITH latest AS (
      SELECT DISTINCT ON (CASE WHEN m."fromUserId"=$1 THEN m."toUserId" ELSE m."fromUserId" END) m.*
      FROM chat_message m WHERE (m."fromUserId"=$1 OR m."toUserId"=$1) AND m."toRoomId" IS NULL
      ORDER BY CASE WHEN m."fromUserId"=$1 THEN m."toUserId" ELSE m."fromUserId" END,m.id DESC)
      SELECT u.id,u.username,u.name,u."avatarId",u."chatScope",m.id AS "messageId",m.text,m."fromUserId",m."toUserId",m.reads,m."fileId",
      (SELECT COUNT(*)::int FROM chat_message unread WHERE unread."toUserId"=$1 AND unread."fromUserId"=u.id AND unread."toRoomId" IS NULL AND NOT ($1=ANY(unread.reads))) AS unread
      FROM latest m JOIN "user" u ON u.id=CASE WHEN m."fromUserId"=$1 THEN m."toUserId" ELSE m."fromUserId" END
      WHERE u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
      AND ($2::varchar IS NULL OR m.id<$2)
      AND NOT EXISTS (SELECT 1 FROM blocking b WHERE (b."blockerId"=$1 AND b."blockeeId"=u.id) OR (b."blockerId"=u.id AND b."blockeeId"=$1))
      ORDER BY m.id DESC LIMIT 31`, [me.id, cursor]),
      ctx.db.query<{ unreadCount: number }>(`SELECT COUNT(*)::int AS "unreadCount"
        FROM chat_message m JOIN "user" u ON u.id=m."fromUserId"
        WHERE m."toUserId"=$1 AND m."toRoomId" IS NULL AND NOT ($1=ANY(m.reads))
        AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocking b WHERE
          (b."blockerId"=$1 AND b."blockeeId"=u.id) OR (b."blockerId"=u.id AND b."blockeeId"=$1))`, [me.id]),
    ])
    const rows = page.rows
    const files = await messageFiles(ctx, rows.slice(0, 30))
    const identities = await readPublicIdentities(ctx, rows.slice(0, 30).map(row => row.id))
    const items = await Promise.all(rows.slice(0, 30).map(async row => {
      const reason = await sending(ctx, ctx.db, row)
      return { user: peerDto(row, identities.get(row.id)), lastMessage: packedMessage(ctx, { ...row, id: row.messageId }, files), unread: row.unread, canSend: !reason, reason }
    }))
    ctx.json(200, { items, nextCursor: rows.length > 30 ? rows[29]!.messageId : null, unreadCount: unread.rows[0]?.unreadCount ?? 0 })
    return true
  }
  const match = /^\/api\/messages\/([a-zA-Z0-9]{1,32})(\/read)?$/.exec(path)
  if (!match) return false
  const otherId = id(match[1]), other = await peer(ctx, ctx.db, otherId)
  if (method === 'GET' && !match[2]) {
    const cursor = ctx.url.searchParams.get('cursor')
    if (cursor) id(cursor)
    const rows = (await ctx.db.query<ChatRow>(`SELECT id,"fromUserId","toUserId",text,reads,"fileId" FROM chat_message
      WHERE "toRoomId" IS NULL AND (("fromUserId"=$1 AND "toUserId"=$2) OR ("fromUserId"=$2 AND "toUserId"=$1))
      AND ($3::varchar IS NULL OR id<$3) ORDER BY id DESC LIMIT 51`, [me.id, otherId, cursor])).rows
    const reason = await sending(ctx, ctx.db, other)
    const files = await messageFiles(ctx, rows.slice(0, 50))
    const identity = (await readPublicIdentities(ctx, [other.id])).get(other.id)
    ctx.json(200, { user: peerDto(other, identity), items: rows.slice(0, 50).map(row => packedMessage(ctx, row, files)),
      nextCursor: rows.length > 50 ? rows[49]!.id : null, canSend: !reason, reason })
    return true
  }
  if (method === 'POST' && match[2]) {
    await ctx.db.query(`UPDATE chat_message SET reads=array_append(reads,$1)
      WHERE "toUserId"=$1 AND "fromUserId"=$2 AND NOT ($1=ANY(reads))`, [me.id, otherId])
    await ctx.redis.del(`newUserChatMessageExists:${me.id}:${otherId}`)
    await ctx.redis.srem(`newChatMessagesExists:${me.id}`, `user:${otherId}`)
    ctx.json(200, { ok: true })
    return true
  }
  if (method === 'POST') {
    const text = ctx.body.sharedWorkId ? new URL(`/work/${id(ctx.body.sharedWorkId)}`, ctx.config.url).href : ctx.body.text
    if (typeof text !== 'string' || !text || text !== text.trim() || text.length > 2048 || ctx.body.fileId) throw httpError(400, '请选择本站作品或内置表情。')
    const requestId = ctx.body.requestId
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(requestId)) throw httpError(400, '请求编号无效。')
    const limiter = `community-next:message-rate:${me.id}`
    if (await ctx.redis.incr(limiter) === 1) await ctx.redis.expire(limiter, 60)
    if (Number(await ctx.redis.get(limiter)) > 30) throw httpError(429, '发送过于频繁，请稍后重试。')
    let added = false
    const message = await transaction(ctx.db, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`message:${me.id}:${requestId}`])
      const locked = await peer(ctx, db, otherId, true)
      const reason = await sending(ctx, db, locked)
      if (reason) throw httpError(403, reason)
      const recipient = await getUser(db, otherId)
      if (!recipient) throw httpError(404, '用户不可用。')
      const content = await chatContent(ctx, db, text, recipient)
      const uri = `urn:community:message:${createHash('sha256').update(me.id + ':' + requestId).digest('hex')}`
      const previous = (await db.query<ChatRow>('SELECT id,text,"fromUserId","toUserId",reads FROM chat_message WHERE "fromUserId"=$1 AND uri=$2', [me.id, uri])).rows[0]
      if (previous) {
        if (previous.text !== content.text || previous.toUserId !== otherId) throw httpError(409, '请求编号已用于其他消息。')
        return previous
      }
      added = true
      return (await db.query<ChatRow>(`INSERT INTO chat_message(id,"fromUserId","toUserId",text,uri)
        VALUES($1,$2,$3,$4,$5) RETURNING id,"fromUserId","toUserId",text,reads`, [ctx.newId(), me.id, otherId, content.text, uri])).rows[0]!
    })
    if (added) {
      await ctx.redis.set(`newUserChatMessageExists:${otherId}:${me.id}`, message.id).catch(() => {})
      await ctx.redis.sadd(`newChatMessagesExists:${otherId}`, `user:${me.id}`).catch(() => {})
      await notifyUser(ctx, { recipientId: otherId, type: 'message', actorId: me.id, text: '分享了作品或表情' })
    }
    ctx.json(201, { message: packedMessage(ctx, message) })
    return true
  }
  return false
}
