import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const user = { id: 'community-17', accountId: '17', username: 'fixture', name: 'Fixture', bio: '', isAdmin: false, isModerator: false }
const response = (balance: unknown, userId = user.id) => new Response(JSON.stringify({ userId, balance }))
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { vi.resetModules(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('deduplicates and briefly throttles reads, with exact counts and current identity', async () => {
  const { session } = await import('./state')
  const { lotteryCount, lotteryLabel, lotteryDescription, refreshLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValue(response(120))
  await Promise.all([refreshLotteryBalance(), refreshLotteryBalance()])
  await refreshLotteryBalance()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0]![1].headers['X-New-Api-User']).toBe(user.id)
  expect(lotteryCount.value).toBe(120)
  expect(lotteryLabel.value).toBe('福利中心 99+ 次抽奖机会')
  expect(lotteryDescription.value).toBe('剩余 120 次抽奖机会')
})

it('forced post-draw reads supersede a slow response from before the draw', async () => {
  const { session } = await import('./state')
  const { lotteryCount, refreshLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
  const old = refreshLotteryBalance()
  const signal = fetchMock.mock.calls[0]![1].signal
  fetchMock.mockResolvedValueOnce(response(0))
  await refreshLotteryBalance(true)
  expect(signal.aborted).toBe(true)
  resolve(response(9)); await old
  expect(lotteryCount.value).toBe(0)
})

it('reuses a current status balance without allowing an older badge read to overwrite it', async () => {
  const { session } = await import('./state')
  const { lotteryBalance, refreshLotteryBalance, updateLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
  const old = refreshLotteryBalance()
  const signal = fetchMock.mock.calls[0]![1].signal
  updateLotteryBalance(user.id, 2)
  expect(signal.aborted).toBe(true)
  resolve(response(9)); await old
  await refreshLotteryBalance()
  expect(lotteryBalance.balance).toBe(2)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  updateLotteryBalance('another-user', 8)
  updateLotteryBalance(user.id, -1)
  expect(lotteryBalance.balance).toBe(2)
  session.user = null
  updateLotteryBalance(user.id, 5)
  expect(lotteryBalance.balance).toBeNull()
})

it('clears on account changes and ignores late data and failures from prior accounts', async () => {
  const { session } = await import('./state')
  const { lotteryBalance, refreshLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }
  for (const fail of [false, true]) {
    let settle!: (value: Response) => void, reject!: (reason: Error) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((done, no) => { settle = done; reject = no }))
    const old = refreshLotteryBalance(true)
    session.user = { ...user, id: 'next', accountId: '18' }
    expect(lotteryBalance.balance).toBeNull()
    fetchMock.mockResolvedValueOnce(response(3, 'next'))
    await refreshLotteryBalance()
    if (fail) reject(new Error('offline')); else settle(response(999))
    await old
    expect(lotteryBalance.balance).toBe(3)
    session.user = { ...user }
  }
  session.user = null
  const count = fetchMock.mock.calls.length
  await refreshLotteryBalance()
  expect(fetchMock).toHaveBeenCalledTimes(count)
  expect(lotteryBalance.balance).toBeNull()
})

it('hides malformed, mismatched and failed balances, then recovers on a new read', async () => {
  const { session } = await import('./state')
  const { lotteryBalance, lotteryCount, refreshLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }
  fetchMock.mockResolvedValueOnce(response(7)); await refreshLotteryBalance()
  for (const value of [-1, 0.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
    fetchMock.mockResolvedValueOnce(response(value)); await refreshLotteryBalance(true)
    expect(lotteryBalance.balance).toBeNull()
  }
  fetchMock.mockResolvedValueOnce(response(8, 'other')); await refreshLotteryBalance(true)
  expect(lotteryCount.value).toBe(0)
  fetchMock.mockRejectedValueOnce(new Error('offline')); await refreshLotteryBalance(true)
  expect(lotteryBalance.balance).toBeNull()
  fetchMock.mockResolvedValueOnce(response(2)); await refreshLotteryBalance(true)
  expect(lotteryCount.value).toBe(2)
})

it('times out stalled reads so a subsequent poll can recover', async () => {
  const { session } = await import('./state')
  const { lotteryBalance, refreshLotteryBalance } = await import('./lottery-balance')
  session.user = { ...user }; vi.useFakeTimers()
  fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
  const stalled = refreshLotteryBalance()
  await vi.advanceTimersByTimeAsync(10000); await stalled
  expect(lotteryBalance.balance).toBeNull()
  fetchMock.mockResolvedValueOnce(response(4)); await refreshLotteryBalance()
  expect(lotteryBalance.balance).toBe(4)
})
