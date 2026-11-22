import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreationInput, CreationTask } from './native-studio'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('./state', async () => {
    const { reactive } = await import('vue')
    return { session: reactive({ user: null as any, csrfToken: 'fixture' }), errorMessage: (error: Error) => error.message, api: vi.fn(), accountApi: vi.fn(), notify: vi.fn(), uploadFile: vi.fn() }
  })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
async function fixture() {
  const { session, api } = await import('./state')
  vi.mocked(api).mockReset()
  session.user = null
  const studio = await import('./native-studio')
  session.user = { id: 'fixture-owner', accountId: '17' } as any
  await studio.initializeCreation()
  const send = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => Response.json({ status: 'succeeded', outputs: [{ url: 'https://media.example/result.png' }] }))
  vi.stubGlobal('fetch', send)
  const input: CreationInput = { conversationId: 'thread', kind: 'image', model: 'gpt-image-2', prompt: '换蓝色背景', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8,
    references: [{ name: '原图', url: 'https://media.example/original.png' }], imageContext: { turns: [{ prompt: '白猫', images: ['https://media.example/original.png'] }] } }
  return { ...studio, input, send, session }
}
async function restoreTasks(p: Awaited<ReturnType<typeof fixture>>, tasks: CreationTask[]) {
  const user = p.session.user
  p.session.user = null
  const { nextTick } = await import('vue')
  await nextTick()
  localStorage.setItem('octopus:user-fixture-owner:native-creation-history:v2-fallback', JSON.stringify(tasks))
  p.session.user = user
  await p.initializeCreation()
}
it('awaits durable conversation registration before the paid POST and sends an immutable input snapshot', async () => {
  const p = await fixture()
  let release!: () => void, entered = false
  const result = p.submitCreation(p.input, async () => { entered = true; await new Promise<void>(resolve => { release = resolve }) })
  await vi.waitFor(() => expect(entered).toBe(true))
  expect(p.send).not.toHaveBeenCalled()
  p.input.prompt = '用户后来修改的草稿'
  p.input.references![0]!.url = 'https://media.example/later.png'
  p.input.imageContext!.turns[0]!.prompt = '后来修改的历史'
  release()
  const task = await result, body = JSON.parse(p.send.mock.calls[0]![1]!.body as string)
  expect(task.phase).toBe('complete')
  expect(body.prompt).toBe('换蓝色背景')
  expect(body.referenceUrls).toEqual(['https://media.example/original.png'])
  expect(body.imageContext.turns[0].prompt).toBe('白猫')
  expect(body.conversationId).toBeUndefined()
  expect(body.references).toBeUndefined()
  expect(task.conversationPending).toBe(false)
})
it('stores the compatible Gemini parameters before registration and sends only one request', async () => {
  const p = await fixture()
  p.input.model = 'gemini-3-pro-image'
  p.input.size = '1200x900'; p.input.exactSize = true
  p.input.imageOptions = { seed: '42' } as any
  const task = await p.submitCreation(p.input)
  expect(p.send).toHaveBeenCalledTimes(1)
  const body = JSON.parse(p.send.mock.calls[0]![1]!.body as string)
  expect(body).toMatchObject({ model: p.input.model, size: 'auto', imageOptions: { seed: '' } })
  expect(body.exactSize).toBeUndefined()
  expect(task.request).toMatchObject({ size: 'auto', imageOptions: { seed: '' } })
  expect(task.request.exactSize).toBeUndefined()
  expect(p.input.imageOptions?.seed).toBe('42')
})
it('publishes inline image results and references without fetching data URLs under CSP', async () => {
  const p = await fixture(), { api, uploadFile } = await import('./state')
  const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  p.input.references = [{ name: 'reference.png', url: source }]
  p.send.mockResolvedValueOnce(Response.json({ status: 'succeeded', outputs: [{ url: source }] }))
  const task = await p.submitCreation(p.input)
  p.send.mockReset().mockRejectedValue(new TypeError('CSP blocked a data URL fetch'))
  const files: File[] = []
  vi.mocked(uploadFile).mockImplementation(async file => {
    files.push(file)
    return { id: `file-${files.length}`, name: file.name, type: file.type, size: file.size, url: `/files/${files.length}` }
  })
  vi.mocked(api).mockResolvedValue({ work: { id: 'published-inline' } })
  await expect(p.publishCreation(task, 'Inline image', 'community', undefined, undefined, {
    tagIds: ['image-tag'], prompt: task.prompt, sourceUrl: '', license: '', referenceIndices: [0],
  })).resolves.toMatchObject({ work: { id: 'published-inline' } })
  expect(p.send).not.toHaveBeenCalled()
  expect(files.map(file => [file.name, file.type])).toEqual([['creation-1.png', 'image/png'], ['reference-1.png', 'image/png']])
  for (const file of files) expect([...new Uint8Array(await file.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(api).toHaveBeenCalledWith('/api/works', expect.objectContaining({ body: expect.objectContaining({
    fileIds: ['file-1'], generation: expect.objectContaining({ referenceFileIds: ['file-2'] }),
  }) }))
})
it('rejects malformed inline publication media without falling back to fetch', async () => {
  const p = await fixture(), { api, uploadFile } = await import('./state')
  const task = await p.submitCreation(p.input)
  task.urls = ['data:image/png;base64,invalid!']
  p.send.mockReset().mockRejectedValue(new TypeError('CSP blocked a data URL fetch'))
  await expect(p.publishCreation(task, 'Invalid image', 'community', undefined, undefined, {
    tagIds: ['image-tag'], prompt: task.prompt, sourceUrl: '', license: '', referenceIndices: [],
  })).rejects.toThrow('作品文件格式无效')
  expect(p.send).not.toHaveBeenCalled()
  expect(uploadFile).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})
it('keeps a registration failure unsubmitted and excluded from automatic conversation synchronization', async () => {
  const p = await fixture()
  await expect(p.submitCreation(p.input, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  expect(p.send).not.toHaveBeenCalled()
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'error', conversationPending: true })
})
it('does not send after the user stops while the initial conversation save is pending', async () => {
  const p = await fixture()
  const task = await p.submitCreation(p.input, current => { p.stopCreation(current) })
  expect(p.send).not.toHaveBeenCalled()
  expect(task.phase).toBe('error')
  expect(task.error).toContain('未提交生成')
})
it('retains a stopped in-flight request and blocks a second POST in the same conversation', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    const signal = options!.signal!
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  const task = p.creation.tasks[0]!
  p.stopCreation(task)
  expect(await pending).toMatchObject({ id: task.id, phase: 'paused' })
  await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
  expect(p.creation.tasks).toHaveLength(1)
  expect(p.creation.tasks[0]!.id).toBe(task.id)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('bounds the original-request recovery read and retains its ID when the read times out', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
  const task = await p.submitCreation(p.input)
  const timeout = new AbortController()
  const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  vi.mocked(api).mockImplementationOnce(async (_path, options) => new Promise((_resolve, reject) => {
    const signal = options!.signal!
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  try {
    const recovery = p.resumeCreation(task)
    expect(deadline).toHaveBeenCalledWith(65000)
    timeout.abort(new DOMException('读取超时', 'TimeoutError'))
    await recovery
    expect(task).toMatchObject({ id: task.id, phase: 'attention', error: '读取超时' })
    await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally { deadline.mockRestore() }
})
it.each([413, 409, 503, 0])('retains an uncertain request after %s and only permits another POST after explicit rejection', async status => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => {
    if (!status) throw new TypeError('Failed to fetch')
    return Response.json({ message: '请求错误' }, { status })
  })
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe(status === 413 ? 'error' : 'attention')
  expect(task.error).toContain(status ? '请求错误' : 'Failed to fetch')
  if (status === 413) expect((await p.submitCreation(p.input)).phase).toBe('complete')
  else {
    await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
    expect(p.creation.tasks).toHaveLength(1)
    expect(p.creation.tasks[0]!.id).toBe(task.id)
  }
  expect(p.send).toHaveBeenCalledTimes(status === 413 ? 2 : 1)
  const { api } = await import('./state')
  expect(api).not.toHaveBeenCalled()
})
it('recovers a known task from a temporary read failure using GET without another POST', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'known-task', outputs: [] }))
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('读取暂时不可用'), { status: 502 }))
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/recovered.png' }] })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'attention', upstreamId: 'known-task', error: '读取暂时不可用' })
  await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
  await vi.advanceTimersByTimeAsync(5000)
  expect(await pending).toMatchObject({ phase: 'complete', error: '', urls: ['https://media.example/recovered.png'] })
  expect(api).toHaveBeenCalledTimes(2)
  expect(p.send).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/tasks/image/known-task?'))).toBe(true)
})
it('stops after three failed task reads while retaining the original task and blocking a new POST', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'known-task', outputs: [] }))
  vi.mocked(api).mockRejectedValue(Object.assign(new Error('暂时无法查询此任务'), { status: 502 }))
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(10_000)
  const task = await pending
  expect(task).toMatchObject({ phase: 'attention', upstreamId: 'known-task' })
  expect(api).toHaveBeenCalledTimes(3)
  await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
  expect(p.send).toHaveBeenCalledTimes(1)
  await p.removeCreationTasks([task.id]).then(() => { throw new Error('uncertain task was deleted') }, error => expect(error.message).toContain('保留'))
})
it('keeps streamed preflight validation rejection editable instead of waiting for a nonexistent request', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => new Response(`data: ${JSON.stringify({ type: 'error', error: '参考图过大', statusCode: 413, notAccepted: true })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
  const result = await p.submitCreation(p.input)
  expect(result.phase).toBe('error')
  expect(result.error).toBe('参考图过大')
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('retains a synchronous upstream timeout without querying or automatically submitting again', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ status: 'indeterminate', protocol: 'sync', error: 'Provider API error: bad response status code 504', outputs: [] }))
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe('attention')
  expect(task.error).toContain('504')
  expect(task.error).toContain('扣费')
  await p.resumeCreation(task)
  expect(p.send).toHaveBeenCalledTimes(1)
  const { api } = await import('./state')
  expect(api).not.toHaveBeenCalled()
})
it.each(['attention', 'submitting', 'paused'])('retains the original ID of a restored %s request when the result cannot be read', async phase => {
  const p = await fixture(), user = p.session.user
  const task = await p.submitCreation(p.input)
  const saved = { ...task, phase, urls: [], error: '连接中断' }
  p.session.user = null
  const { nextTick } = await import('vue')
  await nextTick()
  localStorage.setItem('octopus:user-fixture-owner:native-creation-history:v2-fallback', JSON.stringify([saved]))
  const { api } = await import('./state')
  vi.mocked(api).mockRejectedValue(Object.assign(new Error('没有找到此请求记录。'), { status: 404 }))
  p.session.user = user
  await p.initializeCreation()
  await vi.waitFor(() => expect(p.creation.tasks[0]).toMatchObject({ id: task.id, phase: 'attention', error: '没有找到此请求记录。' }))
  expect(api).toHaveBeenCalledWith(`/api/creation/requests/${task.id}`, expect.anything())
  await expect(p.submitCreation(p.input)).rejects.toThrow('原请求')
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('shows an asynchronous media error while retaining the original task ID', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ status: 'indeterminate', protocol: 'async', upstreamId: 'known-task', error: 'Query failed with status code 504', outputs: [] }))
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'attention', upstreamId: 'known-task', error: 'Query failed with status code 504' })
  expect(p.creationRequestTimedOut(task)).toBe(false)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('restores every pending media task while limiting active GETs and releasing slots between polls', async () => {
  const p = await fixture(), { api } = await import('./state')
  const original = await p.submitCreation(p.input)
  const saved = Array.from({ length: 5 }, (_, index) => ({
    ...original, id: `request-${index}`, conversationId: `thread-${index}`, upstreamId: `upstream-${index}`, phase: 'paused' as const, urls: [],
  }))
  const reads: { path: string; finish: () => void }[] = []
  let active = 0, peak = 0
  vi.mocked(api).mockImplementation((path, options) => new Promise((resolve, reject) => {
    active++; peak = Math.max(peak, active)
    const signal = options!.signal!
    const abort = () => { active--; reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    reads.push({ path, finish: () => {
      signal.removeEventListener('abort', abort); active--
      resolve({ status: 'pending', outputs: [] })
    } })
  }))
  vi.useFakeTimers()
  await restoreTasks(p, saved)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toHaveLength(4)
    expect(active).toBe(4)
    void p.resumeCreation(p.creation.tasks[0]!)
    reads[0]!.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toHaveLength(5)
    expect(peak).toBe(4)
    expect(new Set(reads.map(read => read.path)).size).toBe(5)
    expect(p.creation.tasks.every(task => task.phase === 'running')).toBe(true)
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally {
    for (const task of p.creation.tasks) p.stopCreation(task)
    await vi.advanceTimersByTimeAsync(0)
  }
})
it('cancels queued recovery GETs on account change and releases capacity for the next account', async () => {
  const p = await fixture(), { api } = await import('./state')
  const original = await p.submitCreation(p.input)
  const saved = Array.from({ length: 5 }, (_, index) => ({
    ...original, id: `old-request-${index}`, conversationId: `old-thread-${index}`, upstreamId: `old-upstream-${index}`, phase: 'paused' as const, urls: [],
  }))
  vi.mocked(api).mockImplementation((_path, options) => new Promise((_resolve, reject) => {
    const signal = options!.signal!
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  await restoreTasks(p, saved)
  try {
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(4))
    p.session.user = { id: 'other-owner', accountId: '18' } as any
    const { nextTick } = await import('vue')
    await nextTick()
    await p.initializeCreation()
    const next = { ...original, id: 'new-request', owner: 'other-owner', upstreamId: 'new-upstream', phase: 'paused' as const, urls: [] }
    p.creation.tasks.push(next)
    vi.mocked(api).mockResolvedValue({ status: 'succeeded', outputs: [{ url: 'https://media.example/new-account.png' }] })
    await p.resumeCreation(p.creation.tasks[0]!)
    expect(api).toHaveBeenCalledTimes(5)
    expect(vi.mocked(api).mock.calls[4]![0]).toContain('/tasks/image/new-upstream?')
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('old-upstream-4'))).toBe(false)
    expect(p.creation.tasks).toHaveLength(1)
    expect(p.creation.tasks[0]).toMatchObject({ id: 'new-request', owner: 'other-owner', phase: 'complete', urls: ['https://media.example/new-account.png'] })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally {
    p.session.user = null
    const { nextTick } = await import('vue')
    await nextTick()
  }
})
it('skips a stopped queued recovery without preventing the next task from being read', async () => {
  const p = await fixture(), { api } = await import('./state')
  const original = await p.submitCreation(p.input)
  const saved = Array.from({ length: 6 }, (_, index) => ({
    ...original, id: `request-${index}`, conversationId: `thread-${index}`, upstreamId: `upstream-${index}`, phase: 'paused' as const, urls: [],
  }))
  let finishFirst!: () => void
  vi.mocked(api).mockImplementation((_path, options) => new Promise((resolve, reject) => {
    const signal = options!.signal!
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (!finishFirst) finishFirst = () => {
      signal.removeEventListener('abort', abort)
      resolve({ status: 'pending', outputs: [] })
    }
  }))
  vi.useFakeTimers()
  await restoreTasks(p, saved)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(api).toHaveBeenCalledTimes(4)
    p.stopCreation(p.creation.tasks[4]!)
    finishFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(api).toHaveBeenCalledTimes(5)
    expect(vi.mocked(api).mock.calls[4]![0]).toContain('/tasks/image/upstream-5?')
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/tasks/image/upstream-4?'))).toBe(false)
    expect(p.creation.tasks[4]).toMatchObject({ id: 'request-4', phase: 'paused' })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally {
    for (const task of p.creation.tasks) p.stopCreation(task)
    await vi.advanceTimersByTimeAsync(0)
  }
})
it('keeps one percent progress as one percent while a video is still running', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', upstreamId: 'video-task', progress: 1, outputs: [] }))
  vi.mocked(api).mockResolvedValue({ status: 'pending', progress: 1, outputs: [] })
  vi.useFakeTimers()
  const pending = p.submitCreation({ ...p.input, kind: 'video' })
  await vi.advanceTimersByTimeAsync(0)
  const task = p.creation.tasks[0]!
  try {
    expect(task).toMatchObject({ phase: 'running', progress: 1 })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally { p.stopCreation(task); await pending }
})
it.each(['seconds', 'http-date'])('backs off repeated task-query rate limits using %s without another paid POST', async format => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'limited-task', outputs: [] }))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-22T04:00:00Z'))
  vi.mocked(api).mockImplementationOnce(async () => { throw Object.assign(new Error('查询限流'), {
    status: 429, retryAfter: format === 'seconds' ? '9' : new Date(Date.now() + 9000).toUTCString(),
  }) }).mockRejectedValueOnce(Object.assign(new Error('查询限流'), { status: 429 }))
    .mockRejectedValueOnce(Object.assign(new Error('查询限流'), { status: 429 }))
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/limited-result.png' }] })
  const pending = p.submitCreation(p.input)
  await vi.advanceTimersByTimeAsync(0)
  try {
    expect(api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8999)
    expect(api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9999)
    expect(api).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(19999)
    expect(api).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ phase: 'complete', upstreamId: 'limited-task', error: '', urls: ['https://media.example/limited-result.png'] })
    expect(api).toHaveBeenCalledTimes(4)
    expect(p.send).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/tasks/image/limited-task?'))).toBe(true)
  } finally {
    const task = p.creation.tasks[0]
    if (task && task.phase === 'attention') task.phase = 'running'
    if (task) p.stopCreation(task)
    await pending
  }
})
