import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, h, ref } from 'vue'
import { useStudioMaterials, type StudioFile } from './use-studio-materials'
import { api, session, uploadFile } from './state'
import { prepareStudioImage } from './studio-image-upload'
import { resolveReferenceLimits } from '../shared/studio/model-types'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null }), uploadFile: vi.fn(), api: vi.fn() }
})
vi.mock('./studio-image-upload', () => ({ prepareStudioImage: vi.fn() }))
const renderer = createRenderer<Record<string, unknown>, Record<string, unknown>>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
})
let unmount = () => {}
function mount(videoOnly = false) {
  const files = ref<StudioFile[]>([]), identity = ref('owner1:conversation1:video')
  const sourceVideoOnly = ref(videoOnly), mediaReferences = ref(!videoOnly)
  const referenceLimits = ref(resolveReferenceLimits('video', undefined, videoOnly))
  let materials!: ReturnType<typeof useStudioMaterials>
  const app = renderer.createApp({ setup() {
    materials = useStudioMaterials(files, identity, { limit: ref(10), referenceLimits, imagesOnly: true, videoOnly: sourceVideoOnly, mediaReferences })
    return () => h('div')
  } })
  app.mount({}); unmount = () => app.unmount()
  return { materials, files, identity, sourceVideoOnly, mediaReferences, referenceLimits }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  session.user = { id: 'owner1' } as typeof session.user
  vi.mocked(prepareStudioImage).mockResolvedValue('data:image/png;base64,aW1hZ2U=')
})
afterEach(() => { unmount(); vi.useRealTimers() })
const video = () => new File(['video'], 'source.mp4', { type: 'video/mp4' })
const audio = () => new File(['audio'], 'reference.wav', { type: 'audio/wav' })

it('prepares mixed references through the owned upload queue and retains only server-measured duration', async () => {
  const { materials, files } = mount()
  vi.mocked(uploadFile).mockImplementation(async file => ({ id: file.type.startsWith('video/') ? 'ownedvideo' : 'ownedaudio', name: file.name, type: file.type, size: file.size,
    url: file.type.startsWith('video/') ? '/legacy-files/ownedvideo' : '/legacy-files/ownedaudio', processing: 'pending' as const }))
  vi.mocked(api).mockImplementation(async path => ({ file: path.endsWith('ownedaudio')
    ? { id: 'ownedaudio', name: 'reference.wav', type: 'audio/wav', size: 5, url: '/legacy-files/ownedaudio', processing: 'ready' }
    : { id: 'ownedvideo', name: 'source.mp4', type: 'video/mp4', size: 5, url: '/legacy-files/ownedvideo', processing: 'ready', durationSeconds: 2.5 } }))
  const adding = materials.add([new File(['image'], 'reference.png', { type: 'image/png' }), video(), audio()])
  await vi.advanceTimersByTimeAsync(1000)
  expect(materials.pending.value).toBe(true)
  expect(files.value.map(file => file.type)).toEqual(['image/png', 'video/mp4'])
  await vi.advanceTimersByTimeAsync(1000)
  await adding
  expect(materials.pending.value).toBe(false)
  expect(materials.failed.value).toBe(false)
  expect(uploadFile).toHaveBeenCalledTimes(2)
  expect(files.value.map(file => [file.type, file.content])).toEqual([
    ['image/png', 'data:image/png;base64,aW1hZ2U='], ['video/mp4', '/legacy-files/ownedvideo'], ['audio/wav', '/legacy-files/ownedaudio'],
  ])
  expect(files.value[1]).toMatchObject({ duration: 2.5, durationSeconds: 2.5, referenceId: 'ownedvideo' })
  expect(files.value[2]?.durationSeconds).toBeUndefined()
})

it('removes a queued reference without aborting the active upload', async () => {
  const { materials, files } = mount()
  let finish!: (value: Awaited<ReturnType<typeof uploadFile>>) => void
  let signal!: AbortSignal
  vi.mocked(uploadFile).mockImplementation((_file, uploadSignal) => new Promise(resolve => { signal = uploadSignal!; finish = resolve }))
  const adding = materials.add([video(), audio()])
  const queued = materials.snapshot.value.items[1]!
  materials.remove(queued.id)
  expect(signal.aborted).toBe(false)
  finish({ id: 'ownedvideo', name: 'source.mp4', type: 'video/mp4', size: 5, url: '/legacy-files/ownedvideo', processing: 'ready', durationSeconds: 2.5 })
  await adding
  expect(uploadFile).toHaveBeenCalledTimes(1)
  expect(files.value).toHaveLength(1)
})

