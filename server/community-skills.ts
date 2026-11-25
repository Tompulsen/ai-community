import { createHash } from 'node:crypto'
import { z } from 'zod'
import { httpError } from './auth.ts'
import { readPublicIdentities } from './public-identity.ts'
import { readSkillPackage } from './skill-package.ts'
import { skillLimits, maxSelectedSkills, skillInstructions, type SkillKind, type SkillReference, type CommunitySkill } from '../shared/community-skills.ts'
import type { Database, Queryable, RequestContext } from './types.ts'

const idSchema = z.string().regex(/^[a-zA-Z0-9]{1,32}$/)
const plain = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const uploadSchema = z.object({ filename: z.string().max(160), data: z.string().max(Math.ceil(skillLimits.archiveBytes / 3) * 4) }).strict()
const saveSchema = z.object({ kind: z.enum(['text', 'image', 'video']), name: plain(100), description: plain(1000), body: z.string().max(skillLimits.bodyBytes),
  upload: uploadSchema.optional(), version: z.number().int().positive().optional(),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/).optional(), publish: z.boolean().optional() }).strict()
const columns = 's.id,s."authorId",s.name,s.kind,s.description,s.status,s.official,s.version,s.sha256,s.filename,s.size,s.files,s."legacyId",s."createdAt",s."updatedAt"'
interface SkillRow extends CommunitySkill { archive?: Buffer; requestId: string; requestHash: string }
function invalid(message = '技能参数无效，请重新核对。', status = 400): never { throw httpError(status, message) }
function parsed<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); return result.success ? result.data : invalid() }
function unpack(input: z.infer<typeof uploadSchema>) {
  if (!input.data || input.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) invalid('技能文件编码无效。')
  const source = Buffer.from(input.data, 'base64')
  if (source.toString('base64') !== input.data) invalid('技能文件编码无效。')
  return { filename: input.filename, source }
}
async function transaction<T>(db: Database, action: (db: Queryable) => Promise<T>) {
  const client = await db.connect()
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}
async function audit(ctx: RequestContext, db: Queryable, type: string, skill: { id: string; status: string; version: number }) {
  await db.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)',
    [ctx.newId(), ctx.requireUser().id, type, JSON.stringify(skill)])
}
async function present(ctx: RequestContext, rows: SkillRow[], detail = false) {
  const identities = await readPublicIdentities(ctx, rows.map(row => row.authorId))
  return rows.map(row => {
    const { archive: _archive, requestId: _request, requestHash: _hash, reviewNote, body, ...item } = row
    return { ...item, authorName: identities.get(row.authorId)?.username || row.authorName || '社区创作者',
      ...(detail ? { body } : {}), ...(ctx.user?.isAdmin || ctx.user?.id === row.authorId ? { reviewNote: reviewNote || '' } : {}) }
  })
}
export async function approvedCommunitySkills(db: Queryable) {
  const { rows } = await db.query('SELECT s.id,s."authorId",s.name,s.kind,s.description,s.sha256,s."legacyId" FROM community_skill s JOIN "user" u ON u.id=s."authorId" WHERE s.status=\'published\' AND NOT u."isDeleted" AND NOT u."isSuspended" ORDER BY s.id DESC')
  return rows.map(row => ({ ...row, id: `community-${row.id}`, body: '' }))
}

export async function mediaSkillPrompt(db: Queryable, kind: SkillKind, prompt: string, skills?: SkillReference[], workInstructions: ReadonlyMap<string, string> = new Map()) {
  if (!skills?.length) return prompt
  if (kind === 'text' || skills.length > maxSelectedSkills) invalid('当前创作类型或技能数量无效。')
  const community = skills.filter(skill => skill.id.startsWith('community-'))
  const { rows } = community.length ? await db.query<{ id: string; kind: SkillKind; body: string; sha256: string }>(
    `SELECT s.id,s.kind,s.body,s.sha256 FROM community_skill s JOIN "user" u ON u.id=s."authorId"
     WHERE s.id=ANY($1::varchar[]) AND s.status='published' AND NOT u."isDeleted" AND NOT u."isSuspended"`,
    [community.map(skill => skill.id.slice('community-'.length))]) : { rows: [] }
  const instructions = skills.map(reference => {
    if (reference.id.startsWith('work-') && workInstructions.has(reference.id)) return workInstructions.get(reference.id)!
    const skill = rows.find(row => `community-${row.id}` === reference.id)
    if (!skill || skill.kind !== kind || skill.sha256 !== reference.sha256 || createHash('sha256').update(skill.body).digest('hex') !== reference.sha256)
      invalid('技能已更新、下架或不适用于当前创作类型，请刷新技能列表后重新选择。')
    return skillInstructions(skill.body)
  })
  const combined = [...instructions, `本次创作要求：\n${prompt}`].join('\n\n')
  if (combined.length > 100000) invalid('技能指令与提示词合计过长，请减少所选技能或缩短提示词。')
  return combined
}

