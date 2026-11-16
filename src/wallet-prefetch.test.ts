import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { session } from './state'
import type { WalletOverview } from '../shared/studio/wallet'

const read = vi.hoisted(() => vi.fn())
vi.mock('./studio-account', () => ({ studioAccount: read }))
const cache = await import('./wallet-prefetch')
const user = { id: 'community-17', accountId: '17', username: 'fixture', name: 'Fixture', bio: '', isAdmin: false, isModerator: false }
const overview = (): WalletOverview => ({
  userId: 17, currencySymbol: 'USD', quotaPerUnit: 500000, quotaDisplayType: 'USD', creditExchangeRate: 1,
  topup: { enabled: true, redemptionEnabled: true, minAmount: 1, amountOptions: [10], paymentMethods: [{ type: 'alipay', name: 'Alipay' }] },
  plans: [], subscriptions: [], history: [], historyTotal: 0,
})
beforeEach(() => {
  vi.useFakeTimers()
  read.mockReset()
  session.user = { ...user }
  cache.invalidateWalletCache()
})
afterEach(() => { session.user = null; vi.useRealTimers() })

it('does not preload on login; merges pending reads and expires cached data after 30 seconds', async () => {
  expect(read).not.toHaveBeenCalled()
  let resolve!: (value: WalletOverview) => void
  read.mockReturnValueOnce(new Promise<WalletOverview>(done => { resolve = done }))
  const first = cache.loadWallet('topup'), second = cache.loadWallet('topup')
  expect(read).toHaveBeenCalledTimes(1)
  resolve(overview())
  expect(await first).toEqual(await second)
  await cache.loadWallet('topup')
  expect(read).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(30_001)
  read.mockResolvedValueOnce(overview())
  await cache.loadWallet('topup')
  expect(read).toHaveBeenCalledTimes(2)
})

it('retries failed preloads and force reads bypass successful cached data', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(overview())
  await expect(cache.loadWallet('topup')).rejects.toThrow('offline')
  await cache.loadWallet('topup')
  await cache.loadWallet('topup', true)
  expect(read).toHaveBeenCalledTimes(3)
})

it('discards old in-flight results after A to B to A and explicit invalidation', async () => {
  let resolve!: (value: WalletOverview) => void
  read.mockReturnValueOnce(new Promise<WalletOverview>(done => { resolve = done }))
  const previous = cache.loadWallet('topup')
  const rejected = expect(previous).rejects.toThrow('已变化')
  session.user = { ...user, accountId: '18' }
  session.user = { ...user }
  read.mockResolvedValueOnce(overview())
  await cache.loadWallet('topup')
  resolve(overview())
  await rejected
  cache.invalidateWalletCache()
  read.mockResolvedValueOnce(overview())
  await cache.loadWallet('topup', true)
  expect(read).toHaveBeenCalledTimes(3)
})

it('isolates quotes by amount and pricing configuration and rejects invalid owners', async () => {
  const config = overview()
  read.mockResolvedValue({ userId: 17, amount: 10, money: '2.50' })
  await Promise.all([cache.loadWalletQuote(10, config), cache.loadWalletQuote(10, config)])
  expect(read).toHaveBeenCalledTimes(1)
  expect(cache.cachedWalletQuote(10, config)?.money).toBe('2.50')
  expect(cache.cachedWalletQuote(20, config)).toBeUndefined()
  const changed = { ...config, creditExchangeRate: 2 }
  expect(cache.cachedWalletQuote(10, changed)).toBeUndefined()
  await cache.loadWalletQuote(10, changed)
  session.user = { ...user, accountId: '18' }
  expect(cache.cachedWalletQuote(10, changed)).toBeUndefined()
  await expect(cache.loadWalletQuote(10, changed)).rejects.toThrow('报价响应无效')
})
