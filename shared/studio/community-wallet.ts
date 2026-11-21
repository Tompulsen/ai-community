/** Decimal point balances are display values; New API alone settles them. */
export interface CommunityWallet {
  enabled: true
  currency: 'CNY'
  pointsPerCny: 5000
  charityPoints: string
  permanentPoints: string
  legacyApiQuota: number
  paidApiQuota: number
  totalApiQuota: number
  charityExpiringAt: number | null
  charityExpiringPoints?: string | null
  charityDetailsAvailable?: boolean
}

export interface CommunityWalletLot {
  id: string
  source: string
  points: string
  expiresAt: number | null
  createdAt: number
}

export interface CommunityWalletLots {
  items: CommunityWalletLot[]
  nextCursor: string | null
  sharedPoints: string
}

const decimalPoints = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/
const validExpiry = (value: unknown) => value === null || Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 8640000000000

export function parseCommunityWallet(value: unknown): CommunityWallet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('积分余额暂不可用')
  const wallet = value as Record<string, unknown>
  if (wallet.enabled !== true || wallet.currency !== 'CNY' || wallet.pointsPerCny !== 5000
    || typeof wallet.charityPoints !== 'string' || !decimalPoints.test(wallet.charityPoints)
    || typeof wallet.permanentPoints !== 'string' || !decimalPoints.test(wallet.permanentPoints)
    || !['legacyApiQuota', 'paidApiQuota', 'totalApiQuota'].every(key => Number.isSafeInteger(wallet[key]))
    || Number(wallet.paidApiQuota) < 0
    || !validExpiry(wallet.charityExpiringAt)
    || wallet.charityExpiringPoints !== undefined && wallet.charityExpiringPoints !== null
      && (typeof wallet.charityExpiringPoints !== 'string' || !decimalPoints.test(wallet.charityExpiringPoints))
    || wallet.charityDetailsAvailable !== undefined && typeof wallet.charityDetailsAvailable !== 'boolean') {
    throw new Error('积分余额暂不可用')
  }
  return {
    enabled: true, currency: 'CNY', pointsPerCny: 5000,
    charityPoints: wallet.charityPoints, permanentPoints: wallet.permanentPoints,
    legacyApiQuota: wallet.legacyApiQuota as number, paidApiQuota: wallet.paidApiQuota as number,
    totalApiQuota: wallet.totalApiQuota as number, charityExpiringAt: wallet.charityExpiringAt as number | null,
    ...(wallet.charityExpiringPoints !== undefined ? { charityExpiringPoints: wallet.charityExpiringPoints as string | null } : {}),
    ...(wallet.charityDetailsAvailable !== undefined ? { charityDetailsAvailable: wallet.charityDetailsAvailable as boolean } : {}),
  }
}

export function parseCommunityWalletLots(value: unknown): CommunityWalletLots {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('福利明细暂不可用')
  const page = value as Record<string, unknown>
  if (!Array.isArray(page.items) || page.items.length > 50 || typeof page.sharedPoints !== 'string' || !decimalPoints.test(page.sharedPoints)
    || !(page.nextCursor === null || typeof page.nextCursor === 'string' && /^[1-9]\d{0,15}$/.test(page.nextCursor) && Number.isSafeInteger(Number(page.nextCursor)))) {
    throw new Error('福利明细暂不可用')
  }
  const items = page.items.map((item: unknown): CommunityWalletLot => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('福利明细暂不可用')
    const lot = item as Record<string, unknown>
    if (typeof lot.id !== 'string' || !/^[1-9]\d{0,15}$/.test(lot.id) || !Number.isSafeInteger(Number(lot.id))
      || typeof lot.source !== 'string' || !lot.source || lot.source.length > 64
      || typeof lot.points !== 'string' || !decimalPoints.test(lot.points)
      || !validExpiry(lot.expiresAt) || !Number.isSafeInteger(lot.createdAt) || Number(lot.createdAt) < 0 || Number(lot.createdAt) > 8640000000000) {
      throw new Error('福利明细暂不可用')
    }
    return { id: lot.id, source: lot.source, points: lot.points, expiresAt: lot.expiresAt as number | null, createdAt: Number(lot.createdAt) }
  })
  if (new Set(items.map(item => item.id)).size !== items.length
    || page.nextCursor !== null && page.nextCursor !== items.at(-1)?.id) throw new Error('福利明细暂不可用')
  return { items, nextCursor: page.nextCursor as string | null, sharedPoints: page.sharedPoints }
}

/** Sum display balances without losing fractional points to floating point. */
export function totalCommunityPoints(wallet: CommunityWallet): string {
  const units = [wallet.charityPoints, wallet.permanentPoints].map(value => {
    if (!decimalPoints.test(value)) throw new Error('积分余额暂不可用')
    const [whole = '0', fraction = ''] = value.split('.')
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  })
  const total = units[0]! + units[1]!
  const fraction = (total % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${total / 1_000_000n}${fraction ? `.${fraction}` : ''}`
}

export function formatPoints(value: string): string {
  if (!/^(?:0|[1-9]\d{0,18})(?:\.\d{1,6})?$/.test(value)) return '—'
  const [whole = '0', fraction = ''] = value.split('.')
  const tail = fraction.replace(/0+$/, '')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (tail ? `.${tail}` : '')
}

/** CNY payment quotes have at most two decimal places; one fen is 50 points. */
export function formatCnyPoints(value: string | number): string {
  const match = /^(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return '—'
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] || '').padEnd(2, '0'))
  return formatPoints((cents * 50n).toString())
}

export function pointsInCny(value: string): string {
  if (!decimalPoints.test(value)) return '—'
  const [whole = '0', fraction = ''] = value.split('.')
  const units = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) * 2n
  const digits = units.toString().padStart(11, '0')
  const decimal = digits.slice(-10).replace(/0+$/, '').padEnd(2, '0')
  return `${digits.slice(0, -10)}.${decimal}`
}
