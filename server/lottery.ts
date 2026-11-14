/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto'
import {
  availableLotteryPrizes, chooseLotteryPrize, defaultLotterySettings,
  emptyLotteryProgress, lotteryCreditReceipt, lotteryCredits, normalizeLotterySettings,
} from './business/lottery.ts'
import type {
  LotteryAward, LotteryCreditReceipt, LotteryProgress, LotterySettings, LotterySettingsInput,
} from './business/lottery.ts'
import type { AppConfig, Database, Queryable, RequestContext } from './types.ts'

interface LotteryConfigRow {
  id: string
  version: number
  settings: LotterySettings
}
interface LotteryAccountRow {
  userId: string
  balance: number
  progress: LotteryProgress
}
interface PublicDrawSource {
  id: string
  userId: string | null
  createdAt: Date | string
  creditAttempts: number
  prizes: LotteryAward[]
}
interface LotteryDrawRow extends PublicDrawSource {
  requestId: string
  creditIssuer: string | null
  creditSubject: string | null
  creditPending: boolean
  creditRetryAt: Date | string | null
  username?: string | null
}
interface AdjustmentReceipt {
  userId: string
  mode: 'add' | 'set'
  amount: number
  before: number
  after: number
  requestId: string
  reason: string
}
interface LotteryRecordFilters {
  userId?: string | null
  status?: string | null
}
type LotteryServiceOptions = {
  db: Database
  config: Pick<AppConfig, 'url' | 'newApiSso'>
  fetcher?: typeof fetch
  newId?: () => string
  logger?: Pick<Console, 'warn'>
}
type ServiceContext = Pick<RequestContext, 'db' | 'config' | 'newId'>

const MAX = 2147483647
const requestPattern = /^[a-zA-Z0-9_-]{16,64}$/
const services = new WeakMap<Database, ReturnType<typeof createLotteryService>>()

