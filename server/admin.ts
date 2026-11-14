/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto'
import { handleAdminInsights } from './admin-insights.ts'
import { httpError, roleCondition } from './auth.ts'
import { accountCenter } from './account-session.ts'
import { communityAdKeys, normalizeCommunityAd, type CommunityAd } from './business/ads.ts'
import { legacyIdTime } from './content.ts'
import { readSiteSettings, validateSiteBranding, validateSiteSettings } from './settings.ts'
import { readPublicIdentities, type PublicIdentity } from './public-identity.ts'
import type { Database, Queryable, RequestContext } from './types.ts'

type Body = Record<string, unknown>
type AdId = typeof communityAdKeys[number]
interface MetaRow { id: string; clientOptions: Body }
interface TagRow { id: string; category: string; name: string }
interface ManagedUser {
  id: string; username: string; name: string | null; host: string | null
  createdAt: Date | string | null
  isSuspended: boolean; isDeleted: boolean; isLocked: boolean; isBot: boolean
  isCat: boolean; isExplorable: boolean; followersCount: number; followingCount: number
  notesCount: number; communityViolationCount: number; communityViolationBaseline: number
}
interface RoleRow { id: string; target: string; condFormula: unknown; isAdministrator: boolean; isModerator: boolean }
interface ManagementRole extends RoleRow { name: string }
interface RoleAssignment { id: string; userId: string; roleId: string; expiresAt: Date | string | null }
interface AnnouncementRow { id: string; title: string; text: string; isActive: boolean; updatedAt: Date | string | null }
interface AuditRow { id: string; userId: string; type: string; info: unknown; actorId: string | null; actorUsername: string | null; actorName: string | null }
interface ReportRow {
  id: string; targetUserId: string; reporterId: string; assigneeId: string | null
  resolved: boolean; resolvedAs: 'accept' | 'reject' | null; comment: string
  contentKey: string | null; contentSnapshot: string | null; moderationNote: string
  targetUsername?: string; reporterUsername?: string
}
const configKeys = ['communityPublicationMode', 'communityAutoBanEnabled', 'communityViolationThreshold', 'communityFeedMode', 'communityFeedPoolSize', 'communityPullToRefresh', 'uploadLimits'] as const
const uploadKinds = ['image', 'video', 'audio', 'document', 'other'] as const
const userColumns = 'u.id,u.username,u.name,u.host,u."createdAt",u."isSuspended",u."isDeleted",u."isLocked",u."isBot",u."isCat",u."isExplorable",u."followersCount",u."followingCount",u."notesCount",u."communityViolationCount",u."communityViolationBaseline"'
const reportColumns = 'r.id,r."targetUserId",r."reporterId",r."assigneeId",r.resolved,r."resolvedAs",r.comment,r."contentKey",r."contentSnapshot",r."moderationNote"'
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function checkVersion(body: Body, current: unknown, required = false) {
  if ((required || Object.hasOwn(body, 'version')) && body.version !== fingerprint(current)) fail('设置已变化，请刷新后重新核对。', 409)
}
function record(value: unknown): value is Body { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function fail(message: string, status = 400): never { throw httpError(status, message) }
function keys(body: Body, allowed: readonly string[]) {
  if (!Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) fail('提交的字段无效，请刷新页面后重试。')
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(value)) fail('记录编号无效。')
  return value
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) fail(`文本不得超过 ${maximum} 个字符，且不能包含空字符。`)
  return value.trim()
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`请输入 ${min} 到 ${max} 之间的整数。`)
  return value
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') fail('开关参数无效。'); return value }
function enumValue(value: unknown, values: readonly string[]): string {
  if (typeof value !== 'string' || !values.includes(value)) fail('选项无效，请重新选择。')
  return value
}
function query(ctx: RequestContext) { return text(ctx.url.searchParams.get('query') ?? ctx.url.searchParams.get('q') ?? '', 120) }
function search(value: string) { return `%${value.replace(/[\\%_]/g, '\\$&')}%` }
function cursor(ctx: RequestContext) { const value = ctx.url.searchParams.get('cursor'); return value ? identifier(value) : null }
function paginate<T extends { id: string }>(rows: T[]) { return { items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29]!.id : null } }
async function transaction<T>(db: Database, action: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}
async function meta(db: Queryable, lock = false): Promise<MetaRow> {
  const row = (await db.query<MetaRow>(`SELECT id,"clientOptions" FROM meta ORDER BY id LIMIT 1${lock ? ' FOR UPDATE' : ''}`)).rows[0]
  if (!row) fail('站点配置暂不可用。', 503)
  return row
}
async function audit(ctx: RequestContext, db: Queryable, type: string, info: Body) {
  await db.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)', [ctx.newId(), ctx.requireUser().id, type, JSON.stringify(info)])
}
function publicConfig(options: Body) {
  const currentLimits = record(options.uploadLimits) ? options.uploadLimits : {}
  const legacyLimits = record(options.communityUploadLimits) ? options.communityUploadLimits : {}
  const uploadLimits = Object.fromEntries(uploadKinds.map(kind => {
    const value = currentLimits[kind] ?? legacyLimits[kind === 'document' ? 'resource' : kind]
    return [kind, typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10240 ? value : 20]
  }))
  return {
    communityPublicationMode: options.communityPublicationMode === 'after' ? 'after' : 'before',
    communityAutoBanEnabled: options.communityAutoBanEnabled !== false,
    communityViolationThreshold: Number.isInteger(options.communityViolationThreshold) && Number(options.communityViolationThreshold) >= 1 && Number(options.communityViolationThreshold) <= 1000 ? Number(options.communityViolationThreshold) : 3,
    communityFeedMode: options.communityFeedMode === 'latest' ? 'latest' : 'shuffle',
    communityFeedPoolSize: Number.isInteger(options.communityFeedPoolSize) && Number(options.communityFeedPoolSize) >= 20 && Number(options.communityFeedPoolSize) <= 1000 ? Number(options.communityFeedPoolSize) : 200,
    communityPullToRefresh: options.communityPullToRefresh !== false, uploadLimits,
  }
}
export function validateCommunityConfig(input: Body): Body {
  keys(input, configKeys)
  const next: Body = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'communityPublicationMode') next[key] = enumValue(value, ['before', 'after'])
    else if (key === 'communityFeedMode') next[key] = enumValue(value, ['shuffle', 'latest'])
    else if (key === 'communityViolationThreshold') next[key] = integer(value, 1, 1000)
    else if (key === 'communityFeedPoolSize') next[key] = integer(value, 20, 1000)
    else if (key === 'uploadLimits') {
      if (!record(value) || Object.keys(value).length !== uploadKinds.length) fail('请填写全部五类上传限制。')
      keys(value, uploadKinds)
      next.uploadLimits = Object.fromEntries(uploadKinds.map(kind => [kind, integer(value[kind], 1, 10240)]))
    } else next[key] = boolean(value)
  }
  return next
}
async function config(ctx: RequestContext) {
  if (ctx.req.method === 'GET') { const config = publicConfig((await meta(ctx.db)).clientOptions); return { config, version: fingerprint(config) } }
  const { version: _version, ...input } = ctx.body
  const patch = validateCommunityConfig(input)
  return transaction(ctx.db, async db => {
    const row = await meta(db, true)
    checkVersion(ctx.body, publicConfig(row.clientOptions))
    await db.query('UPDATE meta SET "clientOptions"=COALESCE("clientOptions",\'{}\'::jsonb)||$2::jsonb WHERE id=$1', [row.id, JSON.stringify(patch)])
    await audit(ctx, db, 'updateCommunityConfig', { config: patch })
    const config = publicConfig({ ...row.clientOptions, ...patch })
    return { config, version: fingerprint(config) }
  })
}
function adItems(options: Body, url: string) {
  return communityAdKeys.map(id => {
    const value = options[id]
    const valid = record(value) ? normalizeCommunityAd(value as unknown as CommunityAd, url) : null
    return { id, ...(valid ?? { enabled: false, title: '', imageUrl: '', linkUrl: '' }) }
  })
}
async function readAds(ctx: RequestContext, publicOnly: boolean) {
  const items = adItems((await meta(ctx.db)).clientOptions, ctx.config.url)
  return publicOnly ? { items: items.filter(ad => ad.enabled).map(({ enabled: _enabled, ...ad }) => ad) } : { items, version: fingerprint(items) }
}
async function ads(ctx: RequestContext) {
  if (ctx.req.method === 'GET') return readAds(ctx, false)
  keys(ctx.body, ['items', 'version'])
  if (!Array.isArray(ctx.body.items) || !ctx.body.items.length || ctx.body.items.length > 4) fail('广告位数量无效。')
  const patch: Body = {}
  for (const item of ctx.body.items) {
    if (!record(item)) fail('广告格式无效。')
    keys(item, ['id', 'enabled', 'title', 'imageUrl', 'linkUrl'])
    const id = enumValue(item.id, communityAdKeys) as AdId
    if (Object.hasOwn(patch, id)) fail('广告位不能重复。')
    const normalized = normalizeCommunityAd(item as unknown as CommunityAd, ctx.config.url)
    if (!normalized) fail('启用的广告需要标题、有效的 HTTPS 图片和 HTTP(S) 链接。')
    patch[id] = normalized
  }
  return transaction(ctx.db, async db => {
    const row = await meta(db, true)
    checkVersion(ctx.body, adItems(row.clientOptions, ctx.config.url))
    await db.query('UPDATE meta SET "clientOptions"=COALESCE("clientOptions",\'{}\'::jsonb)||$2::jsonb WHERE id=$1', [row.id, JSON.stringify(patch)])
    await audit(ctx, db, 'updateCommunityAds', { slots: Object.keys(patch) })
    const items = adItems({ ...row.clientOptions, ...patch }, ctx.config.url)
    return { items, version: fingerprint(items) }
  })
}
export function normalizeTagName(value: unknown): string {
  const name = text(value, 96).normalize('NFC')
  if (!name || Array.from(name).length > 24 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) fail('标签需为 1 到 24 个字符，不能包含控制字符。')
  return name
}
async function tags(ctx: RequestContext, tagId?: string) {
  if (ctx.req.method === 'GET') return { items: (await ctx.db.query<TagRow>('SELECT id,category,name FROM community_tag WHERE NOT "isDeleted" ORDER BY category,id')).rows }
  const method = ctx.req.method
  if (method !== 'DELETE') keys(ctx.body, method === 'POST' ? ['category', 'name'] : ['name'])
  return transaction(ctx.db, async db => {
    await db.query('LOCK TABLE community_tag IN SHARE ROW EXCLUSIVE MODE')
    const previous = tagId ? (await db.query<TagRow>('SELECT id,category,name FROM community_tag WHERE id=$1 AND NOT "isDeleted" FOR UPDATE', [identifier(tagId)])).rows[0] : null
    if (tagId && !previous) fail('标签不存在或已被删除。', 404)
    if (method === 'DELETE') {
      await db.query('UPDATE community_tag SET "isDeleted"=true WHERE id=$1', [tagId])
      await audit(ctx, db, 'deleteCommunityTag', { tagId })
      return { deleted: true }
    }
    const category = previous?.category ?? enumValue(ctx.body.category, ['image', 'video', 'resource'])
    const name = normalizeTagName(ctx.body.name)
    const duplicate = await db.query('SELECT id FROM community_tag WHERE category=$1 AND name=$2 AND NOT "isDeleted" AND id<>$3', [category, name, tagId ?? ''])
    if (duplicate.rows.length) fail('这个分类中已存在同名标签。', 409)
    const id = tagId ?? ctx.newId()
    if (previous) await db.query('UPDATE community_tag SET name=$2 WHERE id=$1', [id, name])
    else await db.query('INSERT INTO community_tag (id,category,name,"isDeleted") VALUES ($1,$2,$3,false)', [id, category, name])
    await audit(ctx, db, previous ? 'updateCommunityTag' : 'createCommunityTag', { tagId: id, category, name })
    return { tag: { id, category, name } }
  })
}
async function userProtection(db: Queryable, userIds: string[]) {
  const [root, roles, assignments] = await Promise.all([
    db.query<{ rootUserId: string | null }>('SELECT "rootUserId" FROM meta LIMIT 1'),
    db.query<RoleRow>('SELECT id,target,"condFormula","isAdministrator","isModerator" FROM role WHERE "isAdministrator" OR "isModerator"'),
    db.query<{ userId: string; roleId: string }>('SELECT "userId","roleId" FROM role_assignment WHERE "userId"=ANY($1::varchar[]) AND ("expiresAt" IS NULL OR "expiresAt">NOW())', [userIds]),
  ])
  return (row: ManagedUser): boolean => {
    if (root.rows[0]?.rootUserId === row.id) return true
    const assigned = new Set(assignments.rows.filter(item => item.userId === row.id).map(item => item.roleId))
    return roles.rows.some(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, row, assigned))
  }
}
function packUser(row: ManagedUser, protectedAccount: boolean, identity?: PublicIdentity) {
  const username = identity?.username ?? row.username
  return { id: row.id, username, ...(identity ? { accountId: identity.accountId } : {}),
    name: row.name || username || '章鱼用户', isSuspended: row.isSuspended,
    violationCount: row.communityViolationCount, violationBaseline: row.communityViolationBaseline, isProtected: protectedAccount }
}
async function users(ctx: RequestContext, userId?: string) {
  if (ctx.req.method === 'GET') {
    const status = enumValue(ctx.url.searchParams.get('status') || 'all', ['all', 'active', 'suspended'])
    const rows = (await ctx.db.query<ManagedUser>(`SELECT ${userColumns} FROM "user" u
      WHERE host IS NULL AND NOT "isDeleted" AND ($1='' OR u.username ILIKE $2 OR u.name ILIKE $2 OR u.id=$1)
      AND ($3::varchar IS NULL OR u.id<$3) AND ($4='all' OR u."isSuspended"=($4='suspended'))
      ORDER BY u.id DESC LIMIT 31`, [query(ctx), search(query(ctx)), cursor(ctx), status])).rows
    const page = paginate(rows), protectedAccount = await userProtection(ctx.db, page.items.map(row => row.id))
    const identities = await readPublicIdentities(ctx, page.items.map(row => row.id))
    return { ...page, items: page.items.map(row => packUser(row, protectedAccount(row), identities.get(row.id))) }
  }
  keys(ctx.body, ['isSuspended', 'reason'])
  const suspended = boolean(ctx.body.isSuspended), reason = text(ctx.body.reason ?? '', 1000), id = identifier(userId)
  if (suspended && !reason) fail('封禁账号时请填写原因。')
  const identity = (await readPublicIdentities(ctx, [id])).get(id)
  return transaction(ctx.db, async db => {
    const row = (await db.query<ManagedUser>(`SELECT ${userColumns} FROM "user" u WHERE u.id=$1 AND host IS NULL AND NOT "isDeleted" FOR UPDATE`, [id])).rows[0]
    if (!row) fail('账号不存在。', 404)
    const protectedAccount = await userProtection(db, [id])
    if (id === ctx.requireUser().id || protectedAccount(row) || protectedAccount({ ...row, isSuspended: suspended })) fail('不能修改自己或受保护管理账号的封禁状态。', 403)
    if (row.isSuspended !== suspended) {
      await db.query(`UPDATE "user" SET "isSuspended"=$2,"communityViolationBaseline"=CASE WHEN $2 THEN "communityViolationBaseline" ELSE "communityViolationCount" END WHERE id=$1`, [id, suspended])
      await audit(ctx, db, suspended ? 'suspend' : 'unsuspend', { userId: id, reason })
      row.isSuspended = suspended
      if (!suspended) row.communityViolationBaseline = row.communityViolationCount
    }
    return { user: packUser(row, protectedAccount(row), identity) }
  })
}
async function recordReportViolation(ctx: RequestContext, db: Queryable, report: ReportRow) {
  if (!report.contentKey) return
  const row = (await db.query<ManagedUser>(`SELECT ${userColumns} FROM "user" u WHERE u.id=$1 AND host IS NULL AND NOT "isDeleted" FOR UPDATE`, [report.targetUserId])).rows[0]
  if (!row) return
  const inserted = await db.query('INSERT INTO community_violation ("contentKey","userId","moderatorId",reason,"createdAt") VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT ("contentKey") DO NOTHING RETURNING "contentKey"', [report.contentKey, row.id, ctx.requireUser().id, report.comment])
  if (!inserted.rows.length) return
  await db.query('UPDATE "user" SET "communityViolationCount"="communityViolationCount"+1 WHERE id=$1', [row.id])
  const options = publicConfig((await meta(db)).clientOptions), protectedAccount = await userProtection(db, [row.id])
  if (options.communityAutoBanEnabled && !row.isSuspended && row.communityViolationCount + 1 - row.communityViolationBaseline >= options.communityViolationThreshold
    && row.id !== ctx.requireUser().id && !protectedAccount(row) && !protectedAccount({ ...row, isSuspended: true })) {
    await db.query('UPDATE "user" SET "isSuspended"=true WHERE id=$1', [row.id])
    await audit(ctx, db, 'suspend', { userId: row.id, reason: 'Community violation threshold', contentKey: report.contentKey })
  }
}
async function reports(ctx: RequestContext, reportId?: string) {
  if (ctx.req.method === 'GET') {
    const status = enumValue(ctx.url.searchParams.get('status') || 'open', ['all', 'open', 'resolved'])
    const rows = (await ctx.db.query<ReportRow>(`SELECT ${reportColumns},t.username AS "targetUsername",a.username AS "reporterUsername"
      FROM abuse_user_report r LEFT JOIN "user" t ON t.id=r."targetUserId" LEFT JOIN "user" a ON a.id=r."reporterId"
      WHERE ($1='all' OR r.resolved=($1='resolved')) AND ($2::varchar IS NULL OR r.id<$2)
      AND ($3='' OR r.comment ILIKE $4 OR t.username ILIKE $4 OR a.username ILIKE $4)
      ORDER BY r.id DESC LIMIT 31`, [status, cursor(ctx), query(ctx), search(query(ctx))])).rows
    const page = paginate(rows)
    const identities = await readPublicIdentities(ctx, page.items.flatMap(row => [row.targetUserId, row.reporterId]))
    return { ...page, items: page.items.map(row => packReport(row, identities)) }
  }
  keys(ctx.body, ['resolvedAs', 'moderationNote'])
  const decision = enumValue(ctx.body.resolvedAs, ['accept', 'reject']) as 'accept' | 'reject', note = text(ctx.body.moderationNote ?? '', 8192), id = identifier(reportId)
  const result = await transaction(ctx.db, async db => {
    const report = (await db.query<ReportRow>(`SELECT ${reportColumns} FROM abuse_user_report r WHERE r.id=$1 FOR UPDATE`, [id])).rows[0]
    if (!report) fail('举报记录不存在。', 404)
    if (report.resolved) {
      if (report.resolvedAs !== decision || report.moderationNote !== note) fail('该举报已处理，请刷新列表。', 409)
      return { report }
    }
    if (decision === 'accept') await recordReportViolation(ctx, db, report)
    await db.query('UPDATE abuse_user_report SET resolved=true,"resolvedAs"=$2,"assigneeId"=$3,"moderationNote"=$4 WHERE id=$1', [id, decision, ctx.requireUser().id, note])
    await audit(ctx, db, 'resolveAbuseReport', { reportId: id, resolvedAs: decision, moderationNote: note })
    return { report: { ...report, resolved: true, resolvedAs: decision, assigneeId: ctx.requireUser().id, moderationNote: note } }
  })
  const identities = await readPublicIdentities(ctx, [result.report.targetUserId, result.report.reporterId])
  return { report: packReport(result.report, identities) }
}
function packReport(row: ReportRow, identities: Awaited<ReturnType<typeof readPublicIdentities>>) {
  const target = identities.get(row.targetUserId), reporter = identities.get(row.reporterId)
  return { ...row, ...(target ? { targetUsername: target.username, targetAccountId: target.accountId } : {}),
    ...(reporter ? { reporterUsername: reporter.username, reporterAccountId: reporter.accountId } : {}) }
}
async function logoReference(ctx: RequestContext, db: Queryable, logoUrl: string) {
  const local = /^\/(legacy-files|files)\/([^?]+)(?:\?variant=(original|web|webpublic|thumbnail))?$/.exec(logoUrl)
  if (!local) return { logoUrl, fileId: null }
  const byKey = local[1] === 'files'
  const file = (await db.query<{ id: string; accessKey: string | null; thumbnailAccessKey: string | null; webpublicAccessKey: string | null; webpublicType: string | null }>(`
    SELECT id,"accessKey","thumbnailAccessKey","webpublicAccessKey","webpublicType" FROM drive_file
    WHERE ${byKey ? '("accessKey"=$1 OR "thumbnailAccessKey"=$1 OR "webpublicAccessKey"=$1)' : 'id=$1'}
    AND "userId"=$2 AND "storedInternal" AND NOT "isLink" AND NOT "isSensitive"
    AND type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif') FOR SHARE`, [local[2], ctx.requireUser().id])).rows[0]
  if (!file) fail('请上传属于当前管理员的非敏感图片作为站点 Logo。')
  const usable = (key: string | null) => typeof key === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(key)
  const web = usable(file.webpublicAccessKey) && ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.webpublicType ?? '')
  let variant = byKey ? local[2] === file.thumbnailAccessKey ? 'thumbnail' : local[2] === file.webpublicAccessKey ? 'web' : 'original' : local[3] ?? 'original'
  if (variant === 'webpublic') variant = 'web'
  if ((variant === 'thumbnail' && !usable(file.thumbnailAccessKey)) || (variant === 'web' && !web)) variant = 'original'
  if (variant === 'original' && !usable(file.accessKey)) { if (web) variant = 'web'; else fail('Logo 图片文件不可用，请重新上传。') }
  return { logoUrl: `/legacy-files/${file.id}${variant === 'original' ? '' : `?variant=${variant}`}`, fileId: file.id }
}
async function legacySettings(ctx: RequestContext) {
  if (ctx.req.method === 'GET') { const settings = await readSiteSettings(ctx.db, ctx.config.url); return { settings, version: fingerprint(settings) } }
  keys(ctx.body, ['settings', 'version'])
  const input = ctx.body.settings
  if (!record(input) || !Object.keys(input).length) fail('请检查站点设置。')
  const brandingOnly = Object.keys(input).every(key => ['brand', 'logoUrl'].includes(key))
  if (!brandingOnly) keys(input, ['brand', 'logoUrl', 'registrationOpen', 'publicationMode', 'autoBan', 'violationThreshold', 'uploadLimits', 'defaultModels', 'ads'])
  return transaction(ctx.db, async db => {
    const row = await meta(db, true)
    const previous = await readSiteSettings(db, ctx.config.url)
    checkVersion(ctx.body, previous, true)
    const settings = brandingOnly
      ? { ...previous, ...validateSiteBranding({ brand: previous.brand, logoUrl: previous.logoUrl, ...input }, ctx.config.url, previous.logoUrl) }
      : validateSiteSettings(input, ctx.config.url, previous.logoUrl)
    const patch: Body = { communityBrandName: settings.brand, communityLogoUrl: settings.logoUrl }
    if (settings.logoUrl !== previous.logoUrl) {
      const logo = await logoReference(ctx, db, settings.logoUrl)
      settings.logoUrl = logo.logoUrl
      patch.communityLogoUrl = logo.logoUrl
      patch.communityLogoFileId = logo.fileId
    }
    if (!brandingOnly) {
      Object.assign(patch, { communityPublicationMode: settings.publicationMode,
        communityAutoBanEnabled: settings.autoBan, communityViolationThreshold: settings.violationThreshold,
        uploadLimits: { ...(record(row.clientOptions.uploadLimits) ? row.clientOptions.uploadLimits : {}),
          image: settings.uploadLimits.image, video: settings.uploadLimits.video, document: settings.uploadLimits.resource, other: settings.uploadLimits.other },
        communityDefaultModels: settings.defaultModels })
      for (const [index, key] of communityAdKeys.entries()) patch[key] = settings.ads[index] || null
    }
    await db.query(`UPDATE meta SET "clientOptions"=COALESCE("clientOptions",'{}'::jsonb)||$2::jsonb,name=$3,"iconUrl"=$4${brandingOnly ? '' : ',"disableRegistration"=$5'} WHERE id=$1`,
      [row.id, JSON.stringify(patch), settings.brand, settings.logoUrl || null, ...(!brandingOnly ? [!settings.registrationOpen] : [])])
    await audit(ctx, db, 'communitySettings', { settings: brandingOnly ? { brand: settings.brand, logoUrl: settings.logoUrl } : settings })
    const current = await readSiteSettings(db, ctx.config.url)
    return { settings: current, version: fingerprint(current) }
  })
}
async function announcements(ctx: RequestContext, announcementId?: string) {
  if (ctx.req.method === 'GET') {
    const status = enumValue(ctx.url.searchParams.get('status') || 'all', ['all', 'active', 'inactive'])
    const rows = (await ctx.db.query<AnnouncementRow>(`SELECT id,title,text,"isActive","updatedAt" FROM announcement
      WHERE "userId" IS NULL AND ($1='' OR title ILIKE $2 OR text ILIKE $2)
      AND ($3='all' OR "isActive"=($3='active')) AND ($4::varchar IS NULL OR id<$4)
      ORDER BY id DESC LIMIT 31`, [query(ctx), search(query(ctx)), status, cursor(ctx)])).rows
    const page = paginate(rows)
    return { ...page, items: page.items.map(packAnnouncement) }
  }
  const method = ctx.req.method
  if (method === 'POST') keys(ctx.body, ['title', 'text'])
  else if (method === 'DELETE') {
    if (Object.keys(ctx.body).length) keys(ctx.body, ['version', 'updatedAt'])
  }
  else {
    keys(ctx.body, ['title', 'text', 'isActive', 'version', 'updatedAt'])
    if (method === 'PATCH' && !['title', 'text', 'isActive'].some(key => Object.hasOwn(ctx.body, key))) fail('请选择需要修改的公告字段。')
  }
  if (method === 'PATCH' && !Object.hasOwn(ctx.body, 'version') && !Object.hasOwn(ctx.body, 'updatedAt')) fail('缺少公告版本，请刷新后重试。')
  const title = ctx.body.title === undefined ? undefined : text(ctx.body.title, 100)
  const content = ctx.body.text === undefined ? undefined : text(ctx.body.text, 8192)
  const active = ctx.body.isActive === undefined ? undefined : boolean(ctx.body.isActive)
  if (title === '' || content === '' || method === 'POST' && (!title || !content)) fail('公告标题和正文不能为空。')
  return transaction(ctx.db, async db => {
    if (method !== 'POST') {
      const id = identifier(announcementId)
      const previous = (await db.query<AnnouncementRow>('SELECT id,title,text,"isActive","updatedAt" FROM announcement WHERE id=$1 AND "userId" IS NULL FOR UPDATE', [id])).rows[0]
      if (!previous) fail('公告不存在。', 404)
      const packed = packAnnouncement(previous)
      if (Object.hasOwn(ctx.body, 'version') && ctx.body.version !== packed.version
        || Object.hasOwn(ctx.body, 'updatedAt') && ctx.body.updatedAt !== packed.updatedAt) fail('公告已变化，请刷新后重新编辑。', 409)
      const next = { title: title ?? previous.title, text: content ?? previous.text, isActive: method === 'DELETE' ? false : active ?? previous.isActive }
      const fields = (['title', 'text', 'isActive'] as const).filter(key => next[key] !== previous[key])
      if (!fields.length) return method === 'DELETE' ? { ok: true, announcement: packed } : { announcement: packed }
      const updated = (await db.query<AnnouncementRow>(`UPDATE announcement SET title=$2,text=$3,"isActive"=$4,"updatedAt"=NOW()
        WHERE id=$1 AND "userId" IS NULL RETURNING id,title,text,"isActive","updatedAt"`, [id, next.title, next.text, next.isActive])).rows[0]!
      await audit(ctx, db, method === 'DELETE' ? 'deleteAnnouncement' : 'updateAnnouncement', { announcementId: id, fields })
      return method === 'DELETE' ? { ok: true, announcement: packAnnouncement(updated) } : { announcement: packAnnouncement(updated) }
    }
    const id = ctx.newId()
    const row = (await db.query<AnnouncementRow>(`INSERT INTO announcement(id,title,text,"updatedAt") VALUES($1,$2,$3,NOW())
      RETURNING id,title,text,"isActive","updatedAt"`, [id, title, content])).rows[0]!
    await audit(ctx, db, 'createAnnouncement', { announcementId: id })
    return { id, announcement: packAnnouncement(row) }
  })
}

