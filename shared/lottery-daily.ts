/** Lottery delivery accepts whole USD cents; never silently round point rewards. */
export function lotteryPointsToCents(points: number, pointsPerUsd: number): number {
  const cents = points * 100 / pointsPerUsd
  if (!Number.isFinite(pointsPerUsd) || pointsPerUsd <= 0 || !Number.isSafeInteger(cents) || cents < 1 || cents > 1000000) {
    throw new Error('LOTTERY_POINTS_INVALID')
  }
  return cents
}

export function defaultDailyLotteryPrizes(pointsPerUsd: number) {
  return [
    { id: 'daily-first', name: '一等奖', points: 6000, stock: 40 },
    { id: 'daily-second', name: '二等奖', points: 4000, stock: 50 },
    { id: 'daily-third', name: '三等奖', points: 2000, stock: 50 },
    { id: 'daily-fourth', name: '🤡 非常遗憾', points: 1000, stock: 60 },
  ].map(({ points, ...prize }) => ({ ...prize, description: '', enabled: true,
    kind: 'balance' as const, amountCents: lotteryPointsToCents(points, pointsPerUsd), weight: prize.stock }))
}

export function lotteryDay(now: Date) {
  const day = 86400000, offset = 8 * 3600000
  const start = new Date(Math.floor((now.getTime() + offset) / day) * day - offset)
  return { date: new Date(start.getTime() + offset).toISOString().slice(0, 10),
    start, end: new Date(start.getTime() + day) }
}
