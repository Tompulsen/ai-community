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
  vi.mocked(api).mockReset().mockRejectedValue(Object.assign(new Error('没有找到此请求记录。'), { status: 404 }))
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
it('checks effective image references, video URL frames, file IDs and explicit Gemini history limits', async () => {
  const p = await fixture()
  const { videoOptionsSchema } = await import('../shared/studio/options')
  const image = 'https://media.example/shared.png'
  const gemini = { ...p.input, model: 'gemini-3.1-flash-image-preview', references: [{ name: 'current', url: image }], imageContext: { turns: [{ prompt: 'Previous', images: [image] }] } }
  expect(p.creationReferenceIssue({ ...gemini, apiFormat: 'gemini' }, { id: gemini.model, image: { maxReferenceImages: 1 } })).toBe('')
  expect(p.creationReferenceIssue({ ...gemini, apiFormat: 'chat-completions' }, { id: gemini.model, image: { maxReferenceImages: 1 } }))
    .toBe('当前模型最多支持 1 张参考图片，已选 2 张。')
  expect(p.creationReferenceIssue({ ...gemini, apiFormat: 'chat-completions', imageContext: { turns: [{ prompt: 'Previous', images: Array.from({ length: 16 }, () => image) }] } }, { id: gemini.model })).toBe('')
  const video = { kind: 'video' as const, model: 'video-model', videoOptions: videoOptionsSchema.parse({ mode: 'first-last-frame', openaiReferenceSource: 'image_url', openaiImageUrl: image, openaiLastImageUrl: 'https://media.example/last.png' }), references: [{ name: 'ignored', url: '/legacy-files/video1', type: 'video/mp4' }] }
  expect(p.creationReferenceIssue(video, { id: video.model, video: { maxReferenceImages: 1, maxReferenceVideos: 0 } }))
    .toBe('当前模型最多支持 1 张参考图片，已选 2 张。')
  expect(p.creationReferenceIssue({ ...video, references: [], videoOptions: videoOptionsSchema.parse({ mode: 'image-to-video', openaiReferenceSource: 'file_id', openaiFileId: 'file-reference' }) }, { id: video.model, video: { maxReferenceImages: 0 } }))
    .toBe('当前模型不支持参考图片，已选 1 张。')
  p.creation.models.push({ id: p.input.model, image: { maxReferenceImages: 0 } })
  await expect(p.submitCreation(p.input)).rejects.toThrow('当前模型不支持参考图片，已选 1 张。')
  expect(p.send).not.toHaveBeenCalled()
})
it('source video operations ignore stale image reference options and reject invalid sources before sending', async () => {
  const p = await fixture()
  const { videoOptionsSchema } = await import('../shared/studio/options')
  for (const operation of ['upscale', 'remove-subtitles', 'remove-watermark'] as const) {
    const model = `source-${operation}`
    const configured = { id: model, video: { operation } }
    p.creation.models.push(configured)
    const input: CreationInput = { kind: 'video', model, prompt: '', size: 'auto', aspect_ratio: '', n: 1, duration: 0, references: [{ name: 'source.mp4', url: '/legacy-files/source1', type: 'video/mp4' }],
      videoOptions: videoOptionsSchema.parse({ mode: 'first-last-frame', openaiReferenceSource: 'image_url', openaiImageUrl: 'https://media.example/old.png' }) }
    expect(p.creationReferenceIssue(input, configured)).toBe('')
    expect(p.creationReferenceIssue({ ...input, references: [...input.references!, ...input.references!] }, configured)).toContain('最多支持 1 个参考视频')
    for (const references of [[], [{ name: 'source.webm', url: '/legacy-files/source1', type: 'video/webm' }], [{ name: 'source.mp4', url: 'https://media.example/source.mp4', type: 'video/mp4' }]]) {
      await expect(p.submitCreation({ ...input, references })).rejects.toThrow('视频处理需要上传一个 MP4 源视频。')
    }
  }
  expect(p.send).not.toHaveBeenCalled()
})
it('display previews use the image proxy without changing original media, videos or local assets', async () => {
  const p = await fixture()
  vi.stubGlobal('location', new URL('https://community.example/create/image'))
  const remote = 'https://media.example/original.png?signature=test'
  const original = p.mediaSource(remote)!
  const preview = p.mediaSource(remote, true)!
  expect(new URL(preview, location.origin).searchParams.get('variant')).toBe('preview')
  expect(new URL(preview, location.origin).searchParams.get('url')).toBe(remote)
  expect(original).not.toContain('variant=')
  for (const source of [remote, original, new URL(original, location.origin).href]) {
    expect(new URL((await p.readableMedia(source, 'image', true))!, location.origin).searchParams.get('variant')).toBe('preview')
    expect(await p.readableMedia(source, 'image')).not.toContain('variant=')
  }
  for (const source of ['data:image/png;base64,AA==', 'blob:https://community.example/asset', '/legacy-files/id', '/assets/image.png', '/api/creation/media?path=videos/job/content'])
    expect(p.mediaSource(source, true)).toBe(source)
  expect(p.mediaSource(remote, true, 'video')).not.toContain('variant=')
  expect(p.mediaSource('/legacy-files/source1', false, 'video')).toBe('/legacy-files/source1')
  expect(p.mediaSource('/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fmovie.mp4&kind=video', true)).not.toContain('variant=')
  expect(p.input.references![0]!.url).toBe('https://media.example/original.png')
})
it('shared original reads retain their remaining reader and cancel together on account changes', async () => {
  const p = await fixture()
  vi.stubGlobal('location', new URL('https://community.example/create/image'))
  let finish!: () => void, networkSignal!: AbortSignal
  p.send.mockImplementation(async (_url, options) => {
    networkSignal = options!.signal!
    return new Response(new ReadableStream({ start(controller) {
      finish = () => { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() }
      networkSignal.addEventListener('abort', () => controller.error(networkSignal.reason), { once: true })
    } }), { headers: { 'Content-Type': 'image/png' } })
  })
  const preview = new AbortController()
  const first = p.readCreationImage('https://media.example/shared.png', preview.signal)
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const save = p.readCreationImage('/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fshared.png&kind=image')
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  preview.abort(); await cancelled
  expect(networkSignal.aborted).toBe(false)
  finish()
  expect(new Uint8Array(await (await save).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  const later = p.readCreationImage('https://media.example/next.png')
  const switched = expect(later).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(2))
  p.session.user = { id: 'other-owner', accountId: '18' } as any
  await switched
  expect(networkSignal.aborted).toBe(true)
})
it('reuses completed original bytes across canonical URLs and invalidates decoded failures', async () => {
  const p = await fixture()
  vi.stubGlobal('location', new URL('https://community.example/create/image'))
  p.send.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }))
  const url = 'https://media.example/shared.png', original = await p.readCreationImage(url)
  const proxy = p.mediaSource(url)!
  expect(await p.readCreationImage(new URL(proxy, location.origin).href)).toBe(original)
  expect(p.send).toHaveBeenCalledTimes(1)
  p.forgetCreationImage(url)
  await p.readCreationImage(proxy)
  expect(p.send).toHaveBeenCalledTimes(2)
  p.session.user = { id: 'other-owner', accountId: '18' } as any
  await (await import('vue')).nextTick()
  await p.readCreationImage(url)
  expect(p.send).toHaveBeenCalledTimes(3)
})
it('bounds the original byte cache by both entry count and total bytes', async () => {
  const p = await fixture()
  let size = 1
  p.send.mockImplementation(async () => new Response(new Uint8Array(size), { headers: { 'Content-Type': 'image/png' } }))
  for (let index = 0; index < 9; index++) await p.readCreationImage(`https://media.example/${index}.png`)
  await p.readCreationImage('https://media.example/8.png')
  expect(p.send).toHaveBeenCalledTimes(9)
  await p.readCreationImage('https://media.example/0.png')
  expect(p.send).toHaveBeenCalledTimes(10)
  size = 17 * 1024 ** 2
  await p.readCreationImage('https://media.example/large-a.png')
  await p.readCreationImage('https://media.example/large-b.png')
  expect(p.send).toHaveBeenCalledTimes(12)
  await p.readCreationImage('https://media.example/large-b.png')
  expect(p.send).toHaveBeenCalledTimes(12)
  await p.readCreationImage('https://media.example/large-a.png')
  expect(p.send).toHaveBeenCalledTimes(13)
})
it.each([401, 403, 404, 413])('retains HTTP %s on original reads without automatic retries', async status => {
  const p = await fixture()
  p.send.mockResolvedValue(new Response(null, { status }))
  await expect(p.readCreationImage('https://media.example/rejected.png')).rejects.toMatchObject({ status })
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('original reads enforce the actual streamed size without retrying oversized data', async () => {
  const p = await fixture()
  let cancelled = false
  p.send.mockImplementation(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 ** 2)) },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'image/png' } }))
  await expect(p.readCreationImage('https://media.example/oversized.png')).rejects.toThrow('32 MB')
  expect(p.send).toHaveBeenCalledTimes(1)
  expect(cancelled).toBe(true)
})
it('a stalled original has finite retries and caller cancellation stops the current body', async () => {
  const p = await fixture()
  vi.useFakeTimers()
  p.send.mockImplementation(async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options!.signal!.addEventListener('abort', () => controller.error(options!.signal!.reason), { once: true })
  } }), { headers: { 'Content-Type': 'image/png' } }))
  const failed = expect(p.readCreationImage('https://media.example/stalled.png')).rejects.toMatchObject({
    message: expect.stringContaining('原图读取超时'), status: 408, cause: expect.objectContaining({ name: 'TimeoutError' }),
  })
  await vi.advanceTimersByTimeAsync(190000)
  await failed
  expect(p.send).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
  const controller = new AbortController()
  const cancelled = expect(p.readCreationImage('https://media.example/cancelled.png', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1)
  controller.abort(); await cancelled
  await vi.advanceTimersByTimeAsync(100000)
  expect(p.send).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})
