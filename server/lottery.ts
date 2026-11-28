import { createCommunityCreditClient } from './community-credit.ts'
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes, randomInt } from 'node:crypto'
import {
  availableLotteryPrizes, chooseLotteryPrize, defaultLotterySettings,
  emptyLotteryProgress, lotteryCreditReceipt, lotteryCredits, normalizeLotterySettings,
} from './business/lottery.ts'
import type {
  LotteryAward, LotteryCreditReceipt, LotteryProgress, LotterySettings, LotterySettingsInput,
} from './business/lottery.ts'
import type { AppConfig, Database, Queryable, RequestContext } from './types.ts'
import { communityQuotaPerPoint } from './native-account/community-wallet.ts'
import { lotteryDay } from '../shared/lottery-daily.ts'
import { defaultCheckin, type WelfarePool, type WelfareStatus } from '../shared/welfare-points.ts'
import type { PublicLotteryDraw, PublicLotteryPage } from '../shared/lottery-public.ts'
import { lotteryPointUnits, lotteryPointsFromUnits, type PublicLotteryParticipant, type PublicLotterySummary, type PublicLotteryRange, type PublicLotteryPeriod } from '../shared/lottery-public.ts'

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
  creditSubject?: string | null
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
  now?: () => Date
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
  const daily = input.dailyLimit !== undefined
  if (daily && (typeof input.dailyLimit !== 'number' || !Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 1000000)) fail('LOTTERY_INVALID')
  if (input.minSupportCnyFen !== undefined && (typeof input.minSupportCnyFen !== 'number' || !Number.isSafeInteger(input.minSupportCnyFen)
    || input.minSupportCnyFen < 0 || input.minSupportCnyFen > 100000000)) fail('LOTTERY_INVALID')
  if (input.rewardValidityHours !== undefined && (typeof input.rewardValidityHours !== 'number' || !Number.isInteger(input.rewardValidityHours)
    || input.rewardValidityHours < 1 || input.rewardValidityHours > 8760)) fail('LOTTERY_INVALID')
  if (input.dailyBudgetPoints !== undefined && (typeof input.dailyBudgetPoints !== 'number' || !Number.isSafeInteger(input.dailyBudgetPoints)
    || input.dailyBudgetPoints < 1 || input.dailyBudgetPoints > 1000000000)) fail('LOTTERY_INVALID')
  if (input.checkin !== undefined) {
    const item = input.checkin
    if (!isRecord(item) || typeof item.enabled !== 'boolean' || typeof item.minPoints !== 'number' || typeof item.maxPoints !== 'number'
      || !Number.isSafeInteger(item.minPoints) || !Number.isSafeInteger(item.maxPoints) || item.minPoints < 1 || item.maxPoints < item.minPoints
      || item.maxPoints > 1000000) fail('LOTTERY_INVALID')
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
      || typeof prize.stock !== 'number' || !Number.isInteger(prize.stock) || prize.stock < (daily ? 0 : -1) || prize.stock > 1000000) fail('LOTTERY_INVALID')
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
  if (daily && settings.prizes.filter(prize => prize.enabled).reduce((sum, prize) => sum + prize.stock, 0) !== settings.dailyLimit) fail('LOTTERY_DAILY_QUOTA_INVALID')
  if (settings.enabled && !availableLotteryPrizes(settings.prizes).length) fail('LOTTERY_INVALID')
  return settings
}

function storedCreditReceipt(row: PublicDrawSource, index: number): LotteryCreditReceipt {
  const prize = row.prizes[index]!, receipt = prize.creditReceipt
  const subject = row.creditSubject
  if (typeof subject !== 'string' || !/^[1-9]\d{0,15}$/.test(subject) || !Number.isSafeInteger(Number(subject))
    || !Number.isSafeInteger(prize.amountCents) || (prize.rewardPoints === undefined ? prize.amountCents <= 0 : prize.amountCents < 0) || !isRecord(receipt)) throw new Error('LOTTERY_CREDIT_RESPONSE')
  const reference = `community_lottery_${row.id}_${index}`, userId = Number(subject)
  return lotteryCreditReceipt({ credited: true, reference, user_id: userId, amount_cents: prize.rewardPoints === undefined ? prize.amountCents : 0, receipt: {
    id: receipt.id, quota_added: receipt.quotaAdded, quota_per_usd: receipt.quotaPerUsd,
    reward_kind: receipt.rewardKind, validity_hours: receipt.validityHours, expires_at: receipt.expiresAt,
    points: receipt.points, lot_id: receipt.lotId, credited_at: receipt.creditedAt, quota_per_point: receipt.quotaPerPoint, requested_points: receipt.requestedPoints,
  } }, reference, userId, prize.amountCents, prize)
}

export function packLotteryDraw(row: PublicDrawSource, username = '') {
  return {
    id: row.id, userId: row.userId ?? '', username,
    ...(row.prizes.some(prize => prize.source === 'checkin') ? { source: 'checkin' as const } : {}),
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(), creditAttempts: row.creditAttempts,
    prizes: row.prizes.map(({ fulfilledBy: _actor, creditReceipt, creditBlocked: _blocked, ...prize }, index) => {
      let receipt: LotteryCreditReceipt | null = null
      if (prize.status === 'fulfilled' && creditReceipt) {
        try { receipt = storedCreditReceipt(row, index) }
        catch { /* Historical records without valid delivery evidence remain unclassified. */ }
      }
      if (prize.rewardKind === 'charity') return { ...prize, points: receipt?.points ?? null, expiresAt: receipt?.expiresAt ?? null }
      const quotaPerPoint = communityQuotaPerPoint()
      if (!quotaPerPoint) return prize
      let legacyPoints: string | null = null
      if (receipt) {
        // The wallet validator above checks this integer; convert quota before any floating-point division.
        const quotaPerCny = BigInt(Number(process.env.COMMUNITY_WALLET_QUOTA_PER_CNY))
        const units = (BigInt(receipt.quotaAdded) * 5_000n * 1_000_000n + quotaPerCny / 2n) / quotaPerCny
        legacyPoints = `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, '0')}`
      }
      return { ...prize, legacyPoints }
    }),
  }
}

