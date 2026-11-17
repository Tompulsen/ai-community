/** Decimal point balances are display values; New API alone settles them. */
export interface CommunityWallet {
  enabled: true
  currency: 'CNY'
  pointsPerCny: 5000
  charityPoints: string
  permanentPoints: string
  legacyApiQuota: number
  legacyPoints?: string
  paidApiQuota: number
  totalApiQuota: number
  charityExpiringAt: number | null
}

const decimalPoints = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/
const legacyDecimalPoints = /^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/

export function parseCommunityWallet(value: unknown): CommunityWallet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('积分余额暂不可用')
  const wallet = value as Record<string, unknown>
  if (wallet.enabled !== true || wallet.currency !== 'CNY' || wallet.pointsPerCny !== 5000
    || typeof wallet.charityPoints !== 'string' || !decimalPoints.test(wallet.charityPoints)
    || typeof wallet.permanentPoints !== 'string' || !decimalPoints.test(wallet.permanentPoints)
    || wallet.legacyPoints !== undefined && (typeof wallet.legacyPoints !== 'string' || !legacyDecimalPoints.test(wallet.legacyPoints))
    || !['legacyApiQuota', 'paidApiQuota', 'totalApiQuota'].every(key => Number.isSafeInteger(wallet[key]))
    || Number(wallet.paidApiQuota) < 0
    || !(wallet.charityExpiringAt === null || Number.isSafeInteger(wallet.charityExpiringAt)
      && Number(wallet.charityExpiringAt) > 0 && Number(wallet.charityExpiringAt) <= 8640000000000)) {
    throw new Error('积分余额暂不可用')
  }
  return {
    enabled: true, currency: 'CNY', pointsPerCny: 5000,
    charityPoints: wallet.charityPoints, permanentPoints: wallet.permanentPoints,
    legacyApiQuota: wallet.legacyApiQuota as number, paidApiQuota: wallet.paidApiQuota as number,
    ...(wallet.legacyPoints === undefined ? {} : { legacyPoints: wallet.legacyPoints as string }),
    totalApiQuota: wallet.totalApiQuota as number, charityExpiringAt: wallet.charityExpiringAt as number | null,
  }
}

export function formatPoints(value: string): string {
  if (!decimalPoints.test(value)) return '—'
  return formatDecimalPoints(value)
}

export function formatLegacyPoints(value: string | undefined): string {
  if (typeof value !== 'string' || !legacyDecimalPoints.test(value)) return '—'
  return formatDecimalPoints(value)
}

function formatDecimalPoints(value: string): string {
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