it('cancels active and queued media on conversation scope changes', async () => {
  const { materials, identity } = mount()
  let signal!: AbortSignal
  vi.mocked(uploadFile).mockImplementation((_file, uploadSignal) => new Promise((_resolve, reject) => {
    signal = uploadSignal!
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  const adding = materials.add([video(), audio()])
  identity.value = 'owner1:conversation2:video'
  await adding
  expect(signal.aborted).toBe(true)
  expect(uploadFile).toHaveBeenCalledTimes(1)
  expect(materials.snapshot.value.items).toEqual([])
})

it('rejects unsupported formats and the aggregate size limit while DMC stays MP4-only', async () => {
  const { materials, files } = mount()
  await materials.add([new File(['x'], 'source.webm', { type: 'video/webm' }), new File(['x'], 'reference.m4a', { type: 'audio/mp4' })])
  expect(materials.snapshot.value.items.every(item => item.status === 'failed' && item.error?.includes('MP3、WAV、FLAC、OGG'))).toBe(true)
  const oversized = video()
  Object.defineProperty(oversized, 'size', { value: 64 * 1024 ** 2 + 1 })
  await expect(materials.add([oversized])).rejects.toThrow('合计不能超过 64 MiB')
  files.value = [{ name: 'restored.mp4', type: 'video/mp4', content: '/legacy-files/restored', size: 64 * 1024 ** 2, isText: false }]
  await expect(materials.add([audio()])).rejects.toThrow('合计不能超过 64 MiB')
  expect(uploadFile).not.toHaveBeenCalled()
  unmount()
  const dmc = mount(true)
  await dmc.materials.add([new File(['x'], 'source.webm', { type: 'video/webm' })])
  expect(dmc.materials.snapshot.value.items[0]?.error).toBe('请选择 MP4 视频。')
  expect(uploadFile).not.toHaveBeenCalled()
})

it('rejects a whole batch at per-type limits, preserves references and treats zero as disabled', async () => {
  const { materials, files, referenceLimits } = mount()
  referenceLimits.value = resolveReferenceLimits('video', { maxReferenceImages: 1, maxReferenceVideos: 0 })
  const image = new File(['image'], 'reference.png', { type: 'image/png' })
  await materials.add([image])
  await expect(materials.add([image, audio()])).rejects.toThrow('当前模型最多支持 1 张参考图片，已选 2 张。')
  await expect(materials.add([video()])).rejects.toThrow('当前模型不支持参考视频，已选 1 个。')
  expect(materials.snapshot.value.items).toHaveLength(1)
  expect(files.value).toHaveLength(1)
  expect(uploadFile).not.toHaveBeenCalled()
  referenceLimits.value = resolveReferenceLimits('video', { maxReferenceImages: 0 })
  expect(materials.referenceIssue.value).toBe('当前模型不支持参考图片，已选 1 张。')
  referenceLimits.value = resolveReferenceLimits('video')
  expect(materials.referenceIssue.value).toBe('')
  expect(files.value).toHaveLength(1)
})

it('keeps admitted video and audio queued while switching to source-video mode and back', async () => {
  const { materials, files, sourceVideoOnly, mediaReferences, referenceLimits } = mount()
  let finish!: (value: Awaited<ReturnType<typeof uploadFile>>) => void
  let signal!: AbortSignal
  vi.mocked(uploadFile).mockImplementation((file, uploadSignal) => file.type.startsWith('video/')
    ? new Promise(resolve => { signal = uploadSignal!; finish = resolve })
    : Promise.resolve({ id: 'ownedaudio', name: file.name, type: file.type, size: file.size, url: '/legacy-files/ownedaudio', processing: 'ready' }))
  const adding = materials.add([video(), audio()])
  const ids = materials.snapshot.value.items.map(item => item.id)
  sourceVideoOnly.value = true; mediaReferences.value = false
  referenceLimits.value = resolveReferenceLimits('video', undefined, true)
  expect(materials.snapshot.value.items.map(item => item.id)).toEqual(ids)
  expect(materials.referenceIssue.value).toBe('当前模型不支持参考音频，已选 1 个。')
  expect(signal.aborted).toBe(false)
  finish({ id: 'ownedvideo', name: 'source.mp4', type: 'video/mp4', size: 5, url: '/legacy-files/ownedvideo', processing: 'ready', durationSeconds: 2.5 })
  await adding
  expect(files.value.map(file => file.type)).toEqual(['video/mp4', 'audio/wav'])
  sourceVideoOnly.value = false; mediaReferences.value = true
  referenceLimits.value = resolveReferenceLimits('video')
  expect(materials.referenceIssue.value).toBe('')
  expect(materials.snapshot.value.items.map(item => item.id)).toEqual(ids)
})

it('uses full video queue capacity when starting with source-video mode', async () => {
  const { materials, files, sourceVideoOnly, mediaReferences, referenceLimits } = mount(true)
  let uploads = 0
  vi.mocked(uploadFile).mockImplementation(async file => {
    const id = `ownedvideo${++uploads}`
    return { id, name: file.name, type: file.type, size: file.size, url: `/legacy-files/${id}`, processing: 'ready' }
  })
  await materials.add([video()])
  sourceVideoOnly.value = false; mediaReferences.value = true
  referenceLimits.value = resolveReferenceLimits('video')
  await materials.add([video()])
  expect(files.value).toHaveLength(2)
  sourceVideoOnly.value = true; mediaReferences.value = false
  referenceLimits.value = resolveReferenceLimits('video', undefined, true)
  expect(materials.referenceIssue.value).toBe('当前模型最多支持 1 个参考视频，已选 2 个。')
  expect(files.value).toHaveLength(2)
})

it('checks current limits before retrying a failed upload', async () => {
  const { materials, referenceLimits } = mount()
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('upload failed')).mockResolvedValue({ id: 'ownedvideo', name: 'source.mp4', type: 'video/mp4', size: 5, url: '/legacy-files/ownedvideo', processing: 'ready' })
  await materials.add([video()])
  referenceLimits.value = resolveReferenceLimits('video', { maxReferenceVideos: 0 })
  expect(() => materials.retry()).toThrow('当前模型不支持参考视频，已选 1 个。')
  expect(uploadFile).toHaveBeenCalledTimes(1)
  expect(materials.failed.value).toBe(true)
  referenceLimits.value = resolveReferenceLimits('video')
  materials.retry()
  await materials.wait(new AbortController().signal)
  expect(uploadFile).toHaveBeenCalledTimes(2)
  expect(materials.failed.value).toBe(false)
})