it('an original cannot extend its overall deadline through progress or retries', async () => {
  const p = await fixture()
  vi.useFakeTimers()
  let reads = 0, settled = false
  p.send.mockImplementation(async (_url, options) => {
    const first = ++reads === 1
    return new Response(new ReadableStream({ start(controller) {
      let chunks = 0
      const timer = setInterval(() => {
        if (first && ++chunks === 3) { clearInterval(timer); controller.error(new TypeError('Interrupted')); return }
        controller.enqueue(new Uint8Array([1]))
      }, 40000)
      options!.signal!.addEventListener('abort', () => { clearInterval(timer); controller.error(options!.signal!.reason) }, { once: true })
    } }), { headers: { 'Content-Type': 'image/png' } })
  })
  const pending = p.readCreationImage('https://media.example/endless.png').finally(() => { settled = true })
  const failed = expect(pending).rejects.toMatchObject({ status: 408, cause: expect.objectContaining({ name: 'TimeoutError' }) })
  await vi.advanceTimersByTimeAsync(299999)
  expect(settled).toBe(false)
  expect(reads).toBe(2)
  await vi.advanceTimersByTimeAsync(1)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['headers', 'body', 'cancel'] as const)('original %s waits cannot outlive transfer deadlines when the transport ignores abort', async stage => {
  const p = await fixture()
  vi.useFakeTimers()
  p.send.mockImplementation(async () => {
    if (stage === 'headers') return new Promise<Response>(() => {})
    return new Response(new ReadableStream({
      start(controller) { if (stage === 'cancel') controller.enqueue(new Uint8Array([1])) },
      cancel() { return new Promise<void>(() => {}) },
    }), { status: stage === 'cancel' ? 502 : 200, headers: { 'Content-Type': 'image/png' } })
  })
  let settled = false
  const pending = p.readCreationImage(`https://media.example/stuck-${stage}.png`)
  const outcome = pending.then(() => { settled = true; return undefined }, cause => { settled = true; return cause })
  await vi.advanceTimersByTimeAsync(300001)
  expect(settled).toBe(true)
  expect(await outcome).toMatchObject({ status: stage === 'cancel' ? 502 : 408 })
  expect(p.send).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
  p.send.mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }))
  expect((await p.readCreationImage(`https://media.example/stuck-${stage}.png`)).size).toBe(1)
})
it('cancels late response bodies after timeout without caching their bytes or blocking a fresh read', async () => {
  const p = await fixture()
  vi.useFakeTimers()
  const late: Array<(response: Response) => void> = [], cancel = vi.fn(), getReader = vi.fn()
  p.send.mockImplementation(() => new Promise<Response>(resolve => { late.push(resolve) }))
  const url = 'https://media.example/late.png'
  const failed = expect(p.readCreationImage(url)).rejects.toMatchObject({ status: 408 })
  await vi.advanceTimersByTimeAsync(300001)
  await failed
  for (const resolve of late) {
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } })
    response.body!.getReader = getReader
    resolve(response)
  }
  await vi.advanceTimersByTimeAsync(0)
  expect(cancel).toHaveBeenCalledTimes(3)
  expect(getReader).not.toHaveBeenCalled()
  p.send.mockResolvedValue(new Response(new Uint8Array([42]), { headers: { 'Content-Type': 'image/png' } }))
  expect(new Uint8Array(await (await p.readCreationImage(url)).arrayBuffer())).toEqual(new Uint8Array([42]))
  expect(p.send).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})
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
it('sends a large pinned image once through the Images API without losing original bytes or context text', async () => {
  const p = await fixture()
  const original = `data:image/png;base64,${'A'.repeat(16 * 1024 ** 2)}` // A 12 MiB original previously occupied 32 MiB when repeated.
  p.input.apiFormat = 'images'
  p.input.references = [{ name: '产品原图', url: original }]
  p.input.imageContext = { turns: [{ prompt: '保留产品包装文案', images: [original] }] }
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe('complete')
  expect(p.send).toHaveBeenCalledTimes(1)
  const serialized = p.send.mock.calls[0]![1]!.body as string, body = JSON.parse(serialized)
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(27 * 1024 ** 2)
  expect(body.referenceUrls).toEqual([original])
  expect(body.imageContext.turns).toEqual([{ prompt: '保留产品包装文案', images: [] }])
  expect(task.references.map(file => file.url)).toEqual([original])
  expect(p.input.imageContext.turns[0]!.images).toEqual([original])
})
for (const apiFormat of ['images', 'chat-completions', 'gemini'] as const) it(`resolves auto model aliases without changing ${apiFormat} image roles`, async () => {
  const p = await fixture()
  p.input.model = 'custom-image-alias'; p.input.apiFormat = 'auto'
  p.creation.models = [{ id: p.input.model, kinds: ['image'], apiFormat }]
  p.input.imageContext = { turns: [{ prompt: '第一轮要求', references: ['https://media.example/reference.png'], images: ['https://media.example/output.png'] }] }
  const context = structuredClone(p.input.imageContext)
  const task = await p.submitCreation(p.input)
  const body = JSON.parse(p.send.mock.calls[0]![1]!.body as string)
  expect(body.apiFormat).toBe('auto')
  if (apiFormat === 'images') {
    expect(body.referenceUrls).toEqual(['https://media.example/original.png', 'https://media.example/reference.png', 'https://media.example/output.png'])
    expect(body.imageContext.turns).toEqual([{ prompt: '第一轮要求', images: [] }])
    expect(task.references.map(file => file.url)).toEqual(body.referenceUrls)
  } else {
    expect(body.referenceUrls).toEqual(['https://media.example/original.png'])
    expect(body.imageContext).toEqual(context)
  }
  expect(p.input.imageContext).toEqual(context)
})
it('preserves auto image context when the model catalogue belongs to another group', async () => {
  const p = await fixture()
  p.input.apiFormat = 'auto'; p.input.accountGroup = 'other-group'
  p.creation.models = [{ id: p.input.model, kinds: ['image'], apiFormat: 'images' }]
  await p.submitCreation(p.input)
  expect(JSON.parse(p.send.mock.calls[0]![1]!.body as string).imageContext).toEqual(p.input.imageContext)
})
it('rejects a genuinely oversized request before task creation or paid submission and explains pinned content', async () => {
  const p = await fixture(), registered = vi.fn()
  p.input.references = ['A', 'B'].map(value => ({ name: value, url: `data:image/png;base64,${value.repeat(14 * 1024 ** 2)}` }))
  p.input.imageContext = { turns: [] }
  await expect(p.submitCreation(p.input, registered)).rejects.toThrow(/28\.00 MiB.*27 MiB.*取消固定.*清除上下文不会移除已固定内容/)
  expect(p.send).not.toHaveBeenCalled()
  expect(registered).not.toHaveBeenCalled()
  expect(p.creation.tasks).toEqual([])
  expect(p.input.prompt).toBe('换蓝色背景')
})
it('submits two tasks in the same conversation and keeps out-of-order results on their original tasks', async () => {
  const p = await fixture()
  let release!: (response: Response) => void
  p.send.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve }))
  const first = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  const firstId = p.creation.tasks[0]!.id
  const second = await p.submitCreation({ ...p.input, prompt: '第二条消息' })
  expect(second.phase).toBe('complete')
  release(Response.json({ status: 'succeeded', outputs: [{ url: 'https://media.example/first.png' }] }))
  expect(await first).toMatchObject({ id: firstId, phase: 'complete', urls: ['https://media.example/first.png'] })
  expect(p.creation.tasks).toHaveLength(2)
  expect(p.send).toHaveBeenCalledTimes(2)
})
it('automatically follows a server request ID without treating it as an upstream ID or sending another POST', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async (_url, init) => {
    const { requestId } = JSON.parse(init!.body as string)
    vi.mocked(api).mockResolvedValueOnce({ status: 'succeeded', requestId, outputs: [{ url: 'https://media.example/background.png' }] })
    return Response.json({ status: 'pending', requestId, outputs: [], protocol: 'async' }, { status: 202 })
  })
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'complete', serverTracked: true })
  expect(task.upstreamId).toBeUndefined()
  expect(api).toHaveBeenCalledWith(`/api/creation/requests/${task.id}`, expect.anything())
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('waits for a manual check before reading an old server result after the local polling deadline', async () => {
  const p = await fixture(), { api } = await import('./state')
  const original = await p.submitCreation(p.input)
  vi.mocked(api).mockResolvedValue({ status: 'succeeded', outputs: [{ url: 'https://media.example/finished-hours-ago.png' }] })
  await restoreTasks(p, [{ ...original, createdAt: Date.now() - 4 * 60 * 60_000, phase: 'running', serverTracked: true, urls: [] }])
  expect(api).not.toHaveBeenCalled()
  expect(p.creation.tasks[0]).toMatchObject({ id: original.id, phase: 'paused' })
  await p.resumeCreation(p.creation.tasks[0]!)
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'complete', urls: ['https://media.example/finished-hours-ago.png'] })
  expect(api).toHaveBeenCalledWith(`/api/creation/requests/${original.id}`, expect.anything())
  expect(p.send).toHaveBeenCalledTimes(1)
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
  vi.mocked(api).mockImplementation(async path => path === '/api/works/precheck'
    ? { state: 'passed', checkedAt: Date.now() } : { work: { id: 'published-inline' } } as any)
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
it('cancels a pending publication when the account switches away and back during its check', async () => {
  const p = await fixture(), { api, uploadFile } = await import('./state'), { nextTick } = await import('vue')
  const task = await p.submitCreation(p.input)
  task.kind = 'text'; task.text = 'Safe content'; task.urls = []; task.references = []
  let finish!: (value: unknown) => void
  vi.mocked(api).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = p.publishCreation(task, 'Text', 'community', undefined, undefined, {
    tagIds: ['resource-tag'], prompt: '', sourceUrl: '', license: '', referenceIndices: [],
  })
  const rejected = expect(pending).rejects.toThrow('账号已切换')
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/works/precheck', expect.anything()))
  const original = p.session.user
  p.session.user = { ...original!, id: 'different-user' }; await nextTick()
  p.session.user = original; await nextTick()
  finish({ state: 'passed' })
  await rejected
  expect(uploadFile).not.toHaveBeenCalled()
  expect(vi.mocked(api).mock.calls.every(([path]) => path === '/api/works/precheck')).toBe(true)
})
it.each(['auto', 'gemini'] as const)('preserves native Gemini image parameters on publication when selected as %s', async apiFormat => {
  const p = await fixture(), { api, uploadFile } = await import('./state')
  const source = `data:image/png;base64,${btoa('image')}`
  p.input.model = 'native-image'
  p.input.apiFormat = apiFormat
  p.input.aspect_ratio = '16:9'
  p.input.imageOptions = { resolution: '2k' } as any
  p.input.references = []
  p.send.mockResolvedValueOnce(Response.json({ status: 'succeeded', apiFormat: 'gemini', protocol: 'sync', outputs: [{ url: source }] }))
  const task = await p.submitCreation(p.input)
  vi.mocked(uploadFile).mockResolvedValue({ id: 'native-file' } as any)
  vi.mocked(api).mockImplementation(async path => path === '/api/works/precheck'
    ? { state: 'passed', checkedAt: Date.now() } : { work: { id: 'native-work' } } as any)
  await p.publishCreation(task, 'Native image', 'community', undefined, undefined, {
    tagIds: ['image-tag'], prompt: task.prompt, sourceUrl: '', license: '', referenceIndices: [],
  })
  expect(api).toHaveBeenCalledWith('/api/works', expect.objectContaining({ body: expect.objectContaining({
    generation: expect.objectContaining({ parameters: expect.objectContaining({
      apiFormat, aspect_ratio: '16:9', imageOptions: expect.objectContaining({ resolution: '2k' }),
    }) }),
  }) }))
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('keeps a registration failure unsubmitted and excluded from automatic conversation synchronization', async () => {
  const p = await fixture()
  await expect(p.submitCreation(p.input, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  expect(p.send).not.toHaveBeenCalled()
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'error', conversationPending: true })
})
it('submits once when the browser has no AbortSignal.any', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined })
  try {
    const p = await fixture()
    expect(await p.submitCreation(p.input)).toMatchObject({ phase: 'complete' })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally { Object.defineProperty(AbortSignal, 'any', original) }
})
it('settles preparation failures before sending and releases the registered controller', async () => {
  const p = await fixture(), { api } = await import('./state')
  const registration = vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementationOnce(() => { throw new Error('Cannot initialize monitor') })
  const remove = vi.spyOn(await import('./studio-task-store'), 'deleteTaskRecords').mockResolvedValue()
  try {
    const task = await p.submitCreation(p.input)
    expect(task).toMatchObject({ phase: 'error', errorStage: '生成准备', error: expect.stringContaining('未提交生成') })
    expect(p.send).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
    await p.removeCreationTasks([task.id])
    expect(p.creation.tasks).toHaveLength(0)
    expect((await p.submitCreation(p.input)).phase).toBe('complete')
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally { registration.mockRestore(); remove.mockRestore() }
})
it('does not send after the user stops while the initial conversation save is pending', async () => {
  const p = await fixture()
  const task = await p.submitCreation(p.input, current => { p.stopCreation(current) })
  expect(p.send).not.toHaveBeenCalled()
  expect(task.phase).toBe('error')
  expect(task.error).toContain('未提交生成')
})
it('retains a stopped in-flight request and permits a new message in the same conversation', async () => {
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
  expect((await p.submitCreation(p.input)).phase).toBe('complete')
  expect(p.creation.tasks).toHaveLength(2)
  expect(p.creation.tasks[1]!.id).toBe(task.id)
  expect(p.send).toHaveBeenCalledTimes(2)
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
    await vi.waitFor(() => expect(task.error).toBe('任务查询失败：读取超时 正在自动重试。'))
    p.stopCreation(task)
    await recovery
    expect(task).toMatchObject({ id: task.id, phase: 'paused' })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally { deadline.mockRestore() }
})
it.each([413, 409, 503, 0])('retains the original request after %s while allowing an explicit new message', async status => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => {
    if (!status) throw new TypeError('Failed to fetch')
    return Response.json({ message: '请求错误' }, { status })
  })
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe(status === 413 ? 'error' : 'attention')
  expect(task.error).toContain(status ? '请求错误' : 'Failed to fetch')
  expect(task.error).not.toContain('没有找到此请求记录')
  expect(task.serverTracked).not.toBe(true)
  expect((await p.submitCreation(p.input)).phase).toBe('complete')
  expect(p.creation.tasks).toHaveLength(2)
  expect(p.creation.tasks[1]!.id).toBe(task.id)
  expect(p.send).toHaveBeenCalledTimes(2)
  const { api } = await import('./state')
  expect(api).toHaveBeenCalledTimes(status === 413 ? 0 : 1)
})
it.each([0, 504])('keeps the original submission failure after %s across restoration and recovers without another POST', async status => {
  const p = await fixture(), { api } = await import('./state')
  p.input.protocol = 'sync'
  p.send.mockImplementationOnce(async () => {
    if (!status) throw new TypeError('Failed to fetch')
    return Response.json({ message: 'Gateway timeout 504' }, { status })
  })
  const error = status ? 'Gateway timeout 504' : 'Failed to fetch'
  const original = await p.submitCreation(p.input)
  await restoreTasks(p, [{ ...original }])
  expect(api).toHaveBeenCalledTimes(1)
  expect(p.creation.tasks[0]).toMatchObject({ id: original.id, phase: 'attention', submissionError: status ? `社区提交接口失败（HTTP 504）：${error}` : `提交到社区失败：${error}` })
  expect(p.creation.tasks[0]!.error).toContain(error)
  expect(p.creation.tasks[0]!.error).not.toContain('没有找到此请求记录')
  vi.mocked(api).mockResolvedValueOnce({ status: 'succeeded', requestId: original.id, outputs: [{ url: 'https://media.example/recovered.png' }] })
  await p.resumeCreation(p.creation.tasks[0]!)
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'complete', serverTracked: true, error: '' })
  expect(p.creation.tasks[0]!.submissionError).toBeUndefined()
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('keeps the submission error when a temporary recovery failure is followed by a missing record', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('读取暂时不可用'), { status: 502 }))
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(5000)
  const task = await pending
  expect(task).toMatchObject({ phase: 'attention', submissionError: '提交到社区失败：Failed to fetch' })
  expect(task.error).toContain('Failed to fetch')
  expect(p.send).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledTimes(2)
})
it('saves the original submission error before waiting for the first recovery read', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  let finish: (() => void) | undefined
  vi.mocked(api).mockImplementationOnce(async () => new Promise((_resolve, reject) => {
    finish = () => reject(Object.assign(new Error('没有找到此请求记录。'), { status: 404 }))
  }))
  const pending = p.submitCreation(p.input)
  try {
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(localStorage.getItem('octopus:user-fixture-owner:native-creation-history:v2-fallback')!)[0]
    expect(saved).toMatchObject({ id: p.creation.tasks[0]!.id, submissionError: '提交到社区失败：Failed to fetch' })
    expect(p.send).toHaveBeenCalledTimes(1)
  } finally {
    finish?.()
    await pending
  }
})
it('automatically recovers a result accepted before the submission connection failed', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async (_url, init) => {
    const { requestId } = JSON.parse(init!.body as string)
    vi.mocked(api).mockResolvedValueOnce({ status: 'succeeded', requestId, outputs: [{ url: 'https://media.example/recovered.png' }] })
    throw new TypeError('Failed to fetch')
  })
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'complete', serverTracked: true, error: '', urls: ['https://media.example/recovered.png'] })
  expect(task.submissionError).toBeUndefined()
  expect(api).toHaveBeenCalledTimes(1)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('does not query a request explicitly rejected before acceptance even with HTTP 503', async () => {
  const p = await fixture(), { api } = await import('./state')
  const error = '任务登记失败（HTTP 503）：任务服务配置不完整，请联系管理员。'
  p.send.mockResolvedValueOnce(Response.json({ error: { message: error }, errorStage: '任务登记', errorStatus: 503, notAccepted: true }, { status: 503 }))
  expect(await p.submitCreation({ ...p.input, kind: 'video' })).toMatchObject({ phase: 'error', error, errorStage: '任务登记', errorStatus: 503 })
  expect(api).not.toHaveBeenCalled()
  expect(p.send).toHaveBeenCalledTimes(1)
})
it.each(['json', 'stream'])('shows the server preparation stage for %s errors without querying an unaccepted task', async transport => {
  const p = await fixture(), { api } = await import('./state')
  const error = '参考素材准备失败（HTTP 404）：参考图片不存在。'
  p.send.mockResolvedValueOnce(transport === 'json'
    ? Response.json({ error: { message: error }, errorStage: '参考素材准备', errorStatus: 404, notAccepted: true }, { status: 404 })
    : new Response(`data: ${JSON.stringify({ type: 'error', error, errorStage: '参考素材准备', errorStatus: 404, notAccepted: true })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
  expect(await p.submitCreation(p.input)).toMatchObject({ phase: 'error', error, errorStage: '参考素材准备', errorStatus: 404 })
  expect(api).not.toHaveBeenCalled()
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('recovers a known task from a temporary read failure using GET without another POST', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'known-task', outputs: [] }))
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('读取暂时不可用'), { status: 502 }))
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/recovered.png' }] })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'running', upstreamId: 'known-task', error: '任务查询失败（HTTP 502）：读取暂时不可用 正在自动重试。' })
  await vi.advanceTimersByTimeAsync(5000)
  expect(await pending).toMatchObject({ phase: 'complete', error: '', urls: ['https://media.example/recovered.png'] })
  expect(api).toHaveBeenCalledTimes(2)
  expect(p.send).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/requests/') && path.includes('upstreamId=known-task&'))).toBe(true)
})
for (const [status, retryAfter, wait] of [[408, undefined, 5000], [503, '120', 120000]] as const) it(`recovers an HTTP ${status} task query without resubmitting or ignoring Retry-After`, async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'known-task', outputs: [] }))
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('查询暂时不可用'), { status, retryAfter }))
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/recovered.png' }] })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(p.creation.tasks[0]).toMatchObject({ phase: 'running', errorStatus: status }))
  await vi.advanceTimersByTimeAsync(5000)
  if (wait > 5000) {
    expect(api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(wait - 5000)
  }
  expect(await pending).toMatchObject({ phase: 'complete', upstreamId: 'known-task' })
  expect(api).toHaveBeenCalledTimes(2)
  expect(p.send).toHaveBeenCalledTimes(1)
})

it('keeps a worker query error visible until the automatic read recovers', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async (_url, init) => {
    const { requestId } = JSON.parse(init!.body as string)
    vi.mocked(api).mockResolvedValueOnce({ status: 'pending', requestId, upstreamId: 'known-task', outputs: [],
      error: '任务查询失败（HTTP 503）：网关暂未返回任务状态，后台将自动重试。', errorStage: '任务查询', errorStatus: 503 })
      .mockResolvedValueOnce({ status: 'succeeded', requestId, outputs: [{ url: 'https://media.example/recovered.png' }] })
    return Response.json({ status: 'pending', requestId, outputs: [] }, { status: 202 })
  })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(p.creation.tasks[0]).toMatchObject({ phase: 'running', errorStage: '任务查询', errorStatus: 503 })
  expect(p.creation.tasks[0]!.error).toContain('HTTP 503')
  await vi.advanceTimersByTimeAsync(5000)
  expect(await pending).toMatchObject({ phase: 'complete', error: '' })
  expect(p.creation.tasks[0]!.errorStage).toBeUndefined()
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('continues automatic recovery after three failed reads without repeating the paid POST', async () => {
  const p = await fixture(), { api } = await import('./state')
  p.send.mockImplementationOnce(async () => Response.json({ status: 'pending', protocol: 'async', upstreamId: 'known-task', outputs: [] }))
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('暂时无法查询此任务'), { status: 502 }))
    .mockRejectedValueOnce(Object.assign(new Error('暂时无法查询此任务'), { status: 502 }))
    .mockRejectedValueOnce(Object.assign(new Error('暂时无法查询此任务'), { status: 502 }))
    .mockResolvedValueOnce({ status: 'succeeded', outputs: [{ url: 'https://media.example/recovered.png' }] })
  vi.useFakeTimers()
  const pending = p.submitCreation(p.input)
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(35_000)
  const task = await pending
  expect(task).toMatchObject({ phase: 'complete', upstreamId: 'known-task' })
  expect(api).toHaveBeenCalledTimes(4)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('keeps streamed preflight validation rejection editable instead of waiting for a nonexistent request', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => new Response(`data: ${JSON.stringify({ type: 'error', error: '参考图过大', statusCode: 413, notAccepted: true })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
  const result = await p.submitCreation(p.input)
  expect(result.phase).toBe('error')
  expect(result.error).toBe('请求校验失败（HTTP 413）：参考图过大')
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('shows missing results as an error without asking the user to investigate', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ status: 'indeterminate', protocol: 'sync', outputs: [] }))
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe('attention')
  expect(task.error).toBe('获取生成结果失败。')
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('retains a synchronous upstream timeout without querying or automatically submitting again', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ status: 'indeterminate', protocol: 'sync', error: 'Provider API error: bad response status code 504', outputs: [] }))
  const task = await p.submitCreation(p.input)
  expect(task.phase).toBe('attention')
  expect(task.error).toContain('504')
  expect(task.error).toContain('超时')
  expect(task.error).not.toMatch(/核对|联系管理员|扣费/)
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
  expect(api).not.toHaveBeenCalled()
  await p.resumeCreation(p.creation.tasks[0]!)
  expect(p.creation.tasks[0]).toMatchObject({ id: task.id, phase: 'attention', error: '连接中断' })
  expect(api).toHaveBeenCalledWith(`/api/creation/requests/${task.id}`, expect.anything())
  expect((await p.submitCreation(p.input)).phase).toBe('complete')
  expect(p.send).toHaveBeenCalledTimes(2)
})
it('shows an asynchronous media error while retaining the original task ID', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ status: 'indeterminate', protocol: 'async', upstreamId: 'known-task', error: 'Query failed with status code 504', outputs: [] }))
  const task = await p.submitCreation(p.input)
  expect(task).toMatchObject({ phase: 'attention', upstreamId: 'known-task', error: 'Query failed with status code 504' })
  expect(p.creationRequestTimedOut(task)).toBe(false)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('limits concurrent manual status checks and releases slots between polls', async () => {
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
    expect(reads).toHaveLength(0)
    for (const task of p.creation.tasks) void p.resumeCreation(task)
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
    for (const task of p.creation.tasks) void p.resumeCreation(task)
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
    expect(vi.mocked(api).mock.calls[4]![0]).toContain('/requests/new-request?kind=image&upstreamId=new-upstream&')
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
    for (const task of p.creation.tasks) void p.resumeCreation(task)
    await vi.advanceTimersByTimeAsync(0)
    expect(api).toHaveBeenCalledTimes(4)
    p.stopCreation(p.creation.tasks[4]!)
    finishFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(api).toHaveBeenCalledTimes(5)
    expect(vi.mocked(api).mock.calls[4]![0]).toContain('/requests/request-5?kind=image&upstreamId=upstream-5&')
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/requests/request-4?kind=image&upstreamId=upstream-4&'))).toBe(false)
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
    expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/requests/') && path.includes('upstreamId=limited-task&'))).toBe(true)
  } finally {
    const task = p.creation.tasks[0]
    if (task && task.phase === 'attention') task.phase = 'running'
    if (task) p.stopCreation(task)
    await pending
  }
})
