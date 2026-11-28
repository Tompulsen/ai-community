import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreationInput } from './native-studio'
import { mockStudioTaskStorage } from './studio-task-test-fixture'

beforeEach(() => {
  vi.resetModules()
  mockStudioTaskStorage()
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

async function fixture() {
  const { session, api } = await import('./state')
  vi.mocked(api).mockReset().mockRejectedValue(Object.assign(new Error('登记尚未完成'), { status: 404 }))
  const studio = await import('./native-studio')
  session.user = { id: 'fixture-owner', accountId: '17' } as any
  await studio.initializeCreation()
  const send = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const { requestId } = JSON.parse(options!.body as string)
    return Response.json({ status: 'succeeded', requestId, outputs: [{ text: '完成' }] })
  })
  vi.stubGlobal('fetch', send)
  const input: CreationInput = { conversationId: 'stages-thread', kind: 'image', model: 'gpt-image-2', prompt: '一只白猫',
    size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 }
  return { ...studio, api: vi.mocked(api), session, input, send }
}
const finalResult = (requestId: string) => ({ status: 'succeeded', requestId, outputs: [{ text: '原结果' }] })

it('keeps image responses open for inline delivery while video submission remains asynchronous', async () => {
  const p = await fixture()
  await p.submitCreation(p.input)
  expect(new Headers(p.send.mock.calls[0]![1]!.headers).has('prefer')).toBe(false)
  await p.submitCreation({ ...p.input, kind: 'video', model: 'sora-2' })
  expect(new Headers(p.send.mock.calls[1]![1]!.headers).get('prefer')).toBe('respond-async')
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

it('reveals preparation after two seconds, then stops that reader before normal result polling', async () => {
  const p = await fixture(), posted = deferred<Response>()
  let submittedAt = 0
  p.send.mockImplementationOnce(async () => { submittedAt = Date.now(); return posted.promise })
  p.api.mockImplementationOnce(async path => ({ status: 'pending', requestId: path.split('/').at(-1), stage: 'queued', stageStartedAt: Date.now() }))
    .mockImplementation(async path => finalResult(path.split('/').at(-1)!))
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  const task = p.creation.tasks[0]!
  await vi.advanceTimersByTimeAsync(submittedAt + 1999 - Date.now())
  expect(p.api).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(task).toMatchObject({ phase: 'submitting', stage: 'queued', stageStartedAt: Date.now(), serverTracked: true })
  posted.resolve(Response.json({ status: 'pending', requestId: task.id, stage: 'generating', stageStartedAt: Date.now(), outputs: [] }, { status: 202 }))
  expect(await pending).toMatchObject({ phase: 'complete', text: '原结果', stage: undefined, stageStartedAt: undefined })
  await vi.advanceTimersByTimeAsync(20000)
  expect(p.api.mock.calls.map(([url]) => url)).toEqual([`/api/creation/requests/${task.id}`, `/api/creation/requests/${task.id}`])
  expect(p.send).toHaveBeenCalledTimes(1)
})

it.each([404, 503])('ignores a preparation read failure (%s) and preserves the authoritative POST rejection', async status => {
  const p = await fixture(), posted = deferred<Response>()
  p.send.mockReturnValueOnce(posted.promise)
  p.api.mockRejectedValue(Object.assign(new Error('阶段读取失败'), { status }))
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(2000)
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'submitting' })
  expect(p.creation.tasks[0]!.error).toBeUndefined()
  posted.resolve(Response.json({ error: { message: '参考图无效' }, errorStage: '参考素材准备', notAccepted: true }, { status: 400 }))
  expect(await pending).toMatchObject({ phase: 'error', error: '参考图无效', errorStage: '参考素材准备' })
  await vi.advanceTimersByTimeAsync(15000)
  expect(p.api).toHaveBeenCalledTimes(1)
})

it.each(['complete', 'stop', 'account'] as const)('cancels in-flight preparation reads on %s without late stage changes', async end => {
  const p = await fixture(), posted = deferred<Response>(), observed = deferred<unknown>()
  let signal!: AbortSignal
  p.send.mockReturnValueOnce(posted.promise)
  p.api.mockImplementationOnce(async (_path, options) => { signal = options!.signal!; return observed.promise })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  const task = p.creation.tasks[0]!
  await vi.advanceTimersByTimeAsync(2000)
  expect(signal.aborted).toBe(false)
  if (end === 'stop') p.stopCreation(task)
  if (end === 'account') { p.session.user = null; const { nextTick } = await import('vue'); await nextTick() }
  posted.resolve(Response.json(finalResult(task.id)))
  await pending
  expect(signal.aborted).toBe(true)
  observed.resolve({ status: 'pending', requestId: task.id, stage: 'queued', stageStartedAt: Date.now() })
  await vi.advanceTimersByTimeAsync(15000)
  expect(task.stage).toBeUndefined()
  expect(task.phase).toBe(end === 'stop' ? 'paused' : end === 'complete' ? 'complete' : 'submitting')
  expect(p.api).toHaveBeenCalledTimes(1)
})

