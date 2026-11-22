export interface PublicLotteryDraw {
  id: string
  participant: string
  createdAt: string
  drawCount: number
  totalDrawCount: string | null
  prizes: { name: string; status: 'pending' | 'fulfilled' | 'empty'; points: string | null; rewardKind: 'charity' | 'balance' }[]
}
export interface PublicLotteryPage { items: PublicLotteryDraw[]; nextCursor: string | null; snapshot: string | null }
export const isClownPrize = (name: string) => name.replace(/^🤡\s*/, '').trim() === '非常遗憾' || name.trim() === '🤡'

export interface PublicLotteryParticipant {
  id: string
  participant: string
  drawCount: string
  totalPoints: string
  charityPoints: string
  permanentPoints: string
  fulfilledCount: string
  pendingCount: string
  unverifiedCount: string
  emptyCount: string
}
export type PublicLotteryPeriod = 'today' | '7d' | '30d' | 'custom' | 'all'
export interface PublicLotteryRange {
  period: PublicLotteryPeriod
  start: string | null
  end: string | null
  days: number | null
  timezone: 'Asia/Shanghai'
}
export interface PublicLotteryDay {
  date: string
  totalPoints: string
  charityPoints: string
  permanentPoints: string
  drawCount: string
  fulfilledCount: string
}
export interface PublicLotterySummary {
  items: PublicLotteryParticipant[]
  range: PublicLotteryRange
  updatedAt: string
  totals: Omit<PublicLotteryDay, 'date'> & { participantCount: string; undatedPoints: string }
  daily: PublicLotteryDay[]
}
export function lotteryPointUnits(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid lottery points')
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}
export function lotteryPointsFromUnits(units: bigint): string {
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${units / 1_000_000n}${fraction ? `.${fraction}` : ''}`
}