export async function readPublicLotteryRecords(db: Queryable, query: URLSearchParams): Promise<PublicLotteryPage> {
  const cursor = query.get('cursor'), requestedSnapshot = query.get('snapshot')
  if ([...query.keys()].some(key => !['cursor', 'snapshot'].includes(key) || query.getAll(key).length !== 1)
    || [cursor, requestedSnapshot].some(value => value !== null && !/^[a-zA-Z0-9]{1,32}$/.test(value))
    || cursor && (!requestedSnapshot || cursor > requestedSnapshot)) fail('LOTTERY_INVALID')
  const snapshot = requestedSnapshot ?? (await db.query<{ id: string }>(`SELECT id FROM community_lottery_draw WHERE NOT (prizes @> '[{"source":"checkin"}]'::jsonb) ORDER BY id DESC LIMIT 1`)).rows[0]?.id ?? null
  if (!snapshot) return { items: [], nextCursor: null, snapshot: null }
  // Reuse the draw and user indexes; only page participants need cumulative counts.
  const { rows } = await db.query<LotteryDrawRow & { displayName: string | null; redacted: boolean | null; totalDrawCount: string | null }>(`
    WITH page AS MATERIALIZED (
      SELECT d.* FROM community_lottery_draw d WHERE d.id <= $1 AND ($2::varchar IS NULL OR d.id < $2) AND NOT (d.prizes @> '[{"source":"checkin"}]'::jsonb) ORDER BY d.id DESC LIMIT 21
    ), counts AS (
      SELECT d."userId",sum(jsonb_array_length(d.prizes))::text AS total FROM community_lottery_draw d
      WHERE d.id <= $1 AND d."userId" IN (SELECT "userId" FROM page) AND NOT (d.prizes @> '[{"source":"checkin"}]'::jsonb) GROUP BY d."userId"
    )
    SELECT p.*,COALESCE(u.name,u.username) AS "displayName",(u."isDeleted" OR u."isSuspended") AS redacted,counts.total AS "totalDrawCount"
    FROM page p LEFT JOIN "user" u ON u.id=p."userId" LEFT JOIN counts ON counts."userId"=p."userId" ORDER BY p.id DESC`, [snapshot, cursor])
  const items: PublicLotteryDraw[] = rows.slice(0, 20).map(row => {
    const packed = packLotteryDraw(row)
    const first = Array.from(row.displayName?.trim() ?? '')[0]
    return {
      id: row.id, participant: first && !row.redacted ? `${first}***` : '匿名用户', createdAt: packed.createdAt,
      drawCount: row.prizes.length, totalDrawCount: row.totalDrawCount,
      prizes: packed.prizes.map(prize => ({ name: prize.name, status: prize.status,
        rewardKind: prize.rewardKind === 'charity' ? 'charity' : 'balance',
        points: prize.status === 'fulfilled' ? ('points' in prize ? prize.points : 'legacyPoints' in prize ? prize.legacyPoints : null) ?? null : null,
      })),
    }
  })
  return { items, nextCursor: rows.length > 20 ? rows[19]!.id : null, snapshot }
}

const summaryDayMs = 86_400_000
function validSummaryDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
export function publicLotteryRange(query: URLSearchParams, now = new Date()): PublicLotteryRange {
  const period = query.get('period') ?? 'all', start = query.get('start'), end = query.get('end')
  const today = lotteryDay(now).date
  if ([...query.keys()].some(key => !['period', 'start', 'end'].includes(key) || query.getAll(key).length !== 1)
    || !['today', '7d', '30d', 'custom', 'all'].includes(period)) fail('LOTTERY_INVALID')
  if (period === 'custom') {
    if (!start || !end || !validSummaryDate(start) || !validSummaryDate(end) || start > end || end > today) fail('LOTTERY_INVALID')
    const days = (Date.parse(end!) - Date.parse(start!)) / summaryDayMs + 1
    if (days > 366) fail('LOTTERY_INVALID')
    return { period, start, end, days, timezone: 'Asia/Shanghai' }
  }
  if (start !== null || end !== null) fail('LOTTERY_INVALID')
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : null
  return { period: period as PublicLotteryPeriod, days, timezone: 'Asia/Shanghai', end: days ? today : null,
    start: days ? new Date(Date.parse(today) - (days - 1) * summaryDayMs).toISOString().slice(0, 10) : null }
}

