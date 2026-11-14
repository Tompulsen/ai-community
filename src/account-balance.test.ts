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
