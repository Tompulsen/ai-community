/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { httpError } from './auth.ts'
import { accountCenter } from './account-session.ts'
import { idTimeSql, legacyIdTime } from './content.ts'
import { readPublicIdentities } from './public-identity.ts'
import type { RequestContext } from './types.ts'

const logLabels: Record<string, string> = {
  communityReview: '作品审核', suspend: '封禁账号', unsuspend: '解封账号', resolveAbuseReport: '处理举报',
  updateCommunityConfig: '社区设置', communitySettings: '站点设置', updateCommunityAds: '广告位设置',
  createCommunityTag: '新建标签', updateCommunityTag: '修改标签', deleteCommunityTag: '删除标签',
  createAnnouncement: '发布公告', deleteAnnouncement: '删除公告', adjustLotteryChances: '调整抽奖次数',
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(value)
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function logSummary(type: string, value: unknown) {
  const info = object(value), details: { label: string; value: string }[] = []
  let target: { label: string; to: string } | undefined
  const add = (label: string, value: unknown) => { if (typeof value === 'string' && value) details.push({ label, value: value.slice(0, 1000) }) }
  if (type === 'communityReview') {
    add('结果', { approve: '通过', reject: '驳回', remove: '撤下' }[String(info.action)])
    add('说明', info.reason)
    if (validId(info.submissionId)) target = { label: '查看作品', to: `/work/${info.submissionId}` }
  } else if (type === 'suspend' || type === 'unsuspend') {
    add('说明', info.reason)
    if (validId(info.userId)) target = { label: '查看用户', to: `/community?creator=${info.userId}` }
  } else if (type === 'resolveAbuseReport') {
    add('结果', info.resolvedAs === 'accept' ? '举报成立' : info.resolvedAs === 'reject' ? '举报不成立' : '')
    add('说明', info.moderationNote)
    if (validId(info.reportId)) add('举报编号', info.reportId)
    target = { label: '举报处理', to: '/admin?tab=reports' }
  } else if (['createCommunityTag', 'updateCommunityTag', 'deleteCommunityTag'].includes(type)) {
    add('标签', info.name); target = { label: '管理标签', to: '/admin?tab=tags' }
  } else if (type === 'updateCommunityConfig' || type === 'communitySettings') {
    const labels: Record<string, string> = { brand: '社区名称', logoUrl: '品牌标识', registrationOpen: '注册规则',
      communityPublicationMode: '审核规则', publicationMode: '审核规则', communityAutoBanEnabled: '自动封禁', autoBan: '自动封禁',
      communityViolationThreshold: '违规阈值', violationThreshold: '违规阈值', communityFeedMode: '推荐方式', communityFeedPoolSize: '推荐范围',
      communityPullToRefresh: '下拉刷新', uploadLimits: '上传限制', defaultModels: '默认模型', ads: '广告位' }
    add('变更项', [...new Set(Object.keys(object(info.config ?? info.settings)).flatMap(key => labels[key] ? [labels[key]] : []))].join('、'))
  } else if (type === 'updateCommunityAds') target = { label: '广告位设置', to: '/admin?tab=ads' }
  else if (type === 'createAnnouncement' || type === 'deleteAnnouncement') target = { label: '社区公告', to: '/community?tab=announcements' }
  else if (type === 'adjustLotteryChances') {
    if (Number.isSafeInteger(info.before) && Number.isSafeInteger(info.after)) add('次数变化', `${info.before} → ${info.after}`)
    add('说明', info.reason); target = { label: '抽奖管理', to: '/admin?tab=lottery' }
  }
  // Unknown log types expose metadata only. Never return raw info, credentials or saved configuration.
  return { details, ...(target ? { target } : {}) }
}
async function overview(ctx: RequestContext) {
  const user = ctx.requireUser()
  if (!user.isAdmin && !user.isModerator) throw httpError(403, '需要审核员权限。')
  const days = ctx.url.searchParams.get('days') ?? '7'
  if (!['7', '30'].includes(days)) throw httpError(400, '请选择近 7 天或近 30 天。')
  const to = new Date(), from = new Date(to.getTime() - Number(days) * 86400000)
  const [works, reports, users] = await Promise.all([
    ctx.db.query<{ pending: number; published: number; rejected: number; newWorks: number }>(`SELECT
      (COUNT(*) FILTER (WHERE s.status='pending' OR s."pendingRevision" IS NOT NULL))::int AS pending,
      (COUNT(*) FILTER (WHERE s.status='published' OR (s.status='approved' AND s."approvedNoteId" IS NOT NULL)))::int AS published,
      (COUNT(*) FILTER (WHERE s.status IN ('rejected','removed')))::int AS rejected,
      (COUNT(*) FILTER (WHERE s."submittedAt">=$1 AND s."submittedAt"<$2))::int AS "newWorks"
      FROM community_submission s JOIN "user" u ON u.id=s."authorId"`, [from, to]),
    ctx.db.query<{ open: number }>('SELECT COUNT(*)::int AS open FROM abuse_user_report WHERE NOT resolved'),
    user.isAdmin ? ctx.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "user" u WHERE u.host IS NULL AND NOT u."isDeleted"
      AND ${idTimeSql('u.id', ctx.config.id)}>=$1 AND ${idTimeSql('u.id', ctx.config.id)}<$2`, [from.getTime(), to.getTime()]) : null,
  ])
  const counts = works.rows[0]!
  return { counts: { pending: counts.pending, published: counts.published, rejected: counts.rejected, reports: reports.rows[0]!.open },
    period: { days: Number(days), from: from.toISOString(), to: to.toISOString(), newWorks: counts.newWorks,
      ...(user.isAdmin ? { newUsers: users!.rows[0]!.count } : {}) }, updatedAt: to.toISOString() }
}
async function logs(ctx: RequestContext) {
  ctx.requireAdmin()
  const params = ctx.url.searchParams, type = params.get('type') || '', actor = (params.get('actor') || '').trim(), cursor = params.get('cursor') || null
  const from = params.get('from') ? Date.parse(params.get('from')!) : Date.now() - 30 * 86400000
  const to = params.get('to') ? Date.parse(params.get('to')!) : Date.now() + 1000
  if (type && !Object.hasOwn(logLabels, type) || actor.length > 120 || /[\u0000-\u001f]/.test(actor) || cursor && !validId(cursor)
    || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * 86400000) throw httpError(400, '请检查筛选条件，日期范围最多一年。')
  const escaped = `%${actor.replace(/[\\%_]/g, '\\$&')}%`
  const rows = (await ctx.db.query<{ id: string; userId: string; type: string; info: unknown; name: string | null; username: string | null }>(`SELECT l.id,l."userId",l.type,l.info,u.name,u.username
    FROM moderation_log l LEFT JOIN "user" u ON u.id=l."userId"
    WHERE ($1='' OR l.type=$1) AND ($2::varchar IS NULL OR l.id<$2)
      AND ($3='' OR l."userId"=$3 OR u.name ILIKE $4 OR u.username ILIKE $4 OR EXISTS
        (SELECT 1 FROM external_account e WHERE e."userId"=l."userId" AND e.issuer=$7 AND (e.username ILIKE $4 OR e.subject=$3)))
      AND ${idTimeSql('l.id', ctx.config.id)}>=$5 AND ${idTimeSql('l.id', ctx.config.id)}<$6
    ORDER BY l.id DESC LIMIT 31`, [type, cursor, actor, escaped, from, to, accountCenter(ctx.config)])).rows
  const page = rows.slice(0, 30), identities = await readPublicIdentities(ctx, page.map(row => row.userId))
  return { items: page.map(row => {
    const identity = identities.get(row.userId), time = legacyIdTime(row.id, ctx.config.id)
    return { id: row.id, type: row.type, label: logLabels[row.type] || '其他管理操作', date: Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? new Date(time).toISOString() : null,
      actor: { id: row.userId, name: row.name || identity?.username || row.username || '已删除账号', username: identity?.username ?? row.username ?? '' },
      ...logSummary(row.type, row.info) }
  }), nextCursor: rows.length > 30 ? page[29]!.id : null, types: Object.entries(logLabels).map(([value, label]) => ({ value, label })) }
}
export async function handleAdminInsights(ctx: RequestContext): Promise<boolean> {
  if (ctx.req.method !== 'GET') return false
  if (ctx.url.pathname === '/api/admin/overview') { ctx.json(200, await overview(ctx)); return true }
  if (ctx.url.pathname === '/api/admin/logs') { ctx.json(200, await logs(ctx)); return true }
  return false
}
