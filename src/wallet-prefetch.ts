import { watch, type Directive } from 'vue'
import { session } from './state'
import { studioAccount } from './studio-account'
import type { WalletOverview, WalletQuote, WalletSection } from '../shared/studio/wallet'

type Entry<T> = { value?: T; until: number; pending?: Promise<T> }
const wallets = new Map<string, Entry<WalletOverview>>()
const quotes = new Map<string, Entry<WalletQuote>>()
const identity = () => session.user ? `${session.user.id}:${session.user.accountId || session.user.id}` : ''
let revision = 0
export function invalidateWalletCache() { revision++; wallets.clear(); quotes.clear() }
watch(identity, invalidateWalletCache, { flush: 'sync' })
function stamp() { return `${revision}:${identity()}` }

function cached<T>(store: Map<string, Entry<T>>, key: string, read: () => Promise<T>, force = false): Promise<T> {
  if (!session.user) return Promise.reject(new Error('请先登录章鱼账号。'))
  const previous = store.get(key)
  if (previous?.pending) return previous.pending
  if (!force && previous?.value && previous.until > Date.now()) return Promise.resolve(previous.value)
  const owner = stamp(), entry: Entry<T> = { until: 0 }
  const pending = read().then(value => {
    if (owner !== stamp()) throw new Error('充值信息已变化，请重新读取。')
    entry.value = value; entry.until = Date.now() + 30_000
    return value
  }).finally(() => { if (entry.pending === pending) entry.pending = undefined })
  entry.pending = pending
  store.set(key, entry)
  if (store.size > 32) store.delete(store.keys().next().value!)
  return pending
}
export function walletPricingKey(data: WalletOverview) {
  return JSON.stringify([data.currencySymbol, data.quotaPerUnit, data.quotaPerPoint, data.quotaDisplayType, data.creditExchangeRate, data.topup])
}
export function defaultWalletAmount(data: WalletOverview) { return data.topup.amountOptions[0] || data.topup.minAmount }
export function loadWallet(section: WalletSection, force = false) {
  return cached(wallets, section, async () => {
    const result = await studioAccount<WalletOverview>(`wallet/${section}`)
    if (result?.userId !== Number(session.user?.accountId || session.user?.id) || !result.topup ||
      !Array.isArray(result.topup.amountOptions) || !Array.isArray(result.topup.paymentMethods)) throw new Error('充值信息响应无效，请重试。')
    return result
  }, force)
}
function quoteKey(amount: number, data: WalletOverview) { return `${amount}:${walletPricingKey(data)}` }
export function cachedWalletQuote(amount: number, data: WalletOverview) {
  const entry = quotes.get(quoteKey(amount, data))
  return entry && entry.until > Date.now() ? entry.value : undefined
}
export function loadWalletQuote(amount: number, data: WalletOverview) {
  return cached(quotes, quoteKey(amount, data), async () => {
    const result = await studioAccount<WalletQuote>('wallet/quote', 'POST', { amount })
    if (result?.userId !== Number(session.user?.accountId || session.user?.id) || result.amount !== amount ||
      typeof result.money !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(result.money) ||
      !Number.isFinite(Number(result.money)) || Number(result.money) <= 0) throw new Error('报价响应无效，请重新报价。')
    return result
  })
}
async function prefetch() {
  const owner = stamp(), data = await loadWallet('topup')
  const amount = defaultWalletAmount(data)
  if (owner === stamp() && data.topup.enabled && Number.isSafeInteger(amount) && amount >= data.topup.minAmount &&
    (data.quotaDisplayType !== 'TOKENS' || amount % data.quotaPerUnit === 0)) await loadWalletQuote(amount, data)
}
const triggers = new WeakMap<HTMLElement, { enabled: boolean; cancel: () => void; dispose: () => void }>()
export const walletPrefetch: Directive<HTMLElement, boolean | undefined> = {
  mounted(element, binding) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => { clearTimeout(timer); timer = undefined }
    const enabled = () => triggers.get(element)?.enabled && session.user && !element.matches(':disabled')
    const warm = () => { cancel(); if (enabled()) void prefetch().catch(() => {}) }
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !enabled()) return
      cancel()
      const owner = stamp()
      timer = setTimeout(() => { if (owner === stamp()) warm() }, 200)
    }
    const down = (event: PointerEvent) => { if (event.pointerType !== 'mouse') warm() }
    element.addEventListener('pointerenter', enter)
    element.addEventListener('pointerleave', cancel)
    element.addEventListener('pointercancel', cancel)
    element.addEventListener('focus', warm)
    element.addEventListener('blur', cancel)
    element.addEventListener('pointerdown', down)
    triggers.set(element, { enabled: binding.value !== false, cancel, dispose() {
      cancel()
      element.removeEventListener('pointerenter', enter)
      element.removeEventListener('pointerleave', cancel)
      element.removeEventListener('pointercancel', cancel)
      element.removeEventListener('focus', warm)
      element.removeEventListener('blur', cancel)
      element.removeEventListener('pointerdown', down)
    } })
  },
  updated(element, binding) {
    const trigger = triggers.get(element)
    if (trigger) { trigger.enabled = binding.value !== false; if (!trigger.enabled) trigger.cancel() }
  },
  unmounted(element) { triggers.get(element)?.dispose(); triggers.delete(element) },
}
