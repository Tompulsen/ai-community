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

it('shows the exact total returned by the wallet and clears balances across account changes', async () => {
  const { session } = await import('./state')
  const { accountBalance, balanceDescription, refreshAccountBalance } = await import('./account-balance')
  const points = { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '100.123456', permanentPoints: '5000',
    legacyApiQuota: 99999999, paidApiQuota: 500, totalApiQuota: 100000499, charityExpiringAt: null }
  session.user = { ...user }
  const result = (value: unknown, subject = '17') => new Response(JSON.stringify({ linked: true, subject, balance: 999999, walletEnabled: true, points: value }))
  fetchMock.mockResolvedValueOnce(result(points))
  await refreshAccountBalance()
  expect(accountBalance.points).toEqual(points)
  expect(accountBalance.amount).toBeNull()
  expect(balanceDescription.value).toBe('可用 5,100.123456 积分')
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

it('a fresh read after a reward ignores any older in-flight balance', async () => {
  const { session } = await import('./state')
  const { accountBalance, refreshAccountBalance } = await import('./account-balance')
  session.user = { ...user }
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
  const old = refreshAccountBalance()
  fetchMock.mockResolvedValueOnce(response(15))
  await refreshAccountBalance(true)
  expect(accountBalance.amount).toBe(15)
  resolve(response(12))
  await old
  expect(accountBalance.amount).toBe(15)
  expect(accountBalance.loading).toBe(false)
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

it('adds large balances and fractional points exactly for the single total', async () => {
  const { totalCommunityPoints, formatPoints } = await import('../shared/studio/community-wallet')
  const wallet = { enabled: true as const, currency: 'CNY' as const, pointsPerCny: 5000 as const,
    charityPoints: '1500', permanentPoints: '50000', legacyApiQuota: 50000,
    paidApiQuota: 0, totalApiQuota: 50000, charityExpiringAt: null }
  expect(totalCommunityPoints(wallet)).toBe('51500')
  expect(totalCommunityPoints({ ...wallet, charityPoints: '1000' })).toBe('51000')
  expect(totalCommunityPoints({ ...wallet, charityPoints: '0.000001', permanentPoints: '0.999999' })).toBe('1')
  expect(formatPoints(totalCommunityPoints({ ...wallet, charityPoints: '999999999999999999', permanentPoints: '1' })))
    .toBe('1,000,000,000,000,000,000')
})
