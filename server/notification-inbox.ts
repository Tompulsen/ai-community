/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { httpError } from './auth.ts'
import { randomBytes } from 'node:crypto'
import { readPublicIdentities } from './public-identity.ts'
import type { RequestContext } from './types.ts'

const idPattern = /^[a-zA-Z0-9]{1,32}$/
const streamPattern = /^\d{1,20}-\d{1,20}$/
const pageSize = 30
const announcementScope = `(a."userId"=$1 OR a."userId" IS NULL) AND a."isActive" AND (a."autoArchiveAt" IS NULL OR a."autoArchiveAt">NOW())`
const names: Record<string, string> = {
  follow: '有新的关注', followRequestAccepted: '关注申请已通过', mention: '有人提到了你', reply: '有新的回复', reaction: '收到点赞', like: '作品收到点赞',
  comment: '有新的评论', commentLike: '评论收到点赞', repost: '作品被转发', review: '作品审核结果',
  renote: '作品被转发', login: '账号登录提醒', receiveFollowRequest: '有新的关注请求', message: '收到私信',
}
type Category = 'activity' | 'announcement'
interface Actor { id: string; username: string; name: string | null; avatarId: string | null }
interface Announcement { id: string; title: string; text: string; updatedAt: Date | null; readId: string | null }
export function compareStreamIds(a: string, b: string): number {
  const aa = a.split('-').map(BigInt), bb = b.split('-').map(BigInt)
  return aa[0] === bb[0] ? aa[1]! < bb[1]! ? -1 : aa[1]! > bb[1]! ? 1 : 0 : aa[0]! < bb[0]! ? -1 : 1
}
function boundary(value: unknown, category: Category): string {
  if (typeof value !== 'string' || !(category === 'activity' ? streamPattern : idPattern).test(value)) throw httpError(400, '通知位置无效，请刷新后重试。')
  return value
}
async function activitySnapshot(ctx: RequestContext) {
  const owner = ctx.requireUser().id
  // The producer retains approximately 1,000 entries; count the retained stream, not only the displayed page.
  const [stream, lastRead, individual] = await Promise.all([
    ctx.redis.xrevrange(`notificationTimeline:${owner}`, '+', '-'),
    ctx.redis.get(`latestReadNotification:${owner}`), ctx.redis.hgetall(`community-next:notification-read:${owner}`),
  ])
  if (Object.keys(individual).length) await ctx.redis.persist(`community-next:notification-read:${owner}`)
  const parsed = stream.flatMap(([streamId, fields]) => {
    try {
      const index = fields.indexOf('data')
      if (index < 0 || !streamPattern.test(streamId)) return []
      const data: unknown = JSON.parse(fields[index + 1]!)
      return data && typeof data === 'object' && !Array.isArray(data) ? [{ streamId, data: data as Record<string, unknown> }] : []
    } catch { return [] }
  })
  const actors = [...new Set(parsed.flatMap(({ data }) => typeof data.notifierId === 'string' && idPattern.test(data.notifierId) ? [data.notifierId] : []))]
  const profiles = actors.length ? (await ctx.db.query<Actor>(`SELECT id,username,name,"avatarId" FROM "user"
    WHERE id=ANY($1::varchar[]) AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" AND "movedToUri" IS NULL
    AND NOT EXISTS (SELECT 1 FROM blocking b WHERE (b."blockerId"=$2 AND b."blockeeId"="user".id) OR (b."blockerId"="user".id AND b."blockeeId"=$2))
    AND NOT EXISTS (SELECT 1 FROM muting m WHERE m."muterId"=$2 AND m."muteeId"="user".id AND (m."expiresAt" IS NULL OR m."expiresAt">NOW()))`, [actors, owner])).rows : []
  const visible = new Map(profiles.map(profile => [profile.id, profile]))
  const items = parsed.flatMap(({ streamId, data }) => {
    if (data.notifierId && !visible.has(String(data.notifierId))) return []
    return [{ streamId, data, isRead: individual[streamId] === '1' || !!(lastRead && streamPattern.test(lastRead) && compareStreamIds(streamId, lastRead) <= 0) }]
  }).sort((a, b) => compareStreamIds(b.streamId, a.streamId))
  return { items, visible, individual, retained: new Set(stream.map(([id]) => id)) }
}
async function packActivity(ctx: RequestContext, entries: Awaited<ReturnType<typeof activitySnapshot>>['items'], visible: Map<string, Actor>) {
  const identities = await readPublicIdentities(ctx, [...new Set(entries.flatMap(item => item.data.notifierId ? [String(item.data.notifierId)] : []))])
  const oldNotes = [...new Set(entries.flatMap(({ data }) => typeof data.noteId === 'string' && idPattern.test(data.noteId) ? [data.noteId] : []))]
  const legacy = oldNotes.length ? (await ctx.db.query<{ noteId: string; workId: string; rootId: string }>(`SELECT n.id AS "noteId",s.id AS "workId",s."approvedNoteId" AS "rootId"
    FROM note n JOIN community_submission s ON s."approvedNoteId" IN (n.id,n."replyId",n."threadId") WHERE n.id=ANY($1::varchar[])`, [oldNotes])).rows : []
  return entries.map(({ streamId, data, isRead }) => {
    const actor = visible.get(String(data.notifierId)), identity = actor && identities.get(actor.id)
    const username = identity?.username ?? actor?.username
    const actorDto = actor ? { id: actor.id, username, ...(identity ? { accountId: identity.accountId } : {}), name: actor.name || username || '章鱼用户', avatarUrl: actor.avatarId ? `/legacy-files/${actor.avatarId}?variant=thumbnail` : null } : undefined
    const old = legacy.find(item => item.noteId === data.noteId)
    const workId = typeof data.workId === 'string' && idPattern.test(data.workId) ? data.workId : old?.workId
    const commentId = typeof data.commentId === 'string' ? data.commentId : old && old.noteId !== old.rootId ? old.noteId : null
    const type = String(data.type || '')
    const url = type === 'receiveFollowRequest' ? '/account?tab=following' : workId ? `/work/${workId}${commentId ? `#comment-${encodeURIComponent(commentId)}` : ''}` : type === 'message' && actor ? `/messages?peer=${actor.id}` : actor ? `/community?creator=${actor.id}` : '/community'
    const timestamp = Number(streamId.split('-')[0])
    return { id: `redis:${streamId}`, type: type === 'message' ? 'message' : 'activity', title: names[type] || '社区通知',
      text: typeof data.text === 'string' ? data.text : actorDto?.name || '', isRead, url, actor: actorDto,
      createdAt: Number.isFinite(timestamp) && timestamp <= 8640000000000000 ? new Date(timestamp).toISOString() : null }
  })
}
async function markActivity(ctx: RequestContext, ids: string[], snapshot: Awaited<ReturnType<typeof activitySnapshot>>) {
  const key = `community-next:notification-read:${ctx.requireUser().id}`
  const oldest = [...snapshot.retained].filter(id => streamPattern.test(id)).sort(compareStreamIds)[0]
  // A read hash can already contain newer arrivals than the stream snapshot; never prune those.
  const stale = oldest ? Object.keys(snapshot.individual).filter(id => streamPattern.test(id) && compareStreamIds(id, oldest) < 0 && !snapshot.retained.has(id)) : []
  const batch = ctx.redis.multi()
  if (ids.length) batch.hset(key, ...ids.flatMap(id => [id, '1']))
  // Keep read state for as long as its notification is retained, rather than expiring it after 30 days.
  batch.persist(key)
  if (stale.length) batch.hdel(key, ...stale)
  const result = await batch.exec()
  if (!result || result.some(([error]) => error)) throw httpError(503, '已读状态暂未保存，请重试。')
}
async function markAnnouncements(ctx: RequestContext, ids: string[]) {
  if (!ids.length) return
  await ctx.db.query(`INSERT INTO announcement_read(id,"userId","announcementId")
    SELECT selected.id,$1,a.id FROM unnest($2::varchar[],$3::varchar[]) AS selected(id,"announcementId")
    JOIN announcement a ON a.id=selected."announcementId" WHERE ${announcementScope}
    ON CONFLICT ("userId","announcementId") DO NOTHING`, [ctx.requireUser().id, ids.map(() => ctx.newId()), ids])
}
export async function handleNotifications(ctx: RequestContext): Promise<boolean> {
  const owner = ctx.requireUser().id, path = ctx.url.pathname
  if (ctx.req.method === 'GET' && path === '/api/notifications') {
    const category = ctx.url.searchParams.get('category'), cursor = ctx.url.searchParams.get('cursor')
    if (category !== null && category !== 'activity' && category !== 'announcement') throw httpError(400, '通知分类无效。')
    if (cursor && !category) throw httpError(400, '请指定通知分类。')
    if (cursor) boundary(cursor, category as Category)
    const [snapshot, summary] = await Promise.all([
      activitySnapshot(ctx),
      ctx.db.query<{ unread: number; unreadIds: string[] | null }>(`SELECT (COUNT(*) FILTER (WHERE r.id IS NULL))::int AS unread, ARRAY_AGG(a.id) FILTER (WHERE r.id IS NULL) AS "unreadIds"
        FROM announcement a LEFT JOIN announcement_read r ON r."announcementId"=a.id AND r."userId"=$1 WHERE ${announcementScope}`, [owner]),
    ])
    const activity = snapshot.items.filter(item => item.data.type !== 'message')
    const older = activity.filter(item => category !== 'activity' || !cursor || compareStreamIds(item.streamId, cursor) < 0)
    const announcements = category === 'activity' ? [] : (await ctx.db.query<Announcement>(`SELECT a.id,a.title,a.text,a."updatedAt",r.id AS "readId"
      FROM announcement a LEFT JOIN announcement_read r ON r."announcementId"=a.id AND r."userId"=$1
      WHERE ${announcementScope} AND ($2::varchar IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT 31`, [owner, category === 'announcement' ? cursor : null])).rows
    const activityItems = category === 'announcement' ? [] : await packActivity(ctx, older.slice(0, pageSize), snapshot.visible)
    const items = [...activityItems, ...announcements.slice(0, pageSize).map(row => ({ id: row.id, type: 'announcement', title: row.title, text: row.text,
      createdAt: row.updatedAt?.toISOString() || null, isRead: !!row.readId, url: '/community?tab=announcements' }))]
    let announcementSnapshot: string | null = null
    const unreadIds = summary.rows[0]?.unreadIds
    if (!cursor && unreadIds?.length) {
      announcementSnapshot = randomBytes(16).toString('hex')
      // IDs have random suffixes: a later announcement can sort below the current maximum.
      await ctx.redis.set(`community-next:announcement-snapshot:${owner}:${announcementSnapshot}`, JSON.stringify(unreadIds), 'EX', 300)
    }
    ctx.json(200, { items, unreadCounts: { activity: activity.filter(item => !item.isRead).length, announcement: summary.rows[0]?.unread ?? 0 },
      nextCursors: { activity: older.length > pageSize ? older[pageSize - 1]!.streamId : null, announcement: announcements.length > pageSize ? announcements[pageSize - 1]!.id : null },
      readThrough: { activity: activity[0]?.streamId ?? null, announcement: announcementSnapshot } })
    return true
  }
  if (ctx.req.method === 'POST' && path === '/api/notifications/read-all') {
    const category = ctx.body.category
    if ((category !== 'activity' && category !== 'announcement') || Object.keys(ctx.body).some(key => !['category', 'through'].includes(key))) throw httpError(400, '通知分类无效。')
    const through = boundary(ctx.body.through, category)
    if (category === 'activity') {
      const snapshot = await activitySnapshot(ctx)
      await markActivity(ctx, snapshot.items.filter(item => item.data.type !== 'message' && compareStreamIds(item.streamId, through) <= 0).map(item => item.streamId), snapshot)
    } else {
      const saved = await ctx.redis.get(`community-next:announcement-snapshot:${owner}:${through}`)
      if (!saved) throw httpError(409, '通知列表已更新，请刷新后再标记已读。')
      const ids: unknown = JSON.parse(saved)
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !idPattern.test(id))) throw httpError(409, '通知列表已更新，请刷新后再标记已读。')
      await markAnnouncements(ctx, ids)
    }
    ctx.json(200, { ok: true }); return true
  }
  if (ctx.req.method === 'POST' && path === '/api/notifications/read') {
    if (!Array.isArray(ctx.body.ids) || ctx.body.ids.length > 100 || ctx.body.ids.some(value => typeof value !== 'string' || !(value.startsWith('redis:') ? streamPattern.test(value.slice(6)) : idPattern.test(value)))) throw httpError(400, '通知编号无效。')
    const ids = [...new Set(ctx.body.ids as string[])]
    if (ids.some(id => id.startsWith('redis:'))) {
      const snapshot = await activitySnapshot(ctx), requested = new Set(ids)
      await markActivity(ctx, snapshot.items.filter(item => requested.has(`redis:${item.streamId}`)).map(item => item.streamId), snapshot)
    }
    await markAnnouncements(ctx, ids.filter(id => !id.startsWith('redis:')))
    ctx.json(200, { ok: true }); return true
  }
  return false
}
