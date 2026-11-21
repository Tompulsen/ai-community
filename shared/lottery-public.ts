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