const emptySummaryCounts = () => ({ charity: 0n, permanent: 0n, drawCount: 0n, fulfilledCount: 0n, pendingCount: 0n, unverifiedCount: 0n, emptyCount: 0n })
type SummaryCounts = ReturnType<typeof emptySummaryCounts>
interface SummaryParticipant {
  id: string
  participant: string
  days: Map<string, SummaryCounts>
  undated: SummaryCounts
}
interface LotterySummarySnapshot { participants: SummaryParticipant[]; updatedAt: string }
function summaryDay(days: Map<string, SummaryCounts>, date: string) {
  let counts = days.get(date)
  if (!counts) { counts = emptySummaryCounts(); days.set(date, counts) }
  return counts
}
function addSummaryCounts(target: SummaryCounts, source: SummaryCounts) {
  for (const key of Object.keys(target) as (keyof SummaryCounts)[]) target[key] += source[key]
}
function packedSummaryCounts(counts: SummaryCounts) {
  return { totalPoints: lotteryPointsFromUnits(counts.charity + counts.permanent),
    charityPoints: lotteryPointsFromUnits(counts.charity), permanentPoints: lotteryPointsFromUnits(counts.permanent),
    drawCount: counts.drawCount.toString(), fulfilledCount: counts.fulfilledCount.toString() }
}
function awardDate(prize: LotteryAward): string | null {
  // Only called after receipt validation; never substitute a draw date for an unknown delivery date.
  const value = prize.rewardKind === 'charity' ? (prize.creditReceipt?.creditedAt ?? NaN) * 1000
    : typeof prize.fulfilledAt === 'string' && validSummaryDate(prize.fulfilledAt.slice(0, 10))
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(prize.fulfilledAt) ? Date.parse(prize.fulfilledAt) : NaN
  return Number.isFinite(value) && Math.abs(value) < 8.64e15 ? lotteryDay(new Date(value)).date : null
}