it('shares four read slots across delayed submissions and cancels queued preparation reads when POSTs settle', async () => {
  const p = await fixture(), posts: ReturnType<typeof deferred<Response>>[] = []
  p.send.mockImplementation(async () => { const posted = deferred<Response>(); posts.push(posted); return posted.promise })
  let active = 0, peak = 0
  p.api.mockImplementation((_path, options) => new Promise((_resolve, reject) => {
    active++; peak = Math.max(peak, active)
    options!.signal!.addEventListener('abort', () => { active--; reject(options!.signal!.reason) }, { once: true })
  }))
  vi.useFakeTimers()
  const pending = Array.from({ length: 6 }, (_, index) => p.submitCreation({ ...p.input, conversationId: `stages-${index}` }))
  await vi.waitFor(() => expect(posts).toHaveLength(6))
  await vi.advanceTimersByTimeAsync(2000)
  expect(p.api).toHaveBeenCalledTimes(4)
  expect(active).toBe(4)
  for (const post of posts) post.resolve(Response.json({ status: 'succeeded', outputs: [{ text: '完成' }] }))
  await Promise.all(pending)
  await vi.advanceTimersByTimeAsync(10000)
  expect(peak).toBe(4)
  expect(active).toBe(0)
  expect(p.api).toHaveBeenCalledTimes(4)
})

it('queries an unknown original result and retries saving through save then GET without another generate', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async (_url, options) => Response.json({ status: 'indeterminate',
    requestId: JSON.parse(options!.body as string).requestId, outputs: [], error: '结果待确认' }))
  const task = await p.submitCreation(p.input)
  p.api.mockResolvedValueOnce({ status: 'save_failed', requestId: task.id, errorStage: '结果保存', error: '原图保存失败', outputs: [] })
  await p.resumeCreation(task)
  expect(task).toMatchObject({ phase: 'attention', resultStatus: 'save_failed', serverTracked: true })
  p.creation.selectedGroup = 'different-group'; p.creation.modelTokenId = 999
  p.api.mockResolvedValueOnce({ status: 'pending', requestId: task.id, stage: 'saving', stageStartedAt: Date.now(), outputs: [] })
    .mockResolvedValueOnce(finalResult(task.id))
  await p.retryCreationSave(task)
  expect(p.api.mock.calls.map(([url]) => url)).toEqual([`/api/creation/requests/${task.id}`, `/api/creation/requests/${task.id}/save`, `/api/creation/requests/${task.id}`])
  expect(p.api.mock.calls[1]![1]).toEqual({ method: 'POST', body: {} })
  expect(task).toMatchObject({ phase: 'complete', text: '原结果', stage: undefined })
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('does not call save for unknown results or tasks owned by another account', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async (_url, options) => Response.json({ status: 'indeterminate',
    requestId: JSON.parse(options!.body as string).requestId, outputs: [], error: '结果待确认' }))
  const task = await p.submitCreation(p.input)
  await p.retryCreationSave(task)
  task.resultStatus = 'save_failed'; task.owner = 'another-user'
  await p.retryCreationSave(task)
  expect(p.api).not.toHaveBeenCalled()
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('uses private original URLs directly as next-turn inputs and adds only the display preview variant', async () => {
  const p = await fixture(), original = '/api/creation/media?requestId=original-task&index=0'
  const preview = p.mediaSource(original, true)!
  expect(new URL(preview, location.origin).searchParams.get('variant')).toBe('preview')
  expect(new URL(preview, location.origin).searchParams.get('requestId')).toBe('original-task')
  expect(new URL(preview, location.origin).searchParams.get('index')).toBe('0')
  expect(p.mediaSource(original)).toBe(original)
  expect(await p.portableImage(original)).toBe(original)
  expect(p.send).not.toHaveBeenCalled()
  await p.submitCreation({ ...p.input, references: [{ name: '上一轮原图', url: original }] })
  const body = JSON.parse(p.send.mock.calls[0]![1]!.body as string)
  expect(body.referenceUrls).toEqual([original])
  expect(original).not.toContain('variant=')
})
