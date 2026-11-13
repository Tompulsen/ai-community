/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto'
import { handleAdminInsights } from './admin-insights.ts'
import { httpError, roleCondition } from './auth.ts'
import { communityAdKeys, normalizeCommunityAd, type CommunityAd } from './business/ads.ts'
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
  if (ctx.req.method === 'GET') return { items: (await ctx.db.query('SELECT id,title,text,"isActive","updatedAt" FROM announcement WHERE "userId" IS NULL ORDER BY id DESC LIMIT 100')).rows }
  return transaction(ctx.db, async db => {
    if (ctx.req.method === 'DELETE') {
      const id = identifier(announcementId)
      if (!(await db.query('UPDATE announcement SET "isActive"=false,"updatedAt"=NOW() WHERE id=$1 AND "userId" IS NULL RETURNING id', [id])).rowCount) fail('公告不存在。', 404)
      await audit(ctx, db, 'deleteAnnouncement', { announcementId: id })
      return { ok: true }
    }
    keys(ctx.body, ['title', 'text'])
    const title = text(ctx.body.title, 100), content = text(ctx.body.text, 8192), id = ctx.newId()
    if (!title || !content) fail('公告标题和正文不能为空。')
    await db.query('INSERT INTO announcement(id,title,text,"updatedAt") VALUES($1,$2,$3,NOW())', [id, title, content])
    await audit(ctx, db, 'createAnnouncement', { announcementId: id })
    return { id }
  })
}

export async function handleAdmin(ctx: RequestContext): Promise<boolean> {
  if (await handleAdminInsights(ctx)) return true
  const path = ctx.url.pathname, method = ctx.req.method
  if (path === '/api/community/ads' && method === 'GET') { ctx.json(200, await readAds(ctx, true)); return true }
  if (path === '/api/site' && method === 'GET') { const { brand, logoUrl } = await readSiteSettings(ctx.db, ctx.config.url); ctx.json(200, { brand, logoUrl }); return true }
  const tag = /^\/api\/admin\/tags\/([a-zA-Z0-9]{1,32})$/.exec(path), person = /^\/api\/admin\/users\/([a-zA-Z0-9]{1,32})$/.exec(path)
  const report = /^\/api\/admin\/reports\/([a-zA-Z0-9]{1,32})$/.exec(path), announcement = /^\/api\/admin\/announcements\/([a-zA-Z0-9]{1,32})$/.exec(path)
  const recognized = ['/api/admin/community/config', '/api/admin/community/ads', '/api/admin/tags', '/api/admin/users', '/api/admin/reports', '/api/admin/settings', '/api/admin/announcements'].includes(path) || tag || person || report || announcement
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
  else if ((path === '/api/admin/announcements' && ['GET', 'POST'].includes(method ?? '')) || (announcement && method === 'DELETE')) result = await announcements(ctx, announcement?.[1])
  else return false
  ctx.json(200, result)
  return true
}
