import { randomBytes } from 'node:crypto'
import { maintenanceInput, type MaintenanceBenefit, type MaintenanceClaim, type MaintenanceInput } from '../shared/maintenance-benefits.ts'
import { createCommunityCreditClient } from './community-credit.ts'
import { lotteryCreditReceipt, type LotteryCreditReceipt } from './business/lottery.ts'
import type { AppConfig, Database, Queryable, RequestContext } from './types.ts'

type BenefitRow = { id: string; version: number; definition: MaintenanceInput; active: boolean; createdAt: Date;
  recipientCount?: number; claimedCount?: number; pendingCount?: number; totalDisplays?: number }
type Delivery = { id: string; benefitId: string; userId: string; issuer: string; subject: string; displayCount: number; lastShownAt: Date | null;
  claimedAt: Date | null; credits: number; validityDays: number; status: 'unclaimed' | MaintenanceClaim['status']; attempts: number; retryAt: Date | null; receipt: LotteryCreditReceipt | null }
type Options = { db: Database; config: Pick<AppConfig, 'url' | 'newApiSso'>; newId: () => string; fetcher?: typeof fetch; now?: () => Date }
const instances = new WeakMap<Database, ReturnType<typeof createMaintenanceService>>()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(value)
function fail(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }) }
async function transaction<T>(db: Database, action: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}
function pack(row: BenefitRow): MaintenanceBenefit {
  return { ...row.definition, id: row.id, version: row.version, isActive: row.active, createdAt: new Date(row.createdAt).toISOString(),
    recipientCount: row.recipientCount ?? 0, claimedCount: row.claimedCount ?? 0, pendingCount: row.pendingCount ?? 0, totalDisplays: row.totalDisplays ?? 0 }
}
const reference = (row: Delivery) => `community_lottery_${row.id}_0`
function claimView(row?: Delivery): MaintenanceClaim | null {
  return !row?.claimedAt || row.status === 'unclaimed' ? null : { credits: row.credits, rewardValidityDays: row.validityDays,
    status: row.status, expiresAt: row.receipt?.expiresAt ?? null, reference: reference(row) }
}

