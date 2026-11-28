import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreationInput } from './native-studio'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('./state', async () => {
    const { reactive } = await import('vue')
    return { session: reactive({ user: null as any, csrfToken: 'fixture' }), errorMessage: (error: Error) => error.message,
      api: vi.fn(), accountApi: vi.fn(), notify: vi.fn(), uploadFile: vi.fn() }
  })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('location', new URL('https://community.example/create/image'))
  vi.stubGlobal('indexedDB', undefined)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function fixture(accepted: Record<string, unknown> = {}) {
  const { session, api } = await import('./state')
  vi.mocked(api).mockReset().mockRejectedValue(Object.assign(new Error('没有找到此请求记录。'), { status: 404 }))
  const studio = await import('./native-studio')
  session.user = { id: 'fixture-owner', accountId: '17' } as any
  await studio.initializeCreation()
  const send = vi.fn(async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
    if (url !== '/api/creation/generate') throw new Error(`Unexpected fetch: ${String(url)}`)
    const { requestId } = JSON.parse(options!.body as string)
    return Response.json({ status: 'pending', requestId, protocol: 'sync', stage: 'queued', outputs: [], ...accepted }, { status: 202 })
  })
  vi.stubGlobal('fetch', send)
  const input: CreationInput = { conversationId: 'recovery-thread', kind: 'image', model: 'gpt-image-2', prompt: '一只白猫',
    size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 }
  return { ...studio, api: vi.mocked(api), input, send }
}
const finalResult = (requestId: string) => ({ status: 'succeeded', requestId,
  outputs: [{ url: `/api/creation/media?requestId=${requestId}&index=0` }] })

it('keeps a missing request uncertain until a manual check finds its real result', async () => {
  const p = await fixture()
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'attention', errorStatus: 404 })
  expect(task.error).toContain('没有找到此请求记录')
  expect(task.settledAt).toBeTypeOf('number')
  const { session } = await import('./state')
  const user = session.user
  session.user = null
  await (await import('vue')).nextTick()
  p.api.mockResolvedValueOnce(finalResult(task.id))
  session.user = user
  await p.initializeCreation()
  expect(p.api).toHaveBeenCalledTimes(1)
  expect(p.creation.tasks[0]).toMatchObject({ id: task.id, phase: 'attention' })
  await p.resumeCreation(p.creation.tasks[0]!)
  expect(p.creation.tasks[0]).toMatchObject({ id: task.id, phase: 'complete', error: '' })
  expect(p.api).toHaveBeenCalledTimes(2)
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('keeps the upstream failure reason when the original task explicitly fails', async () => {
  const p = await fixture()
  p.api.mockResolvedValueOnce({ status: 'failed', requestId: 'unused', error: '上游审核未通过：参考图不符合要求。', outputs: [] })
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'error', error: '上游审核未通过：参考图不符合要求。' })
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('does not normalize provider response formats a second time in the browser', async () => {
  const p = await fixture()
  p.send.mockResolvedValueOnce(Response.json({ status: 'completed', data: [{ url: 'https://media.example/unparsed.png' }] }))
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'attention', urls: [], error: '社区返回了无法识别的任务状态，原记录已保留。' })
  expect(p.send).toHaveBeenCalledTimes(1)
})

it.each(['succeeded', 'failed'])('reads %s through the unified request endpoint without choosing a gateway route', async status => {
  const p = await fixture({ upstreamId: 'gateway-original', tokenId: 71, protocol: 'openai' })
  p.api.mockResolvedValueOnce({ status, outputs: status === 'succeeded' ? [{ url: 'https://media.example/original.png' }] : [], error: status === 'failed' ? '上游原始失败原因' : undefined })
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: status === 'succeeded' ? 'complete' : 'error', upstreamId: 'gateway-original', tokenId: 71 })
  if (status === 'failed') expect(task.error).toBe('上游原始失败原因')
  expect(p.api.mock.calls.map(([url]) => url)).toEqual([
    `/api/creation/requests/${task.id}?kind=image&upstreamId=gateway-original&protocol=openai&tokenId=71`,
  ])
  expect(p.send).toHaveBeenCalledTimes(1)
})

it.each([403, 429])('never bypasses a community query %s by querying the gateway', async status => {
  const p = await fixture({ upstreamId: 'gateway-original', tokenId: 71 })
  p.api.mockRejectedValueOnce(Object.assign(new Error('查询不可用'), { status }))
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.api).toHaveBeenCalledTimes(1))
  if (status === 429) p.stopCreation(p.creation.tasks[0]!)
  await pending
  expect(p.api.mock.calls.map(([url]) => url)).toEqual([`/api/creation/requests/${p.creation.tasks[0]!.id}?kind=image&upstreamId=gateway-original&protocol=sync&tokenId=71`])
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('continues polling a recovered gateway task with its original token after the selected token changes', async () => {
  const p = await fixture({ upstreamId: 'gateway-original', tokenId: 71, protocol: 'openai' })
  vi.useFakeTimers()
  p.api.mockResolvedValueOnce({ status: 'pending', upstreamId: 'gateway-original', outputs: [] })
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/original.png' }] })
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.api).toHaveBeenCalledTimes(1))
  p.creation.modelTokenId = 999
  await vi.advanceTimersByTimeAsync(5000)
  expect(await pending).toMatchObject({ phase: 'complete', tokenId: 71 })
  expect(p.api.mock.calls.map(([url]) => url)).toEqual(Array(2).fill(`/api/creation/requests/${p.creation.tasks[0]!.id}?kind=image&upstreamId=gateway-original&protocol=openai&tokenId=71`))
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('does not query a gateway task without the original token', async () => {
  const p = await fixture({ upstreamId: 'gateway-original', tokenId: null })
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe('attention')
  expect(p.api.mock.calls.map(([url]) => url)).toEqual([`/api/creation/requests/${task.id}?kind=image&upstreamId=gateway-original&protocol=sync`])
  expect(p.send).toHaveBeenCalledTimes(1)
})