function fail(code: string, statusCode = 400): never {
  throw Object.assign(new Error(code), { statusCode, code })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function transaction<T>(db: Database, action: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function issuerOrigin(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('LOTTERY_CREDIT_CONFIG')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin.length > 255) throw new Error('LOTTERY_CREDIT_CONFIG')
  return url.origin
}

export function validateLotterySettings(input: unknown): LotterySettingsInput {
  if (!isRecord(input) || typeof input.enabled !== 'boolean'
    || (input.likesMode !== 'work' && input.likesMode !== 'total') || !Array.isArray(input.prizes) || input.prizes.length > 30) fail('LOTTERY_INVALID')
  for (const field of ['invites', 'likes', 'followers'] as const) {
    const rule = input[field]
    if (!isRecord(rule) || typeof rule.enabled !== 'boolean' || typeof rule.threshold !== 'number' || !Number.isInteger(rule.threshold)
      || rule.threshold < 1 || rule.threshold > 1000000 || typeof rule.tickets !== 'number' || !Number.isInteger(rule.tickets)
      || rule.tickets < 1 || rule.tickets > 1000) fail('LOTTERY_INVALID')
  }
  const ids = new Set<string>()
  const prizes: unknown[] = input.prizes
  for (const prize of prizes) {
    if (!isRecord(prize) || typeof prize.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(prize.id) || ids.has(prize.id)
      || typeof prize.name !== 'string' || !prize.name.trim() || prize.name.length > 80
      || typeof prize.description !== 'string' || prize.description.length > 500
      || typeof prize.enabled !== 'boolean' || (prize.kind !== 'balance' && prize.kind !== 'empty')
      || typeof prize.amountCents !== 'number' || !Number.isInteger(prize.amountCents) || prize.amountCents < 0 || prize.amountCents > 1000000
      || (prize.kind === 'balance' ? prize.amountCents < 1 : prize.amountCents !== 0)
      || typeof prize.weight !== 'number' || !Number.isInteger(prize.weight) || prize.weight < 1 || prize.weight > 1000000
      || typeof prize.stock !== 'number' || !Number.isInteger(prize.stock) || prize.stock < -1 || prize.stock > 1000000) fail('LOTTERY_INVALID')
    ids.add(prize.id)
  }
  if (input.wheel !== undefined) {
    const wheel = input.wheel
    if (!isRecord(wheel) || typeof wheel.theme !== 'string' || !['teal', 'violet', 'sunset'].includes(wheel.theme)) fail('LOTTERY_INVALID')
    for (const [field, maximum] of [['title', 32], ['subtitle', 120], ['buttonText', 8], ['rulesText', 2000]] as const) {
      const value = wheel[field]
      if (typeof value !== 'string' || value.length > maximum || (field === 'buttonText' && !value.trim())) fail('LOTTERY_INVALID')
    }
  }
  const settings = input as unknown as LotterySettingsInput
  if (settings.enabled && !availableLotteryPrizes(settings.prizes).length) fail('LOTTERY_INVALID')
  return settings
}

export function packLotteryDraw(row: PublicDrawSource, username = '') {
  return {
    id: row.id, userId: row.userId ?? '', username,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(), creditAttempts: row.creditAttempts,
    prizes: row.prizes.map(({ fulfilledBy: _actor, creditReceipt: _receipt, creditBlocked: _blocked, ...prize }) => prize),
  }
}

export function packAdminLotteryDraw(row: LotteryDrawRow) {
  const packed = packLotteryDraw(row, row.username ?? '')
  const accountId = typeof row.creditSubject === 'string' && /^[1-9]\d{0,15}$/.test(row.creditSubject) ? Number(row.creditSubject) : NaN
  return {
    ...packed,
    creditPending: row.creditPending,
    creditAccountId: Number.isSafeInteger(accountId) ? accountId : null,
    creditRetryAt: row.creditRetryAt ? new Date(row.creditRetryAt).toISOString() : null,
    prizes: packed.prizes.map((prize, index) => {
      const source = row.prizes[index]!
      const reference = `community_lottery_${row.id}_${index}`
      const blocked = source.status === 'pending' && (source.creditBlocked === true || row.creditAttempts >= 3)
      const blockedReason = !blocked ? null : source.creditBlocked === true ? 'UPSTREAM_REJECTED_OR_INVALID_RECEIPT' : 'RETRY_LIMIT'
      let receiptStatus: 'verified' | 'missing' | 'invalid' | 'not-required' = source.status === 'empty' ? 'not-required' : 'missing'
      let receipt: LotteryCreditReceipt | null = null
      if (source.status !== 'empty' && source.creditReceipt != null) {
        receiptStatus = 'invalid'
        try {
          if (!Number.isSafeInteger(accountId) || !Number.isSafeInteger(source.amountCents) || source.amountCents <= 0 || !isRecord(source.creditReceipt)) throw new Error('LOTTERY_CREDIT_RESPONSE')
          receipt = lotteryCreditReceipt({
            credited: true, reference, user_id: accountId, amount_cents: source.amountCents,
            receipt: { id: source.creditReceipt.id, quota_added: source.creditReceipt.quotaAdded, quota_per_usd: source.creditReceipt.quotaPerUsd },
          }, reference, accountId, source.amountCents)
          receiptStatus = 'verified'
        } catch { /* A stored receipt is evidence only after the original quota validation passes. */ }
      }
      return {
        ...prize, reference, deliveryStatus: blocked ? 'blocked' as const : source.status,
        blockedReason, receiptStatus, creditReceipt: receipt, amountMatches: receipt ? true : null,
      }
    }),
  }
}

export function createLotteryService({ db, config, fetcher = fetch, newId = () => randomBytes(16).toString('hex'), logger = console }: LotteryServiceOptions) {
  let processing = false

  function creditConfig() {
    const settings = config.newApiSso
    if (typeof settings?.lotterySecret !== 'string' || settings.lotterySecret.length < 32) return null
    try { return { issuer: issuerOrigin(settings.issuer), secret: settings.lotterySecret } }
    catch { return null }
  }

  async function creditRequest(issuer: string | null, body?: Record<string, unknown>, signal = AbortSignal.timeout(8000)): Promise<Record<string, unknown>> {
    const settings = creditConfig()
    if (!settings || settings.issuer !== issuer) throw Object.assign(new Error('LOTTERY_CREDIT_CONFIG'), { permanent: true })
    const response = await fetcher(new URL('/api/community-sso/lottery', settings.issuer), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.secret}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw Object.assign(new Error(`LOTTERY_CREDIT_HTTP_${response.status}`), {
      permanent: response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status),
    })
    let size = 0
    const chunks: Buffer[] = []
    if (!response.body) throw new Error('LOTTERY_CREDIT_RESPONSE')
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 65536) throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true })
      chunks.push(Buffer.from(chunk))
    }
    try {
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isRecord(result)) throw new Error('LOTTERY_CREDIT_RESPONSE')
      return result
    }
    catch { throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true }) }
  }

  async function configuration(client: Queryable, lock = false) {
    await client.query('INSERT INTO community_lottery_config (id, version, settings) VALUES ($1,0,$2::jsonb) ON CONFLICT (id) DO NOTHING', ['default', JSON.stringify(defaultLotterySettings())])
    const { rows } = await client.query<LotteryConfigRow>(`SELECT * FROM community_lottery_config WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, ['default'])
    const row = rows[0]
    if (!row) fail('LOTTERY_UNAVAILABLE', 500)
    row.settings = normalizeLotterySettings(row.settings)
    return row
  }

  async function actor(client: Queryable, userId: string | null) {
    const { rows } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE id=$1 AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" AND "movedToUri" IS NULL', [userId])
    if (!rows.length) fail('LOTTERY_FORBIDDEN', 403)
  }

  async function statistics(client: Queryable, userId: string | null) {
    const { rows: invites } = await client.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM community_lottery_referral WHERE "inviterId"=$1', [userId])
    const { rows: followers } = await client.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM following f JOIN "user" u ON u.id=f."followerId" WHERE f."followeeId"=$1 AND f."followerId"<>$1 AND u.host IS NULL AND NOT u."isSuspended" AND NOT u."isDeleted"', [userId])
    const { rows: works } = await client.query<{ id: string; likes: number }>(`SELECT s.id,COUNT(r.id)::integer AS likes FROM community_submission s JOIN note n ON n.id=s."approvedNoteId"
      LEFT JOIN note_reaction r ON r."noteId"=n.id AND r."userId"<>$1 AND r.reaction IN ('❤','❤️')
      AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=r."userId" AND u.host IS NULL AND NOT u."isSuspended" AND NOT u."isDeleted")
      WHERE s."authorId"=$1 AND s.status IN ('approved','published') AND s.destination='community' AND n.visibility='public' GROUP BY s.id`, [userId])
    const inviteCount = invites[0], followerCount = followers[0]
    if (!inviteCount || !followerCount) fail('LOTTERY_UNAVAILABLE', 500)
    return { invites: inviteCount.count, followers: followerCount.count, works }
  }

  async function sync(client: Queryable, userId: string | null, settings: LotterySettings) {
    await client.query('INSERT INTO community_lottery_account ("userId",balance,progress) VALUES ($1,0,$2::jsonb) ON CONFLICT ("userId") DO NOTHING', [userId, JSON.stringify(emptyLotteryProgress())])
    const { rows } = await client.query<LotteryAccountRow>('SELECT * FROM community_lottery_account WHERE "userId"=$1 FOR UPDATE', [userId])
    const account = rows[0]
    if (!account) fail('LOTTERY_UNAVAILABLE', 500)
    const counts = await statistics(client, userId)
    const credit = lotteryCredits(account.progress, counts, settings)
    if (account.balance + credit.added <= MAX) {
      account.balance += credit.added
      account.progress = credit.progress
      await client.query('UPDATE community_lottery_account SET balance=$2,progress=$3::jsonb WHERE "userId"=$1', [userId, account.balance, JSON.stringify(account.progress)])
    }
    return { account, counts }
  }

  async function deliver(drawId: string) {
    return transaction(db, async client => {
      const { rows } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE id=$1 FOR UPDATE', [drawId])
      const row = rows[0]
      if (!row) fail('LOTTERY_NOT_FOUND', 404)
      if (!row.creditPending || row.creditAttempts >= 3 || (row.creditRetryAt && (row.creditRetryAt instanceof Date ? row.creditRetryAt.getTime() : new Date(row.creditRetryAt).getTime()) > Date.now())) return packLotteryDraw(row)
      row.creditAttempts++
      const signal = AbortSignal.timeout(8000)
      for (const [index, prize] of row.prizes.entries()) {
        if (prize.status !== 'pending' || prize.creditBlocked) continue
        const reference = `community_lottery_${row.id}_${index}`
        try {
          const response = await creditRequest(row.creditIssuer, {
            client_id: new URL(config.url).origin, user_id: Number(row.creditSubject),
            reference, amount_cents: prize.amountCents,
          }, signal)
          try { prize.creditReceipt = lotteryCreditReceipt(response, reference, Number(row.creditSubject), prize.amountCents) }
          catch { throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true }) }
          prize.status = 'fulfilled'
          prize.fulfilledAt = new Date().toISOString()
          prize.note = `${(prize.amountCents / 100).toFixed(2)} USD`
        } catch (error) {
          const permanent = isRecord(error) && error.permanent === true
          logger.warn?.(`Credit pending for draw ${row.id}: ${permanent ? 'blocked receipt or upstream rejection' : 'transport or temporary error'}.`)
          if (permanent) { prize.creditBlocked = true; continue }
          break
        }
      }
      row.creditPending = row.prizes.some(prize => prize.status === 'pending')
      if (row.creditPending && row.prizes.filter(prize => prize.status === 'pending').every(prize => prize.creditBlocked)) row.creditAttempts = 3
      row.creditRetryAt = row.creditPending ? new Date(Date.now() + row.creditAttempts * 60000) : null
      await client.query('UPDATE community_lottery_draw SET prizes=$2::jsonb,"creditPending"=$3,"creditAttempts"=$4,"creditRetryAt"=$5 WHERE id=$1',
        [row.id, JSON.stringify(row.prizes), row.creditPending, row.creditAttempts, row.creditRetryAt])
      return packLotteryDraw(row)
    })
  }

  async function processPending() {
    if (processing || !creditConfig()) return
    processing = true
    try {
      const { rows } = await db.query<{ id: string }>('SELECT id FROM community_lottery_draw WHERE "creditPending"=true AND "creditAttempts"<3 AND ("creditRetryAt" IS NULL OR "creditRetryAt"<=NOW()) ORDER BY id ASC LIMIT 5')
      for (const row of rows) await deliver(row.id)
    } catch { logger.warn?.('Could not scan pending lottery credits.') }
    finally { processing = false }
  }

  async function status(userId?: string) {
    const credit = creditConfig()
    return transaction(db, async client => {
      if (userId) await actor(client, userId)
      const { settings } = await configuration(client, Boolean(userId))
      const result = userId ? await sync(client, userId, settings) : null
      const progress = result?.account.progress ?? emptyLotteryProgress()
      const { rows } = userId && credit ? await client.query<{ '?column?': number }>('SELECT 1 FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId]) : { rows: [] }
      return {
        creditReady: Boolean(credit), accountLinked: rows.length > 0,
        settings: { ...settings, prizes: settings.prizes.filter(prize => prize.enabled) },
        balance: result?.account.balance ?? 0,
        earned: { invites: progress.invites, likes: progress.likes, followers: progress.followers },
        counts: {
          invites: result?.counts.invites ?? 0, followers: result?.counts.followers ?? 0,
          likes: result?.counts.works.reduce((sum, work) => sum + work.likes, 0) ?? 0,
          bestWorkLikes: result?.counts.works.reduce((best, work) => Math.max(best, work.likes), 0) ?? 0,
        },
        inviteUrl: userId ? `${new URL(config.url).origin}/activities?invite=${encodeURIComponent(userId)}` : '',
      }
    })
  }

  async function draw(userId: string, requestId: unknown, count: unknown) {
    if (typeof count !== 'number' || ![1, 3, 5].includes(count) || typeof requestId !== 'string' || !requestPattern.test(requestId)) fail('LOTTERY_INVALID')
    const receipt = await transaction(db, async client => {
      await actor(client, userId)
      const pool = await configuration(client, true)
      const { rows: existing } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "userId"=$1 AND "requestId"=$2', [userId, requestId])
      const previous = existing[0]
      if (previous) {
        if (previous.prizes.length !== count) fail('LOTTERY_CONFLICT', 409)
        return packLotteryDraw(previous)
      }
      if (!pool.settings.enabled || !availableLotteryPrizes(pool.settings.prizes).length) fail('LOTTERY_UNAVAILABLE', 409)
      const credit = creditConfig()
      const { rows } = credit ? await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId]) : { rows: [] }
      const subject = rows[0]?.subject
      if (!credit || typeof subject !== 'string' || !/^[1-9]\d{0,14}$/.test(subject) || !Number.isSafeInteger(Number(subject))) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      const { account } = await sync(client, userId, pool.settings)
      if (account.balance < count) fail('LOTTERY_INSUFFICIENT', 409)
      const prizes: LotteryAward[] = []
      for (let index = 0; index < count; index++) {
        const prize = chooseLotteryPrize(pool.settings.prizes)
        if (!prize) fail('LOTTERY_UNAVAILABLE', 409)
        if (prize.stock > 0) prize.stock--
        prizes.push({ amountCents: prize.amountCents, prizeId: prize.id, name: prize.name, description: prize.description,
          status: prize.kind === 'empty' ? 'empty' : 'pending', fulfilledAt: null, fulfilledBy: null, note: '' })
      }
      await client.query('UPDATE community_lottery_account SET balance=balance-$2 WHERE "userId"=$1', [userId, count])
      await client.query('UPDATE community_lottery_config SET version=version+1,settings=$2::jsonb WHERE id=$1', ['default', JSON.stringify(pool.settings)])
      const row = { id: newId(), userId, requestId, prizes, createdAt: new Date(), creditAttempts: 0 }
      await client.query(`INSERT INTO community_lottery_draw (id,"userId","requestId",prizes,"createdAt","creditIssuer","creditSubject","creditPending","creditAttempts","creditRetryAt")
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,0,NULL)`, [row.id, userId, requestId, JSON.stringify(prizes), row.createdAt, credit.issuer, subject, prizes.some(prize => prize.status === 'pending')])
      return packLotteryDraw(row)
    })
    void processPending()
    return receipt
  }

  async function records(userId: string, admin = false, cursor?: string | null, drawId?: string | null, filters: LotteryRecordFilters = {}) {
    const parameters: string[] = []
    const where: string[] = []
    if (!admin) { parameters.push(userId); where.push(`d."userId"=$${parameters.length}`) }
    else {
      if (filters.userId) {
        if (!/^[a-zA-Z0-9]{1,32}$/.test(filters.userId)) fail('LOTTERY_INVALID')
        parameters.push(filters.userId); where.push(`d."userId"=$${parameters.length}`)
      }
      const status = filters.status || 'all'
      if (!['all', 'fulfilled', 'pending', 'blocked', 'empty'].includes(status)) fail('LOTTERY_INVALID')
      if (status !== 'all') {
        const pending = `award->>'status'='pending'`
        const blocked = `(award->>'creditBlocked'='true' OR d."creditAttempts">=3)`
        const condition = status === 'blocked' ? `${pending} AND ${blocked}`
          : status === 'pending' ? `${pending} AND NOT COALESCE(award->>'creditBlocked'='true',false) AND d."creditAttempts"<3`
            : status === 'fulfilled' ? `award->>'status'='fulfilled'` : `award->>'status'='empty'`
        where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(d.prizes) AS award WHERE ${condition})`)
      }
    }
    if (drawId) { parameters.push(drawId); where.push(`d.id=$${parameters.length}`) }
    else if (cursor) { parameters.push(cursor); where.push(`d.id<$${parameters.length}`) }
    const { rows } = await db.query<LotteryDrawRow>(`SELECT d.*,u.username FROM community_lottery_draw d LEFT JOIN "user" u ON u.id=d."userId"${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 21`, parameters)
    return { items: rows.slice(0, 20).map(row => admin ? packAdminLotteryDraw(row) : packLotteryDraw(row)), nextCursor: rows.length > 20 ? rows[19]?.id ?? null : null }
  }

  async function getConfig() {
    return transaction(db, async client => {
      const { settings, version } = await configuration(client)
      return { settings, version }
    })
  }

  async function updateConfig(version: unknown, input: unknown) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) fail('LOTTERY_INVALID')
    const normalized = structuredClone(validateLotterySettings(input))
    for (const prize of normalized.prizes) { prize.name = prize.name.trim(); prize.description = prize.description.trim() }
    if (normalized.enabled) {
      const credit = creditConfig()
      try {
        if (!credit) throw new Error()
        const health = await creditRequest(credit.issuer)
        if (health.ready !== true || health.client_id !== new URL(config.url).origin) throw new Error()
      } catch { fail('LOTTERY_UNAVAILABLE', 409) }
    }
    return transaction(db, async client => {
      const current = await configuration(client, true)
      if (version !== current.version) fail('LOTTERY_CONFLICT', 409)
      const settings = normalizeLotterySettings({ ...normalized, wheel: normalized.wheel ?? current.settings.wheel })
      for (const key of ['title', 'subtitle', 'buttonText', 'rulesText'] as const) settings.wheel[key] = settings.wheel[key].trim()
      settings.wheel.buttonText ||= 'GO'
      await client.query('UPDATE community_lottery_config SET version=version+1,settings=$2::jsonb WHERE id=$1', ['default', JSON.stringify(settings)])
      return { version: current.version + 1, settings }
    })
  }

  async function adjustChances(adminId: string, input: Record<string, unknown>) {
    const { userId, mode, amount, expectedBalance, requestId } = input
    if (typeof userId !== 'string' || userId.length > 32 || (mode !== 'add' && mode !== 'set')
      || typeof amount !== 'number' || !Number.isInteger(amount) || amount < (mode === 'add' ? 1 : 0) || amount > MAX
      || typeof expectedBalance !== 'number' || !Number.isInteger(expectedBalance) || expectedBalance < 0 || expectedBalance > MAX
      || typeof requestId !== 'string' || !requestPattern.test(requestId)
      || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 300))) fail('LOTTERY_INVALID')
    const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
    return transaction(db, async client => {
      await actor(client, userId)
      const { settings } = await configuration(client, true)
      const { rows } = await client.query<{ info: AdjustmentReceipt }>(`SELECT info FROM moderation_log WHERE "userId"=$1 AND type='adjustLotteryChances' AND info->>'requestId'=$2`, [adminId, requestId])
      const receipt = rows[0]?.info
      if (receipt && (receipt.userId !== userId || receipt.mode !== mode || receipt.amount !== amount || receipt.before !== expectedBalance || receipt.reason !== reason)) fail('LOTTERY_CONFLICT', 409)
      const { account } = await sync(client, userId, settings)
      if (receipt) return { userId, balance: account.balance }
      if (account.balance !== expectedBalance) fail('LOTTERY_CONFLICT', 409)
      const balance = mode === 'add' ? account.balance + amount : amount
      if (balance > MAX) fail('LOTTERY_INVALID')
      await client.query('UPDATE community_lottery_account SET balance=$2 WHERE "userId"=$1', [userId, balance])
      await client.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)',
        [newId(), adminId, 'adjustLotteryChances', JSON.stringify({ userId, mode, amount, before: expectedBalance, after: balance, requestId, reason })])
      return { userId, balance }
    })
  }

  async function account(userId: string | null) {
    return transaction(db, async client => {
      await actor(client, userId)
      const { settings } = await configuration(client, true)
      const { account: row } = await sync(client, userId, settings)
      return { userId, balance: row.balance }
    })
  }

  async function retry(drawId: unknown) {
    if (typeof drawId !== 'string') fail('LOTTERY_INVALID')
    await transaction(db, async client => {
      const { rows } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE id=$1 FOR UPDATE', [drawId])
      const row = rows[0]
      if (!row) fail('LOTTERY_NOT_FOUND', 404)
      if (row.creditPending) {
        for (const prize of row.prizes) delete prize.creditBlocked
        await client.query('UPDATE community_lottery_draw SET prizes=$2::jsonb,"creditAttempts"=0,"creditRetryAt"=NULL WHERE id=$1', [drawId, JSON.stringify(row.prizes)])
      }
    })
    return deliver(drawId)
  }

  return { status, draw, records, getConfig, updateConfig, adjustChances, account, retry, deliver, processPending }
}

