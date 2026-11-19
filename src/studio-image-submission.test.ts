import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreationInput } from './native-studio'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any, csrfToken: 'fixture' }), errorMessage: (error: Error) => error.message, api: vi.fn(), accountApi: vi.fn(), notify: vi.fn(), uploadFile: vi.fn() }
})
beforeEach(() => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const { session } = await import('./state')
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
it('marks explicit validation rejection as failed but retains network and conflicting-request uncertainty without retries', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => Response.json({ message: '参考图超过大小限制' }, { status: 413 }))
  expect((await p.submitCreation(p.input)).phase).toBe('error')
  p.send.mockImplementationOnce(async () => Response.json({ message: '请求编号冲突' }, { status: 409 }))
  expect((await p.submitCreation(p.input)).phase).toBe('attention')
  p.send.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
  expect((await p.submitCreation(p.input)).phase).toBe('attention')
  expect(p.send).toHaveBeenCalledTimes(3)
})
it('keeps streamed preflight validation rejection editable instead of waiting for a nonexistent request', async () => {
  const p = await fixture()
  p.send.mockImplementationOnce(async () => new Response(`data: ${JSON.stringify({ type: 'error', error: '参考图过大', statusCode: 413, notAccepted: true })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
  const result = await p.submitCreation(p.input)
  expect(result.phase).toBe('error')
  expect(result.error).toBe('参考图过大')
  expect(p.send).toHaveBeenCalledTimes(1)
})
