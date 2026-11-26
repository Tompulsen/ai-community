export interface CheckinSettings { enabled: boolean; minPoints: number; maxPoints: number }
export const defaultCheckin = (): CheckinSettings => ({ enabled: true, minPoints: 500, maxPoints: 700 })
export interface WelfarePool {
  date: string; resetsAt: string; serverTime: string
  limit: number; claimed: number; delivered: number; reserved: number; remaining: number; ready: boolean
}
export interface WelfareStatus {
  pool: WelfarePool | null
  checkin: CheckinSettings & { claimed: boolean; points: number | null; drawId: string | null; status: 'pending' | 'fulfilled' | null }
  lottery: { enabled: boolean; minPoints: number | null; maxPoints: number | null; participated: boolean }
}
