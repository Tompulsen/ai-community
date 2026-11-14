import { computed, reactive, watch } from 'vue'
import { api, session } from './state'

export const accountBalance = reactive({ amount: null as number | null, currency: '', loading: false, error: '' })
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
export const balanceNumber = computed(() => accountBalance.amount === null ? '—' : accountBalance.amount.toFixed(2))
export const balanceDescription = computed(() => accountBalance.amount === null
  ? accountBalance.loading ? '正在读取可用余额' : accountBalance.error || '可用余额暂不可用'
  : `可用余额 ${accountBalance.currency} ${accountBalance.amount}`)
let revision = 0
let pending: Promise<void> | undefined

watch(identity, () => {
  revision++
  pending = undefined
  Object.assign(accountBalance, { amount: null, currency: '', loading: false, error: '' })
}, { flush: 'sync' })

export function refreshAccountBalance(): Promise<void> {
  if (!session.user) return Promise.resolve()
  if (pending) return pending
  const current = revision, owner = identity(), subject = session.user.accountId || session.user.id
  accountBalance.loading = true
  pending = (async () => {
    try {
      const result = await api<{ linked: boolean; subject: string | null; balance: number | null; currencySymbol?: string }>('/api/account', { expectedAccount: subject })
      if (current !== revision || owner !== identity()) return
      if (!result.linked || result.subject !== subject || typeof result.balance !== 'number' || !Number.isFinite(result.balance)) throw new Error('可用余额暂不可用')
      accountBalance.amount = result.balance
      accountBalance.currency = result.currencySymbol || ''
      accountBalance.error = ''
    } catch {
      if (current !== revision || owner !== identity()) return
      accountBalance.amount = null
      accountBalance.currency = ''
      accountBalance.error = '余额读取失败，点击重试'
    } finally {
      if (current === revision && owner === identity()) {
        accountBalance.loading = false
        pending = undefined
      }
    }
  })()
  return pending
}