function packAnnouncement(row: AnnouncementRow) {
  const updatedAt = row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  return { id: row.id, title: row.title, text: row.text, isActive: row.isActive, updatedAt,
    version: fingerprint([row.id, row.title, row.text, row.isActive, updatedAt]) }
}

const auditLabels: Record<string, string> = {
  createAnnouncement: '发布公告', updateAnnouncement: '修改公告', deleteAnnouncement: '停用公告',
  communityReview: '作品审核', suspend: '封禁账号', unsuspend: '解除封禁', resolveAbuseReport: '处理举报',
  updateCommunityConfig: '修改社区配置', communitySettings: '修改站点设置', updateCommunityAds: '修改广告位',
  createCommunityTag: '创建标签', updateCommunityTag: '修改标签', deleteCommunityTag: '删除标签',
  adjustLotteryChances: '调整抽奖次数', updateCommunityRoles: '调整管理授权',
}
function safeAuditDetails(type: string, input: unknown): Body {
  if (!record(input)) return {}
  const result: Body = {}
  const copyId = (key: string) => { const value = input[key]; if (typeof value === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(value)) result[key] = value }
  const copyNumber = (key: string) => { const value = input[key]; if (typeof value === 'number' && Number.isSafeInteger(value)) result[key] = value }
  const copyEnum = (key: string, values: readonly string[]) => { const value = input[key]; if (typeof value === 'string' && values.includes(value)) result[key] = value }
  const copyList = (key: string, allowed?: readonly string[]) => {
    if (Array.isArray(input[key])) result[key] = input[key].filter((value): value is string => typeof value === 'string' && (allowed ? allowed.includes(value) : /^[a-zA-Z0-9]{1,32}$/.test(value))).slice(0, 100)
  }
  if (['createAnnouncement', 'updateAnnouncement', 'deleteAnnouncement'].includes(type)) {
    copyId('announcementId'); copyList('fields', ['title', 'text', 'isActive'])
  } else if (type === 'communityReview') {
    copyId('submissionId'); copyEnum('action', ['approve', 'reject', 'remove']); copyNumber('version')
  } else if (type === 'suspend' || type === 'unsuspend') copyId('userId')
  else if (type === 'resolveAbuseReport') {
    copyId('reportId'); copyEnum('resolvedAs', ['accept', 'reject'])
  } else if (type === 'adjustLotteryChances') {
    copyId('userId'); copyEnum('mode', ['add', 'set'])
    for (const key of ['amount', 'before', 'after']) copyNumber(key)
  } else if (type === 'updateCommunityRoles') {
    copyId('userId'); copyList('before'); copyList('after')
  } else if (['createCommunityTag', 'updateCommunityTag', 'deleteCommunityTag'].includes(type)) {
    copyId('tagId'); copyEnum('category', ['image', 'video', 'resource'])
  } else if (type === 'updateCommunityAds') copyList('slots', communityAdKeys)
  else if (type === 'updateCommunityConfig' && record(input.config)) {
    const normalized = publicConfig(input.config)
    result.config = Object.fromEntries(configKeys.filter(key => Object.hasOwn(input.config as Body, key)).map(key => [key, normalized[key]]))
  } else if (type === 'communitySettings' && record(input.settings)) {
    result.fields = ['brand', 'logoUrl', 'publicationMode', 'autoBan', 'violationThreshold', 'registrationOpen', 'uploadLimits', 'defaultModels', 'ads']
      .filter(key => Object.hasOwn(input.settings as Body, key))
  }
  return result
}
async function auditLog(ctx: RequestContext) {
  const type = text(ctx.url.searchParams.get('type') || '', 128)
  if (type && !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(type)) fail('审计类型无效。')
  const rows = (await ctx.db.query<AuditRow>(`SELECT l.id,l."userId",l.type,l.info,u.id AS "actorId",u.username AS "actorUsername",u.name AS "actorName"
    FROM moderation_log l LEFT JOIN "user" u ON u.id=l."userId"
    WHERE ($1='' OR l.type=$1) AND ($2::varchar IS NULL OR l.id<$2)
    AND ($3='' OR l.id=$3 OR l.type ILIKE $4 OR u.username ILIKE $4 OR u.name ILIKE $4
      OR EXISTS (SELECT 1 FROM external_account e WHERE e."userId"=l."userId" AND e.issuer=$5 AND (e.username ILIKE $4 OR e.subject=$3)))
    ORDER BY l.id DESC LIMIT 31`, [type, cursor(ctx), query(ctx), search(query(ctx)), accountCenter(ctx.config)])).rows
  const page = paginate(rows)
  const identities = await readPublicIdentities(ctx, page.items.flatMap(row => row.actorId ? [row.actorId] : []))
  const items = page.items.map(row => {
    const identity = row.actorId ? identities.get(row.actorId) : undefined
    const username = identity?.username ?? row.actorUsername ?? ''
    const time = legacyIdTime(row.id, ctx.config.id)
    const publicType = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(row.type) ? row.type : 'unknown'
    return { id: row.id, date: Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? new Date(time).toISOString() : null,
      type: publicType, label: Object.hasOwn(auditLabels, publicType) ? auditLabels[publicType] : '管理操作',
      actor: row.actorId ? { id: row.actorId, username, name: row.actorName || username || '章鱼用户', ...(identity ? { accountId: identity.accountId } : {}) } : null,
      details: safeAuditDetails(row.type, row.info) }
  })
  const types = new Map(Object.entries(auditLabels))
  for (const item of items) if (!types.has(item.type)) types.set(item.type, item.label)
  return { ...page, items, typeOptions: [...types].map(([value, label]) => ({ value, label })) }
}