function service(ctx: ServiceContext) {
  const existing = services.get(ctx.db)
  if (existing) return existing
  const created = createLotteryService({ db: ctx.db, config: ctx.config, newId: ctx.newId })
  services.set(ctx.db, created)
  return created
}

export function startPendingWorker(options: ServiceContext) {
  const instance = service(options)
  const run = () => { void instance.processPending() }
  run()
  const timer = setInterval(run, 5000)
  timer.unref()
  return () => clearInterval(timer)
}

export async function handleLottery(ctx: RequestContext): Promise<boolean> {
  const path = ctx.url.pathname
  if (!path.startsWith('/api/lottery/') && !path.startsWith('/api/admin/lottery/')) return false
  const api = service(ctx)
  const method = ctx.req.method
  const admin = path.startsWith('/api/admin/')
  if (admin) ctx.requireAdmin()
  else if (path !== '/api/lottery/status') ctx.requireUser()
  let result: unknown
  if (method === 'GET' && path === '/api/lottery/status') result = await api.status(ctx.user?.id)
  else if (method === 'POST' && path === '/api/lottery/draw') result = await api.draw(ctx.requireUser().id, ctx.body.requestId, ctx.body.count)
  else if (method === 'GET' && path.endsWith('/records')) result = await api.records(ctx.requireUser().id, admin, ctx.url.searchParams.get('cursor'), ctx.url.searchParams.get('drawId'), { userId: ctx.url.searchParams.get('userId'), status: ctx.url.searchParams.get('status') })
  else if (method === 'GET' && path === '/api/admin/lottery/config') result = await api.getConfig()
  else if (method === 'PATCH' && path === '/api/admin/lottery/config') result = await api.updateConfig(ctx.body.version, ctx.body.settings)
  else if (method === 'GET' && path === '/api/admin/lottery/account') result = await api.account(ctx.url.searchParams.get('userId'))
  else if (method === 'POST' && path === '/api/admin/lottery/chances') result = await api.adjustChances(ctx.requireAdmin().id, ctx.body)
  else if (method === 'POST' && path === '/api/admin/lottery/retry') result = await api.retry(ctx.body.drawId)
  else return false
  ctx.json(200, result)
  return true
}
