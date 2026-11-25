import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { studioAccount } from './studio-account'

vi.mock('./state', () => ({ session: { user: { id: 'community-3', accountId: '3' } } }))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method || 'GET') &&
      new Headers(options.headers).get('Content-Type') !== 'application/json') {
      return new Response(JSON.stringify({ error: { message: 'JSON required' } }), { status: 415 })
    }
    return new Response(JSON.stringify({ success: true, data: { accepted: true } }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['tokens/1908', 'DELETE'],
  ['tokens/1908/select', 'POST'],
])('sends JSON for a bodyless %s %s', async (route, method) => {
  await expect(studioAccount(route, method)).resolves.toEqual({ accepted: true })
  const options = fetchMock.mock.calls[0]![1] as RequestInit
  expect(options.body).toBe('{}')
  expect(new Headers(options.headers).get('Content-Type')).toBe('application/json')
  expect(new Headers(options.headers).get('X-New-Api-User')).toBe('3')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('preserves explicit update payloads', async () => {
  const body = { status: 2 }
  await studioAccount('tokens/1908', 'PATCH', body)
  expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe(JSON.stringify(body))
})

it('keeps account reads free of a body and Content-Type', async () => {
  await studioAccount('tokens')
  const options = fetchMock.mock.calls[0]![1] as RequestInit
  expect(options.body).toBeUndefined()
  expect(new Headers(options.headers).has('Content-Type')).toBe(false)
})
