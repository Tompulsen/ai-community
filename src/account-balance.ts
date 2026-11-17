import { computed, reactive, watch } from 'vue'
import { api, session } from './state'
import { formatLegacyPoints, formatPoints, parseCommunityWallet, type CommunityWallet } from '../shared/studio/community-wallet'

export const accountBalance = reactive({ amount: null as number | null, currency: '', points: null as CommunityWallet | null, loading: false, error: '' })
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
export const balanceNumber = computed(() => accountBalance.amount === null ? '—' : accountBalance.amount.toFixed(2))
export const balanceDescription = computed(() => {
  const points = accountBalance.points
  if (points) {
    const balances = [`公益 ${formatPoints(points.charityPoints)} 积分`, `永久 ${formatPoints(points.permanentPoints)} 积分`]
    if (points.legacyApiQuota !== 0) {
      const label = points.legacyApiQuota < 0 ? '历史欠额' : '历史 API 额度'
      const amount = points.legacyPoints === undefined ? '折合积分暂不可用' : ` ${formatLegacyPoints(points.legacyPoints)} 积分`
      balances.push(`${label}${amount}（仅账户中心${points.legacyApiQuota < 0 ? '记账' : '使用'}）`)
    }
    return balances.join(' · ')
  }
  return accountBalance.amount === null
    ? accountBalance.loading ? '正在读取可用余额' : accountBalance.error || '可用余额暂不可用'
    : `可用余额 ${accountBalance.currency} ${accountBalance.amount}`
})
let revision = 0
let pending: Promise<void> | undefined

watch(identity, () => {
  revision++
  pending = undefined
  Object.assign(accountBalance, { amount: null, currency: '', points: null, loading: false, error: '' })
}, { flush: 'sync' })

export function refreshAccountBalance(): Promise<void> {
  if (!session.user) return Promise.resolve()
  if (pending) return pending
  const current = revision, owner = identity(), subject = session.user.accountId || session.user.id
  accountBalance.loading = true
  pending = (async () => {
    try {
      const result = await api<{ linked: boolean; subject: string | null; balance: number | null; currencySymbol?: string; walletEnabled?: boolean; points?: unknown }>('/api/account', { expectedAccount: subject })
      if (current !== revision || owner !== identity()) return
      if (!result.linked || result.subject !== subject) throw new Error('可用余额暂不可用')
      if (result.walletEnabled) {
        const points = parseCommunityWallet(result.points)
        Object.assign(accountBalance, { points, amount: null, currency: 'CNY' })
      } else {
        if (typeof result.balance !== 'number' || !Number.isFinite(result.balance)) throw new Error('可用余额暂不可用')
        Object.assign(accountBalance, { points: null, amount: result.balance, currency: result.currencySymbol || '' })
      }
      accountBalance.error = ''
    } catch {
      if (current !== revision || owner !== identity()) return
      accountBalance.amount = null
      accountBalance.points = null
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
