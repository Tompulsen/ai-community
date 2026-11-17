import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const user = { id: 'community-17', accountId: '17', username: 'fixture', name: 'Fixture', bio: '', isAdmin: false, isModerator: false }
const response = (balance: number, subject = '17') => new Response(JSON.stringify({ linked: true, subject, balance, currencySymbol: 'USD' }))
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

it('shows authoritative point strings, clears them across account changes and never treats legacy quota as permanent points', async () => {
  const { session } = await import('./state')
  const { accountBalance, balanceDescription, refreshAccountBalance } = await import('./account-balance')
  const points = { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '100.123456', permanentPoints: '5000',
    legacyApiQuota: 99999999, legacyPoints: '999999.99', paidApiQuota: 500, totalApiQuota: 100000499, charityExpiringAt: null }
  session.user = { ...user }
  const result = (value: unknown, subject = '17') => new Response(JSON.stringify({ linked: true, subject, balance: 999999, walletEnabled: true, points: value }))
  fetchMock.mockResolvedValueOnce(result(points))
  await refreshAccountBalance()
  expect(accountBalance.points).toEqual(points)
  expect(accountBalance.amount).toBeNull()
  expect(balanceDescription.value).toBe('公益 100.123456 积分 · 永久 5,000 积分 · 历史 API 额度 999,999.99 积分（仅账户中心使用）')
  fetchMock.mockResolvedValueOnce(result(null))
  await refreshAccountBalance()
  expect(accountBalance.points).toBeNull()
  expect(accountBalance.amount).toBeNull()
  fetchMock.mockResolvedValueOnce(result(points))
  await refreshAccountBalance()
  session.user = { ...user, accountId: '18' }
  expect(accountBalance.points).toBeNull()
  fetchMock.mockResolvedValueOnce(result(points))
  await refreshAccountBalance()
  expect(accountBalance.points).toBeNull()
})

it('shares one read and displays the authoritative amount without quota conversion', async () => {
  const { session } = await import('./state')
  const { accountBalance, balanceNumber, refreshAccountBalance } = await import('./account-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValue(response(1234.56789))
  await Promise.all([refreshAccountBalance(), refreshAccountBalance()])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(accountBalance.amount).toBe(1234.56789)
  expect(balanceNumber.value).toBe('1234.57')
  expect(accountBalance.currency).toBe('USD')
})

it.each([
  [-2, '-0.02', '公益 0 积分 · 永久 0 积分 · 历史欠额 -0.02 积分（仅账户中心记账）'],
  [0, '0', '公益 0 积分 · 永久 0 积分'],
  [1000000, undefined, '公益 0 积分 · 永久 0 积分 · 历史 API 额度折合积分暂不可用（仅账户中心使用）'],
])('keeps zero, negative and missing historical displays separate (%s quota)', async (legacyApiQuota, legacyPoints, expected) => {
  const { session } = await import('./state')
  const { accountBalance, balanceDescription, refreshAccountBalance } = await import('./account-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ linked: true, subject: '17', walletEnabled: true,
    points: { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '0', permanentPoints: '0',
      legacyApiQuota, legacyPoints, paidApiQuota: 0, totalApiQuota: legacyApiQuota, charityExpiringAt: null } })))
  await refreshAccountBalance()
  expect(balanceDescription.value).toBe(expected)
  expect(accountBalance.points?.charityPoints).toBe('0')
  expect(accountBalance.points?.permanentPoints).toBe('0')
})

it('clears on identity changes and ignores delayed responses from the previous account', async () => {
  const { session } = await import('./state')
  const { accountBalance, refreshAccountBalance } = await import('./account-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValueOnce(response(12.5))
  await refreshAccountBalance()
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
  const previous = refreshAccountBalance()
  session.user = { ...user, accountId: '18' }
  expect(accountBalance.amount).toBeNull()
  fetchMock.mockResolvedValueOnce(response(3.75, '18'))
  await refreshAccountBalance()
  resolve(response(999))
  await previous
  expect(accountBalance.amount).toBe(3.75)
  session.user = null
  expect(accountBalance.amount).toBeNull()
  await refreshAccountBalance()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('hides unavailable or mismatched balances and allows a later retry', async () => {
  const { session } = await import('./state')
  const { accountBalance, balanceNumber, refreshAccountBalance } = await import('./account-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValueOnce(response(12.5))
  await refreshAccountBalance()
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  await refreshAccountBalance()
  expect(accountBalance.amount).toBeNull()
  expect(balanceNumber.value).toBe('—')
  expect(accountBalance.error).toContain('重试')
  fetchMock.mockResolvedValueOnce(response(999, 'another-account'))
  await refreshAccountBalance()
  expect(accountBalance.amount).toBeNull()
  fetchMock.mockResolvedValueOnce(response(0))
  await refreshAccountBalance()
  expect(balanceNumber.value).toBe('0.00')
  expect(accountBalance.error).toBe('')
})
