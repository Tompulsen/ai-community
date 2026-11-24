import { computed, reactive, watch } from 'vue'
import { api, session } from './state'

export const lotteryBalance = reactive({ balance: null as number | null })
export const lotteryCount = computed(() => session.user ? lotteryBalance.balance ?? 0 : 0)
export const lotteryLabel = computed(() => lotteryCount.value ? `福利中心 ${lotteryCount.value > 99 ? '99+' : lotteryCount.value} 次抽奖机会` : '福利中心')
export const lotteryDescription = computed(() => lotteryCount.value ? `剩余 ${lotteryCount.value} 次抽奖机会` : undefined)
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || ''}`
let revision = 0, attemptedAt = 0
let controller: AbortController | undefined, pending: Promise<void> | undefined

watch(identity, () => {
  revision++; controller?.abort(); controller = undefined; pending = undefined
  attemptedAt = 0; lotteryBalance.balance = null
}, { flush: 'sync' })

export function updateLotteryBalance(userId: string, balance: number) {
  if (session.user?.id !== userId || !Number.isSafeInteger(balance) || balance < 0) return
  revision++; controller?.abort(); controller = undefined; pending = undefined
  attemptedAt = Date.now(); lotteryBalance.balance = balance
}

export function refreshLotteryBalance(force = false): Promise<void> {
  const userId = session.user?.id
  if (!userId) return Promise.resolve()
  if (!force && pending) return pending
  if (!force && attemptedAt && Date.now() - attemptedAt < 10000) return Promise.resolve()
  // A mutation must not reuse a read started before its balance changed.
  const current = ++revision, owner = identity(), request = new AbortController()
  controller?.abort(); controller = request; attemptedAt = Date.now()
  const timeout = setTimeout(() => request.abort(), 10000)
  const isCurrent = () => current === revision && owner === identity()
  pending = (async () => {
    try {
      const result = await api<{ userId: string; balance: number }>('/api/lottery/balance', { signal: request.signal, expectedAccount: userId })
      if (!isCurrent()) return
      if (result.userId !== userId || !Number.isSafeInteger(result.balance) || result.balance < 0) throw new Error('Invalid lottery balance')
      lotteryBalance.balance = result.balance
    } catch {
      if (isCurrent()) lotteryBalance.balance = null
    } finally {
      clearTimeout(timeout)
      if (isCurrent()) { controller = undefined; pending = undefined }
    }
  })()
  return pending
}
