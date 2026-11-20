import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, h, ref } from 'vue'
import type { Work, WorkComment } from './data'
import { useCommentComposer } from './use-comment-composer'
import { api, notify, session, uploadFile } from './state'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null }), api: vi.fn(), uploadFile: vi.fn(), notify: vi.fn(), errorMessage: (cause: Error) => cause.message }
})
const renderer = createRenderer<Record<string, unknown>, Record<string, unknown>>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
})
const file = (name: string) => new File(['image'], name, { type: 'image/png' })
const tick = async () => { for (let count = 0; count < 12; count++) await Promise.resolve() }
type Request = { file: File; signal: AbortSignal; progress: (value: number) => void; resolve: (value: any) => void; reject: (cause: Error) => void }
let requests: Request[], unmount: () => void
function mount() {
  let composer!: ReturnType<typeof useCommentComposer>
  const work = ref({ id: 'work1' } as Work), sent = vi.fn()
  const app = renderer.createApp({ setup() { composer = useCommentComposer(work, sent); return () => h('div') } })
  app.mount({}); unmount = () => app.unmount()
  return { composer, sent }
}
function complete(index: number) { requests[index]!.resolve({ id: `file${index}`, name: requests[index]!.file.name, type: 'image/png', url: `/files/${index}` }) }
beforeEach(() => {
  vi.clearAllMocks(); requests = []
  session.user = { id: 'owner1' } as typeof session.user
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${crypto.randomUUID()}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(uploadFile).mockImplementation((file, signal, progress) => new Promise((resolve, reject) => {
    requests.push({ file, signal: signal!, progress: progress!, resolve, reject })
    signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  vi.mocked(api).mockResolvedValue({ comment: { id: 'saved1' } })
})
afterEach(async () => { unmount?.(); await tick(); vi.restoreAllMocks() })

it('previews immediately, caps concurrency at two and waits for server confirmation after 100 percent', async () => {
  const { composer, sent } = mount()
  composer.add([file('one.png'), file('two.png'), file('three.png')])
  expect(composer.attachments.value.map(item => item.preview)).toHaveLength(3)
  expect(requests).toHaveLength(2)
  requests[0]!.progress(100)
  expect(composer.attachments.value[0]!.state).toBe('saving')
  composer.text.value = 'first comment'; composer.send()
  expect(composer.pending.value).toHaveLength(1)
  composer.text.value = 'next draft'
  expect(api).not.toHaveBeenCalled()
  complete(0); await tick()
  expect(requests).toHaveLength(3)
  complete(1); await tick(); expect(api).not.toHaveBeenCalled()
  complete(2); await tick()
  expect(api).toHaveBeenCalledWith('/api/works/work1/comments', expect.objectContaining({ body: { text: 'first comment', replyToId: undefined, fileIds: ['file0', 'file1', 'file2'] } }))
  expect(composer.pending.value).toHaveLength(0)
  expect(composer.text.value).toBe('next draft')
  expect(sent).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith('评论已发送。')
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
})

it('retries only failed uploads, retaining uploaded files and the original reply target', async () => {
  const { composer } = mount()
  composer.add([file('good.png'), file('bad.png')]); composer.text.value = 'reply'
  composer.replyTo.value = { id: 'parent1', author: 'reader' } as WorkComment
  composer.send()
  complete(0); requests[1]!.reject(new Error('upload failed')); await tick()
  expect(api).not.toHaveBeenCalled()
  const entry = composer.pending.value[0]!
  expect(entry.state).toBe('failed')
  composer.retry(entry)
  expect(requests).toHaveLength(3)
  expect(requests[2]!.file.name).toBe('bad.png')
  complete(2); await tick()
  expect(api).toHaveBeenCalledWith('/api/works/work1/comments', expect.objectContaining({ body: { text: 'reply', replyToId: 'parent1', fileIds: ['file0', 'file2'] } }))
})

it('retains a rejected comment without automatically replaying POST or uploading successful files again', async () => {
  const { composer, sent } = mount()
  vi.mocked(api).mockRejectedValueOnce(new Error('503'))
  composer.add([file('good.png')]); complete(0); await tick(); composer.send(); await tick()
  const entry = composer.pending.value[0]!
  expect(entry.state).toBe('failed'); expect(entry.attachments[0]!.uploaded?.id).toBe('file0')
  expect(sent).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled()
  expect(api).toHaveBeenCalledTimes(1)
  composer.retry(entry); composer.retry(entry); await tick()
  expect(api).toHaveBeenCalledTimes(2)
  expect(uploadFile).toHaveBeenCalledTimes(1)
  expect(composer.pending.value).toHaveLength(0)
})

it('cancels removed files and does not publish unfinished comments after changing account', async () => {
  const { composer, sent } = mount()
  composer.add([file('cancel.png'), file('keep.png'), file('queued.png')])
  composer.remove(composer.attachments.value[0]!.id); await tick()
  expect(requests[0]!.signal.aborted).toBe(true); expect(requests).toHaveLength(3)
  composer.send(); session.user = { id: 'owner2' } as typeof session.user
  await tick()
  expect(requests.every(request => request.signal.aborted)).toBe(true)
  expect(composer.pending.value).toHaveLength(0); expect(composer.dirty.value).toBe(false)
  expect(api).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
})

it('aborts an active save on reset and ignores its late response', async () => {
  const { composer, sent } = mount()
  let resolve!: (result: any) => void
  vi.mocked(api).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  composer.text.value = 'comment'; composer.send(); await tick()
  const options = vi.mocked(api).mock.calls[0]![1]!
  composer.reset()
  expect(options.signal!.aborted).toBe(true)
  resolve({ comment: { id: 'late' } }); await tick()
  expect(sent).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled()
})