export async function handleCommunitySkills(ctx: RequestContext): Promise<boolean> {
  const path = ctx.url.pathname, admin = path.startsWith('/api/admin/skills')
  if (!/^\/api\/(?:admin\/)?skills(?:\/|$)/.test(path)) return false
  if (admin) ctx.requireAdmin()
  const actor = ctx.user
  const expected = ctx.req.headers['x-new-api-user']
  if (expected !== undefined && (!actor || ![actor.id, actor.accountId].includes(String(expected)))) invalid('账号已切换，请重新操作。', 409)
  const prefix = admin ? '/api/admin/skills' : '/api/skills'
  const match = new RegExp(`^${prefix}/([a-zA-Z0-9]{1,32})(/download|/review)?$`).exec(path)
  const id = match?.[1]
  if (ctx.req.method === 'GET' && path === prefix) {
    if (new Set(ctx.url.searchParams.keys()).size !== [...ctx.url.searchParams].length) invalid()
    const input = parsed(z.object({ scope: z.enum(['public', 'mine']).default('public'), status: z.enum(['all', 'pending', 'published', 'rejected', 'removed']).optional(),
      kind: z.enum(['text', 'image', 'video']).optional(), query: z.string().trim().max(120).default(''), cursor: idSchema.optional() }).strict(), Object.fromEntries(ctx.url.searchParams))
    if (input.scope === 'mine') ctx.requireUser()
    if (!admin && input.status) invalid()
    const values: unknown[] = [], where: string[] = []
    if (!admin && input.scope === 'public') where.push("s.status='published'", 'NOT u."isDeleted"', 'NOT u."isSuspended"')
    if (!admin && input.scope === 'mine') { values.push(actor!.id); where.push(`s."authorId"=$${values.length}`) }
    if (admin && input.status && input.status !== 'all') { values.push(input.status); where.push(`s.status=$${values.length}`) }
    if (input.kind) { values.push(input.kind); where.push(`s.kind=$${values.length}`) }
    if (input.cursor) { values.push(input.cursor); where.push(`s.id<$${values.length}`) }
    if (input.query) { values.push('%' + input.query.replace(/[\\%_]/g, '\\$&') + '%'); where.push(`(s.name ILIKE $${values.length} OR s.description ILIKE $${values.length})`) }
    const { rows } = await ctx.db.query<SkillRow>(`SELECT ${columns},u.name AS "authorName",s."reviewNote" FROM community_skill s JOIN "user" u ON u.id=s."authorId" ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 31`, values)
    ctx.json(200, { items: await present(ctx, rows.slice(0, 30)), nextCursor: rows.length > 30 ? rows[29]!.id : null }); return true
  }
  if (ctx.req.method === 'GET' && id) {
    const download = match?.[2] === '/download'
    if (match?.[2] && !download) return false
    const { rows } = await ctx.db.query<SkillRow>(`SELECT ${columns},s.body,s."reviewNote",u.name AS "authorName"${download ? ',s.archive' : ''} FROM community_skill s JOIN "user" u ON u.id=s."authorId" WHERE s.id=$1 AND ((s.status='published' AND NOT u."isDeleted" AND NOT u."isSuspended") OR s."authorId"=$2 OR $3)`, [id, actor?.id || '', Boolean(actor?.isAdmin)])
    const row = rows[0]; if (!row) invalid('技能不存在或尚未公开。', 404)
    if (download) {
      const ext = row.filename.toLowerCase().endsWith('.zip') ? 'zip' : 'md'
      ctx.reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="skill-${id}.${ext}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`).send(row.archive)
    } else ctx.json(200, { skill: (await present(ctx, rows, true))[0] })
    return true
  }
  if (!['POST', 'PATCH', 'DELETE'].includes(ctx.req.method || '')) return false
  const user = ctx.requireUser()
  const count = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],3600) end; return n', 1, `community-next:skills:rate:${user.id}`))
  if (count > (admin ? 300 : 60)) invalid('技能操作过于频繁，请稍后再试。', 429)
  if (ctx.req.method === 'POST' && path === prefix + '/inspect') {
    const upload = unpack(parsed(uploadSchema, ctx.body)), pack = await readSkillPackage(upload.filename, upload.source)
    const { archive: _archive, ...result } = pack
    ctx.json(200, result); return true
  }
  if (ctx.req.method === 'POST' && match?.[2] === '/review' && admin) {
    const input = parsed(z.object({ version: z.number().int().positive(), action: z.enum(['approve', 'reject', 'remove']), reason: z.string().trim().max(1000).default('') }).strict(), ctx.body)
    if (input.action !== 'approve' && !input.reason) invalid('请填写审核或下架原因。')
    await transaction(ctx.db, async db => {
      const row = (await db.query<SkillRow>('SELECT id,status,version FROM community_skill WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!row) invalid('技能不存在。', 404)
      if (row.version !== input.version) invalid('技能已被修改，请刷新后重新审核。', 409)
      const status = input.action === 'approve' ? 'published' : input.action === 'reject' ? 'rejected' : 'removed'
      await db.query('UPDATE community_skill SET status=$2,"reviewNote"=$3,"reviewedBy"=$4,version=version+1,"updatedAt"=now() WHERE id=$1', [id, status, input.reason, user.id])
      await audit(ctx, db, 'communitySkillReview', { id: id!, status, version: row.version + 1 })
    })
    ctx.json(200, { id }); return true
  }
  if ((ctx.req.method === 'POST' && path === prefix) || (ctx.req.method === 'PATCH' && id && !match?.[2])) {
    const input = parsed(saveSchema, ctx.body)
    if (!admin && input.publish !== undefined || !id && (!input.upload || !input.requestId) || id && !input.version) invalid()
    const initial = id ? (await ctx.db.query<SkillRow>('SELECT * FROM community_skill WHERE id=$1 AND ("authorId"=$2 OR $3)', [id, user.id, admin])).rows[0] : undefined
    if (id && !initial) invalid('技能不存在或没有编辑权限。', 404)
    const uploaded = input.upload ? unpack(input.upload) : { filename: initial!.filename, source: initial!.archive! }
    const pack = await readSkillPackage(uploaded.filename, uploaded.source, input.body)
    const status = admin && input.publish ? 'published' : 'pending'
    const hash = createHash('sha256').update(JSON.stringify([input.name, input.kind, input.description, pack.sha256, createHash('sha256').update(pack.archive).digest('hex'), status])).digest('hex')
    const savedId = await transaction(ctx.db, async db => {
      // Serialize the author's quota checks as well as updates to this skill.
      const authorId = initial?.authorId || user.id
      const author = (await db.query('SELECT id FROM "user" WHERE id=$1 AND NOT "isDeleted" AND NOT "isSuspended" FOR UPDATE', [authorId])).rows[0]
      if (!author) invalid('作者账号当前不可用。', 403)
      const row = id ? (await db.query<SkillRow>('SELECT id,version FROM community_skill WHERE id=$1 FOR UPDATE', [id])).rows[0] : undefined
      if (id && (!row || row.version !== input.version)) invalid('技能已变化，请刷新后重新编辑。', 409)
      if (!id) {
        const prior = (await db.query<SkillRow>('SELECT id,"requestHash" FROM community_skill WHERE "authorId"=$1 AND "requestId"=$2', [user.id, input.requestId])).rows[0]
        if (prior) { if (prior.requestHash !== hash) invalid('本次上传已提交，请刷新后核对。', 409); return prior.id }
      }
      const usage = (await db.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(size),0)::bigint AS bytes FROM community_skill WHERE "authorId"=$1 AND id<>$2', [authorId, id || ''])).rows[0]
      if (usage.count >= skillLimits.accountCount || Number(usage.bytes) + pack.size > skillLimits.accountBytes) invalid('技能空间已满：每个账号最多 100 个技能、合计 100 MB。', 413)
      const savedId = id || ctx.newId()
      const values = [savedId, input.name, input.description, pack.body, pack.sha256, pack.filename, pack.archive, pack.size, JSON.stringify(pack.files), status, admin ? user.id : null, input.kind]
      if (id) await db.query('UPDATE community_skill SET kind=$12,name=$2,description=$3,body=$4,sha256=$5,filename=$6,archive=$7,size=$8,files=$9::jsonb,status=$10,"reviewedBy"=$11,"reviewNote"=\'\',version=version+1,"updatedAt"=now() WHERE id=$1', values)
      else await db.query('INSERT INTO community_skill (id,name,description,body,sha256,filename,archive,size,files,status,"reviewedBy",kind,"authorId",official,"requestId","requestHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)', [...values, user.id, admin, input.requestId, hash])
      await audit(ctx, db, id ? 'communitySkillEdit' : 'communitySkillCreate', { id: savedId, status, version: (row?.version || 0) + 1 })
      return savedId
    })
    ctx.json(200, { id: savedId, status }); return true
  }
  if (ctx.req.method === 'DELETE' && id && !match?.[2]) {
    const input = parsed(z.object({ version: z.number().int().positive() }).strict(), ctx.body)
    await transaction(ctx.db, async db => {
      const row = (await db.query<SkillRow>('SELECT id,status,version FROM community_skill WHERE id=$1 AND ("authorId"=$2 OR $3) FOR UPDATE', [id, user.id, admin])).rows[0]
      if (!row) invalid('技能不存在或没有删除权限。', 404)
      if (row.version !== input.version) invalid('技能已变化，请刷新后再删除。', 409)
      await db.query('DELETE FROM community_skill WHERE id=$1', [id])
      await audit(ctx, db, 'communitySkillDelete', row)
    })
    ctx.json(200, { id }); return true
  }
  return false
}