async function managementRoles(db: Queryable, lock = false) {
  return (await db.query<ManagementRole>(`SELECT id,name,target,"condFormula","isAdministrator","isModerator" FROM role
    WHERE "isAdministrator" OR "isModerator" ORDER BY id${lock ? ' FOR SHARE' : ''}`)).rows
}
async function roleAssignments(db: Queryable, userIds: string[], lock = false) {
  return (await db.query<RoleAssignment>(`SELECT id,"userId","roleId","expiresAt" FROM role_assignment
    WHERE "userId"=ANY($1::varchar[]) AND ("expiresAt" IS NULL OR "expiresAt">NOW()) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [userIds])).rows
}
function manualRoles(roles: ManagementRole[]) { return roles.filter(role => role.target === 'manual') }
function packRoleUser(ctx: RequestContext, row: ManagedUser, roles: ManagementRole[], assignments: RoleAssignment[], rootUserId: string | null, identity?: PublicIdentity) {
  const manual = manualRoles(roles)
  const owned = assignments.filter(item => item.userId === row.id)
  const roleIds = manual.filter(role => owned.some(item => item.roleId === role.id)).map(role => role.id)
  const isRoot = row.id === rootUserId, isSelf = row.id === ctx.requireUser().id
  return { ...packUser(row, isRoot || isSelf, identity), roleIds, isRoot, isSelf, canEdit: manual.length > 0 && !isRoot && !isSelf,
    version: fingerprint({ rootUserId, roles, assignments: owned }) }
}
async function roles(ctx: RequestContext, userId?: string) {
  if (ctx.req.method === 'GET') {
    const needle = query(ctx)
    const [available, root, rows] = await Promise.all([
      managementRoles(ctx.db),
      ctx.db.query<{ rootUserId: string | null }>('SELECT "rootUserId" FROM meta LIMIT 1'),
      ctx.db.query<ManagedUser>(`SELECT ${userColumns} FROM "user" u WHERE u.host IS NULL AND NOT u."isDeleted"
        AND ($1='' OR u.id=$1 OR u.username ILIKE $2 OR u.name ILIKE $2 OR EXISTS (SELECT 1 FROM external_account e
          WHERE e."userId"=u.id AND e.issuer=$4 AND (e.username ILIKE $2 OR e.subject=$1)))
        AND ($3::varchar IS NULL OR u.id<$3) ORDER BY u.id DESC LIMIT 31`, [needle, search(needle), cursor(ctx), accountCenter(ctx.config)]),
    ])
    const page = paginate(rows.rows), ids = page.items.map(row => row.id)
    const [assignments, identities] = await Promise.all([roleAssignments(ctx.db, ids), readPublicIdentities(ctx, ids)])
    const manual = manualRoles(available)
    return { ...page, items: page.items.map(row => packRoleUser(ctx, row, available, assignments, root.rows[0]?.rootUserId ?? null, identities.get(row.id))),
      roles: manual.map(role => ({ id: role.id, name: role.name, isAdmin: role.isAdministrator, isModerator: role.isModerator })),
      canAssign: manual.length > 0, ...(manual.length ? {} : { message: '尚未配置可分配的手动管理员或审核员角色，请联系维护人员配置角色。' }) }
  }
  keys(ctx.body, ['roleIds', 'version'])
  if (!Array.isArray(ctx.body.roleIds) || ctx.body.roleIds.length > 100 || new Set(ctx.body.roleIds).size !== ctx.body.roleIds.length) fail('管理角色列表无效。')
  const desired = ctx.body.roleIds.map(identifier)
  if (typeof ctx.body.version !== 'string' || !/^[a-f0-9]{64}$/.test(ctx.body.version)) fail('缺少有效的授权版本，请刷新后重试。')
  const targetId = identifier(userId), actorId = ctx.requireUser().id
  const changed = await transaction(ctx.db, async db => {
    const root = (await db.query<{ rootUserId: string | null }>('SELECT "rootUserId" FROM meta ORDER BY id LIMIT 1 FOR UPDATE')).rows[0]?.rootUserId ?? null
    const people = (await db.query<ManagedUser>(`SELECT ${userColumns} FROM "user" u
      WHERE u.id=ANY($1::varchar[]) AND u.host IS NULL AND NOT u."isDeleted" ORDER BY u.id FOR UPDATE`, [[...new Set([actorId, targetId])]])).rows
    const target = people.find(row => row.id === targetId), actor = people.find(row => row.id === actorId)
    const available = await managementRoles(db, true)
    const assignments = await roleAssignments(db, people.map(row => row.id), true)
    const actorAssigned = new Set(assignments.filter(item => item.userId === actorId).map(item => item.roleId))
    if (!actor || actor.isSuspended || !(actorId === root || available.some(role => role.isAdministrator
      && (role.target === 'manual' ? actorAssigned.has(role.id) : roleCondition(role.condFormula, actor, actorAssigned))))) fail('管理员权限已变化，请重新登录。', 403)
    if (!target) fail('账号不存在。', 404)
    const manual = manualRoles(available)
    if (!manual.length) fail('尚未配置可分配的手动管理角色。', 409)
    if (desired.some(id => !manual.some(role => role.id === id))) fail('只能分配已有的手动管理员或审核员角色。')
    const before = packRoleUser(ctx, target, available, assignments, root)
    if (before.version !== ctx.body.version) fail('管理授权已变化，请刷新后重新核对。', 409)
    const removed = before.roleIds.filter(id => !desired.includes(id)), added = desired.filter(id => !before.roleIds.includes(id))
    if ((before.isRoot || before.isSelf) && (removed.length || added.length)) fail('不能修改自己或根管理员的管理授权。', 403)
    if (removed.length) await db.query(`DELETE FROM role_assignment WHERE "userId"=$1 AND "roleId"=ANY($2::varchar[])
      AND ("expiresAt" IS NULL OR "expiresAt">NOW())`, [targetId, removed])
    for (const id of added) await db.query(`INSERT INTO role_assignment (id,"userId","roleId","expiresAt") VALUES ($1,$2,$3,NULL)
      ON CONFLICT ("userId","roleId") DO UPDATE SET "expiresAt"=NULL`, [ctx.newId(), targetId, id])
    if (removed.length || added.length) await audit(ctx, db, 'updateCommunityRoles', { userId: targetId, before: before.roleIds, after: desired })
    return { target, available, root, assignments: await roleAssignments(db, [targetId]) }
  })
  const identities = await readPublicIdentities(ctx, [targetId])
  return { user: packRoleUser(ctx, changed.target, changed.available, changed.assignments, changed.root, identities.get(targetId)) }
}

export async function handleAdmin(ctx: RequestContext): Promise<boolean> {
  if (await handleAdminInsights(ctx)) return true
  const path = ctx.url.pathname, method = ctx.req.method
  if (path === '/api/community/ads' && method === 'GET') { ctx.json(200, await readAds(ctx, true)); return true }
  if (path === '/api/site' && method === 'GET') { const { brand, logoUrl } = await readSiteSettings(ctx.db, ctx.config.url); ctx.json(200, { brand, logoUrl }); return true }
  const tag = /^\/api\/admin\/tags\/([a-zA-Z0-9]{1,32})$/.exec(path), person = /^\/api\/admin\/users\/([a-zA-Z0-9]{1,32})$/.exec(path)
  const report = /^\/api\/admin\/reports\/([a-zA-Z0-9]{1,32})$/.exec(path), announcement = /^\/api\/admin\/announcements\/([a-zA-Z0-9]{1,32})$/.exec(path)
  const userRoles = /^\/api\/admin\/users\/([a-zA-Z0-9]{1,32})\/roles$/.exec(path)
  const recognized = ['/api/admin/community/config', '/api/admin/community/ads', '/api/admin/tags', '/api/admin/users', '/api/admin/reports', '/api/admin/settings', '/api/admin/announcements', '/api/admin/audit', '/api/admin/roles'].includes(path) || tag || person || report || announcement || userRoles
  if (!recognized) return false
  if (path === '/api/admin/reports' || report) { const actor = ctx.requireUser(); if (!actor.isAdmin && !actor.isModerator) fail('需要审核员权限。', 403) }
  else ctx.requireAdmin()
  let result: unknown
  if (path === '/api/admin/community/config' && ['GET', 'PATCH'].includes(method ?? '')) result = await config(ctx)
  else if (path === '/api/admin/community/ads' && ['GET', 'PATCH'].includes(method ?? '')) result = await ads(ctx)
  else if ((path === '/api/admin/tags' && ['GET', 'POST'].includes(method ?? '')) || (tag && ['PATCH', 'DELETE'].includes(method ?? ''))) result = await tags(ctx, tag?.[1])
  else if ((path === '/api/admin/users' && method === 'GET') || (person && method === 'PATCH')) result = await users(ctx, person?.[1])
  else if ((path === '/api/admin/reports' && method === 'GET') || (report && method === 'PATCH')) result = await reports(ctx, report?.[1])
  else if (path === '/api/admin/settings' && ['GET', 'PATCH'].includes(method ?? '')) result = await legacySettings(ctx)
  else if ((path === '/api/admin/announcements' && ['GET', 'POST'].includes(method ?? '')) || (announcement && ['PATCH', 'DELETE'].includes(method ?? ''))) result = await announcements(ctx, announcement?.[1])
  else if (path === '/api/admin/audit' && method === 'GET') result = await auditLog(ctx)
  else if ((path === '/api/admin/roles' && method === 'GET') || (userRoles && method === 'PATCH')) result = await roles(ctx, userRoles?.[1])
  else return false
  ctx.json(200, result)
  return true
}
