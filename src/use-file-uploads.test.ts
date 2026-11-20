import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, h } from 'vue'
import { useFileUploads } from './use-file-uploads'
import { session, uploadFile } from './state'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null }), uploadFile: vi.fn(), errorMessage: (cause: Error) => cause.message }
})
const renderer = createRenderer<Record<string, unknown>, Record<string, unknown>>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
})
const tick = async () => { for (let count = 0; count < 12; count++) await Promise.resolve() }
type Request = { signal: AbortSignal; progress: (percent: number) => void; resolve: (file: any) => void; reject: (cause: Error) => void }
let requests: Request[], unmount: () => void
function mount() {
  let uploads!: ReturnType<typeof useFileUploads>
  const app = renderer.createApp({ setup() { uploads = useFileUploads(); return () => h('div') } })
  app.mount({}); unmount = () => app.unmount()
  return uploads
}
function complete(index: number) { requests[index]!.resolve({ id: `file${index}`, name: 'image.png', type: 'image/png', url: '/image.png', processing: 'pending' }) }
beforeEach(() => {
  vi.clearAllMocks(); requests = []; session.user = { id: 'owner1' } as typeof session.user
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${crypto.randomUUID()}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(uploadFile).mockImplementation((_file, signal, progress) => new Promise((resolve, reject) => {
    requests.push({ signal: signal!, progress: progress!, resolve, reject })
    signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
})
afterEach(async () => { unmount?.(); await tick(); vi.restoreAllMocks() })
const file = () => new File(['image'], 'image.png', { type: 'image/png' })

it('previews immediately, uploads two at a time and waits for acknowledgement rather than 100 percent', async () => {
  const uploads = mount(), items = uploads.add([file(), file(), file()])
  expect(items.every(item => item.url.startsWith('blob:'))).toBe(true)
  expect(requests).toHaveLength(2)
  requests[0]!.progress(100)
  expect(items[0]!.upload?.state).toBe('saving')
  const done = vi.fn(); void uploads.wait(items).then(done)
  await tick(); expect(done).not.toHaveBeenCalled()
  complete(0); await tick(); expect(requests).toHaveLength(3)
  complete(1); complete(2); await tick()
  expect(done).toHaveBeenCalledTimes(1)
  expect(items.map(item => item.id)).toEqual(['file0', 'file1', 'file2'])
  expect(items[0]!.processing).toBe('pending')
  expect(items[0]!.url).toMatch(/^blob:/)
})

it('retains failed previews, rejects a save and retries only the failed file', async () => {
  const uploads = mount(), items = uploads.add([file(), file()]), preview = items[0]!.url
  requests[0]!.reject(new Error('upload failed')); complete(1); await tick()
  await expect(uploads.wait(items)).rejects.toThrow('upload failed')
  expect(items[0]!.url).toBe(preview)
  uploads.retry(items[0]!); complete(2); await uploads.wait(items)
  expect(requests).toHaveLength(3)
  expect(items.map(item => item.id)).toEqual(['file2', 'file1'])
})

it('cancels removed files, clears all queued jobs on account change and releases previews', async () => {
  const uploads = mount(), items = uploads.add([file(), file(), file()])
  uploads.remove(items[2]!)
  expect(requests).toHaveLength(2)
  session.user = { id: 'owner2' } as typeof session.user
  await tick()
  expect(requests.every(request => request.signal.aborted)).toBe(true)
  expect(requests).toHaveLength(2)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
  expect(uploads.uploading.value).toBe(false)
})