export function createMaintenanceService({ db, config, newId, fetcher, now = () => new Date() }: Options) {
  const credit = createCommunityCreditClient(config, fetcher)
  async function account(client: Queryable, userId: string) {
    const issuer = credit.configuration()?.issuer
    if (!issuer) fail('福利积分服务暂不可用，请稍后再试。', 503)
    const row = (await client.query<{ subject: string }>(`SELECT e.subject FROM external_account e JOIN "user" u ON u.id=e."userId"
      WHERE e.issuer=$1 AND e."userId"=$2 AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL`, [issuer, userId])).rows[0]
    if (!row || !/^[1-9]\d{0,15}$/.test(row.subject) || !Number.isSafeInteger(Number(row.subject))) fail('请先登录有效的统一积分账号。', 403)
    return { issuer, subject: row.subject }
  }
  async function delivery(client: Queryable, benefitId: string, userId: string, owner: { issuer: string; subject: string }, lock = false) {
    const rows = (await client.query<Delivery>(`SELECT * FROM community_maintenance_delivery WHERE "benefitId"=$1
      AND ("userId"=$2 OR (issuer=$3 AND subject=$4))${lock ? ' FOR UPDATE' : ''}`, [benefitId, userId, owner.issuer, owner.subject])).rows
    // An account cannot collect again after relinking, nor read another wallet's receipt.
    if (rows.some(row => row.issuer !== owner.issuer || row.subject !== owner.subject)) fail('账号绑定已变化，请联系管理员核对原领取记录。', 409)
    return rows[0]
  }
  function available(row: BenefitRow) { const time = now().getTime(); return row.active && time >= Date.parse(row.definition.startsAt) && time < Date.parse(row.definition.endsAt) }
  async function list(cursor?: string | null) {
    if (cursor && !validId(cursor)) fail('分页参数无效。')
    const { rows } = await db.query<BenefitRow>(`SELECT b.*,
      (SELECT count(*)::int FROM community_maintenance_delivery d WHERE d."benefitId"=b.id AND d."displayCount">0) AS "recipientCount",
      (SELECT count(*)::int FROM community_maintenance_delivery d WHERE d."benefitId"=b.id AND d.status='fulfilled') AS "claimedCount",
      (SELECT count(*)::int FROM community_maintenance_delivery d WHERE d."benefitId"=b.id AND d.status IN ('pending','blocked')) AS "pendingCount",
      (SELECT coalesce(sum(d."displayCount"),0)::int FROM community_maintenance_delivery d WHERE d."benefitId"=b.id) AS "totalDisplays"
      FROM community_maintenance_benefit b WHERE ($1::text IS NULL OR (b."createdAt",b.id)<(SELECT "createdAt",id FROM community_maintenance_benefit WHERE id=$1)) ORDER BY b."createdAt" DESC,b.id DESC LIMIT 21`, [cursor || null])
    return { benefits: rows.slice(0,20).map(pack), nextCursor: rows.length > 20 ? rows[19]!.id : null }
  }
  async function save(adminId: string, body: Record<string, unknown>) {
    if (!validId(body.id) || !Number.isInteger(body.version) || Number(body.version) < 0 || typeof body.isActive !== 'boolean') fail('活动参数无效，请刷新后重试。')
    const parsed = maintenanceInput.safeParse(body.definition)
    if (!parsed.success) fail('请检查标题、内容、积分、有效期和活动时间；积分须为整数，有效期为 1–365 天。')
    return transaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(502718,1)')
      const previous = (await client.query<BenefitRow>('SELECT * FROM community_maintenance_benefit WHERE id=$1 FOR UPDATE', [body.id])).rows[0]
      if ((previous?.version ?? 0) !== body.version) fail('活动已被其他管理员修改，请刷新列表后重新编辑。', 409)
      if (body.isActive) await client.query('UPDATE community_maintenance_benefit SET active=false,version=version+1 WHERE active AND id<>$1', [body.id])
      const row = previous
        ? (await client.query<BenefitRow>('UPDATE community_maintenance_benefit SET definition=$2::jsonb,active=$3,version=version+1 WHERE id=$1 RETURNING *', [body.id, JSON.stringify(parsed.data), body.isActive])).rows[0]!
        : (await client.query<BenefitRow>('INSERT INTO community_maintenance_benefit (id,definition,active) VALUES ($1,$2::jsonb,$3) RETURNING *', [body.id, JSON.stringify(parsed.data), body.isActive])).rows[0]!
      await client.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)', [newId(), adminId, 'maintenanceBenefitSaved', JSON.stringify({ benefitId: row.id, version: row.version, active: row.active, definition: parsed.data })])
      return { benefit: pack(row) }
    })
  }
  async function offer(userId: string, id?: string | null) {
    if (id && !validId(id)) fail('活动编号无效。')
    const owner = await account(db, userId)
    const row = (await db.query<BenefitRow>(id ? 'SELECT * FROM community_maintenance_benefit WHERE id=$1' : 'SELECT * FROM community_maintenance_benefit WHERE active LIMIT 1', id ? [id] : [])).rows[0]
    if (!row) return { benefit: null, claim: null }
    const sent = await delivery(db, row.id, userId, owner), claim = claimView(sent)
    if (claim) return { benefit: null, claim }
    if (!available(row) || (sent && (sent.displayCount >= row.definition.popupMaxDisplays || (sent.lastShownAt && now().getTime() - new Date(sent.lastShownAt).getTime() < row.definition.popupIntervalMinutes * 60000)))) return { benefit: null, claim: null }
    return { benefit: pack(row), claim: null }
  }
  async function display(userId: string, id: unknown, version: unknown) {
    if (!validId(id)) fail('活动编号无效。')
    return transaction(db, async client => {
      const owner = await account(client, userId)
      const row = (await client.query<BenefitRow>('SELECT * FROM community_maintenance_benefit WHERE id=$1 FOR SHARE', [id])).rows[0]
      if (!row || !available(row) || version !== row.version) return { benefit: null, claim: null }
      // Both the unified account and local account are unique, including simultaneous tabs.
      await client.query(`INSERT INTO community_maintenance_delivery (id,"benefitId","userId",issuer,subject) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, ['m' + randomBytes(16).toString('hex').slice(0,31), id, userId, owner.issuer, owner.subject])
      const sent = await delivery(client, id, userId, owner, true)
      if (!sent) fail('福利展示状态暂不可用。', 503)
      const claim = claimView(sent)
      if (claim) return { benefit: null, claim }
      if (sent.displayCount >= row.definition.popupMaxDisplays || (sent.lastShownAt && now().getTime() - new Date(sent.lastShownAt).getTime() < row.definition.popupIntervalMinutes * 60000)) return { benefit: null, claim: null }
      await client.query('UPDATE community_maintenance_delivery SET "displayCount"="displayCount"+1,"lastShownAt"=$2 WHERE id=$1', [sent.id, now()])
      return { benefit: pack(row), claim: null }
    })
  }
  async function deliver(id: string) {
    return transaction(db, async client => {
      const row = (await client.query<Delivery>('SELECT * FROM community_maintenance_delivery WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!row || row.status !== 'pending' || (row.retryAt && new Date(row.retryAt).getTime() > now().getTime())) return claimView(row)
      let receipt: LotteryCreditReceipt | null = null, blocked = false
      try {
        const payload = await credit.request(row.issuer, { client_id: new URL(config.url).origin, user_id: Number(row.subject), reference: reference(row),
          amount_cents: 0, points: row.credits, reward_kind: 'charity', validity_hours: row.validityDays * 24 })
        try { receipt = lotteryCreditReceipt(payload, reference(row), Number(row.subject), 0, { rewardPoints: row.credits, rewardKind: 'charity', validityHours: row.validityDays * 24 }) }
        catch { throw Object.assign(new Error('Invalid credit receipt'), { permanent: true }) }
      } catch (error) { blocked = (error as { permanent?: boolean }).permanent === true }
      const attempts = row.attempts + 1, status = receipt ? 'fulfilled' : blocked || attempts >= 3 ? 'blocked' : 'pending'
      const updated = (await client.query<Delivery>('UPDATE community_maintenance_delivery SET status=$2,attempts=$3,"retryAt"=$4,receipt=$5::jsonb WHERE id=$1 RETURNING *',
        [id, status, attempts, status === 'pending' ? new Date(now().getTime() + attempts * 60000) : null, receipt ? JSON.stringify(receipt) : null])).rows[0]!
      return claimView(updated)
    })
  }
  async function claim(userId: string, id: unknown, version: unknown) {
    if (!validId(id)) fail('活动编号无效。')
    const sent = await transaction(db, async client => {
      const owner = await account(client, userId)
      const row = (await client.query<BenefitRow>('SELECT * FROM community_maintenance_benefit WHERE id=$1 FOR SHARE', [id])).rows[0]
      const existing = await delivery(client, id, userId, owner, true)
      if (existing?.claimedAt) return existing
      if (!row || !available(row)) fail('这期福利已结束或已停用。', 409)
      if (version !== row.version) fail('福利内容已更新，请关闭后重新打开领取。', 409)
      if (!existing || !existing.displayCount) fail('请先打开福利弹窗。', 409)
      return (await client.query<Delivery>(`UPDATE community_maintenance_delivery SET "claimedAt"=$2,credits=$3,"validityDays"=$4,status='pending' WHERE id=$1 RETURNING *`,
        [existing.id, now(), row.definition.credits, row.definition.rewardValidityDays])).rows[0]!
    })
    return { claim: await deliver(sent.id) }
  }
  let processing: Promise<void> | null = null
  function processPending(): Promise<void> {
    if (processing) return processing
    processing = (async () => {
      const rows = (await db.query<{ id: string }>(`SELECT id FROM community_maintenance_delivery WHERE status='pending' AND ("retryAt" IS NULL OR "retryAt"<=$1) ORDER BY "claimedAt" LIMIT 5`, [now()])).rows
      for (const row of rows) await deliver(row.id)
    })().catch(() => { console.warn('Maintenance benefit delivery is pending; retrying later.') }).finally(() => { processing = null })
    return processing
  }
  async function retry(adminId: string, id: unknown) {
    if (!validId(id)) fail('活动编号无效。')
    await transaction(db, async client => {
      await client.query(`UPDATE community_maintenance_delivery SET status='pending',attempts=0,"retryAt"=NULL WHERE "benefitId"=$1 AND status='blocked'`, [id])
      await client.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)', [newId(), adminId, 'maintenanceBenefitRetry', JSON.stringify({ benefitId: id })])
    })
    return { queued: true }
  }
  async function records(userId: string, cursor?: string | null) {
    if (cursor && !validId(cursor)) fail('分页参数无效。')
    const owner = await account(db, userId)
    const rows = (await db.query<Delivery & { title: string }>(`SELECT d.*,b.definition->>'title' AS title FROM community_maintenance_delivery d
      JOIN community_maintenance_benefit b ON b.id=d."benefitId" WHERE d.issuer=$1 AND d.subject=$2 AND d."claimedAt" IS NOT NULL
      AND ($3::text IS NULL OR (d."claimedAt",d.id)<(SELECT "claimedAt",id FROM community_maintenance_delivery WHERE id=$3 AND issuer=$1 AND subject=$2))
      ORDER BY d."claimedAt" DESC,d.id DESC LIMIT 21`, [owner.issuer, owner.subject, cursor || null])).rows
    return { items: rows.slice(0,20).map(row => ({ id: row.id, benefitId: row.benefitId, title: row.title,
      claimedAt: new Date(row.claimedAt!).toISOString(), claim: claimView(row)! })), nextCursor: rows.length > 20 ? rows[19]!.id : null }
  }
  return { list, save, offer, display, claim, deliver, retry, processPending, records }
}
function service(options: Options) {
  let instance = instances.get(options.db)
  if (!instance) { instance = createMaintenanceService(options); instances.set(options.db, instance) }
  return instance
}
export function startMaintenanceWorker(options: Options) {
  const api = service(options), timer = setInterval(() => { void api.processPending() }, 15000)
  timer.unref()
  return async () => { clearInterval(timer); await api.processPending() }
}
export async function handleMaintenanceBenefits(ctx: RequestContext) {
  const path = ctx.url.pathname
  if (!path.startsWith('/api/maintenance-benefit') && !path.startsWith('/api/admin/maintenance-benefits')) return false
  const user = path.startsWith('/api/admin/') ? ctx.requireAdmin() : ctx.requireUser()
  const expected = ctx.req.headers['x-new-api-user']
  if (expected !== undefined && expected !== user.id) fail('账号已切换，请重新操作。', 409)
  const api = service(ctx), method = ctx.req.method
  let result: unknown
  if (method === 'GET' && path === '/api/admin/maintenance-benefits') result = await api.list(ctx.url.searchParams.get('cursor'))
  else if (method === 'POST' && path === '/api/admin/maintenance-benefits') result = await api.save(user.id, ctx.body)
  else if (method === 'POST' && path === '/api/admin/maintenance-benefits/retry') result = await api.retry(user.id, ctx.body.id)
  else if (method === 'GET' && path === '/api/maintenance-benefit/records') result = await api.records(user.id, ctx.url.searchParams.get('cursor'))
  else if (method === 'GET' && path === '/api/maintenance-benefit') result = await api.offer(user.id, ctx.url.searchParams.get('id'))
  else if (method === 'POST' && path === '/api/maintenance-benefit/display') result = await api.display(user.id, ctx.body.id, ctx.body.version)
  else if (method === 'POST' && path === '/api/maintenance-benefit/claim') result = await api.claim(user.id, ctx.body.id, ctx.body.version)
  else return false
  ctx.reply.header('Cache-Control', 'private, no-store')
  ctx.json(200, result); return true
}