async function buildPublicLotterySummary(db: Database): Promise<LotterySummarySnapshot> {
  type SummaryDraw = PublicDrawSource & { displayName: string | null; redacted: boolean | null }
  const client = await db.connect()
  const participants = new Map<string, SummaryParticipant>(), updatedAt = new Date().toISOString()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    let cursor: string | null = null
    for (;;) {
      const { rows }: { rows: SummaryDraw[] } = await client.query<SummaryDraw>(`
        SELECT d.id,d."userId",d.prizes,d."createdAt",d."creditAttempts",d."creditSubject",
          COALESCE(u.name,u.username) AS "displayName",(u."isDeleted" OR u."isSuspended") AS redacted
        FROM community_lottery_draw d LEFT JOIN "user" u ON u.id=d."userId"
        WHERE ($1::varchar IS NULL OR d.id > $1) ORDER BY d.id ASC LIMIT 500`, [cursor])
      for (const row of rows) {
        if (row.prizes.some(prize => prize.source === 'checkin')) continue
        const key = row.userId ?? ''
        let participant = participants.get(key)
        if (!participant) {
          const first = Array.from(row.displayName?.trim() ?? '')[0]
          participant = {
            id: row.id, participant: row.userId === null ? '已注销用户（合计）' : first && !row.redacted ? `${first}***` : '匿名用户',
            days: new Map(), undated: emptySummaryCounts(),
          }
          participants.set(key, participant)
        }
        const drawDay = summaryDay(participant.days, lotteryDay(new Date(row.createdAt)).date)
        drawDay.drawCount += BigInt(row.prizes.length)
        for (const [index, prize] of packLotteryDraw(row).prizes.entries()) {
          const points = 'points' in prize ? prize.points : 'legacyPoints' in prize ? prize.legacyPoints : null
          const status = prize.status === 'pending' ? 'pendingCount' : prize.status === 'empty' ? 'emptyCount'
            : points == null ? 'unverifiedCount' : 'fulfilledCount'
          if (status === 'fulfilledCount' && points != null) {
            const date = awardDate(row.prizes[index]!)
            const deliveryDay = date ? summaryDay(participant.days, date) : participant.undated
            deliveryDay.fulfilledCount++
            deliveryDay[prize.rewardKind === 'charity' ? 'charity' : 'permanent'] += lotteryPointUnits(points)
          } else drawDay[status]++
        }
      }
      if (rows.length < 500) break
      cursor = rows[rows.length - 1]!.id
    }
    await client.query('COMMIT')
    return { participants: Array.from(participants.values()), updatedAt }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

// One sparse daily snapshot, no per-range cache or extra event storage. Invalidations also coalesce active scans.
const publicSummaries = new WeakMap<Database, { promise: Promise<LotterySummarySnapshot>; dirty: boolean }>()
export function invalidatePublicLotterySummary(db: Database) { const cached = publicSummaries.get(db); if (cached) cached.dirty = true }
function readLotterySummarySnapshot(db: Database): Promise<LotterySummarySnapshot> {
  const existing = publicSummaries.get(db)
  if (existing) return existing.dirty ? existing.promise.catch(() => {}).then(() => {
    if (publicSummaries.get(db) === existing) publicSummaries.delete(db)
    return readLotterySummarySnapshot(db)
  }) : existing.promise
  const entry = { promise: buildPublicLotterySummary(db), dirty: false }
  publicSummaries.set(db, entry)
  const discard = () => { if (publicSummaries.get(db) === entry) publicSummaries.delete(db) }
  void entry.promise.then(() => { setTimeout(discard, 30_000).unref() }, discard)
  return entry.promise
}
export async function readPublicLotterySummary(db: Database, query = new URLSearchParams(), now = new Date()): Promise<PublicLotterySummary> {
  const range = publicLotteryRange(query, now), snapshot = await readLotterySummarySnapshot(db)
  const items: PublicLotteryParticipant[] = [], days = new Map<string, SummaryCounts>(), totals = emptySummaryCounts()
  let undated = 0n
  for (const participant of snapshot.participants) {
    const counts = emptySummaryCounts()
    for (const [date, value] of participant.days) {
      if (range.start && (date < range.start || date > range.end!)) continue
      addSummaryCounts(counts, value); addSummaryCounts(summaryDay(days, date), value)
    }
    if (range.period === 'all') {
      addSummaryCounts(counts, participant.undated)
      undated += participant.undated.charity + participant.undated.permanent
    }
    if (!counts.drawCount && !counts.fulfilledCount) continue
    addSummaryCounts(totals, counts)
    items.push({ id: participant.id, participant: participant.participant, ...packedSummaryCounts(counts),
      pendingCount: counts.pendingCount.toString(), unverifiedCount: counts.unverifiedCount.toString(), emptyCount: counts.emptyCount.toString() })
  }
  if (range.start) for (let i = 0; i < range.days!; i++) summaryDay(days, new Date(Date.parse(range.start) + i * summaryDayMs).toISOString().slice(0, 10))
  return { items, range, updatedAt: snapshot.updatedAt,
    totals: { ...packedSummaryCounts(totals), participantCount: items.length.toString(), undatedPoints: lotteryPointsFromUnits(undated) },
    daily: Array.from(days, ([date, counts]) => ({ date, ...packedSummaryCounts(counts) })).sort((a, b) => b.date.localeCompare(a.date)),
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
          receipt = storedCreditReceipt(row, index)
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

export function createLotteryService({ db, config, fetcher = fetch, newId = () => randomBytes(16).toString('hex'), logger = console, now = () => new Date() }: LotteryServiceOptions) {
  let processing = false

  const { configuration: creditConfig, request: creditRequest } = createCommunityCreditClient(config, fetcher)

  function charityQuotaPerPoint(response: Record<string, unknown>): number | null {
    try {
      const quota = communityQuotaPerPoint()
      return response.ready === true && response.client_id === new URL(config.url).origin
        && Array.isArray(response.reward_kinds) && response.reward_kinds.includes('charity')
        && typeof quota === 'number' && Number.isSafeInteger(quota) && quota > 0 && response.quota_per_point === quota ? quota : null
    } catch { return null }
  }

  function exactPointsRate(response: Record<string, unknown>): number | null {
    const quota = charityQuotaPerPoint(response)
    return quota && response.exact_points === true && typeof response.quota_per_usd === 'number'
      && Number.isSafeInteger(response.quota_per_usd) && response.quota_per_usd > 0 ? response.quota_per_usd / quota : null
  }

  function prizePoints(cents: number, rate: number | null): number {
    const points = rate === null ? NaN : cents * rate / 100
    if (!Number.isSafeInteger(points) || points < 1 || points > 1000000000) fail('WELFARE_UNAVAILABLE', 503)
    return points
  }


  async function readSupport(issuer: string, subject: string) {
    const response = await creditRequest(issuer, undefined, AbortSignal.timeout(8000), subject)
    if (response.ready !== true || response.client_id !== new URL(config.url).origin || response.user_id !== Number(subject)
      || response.basis !== 'support' || typeof response.has_support !== 'boolean' || typeof response.support_cny_fen !== 'number'
      || !Number.isSafeInteger(response.support_cny_fen) || response.support_cny_fen < 0
      || (!response.has_support && response.support_cny_fen > 0)) throw new Error('LOTTERY_SUPPORT_RESPONSE')
    return { hasSupport: response.has_support, amountCnyFen: response.support_cny_fen,
      charityReady: charityQuotaPerPoint(response) !== null, pointsPerUsd: exactPointsRate(response), checkedAt: Date.now() }
  }

  async function configuration(client: Queryable, lock = false) {
    const select = `SELECT * FROM community_lottery_config WHERE id=$1${lock ? ' FOR UPDATE' : ''}`
    let row = (await client.query<LotteryConfigRow>(select, ['default'])).rows[0]
    if (!row) {
      await client.query('INSERT INTO community_lottery_config (id, version, settings) VALUES ($1,0,$2::jsonb) ON CONFLICT (id) DO NOTHING', ['default', JSON.stringify(defaultLotterySettings())])
      row = (await client.query<LotteryConfigRow>(select, ['default'])).rows[0]
    }
    if (!row) fail('LOTTERY_UNAVAILABLE', 500)
    row.settings = normalizeLotterySettings(row.settings)
    row.settings.invites.enabled = false
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
    const select = 'SELECT * FROM community_lottery_account WHERE "userId"=$1 FOR UPDATE'
    let account = (await client.query<LotteryAccountRow>(select, [userId])).rows[0]
    if (!account) {
      await client.query('INSERT INTO community_lottery_account ("userId",balance,progress) VALUES ($1,0,$2::jsonb) ON CONFLICT ("userId") DO NOTHING', [userId, JSON.stringify(emptyLotteryProgress())])
      account = (await client.query<LotteryAccountRow>(select, [userId])).rows[0]
    }
    if (!account) fail('LOTTERY_UNAVAILABLE', 500)
    const counts = await statistics(client, userId)
    const credit = lotteryCredits(account.progress, counts, settings)
    const progress = JSON.stringify(credit.progress)
    if (account.balance + credit.added <= MAX && (credit.added || progress !== JSON.stringify(account.progress))) {
      account.balance += credit.added
      account.progress = credit.progress
      await client.query('UPDATE community_lottery_account SET balance=$2,progress=$3::jsonb WHERE "userId"=$1', [userId, account.balance, progress])
    }
    return { account, counts }
  }

  async function deliver(drawId: string) {
    const receipt = await transaction(db, async client => {
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
          if (prize.rewardKind === 'charity') {
            if (!Number.isInteger(prize.validityHours) || prize.validityHours! < 1 || prize.validityHours! > 8760) throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true })
          }
          const response = await creditRequest(row.creditIssuer, {
            client_id: new URL(config.url).origin, user_id: Number(row.creditSubject),
            reference, amount_cents: prize.rewardPoints === undefined ? prize.amountCents : 0,
            ...(prize.rewardPoints === undefined ? {} : { points: prize.rewardPoints }),
            ...(prize.rewardKind === 'charity' ? { reward_kind: 'charity', validity_hours: prize.validityHours } : {}),
          }, signal)
          try { prize.creditReceipt = lotteryCreditReceipt(response, reference, Number(row.creditSubject), prize.amountCents, prize) }
          catch { throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true }) }
          prize.status = 'fulfilled'
          row.creditAttempts = 0
          prize.fulfilledAt = new Date().toISOString()
          prize.note = prize.rewardPoints === undefined ? `${(prize.amountCents / 100).toFixed(2)} USD` : `${prize.rewardPoints} 积分`
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
    invalidatePublicLotterySummary(db)
    return receipt
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
    const { subject, ...result } = await transaction(db, async client => {
      if (userId) await actor(client, userId)
      const { settings } = await configuration(client)
      const daily = settings.dailyLimit ? await dailyPool(client, settings, userId, now()) : null
      const welfare = settings.welfarePointsReady ? await welfareState(client, settings, userId, now()) : null
      const result = userId ? await sync(client, userId, settings) : null
      const progress = result?.account.progress ?? emptyLotteryProgress()
      const { rows } = userId && credit ? await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId]) : { rows: [] }
      return {
        creditReady: Boolean(credit), accountLinked: rows.length > 0,
        subject: rows[0]?.subject,
        settings: { ...settings, prizes: (daily?.prizes ?? settings.prizes).filter(prize => prize.enabled) },
        daily: daily?.summary ?? null,
        welfare,
        balance: result?.account.balance ?? 0,
        earned: { invites: progress.invites, likes: progress.likes, followers: progress.followers },
        counts: {
          invites: result?.counts.invites ?? 0, followers: result?.counts.followers ?? 0,
          likes: result?.counts.works.reduce((sum, work) => sum + work.likes, 0) ?? 0,
          bestWorkLikes: result?.counts.works.reduce((best, work) => Math.max(best, work.likes), 0) ?? 0,
        },
        inviteUrl: '',
      }
    })
    let support = { checked: false, eligible: false, amountCnyFen: null as number | null }
    let pointsPerUsd: number | null = null
    if (credit && typeof subject === 'string' && /^[1-9]\d{0,14}$/.test(subject)) {
      try {
        const checked = await readSupport(credit.issuer, subject)
        result.creditReady = checked.charityReady
        pointsPerUsd = checked.pointsPerUsd
        support = { checked: true, eligible: checked.hasSupport && checked.amountCnyFen >= result.settings.minSupportCnyFen, amountCnyFen: checked.amountCnyFen }
      } catch { /* Task opportunities remain available when support verification is temporarily unavailable. */ }
    }
    if (result.welfare) {
      if (pointsPerUsd === null && credit) {
        const health = await creditRequest(credit.issuer).catch(() => null)
        pointsPerUsd = health ? exactPointsRate(health) : null
      }
      result.creditReady = pointsPerUsd !== null
      const pool = result.welfare.pool!
      result.settings.prizes = result.settings.prizes.map(prize => {
        const amount = prize.kind === 'empty' ? 0 : pointsPerUsd === null ? Infinity : prizePoints(prize.amountCents, pointsPerUsd)
        return pool.ready && amount <= pool.remaining ? prize : { ...prize, stock: 0, weight: 0 }
      })
      setLotteryRange(result.welfare, result.settings, pointsPerUsd)
    }
    return { ...result, support }
  }

  async function welfarePool(client: Queryable, settings: LotterySettings, time: Date): Promise<WelfarePool> {
    const day = lotteryDay(time)
    const { rows } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "createdAt">=$1 AND "createdAt"<$2', [day.start, day.end])
    let delivered = 0, reserved = 0, ready = true
    for (const row of rows) for (const [index, award] of row.prizes.entries()) {
      if (award.status === 'empty') continue
      let points = award.rewardPoints
      if (points === undefined) {
        try {
          const receipt = award.status === 'fulfilled' ? storedCreditReceipt(row, index) : null
          points = receipt?.rewardKind === 'charity' ? Number(receipt.points) : undefined
        } catch { /* Unverified historical awards block new allocations instead of inventing a balance. */ }
      }
      if (!Number.isSafeInteger(points) || points! < 1) { ready = false; continue }
      if (award.status === 'fulfilled') delivered += points!
      else reserved += points!
    }
    const claimed = delivered + reserved, limit = settings.dailyBudgetPoints ?? 600000
    if (!Number.isSafeInteger(claimed)) fail('WELFARE_UNAVAILABLE', 503)
    return { date: day.date, resetsAt: day.end.toISOString(), serverTime: time.toISOString(), limit, claimed, delivered, reserved,
      remaining: ready ? Math.max(0, limit - claimed) : 0, ready }
  }

  async function todayCheckin(client: Queryable, userId: string | undefined, time: Date, issuer?: string, subject?: string) {
    if (!userId) return null
    const day = lotteryDay(time)
    const { rows } = await client.query<LotteryDrawRow>(`SELECT * FROM community_lottery_draw
      WHERE ("userId"=$1 OR ("creditIssuer"=$4 AND "creditSubject"=$5)) AND "createdAt">=$2 AND "createdAt"<$3
      AND prizes @> '[{"source":"checkin"}]'::jsonb ORDER BY id LIMIT 1`, [userId, day.start, day.end, issuer ?? null, subject ?? null])
    return rows[0] ?? null
  }

  async function welfareState(client: Queryable, settings: LotterySettings, userId: string | undefined, time: Date, rate: number | null = null): Promise<WelfareStatus> {
    const pool = await welfarePool(client, settings, time), checkin = await todayCheckin(client, userId, time)
    const daily = settings.dailyLimit ? await dailyPool(client, settings, userId, time) : null
    const state: WelfareStatus = { pool, checkin: { ...(settings.checkin ?? defaultCheckin()), claimed: !!checkin,
      points: checkin?.prizes[0]?.rewardPoints ?? null, drawId: checkin?.id ?? null,
      status: checkin?.prizes[0]?.status === 'fulfilled' ? 'fulfilled' : checkin ? 'pending' : null },
      lottery: { enabled: settings.enabled, minPoints: null, maxPoints: null, participated: daily?.summary.participated ?? false } }
    setLotteryRange(state, { ...settings, prizes: daily?.prizes ?? settings.prizes }, rate)
    return state
  }

  function setLotteryRange(state: WelfareStatus, settings: LotterySettings, rate: number | null) {
    if (rate === null) return
    const points = settings.prizes.filter(prize => prize.enabled && prize.kind === 'balance' && prize.stock !== 0 && prize.weight > 0)
      .map(prize => prizePoints(prize.amountCents, rate)).filter(points => points <= (state.pool?.remaining ?? 0))
    state.lottery.minPoints = points.length ? Math.min(...points) : null
    state.lottery.maxPoints = points.length ? Math.max(...points) : null
  }

  async function welfare(userId: string) {
    const credit = creditConfig()
    const health = credit ? await creditRequest(credit.issuer).catch(() => null) : null
    return transaction(db, async client => {
      await actor(client, userId)
      const { settings } = await configuration(client)
      if (!settings.welfarePointsReady) return { pool: null, checkin: { ...(settings.checkin ?? defaultCheckin()), enabled: false, claimed: false, points: null, drawId: null, status: null },
        lottery: { enabled: settings.enabled, minPoints: null, maxPoints: null, participated: false } }
      const state = await welfareState(client, settings, userId, now(), health ? exactPointsRate(health) : null)
      return state
    })
  }

  async function checkin(userId: string, requestId: unknown) {
    if (typeof requestId !== 'string' || !requestPattern.test(requestId)) fail('LOTTERY_INVALID')
    const preflight = await transaction(db, async client => {
      await actor(client, userId)
      const previous = (await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "userId"=$1 AND "requestId"=$2', [userId, requestId])).rows[0]
      if (previous) {
        if (previous.prizes[0]?.source !== 'checkin') fail('LOTTERY_CONFLICT', 409)
        return { receipt: packLotteryDraw(previous), issuer: '', subject: '' }
      }
      const credit = creditConfig()
      const subject = credit ? (await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId])).rows[0]?.subject : undefined
      if (!credit || !subject || !/^[1-9]\d{0,14}$/.test(subject)) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      return { receipt: null, issuer: credit.issuer, subject }
    })
    if (preflight.receipt) { void processPending(); return preflight.receipt }
    const health = await creditRequest(preflight.issuer).catch(() => null)
    const receipt = await transaction(db, async client => {
      await actor(client, userId)
      const { settings } = await configuration(client, true)
      const previous = (await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "userId"=$1 AND "requestId"=$2', [userId, requestId])).rows[0]
      if (previous) {
        if (previous.prizes[0]?.source !== 'checkin') fail('LOTTERY_CONFLICT', 409)
        return packLotteryDraw(previous)
      }
      const subject = (await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [preflight.issuer, userId])).rows[0]?.subject
      if (subject !== preflight.subject) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      const createdAt = now(), prior = await todayCheckin(client, userId, createdAt, preflight.issuer, subject)
      if (prior) return packLotteryDraw(prior)
      const rule = settings.checkin ?? defaultCheckin()
      if (!settings.welfarePointsReady || !rule.enabled) fail('WELFARE_CHECKIN_DISABLED', 409)
      if (!health || exactPointsRate(health) === null) fail('WELFARE_UNAVAILABLE', 503)
      const pool = await welfarePool(client, settings, createdAt)
      if (!pool.ready) fail('WELFARE_UNAVAILABLE', 503)
      if (pool.remaining < rule.minPoints) fail('WELFARE_POOL_EXHAUSTED', 409)
      const points = randomInt(rule.minPoints, Math.min(rule.maxPoints, pool.remaining) + 1)
      const prizes: LotteryAward[] = [{ source: 'checkin', prizeId: 'daily-checkin', name: '每日签到奖励', description: '到账后 24 小时有效', amountCents: 0,
        rewardPoints: points, rewardKind: 'charity', validityHours: 24, status: 'pending', fulfilledAt: null, fulfilledBy: null, note: '' }]
      const row = { id: newId(), userId, requestId, prizes, createdAt, creditAttempts: 0 }
      await client.query(`INSERT INTO community_lottery_draw (id,"userId","requestId",prizes,"createdAt","creditIssuer","creditSubject","creditPending","creditAttempts","creditRetryAt")
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,true,0,NULL)`, [row.id, userId, requestId, JSON.stringify(prizes), createdAt, preflight.issuer, subject])
      return packLotteryDraw(row)
    })
    void processPending()
    return receipt
  }

  // Deployment-only activation: never expose this gate through the administrator PATCH route.
  async function activateWelfare() {
    const credit = creditConfig(), health = credit ? await creditRequest(credit.issuer) : null
    if (!health || exactPointsRate(health) === null) fail('WELFARE_UNAVAILABLE', 503)
    return transaction(db, async client => {
      const current = await configuration(client, true)
      const pool = await welfarePool(client, current.settings, now())
      if (!pool.ready) fail('WELFARE_UNVERIFIED_LEGACY_AWARDS', 409)
      if (!current.settings.welfarePointsReady) {
        current.settings.welfarePointsReady = true
        await client.query('UPDATE community_lottery_config SET version=version+1,settings=$2::jsonb WHERE id=$1', ['default', JSON.stringify(current.settings)])
      }
      return { activated: true, pool }
    })
  }

  async function dailyPool(client: Queryable, settings: LotterySettings, userId: string | undefined, time: Date) {
    const day = lotteryDay(time)
    const { rows } = await client.query<{ prizeId: string; used: number; participated: boolean }>(`
      SELECT award->>'prizeId' AS "prizeId",COUNT(*)::integer AS used,BOOL_OR(d."userId"=$3) AS participated
      FROM community_lottery_draw d CROSS JOIN LATERAL jsonb_array_elements(d.prizes) award
      WHERE d."createdAt">=$1 AND d."createdAt"<$2 AND NOT (d.prizes @> '[{"source":"checkin"}]'::jsonb) GROUP BY award->>'prizeId'`, [day.start, day.end, userId ?? null])
    const used = rows.reduce((sum, row) => sum + row.used, 0)
    const prizes = settings.prizes.map(prize => {
      const stock = Math.max(0, prize.stock - (rows.find(row => row.prizeId === prize.id)?.used ?? 0))
      return { ...prize, dailyQuota: prize.stock, stock, weight: stock }
    })
    const remaining = Math.max(0, Math.min(settings.dailyLimit! - used, prizes.filter(prize => prize.enabled).reduce((sum, prize) => sum + prize.stock, 0)))
    return { prizes: remaining ? prizes : prizes.map(prize => ({ ...prize, stock: 0, weight: 0 })), summary: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(),
      limit: settings.dailyLimit!, used, remaining, participated: rows.some(row => row.participated) } }
  }

  async function draw(userId: string, requestId: unknown, count: unknown) {
    if (typeof count !== 'number' || ![1, 3, 5].includes(count) || typeof requestId !== 'string' || !requestPattern.test(requestId)) fail('LOTTERY_INVALID')
    const preflight = await transaction(db, async client => {
      await actor(client, userId)
      const { rows: existing } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "userId"=$1 AND "requestId"=$2', [userId, requestId])
      if (existing[0]) {
        if (existing[0].prizes.length !== count || existing[0].prizes[0]?.source === 'checkin') fail('LOTTERY_CONFLICT', 409)
        return { kind: 'receipt' as const, receipt: packLotteryDraw(existing[0]) }
      }
      const credit = creditConfig()
      const { rows } = credit ? await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId]) : { rows: [] }
      const subject = rows[0]?.subject
      if (!credit || typeof subject !== 'string' || !/^[1-9]\d{0,14}$/.test(subject)) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      return { kind: 'new' as const, issuer: credit.issuer, subject }
    })
    if (preflight.kind === 'receipt') {
      void processPending()
      return preflight.receipt
    }
    // Verify without holding the global pool lock; restore concurrent receipts even if verification failed.
    const support = await readSupport(preflight.issuer, preflight.subject).catch(() => null)
    const receipt = await transaction(db, async client => {
      await actor(client, userId)
      const pool = await configuration(client, true)
      const { rows: existing } = await client.query<LotteryDrawRow>('SELECT * FROM community_lottery_draw WHERE "userId"=$1 AND "requestId"=$2', [userId, requestId])
      const previous = existing[0]
      if (previous) {
        if (previous.prizes.length !== count || previous.prizes[0]?.source === 'checkin') fail('LOTTERY_CONFLICT', 409)
        return packLotteryDraw(previous)
      }
      // Take the day after acquiring the config lock, including requests waiting across midnight.
      const createdAt = now()
      const daily = pool.settings.dailyLimit ? await dailyPool(client, pool.settings, userId, createdAt) : null
      if (daily) {
        if (count !== 1) fail('LOTTERY_DAILY_SINGLE', 409)
        if (daily.summary.participated) fail('LOTTERY_DAILY_USED', 409)
        if (!daily.summary.remaining) fail('LOTTERY_DAILY_EXHAUSTED', 409)
      }
      let available = daily?.prizes ?? pool.settings.prizes
      if (!pool.settings.enabled || !availableLotteryPrizes(available).length) fail('LOTTERY_UNAVAILABLE', 409)
      const credit = creditConfig()
      const { rows } = credit ? await client.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [credit.issuer, userId]) : { rows: [] }
      const subject = rows[0]?.subject
      if (!credit || typeof subject !== 'string' || !/^[1-9]\d{0,14}$/.test(subject) || !Number.isSafeInteger(Number(subject))) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      if (credit.issuer !== preflight.issuer || subject !== preflight.subject) fail('LOTTERY_ACCOUNT_REQUIRED', 409)
      if (!support || Date.now() - support.checkedAt > 60000) fail('LOTTERY_SUPPORT_UNAVAILABLE', 503)
      if (!support.charityReady) fail('LOTTERY_UNAVAILABLE', 409)
      if (!support.hasSupport || support.amountCnyFen < pool.settings.minSupportCnyFen) fail('LOTTERY_SUPPORT_REQUIRED', 409)
      const welfare = pool.settings.welfarePointsReady ? await welfarePool(client, pool.settings, createdAt) : null
      if (welfare && (!welfare.ready || support.pointsPerUsd === null)) fail('WELFARE_UNAVAILABLE', 503)
      let remainingPoints = welfare?.remaining ?? 0
      const { account } = await sync(client, userId, pool.settings)
      if (account.balance < count) fail('LOTTERY_INSUFFICIENT', 409)
      const prizes: LotteryAward[] = []
      for (let index = 0; index < count; index++) {
        if (welfare) {
          available = available.filter(prize => prize.kind === 'empty' || prizePoints(prize.amountCents, support.pointsPerUsd) <= remainingPoints)
          if (!availableLotteryPrizes(available).some(prize => prize.kind === 'balance')) fail('WELFARE_POOL_EXHAUSTED', 409)
        }
        const prize = chooseLotteryPrize(available)
        if (!prize) fail('LOTTERY_UNAVAILABLE', 409)
        if (prize.stock > 0) prize.stock--
        const rewardPoints = welfare && prize.kind === 'balance' ? prizePoints(prize.amountCents, support.pointsPerUsd) : undefined
        if (rewardPoints !== undefined) remainingPoints -= rewardPoints
        prizes.push({ amountCents: prize.amountCents, prizeId: prize.id, name: prize.name, description: prize.description,
          ...(rewardPoints === undefined ? {} : { rewardPoints }),
          status: prize.kind === 'empty' ? 'empty' : 'pending', fulfilledAt: null, fulfilledBy: null, note: '',
          ...(prize.kind === 'balance' ? { rewardKind: 'charity', validityHours: pool.settings.rewardValidityHours } : {}) })
      }
      await client.query('UPDATE community_lottery_account SET balance=balance-$2 WHERE "userId"=$1', [userId, count])
      if (!daily) await client.query('UPDATE community_lottery_config SET version=version+1,settings=$2::jsonb WHERE id=$1', ['default', JSON.stringify(pool.settings)])
      const row = { id: newId(), userId, requestId, prizes, createdAt, creditAttempts: 0 }
      await client.query(`INSERT INTO community_lottery_draw (id,"userId","requestId",prizes,"createdAt","creditIssuer","creditSubject","creditPending","creditAttempts","creditRetryAt")
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,0,NULL)`, [row.id, userId, requestId, JSON.stringify(prizes), row.createdAt, credit.issuer, subject, prizes.some(prize => prize.status === 'pending')])
      return packLotteryDraw(row)
    })
    invalidatePublicLotterySummary(db)
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
        if (charityQuotaPerPoint(health) === null) throw new Error()
      } catch { fail('LOTTERY_UNAVAILABLE', 409) }
    }
    return transaction(db, async client => {
      const current = await configuration(client, true)
      if (version !== current.version) fail('LOTTERY_CONFLICT', 409)
      const settings = normalizeLotterySettings({ ...normalized, minSupportCnyFen: normalized.minSupportCnyFen ?? current.settings.minSupportCnyFen,
        rewardValidityHours: normalized.rewardValidityHours ?? current.settings.rewardValidityHours, wheel: normalized.wheel ?? current.settings.wheel,
        dailyBudgetPoints: normalized.dailyBudgetPoints ?? current.settings.dailyBudgetPoints,
        checkin: normalized.checkin ?? current.settings.checkin, welfarePointsReady: current.settings.welfarePointsReady })
      settings.invites.enabled = false
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

  return { status, draw, records, getConfig, updateConfig, adjustChances, account, retry, deliver, processPending, welfare, checkin, activateWelfare }
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
  if (path === '/api/lottery/balance' && ctx.req.method === 'GET') {
    const user = ctx.requireUser(), expected = ctx.req.headers?.['x-new-api-user']
    if (expected !== undefined && expected !== user.id) fail('LOTTERY_ACCOUNT_CHANGED', 409)
    if (ctx.url.searchParams.size) fail('LOTTERY_INVALID')
    // Navigation only reads credited chances; it must not synchronize rewards or check consumption.
    const { rows } = await ctx.db.query<{ balance: number }>('SELECT balance FROM community_lottery_account WHERE "userId"=$1', [user.id])
    ctx.json(200, { userId: user.id, balance: rows[0]?.balance ?? 0 }); return true
  }
  if (path === '/api/lottery/public-records' && ctx.req.method === 'GET') {
    ctx.json(200, await readPublicLotteryRecords(ctx.db, ctx.url.searchParams)); return true
  }
  if (path === '/api/lottery/public-summary' && ctx.req.method === 'GET') {
    ctx.json(200, await readPublicLotterySummary(ctx.db, ctx.url.searchParams)); return true
  }
  const api = service(ctx)
  const method = ctx.req.method
  const admin = path.startsWith('/api/admin/')
  if (admin) {
    const actor = ctx.requireAdmin()
    const expected = ctx.req.headers?.['x-new-api-user']
    if ((path === '/api/admin/lottery/account' || path === '/api/admin/lottery/chances') && expected !== undefined && expected !== actor.id) fail('LOTTERY_ACCOUNT_CHANGED', 409)
  }
  else if (path !== '/api/lottery/status') ctx.requireUser()
  if (path === '/api/lottery/checkin' || path === '/api/lottery/welfare') {
    const expected = ctx.req.headers?.['x-new-api-user']
    if (expected !== undefined && expected !== ctx.requireUser().id) fail('LOTTERY_ACCOUNT_CHANGED', 409)
  }
  let result: unknown
  if (method === 'GET' && path === '/api/lottery/status') result = await api.status(ctx.user?.id)
  else if (method === 'POST' && path === '/api/lottery/draw') result = await api.draw(ctx.requireUser().id, ctx.body.requestId, ctx.body.count)
  else if (method === 'POST' && path === '/api/lottery/checkin') result = await api.checkin(ctx.requireUser().id, ctx.body.requestId)
  else if (method === 'GET' && path === '/api/lottery/welfare') result = await api.welfare(ctx.requireUser().id)
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
