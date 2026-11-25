import { computed, onBeforeUnmount, shallowRef, unref, watch, type Ref } from 'vue'
import { createMaterialUpload, type MaterialUploadSnapshot } from '../shared/studio/material-upload'
import { parseFile, type ParsedFile } from '../shared/studio/file-upload'
import { prepareStudioImage } from './studio-image-upload'
import { api, session, uploadFile } from './state'
import type { WorkFile } from './data'
import { referenceCountIssue, type resolveReferenceLimits } from '../shared/studio/model-types'

export type StudioFile = ParsedFile & { sourceUrl?: string; fromWorkId?: string; referenceId?: string; duration?: number; durationSeconds?: number }
export function useStudioMaterials(files: Ref<StudioFile[]>, identity: Ref<string>, options: { limit?: Ref<number>; referenceLimits?: Ref<ReturnType<typeof resolveReferenceLimits>>; imagesOnly?: boolean; videoOnly?: Ref<boolean>; mediaReferences?: Ref<boolean> } = {}) {
  const snapshot = shallowRef<MaterialUploadSnapshot>({ items: [], files: [], images: [], pending: 0 })
  const counts = computed(() => snapshot.value.items.reduce((counts, file) => {
    counts[file.type.startsWith('video/') ? 'videos' : file.type.startsWith('audio/') ? 'audios' : 'images']++
    return counts
  }, { images: 0, videos: 0, audios: 0 }))
  const referenceIssue = computed(() => options.referenceLimits ? referenceCountIssue(counts.value, options.referenceLimits.value) : '')
  let preparation: ReturnType<typeof createMaterialUpload>, unsubscribe = () => {}, syncing = false
  let activeUpload: { controller: AbortController; itemId?: string } | undefined
  const admissionErrors = new WeakMap<File, string>()
  function reset() {
    unsubscribe()
    activeUpload?.controller.abort()
    preparation?.cancel()
    const key = identity.value
    const limit = unref(options.limit) ?? 10
    const uploadMedia = unref(options.videoOnly) || unref(options.mediaReferences)
    const next = createMaterialUpload({
      loadImage: file => {
        const issue = admissionErrors.get(file)
        if (issue) throw new Error(issue)
        return prepareStudioImage(file, options.imagesOnly)
      },
      loadFile: async file => {
        const issue = admissionErrors.get(file)
        if (issue) throw new Error(issue)
        if (uploadMedia) {
          const video = file.type === 'video/mp4'
          const audio = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg'].includes(file.type)
          if (!video && !audio) throw new Error('请选择图片、MP4 视频或 MP3、WAV、FLAC、OGG 音频。')
          const controller = new AbortController(), owner = session.user?.id
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
          activeUpload = { controller, itemId: snapshot.value.items.find(item => item.status === 'processing')?.id }
          try {
            let uploaded: WorkFile = await uploadFile(file, signal)
            const id = uploaded.id
            while (uploaded.processing === 'pending' || uploaded.processing === 'processing') {
              await new Promise<void>((resolve, reject) => {
                const finish = () => { signal.removeEventListener('abort', abort); resolve() }
                const timer = setTimeout(finish, 1000)
                const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
                signal.addEventListener('abort', abort, { once: true })
                if (signal.aborted) abort()
              })
              if (key !== identity.value || preparation !== next || owner !== session.user?.id) throw new DOMException('已取消素材处理。', 'AbortError')
              const result = await api<{ file: WorkFile }>(`/api/uploads/${encodeURIComponent(id)}`, { signal, expectedAccount: owner })
              if (!result.file || result.file.id !== id) throw new Error('素材处理状态无效，请重新上传。')
              uploaded = result.file
            }
            signal.throwIfAborted()
            if (key !== identity.value || preparation !== next || owner !== session.user?.id) throw new DOMException('已取消素材处理。', 'AbortError')
            if (uploaded.processing === 'failed') throw new Error('素材处理失败，请重新上传。')
            if (uploaded.processing !== 'ready') throw new Error('素材处理状态无效，请重新上传。')
            if (video ? uploaded.type !== 'video/mp4' : !['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg'].includes(uploaded.type)) throw new Error('素材格式无效，请重新上传。')
            if (!/^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(uploaded.url)) throw new Error('素材地址无效，请重新上传。')
            const durationSeconds = Number.isFinite(uploaded.durationSeconds) && uploaded.durationSeconds! > 0 ? uploaded.durationSeconds : undefined
            return { name: uploaded.name, type: uploaded.type, size: uploaded.size || file.size, content: uploaded.url, isText: false, referenceId: uploaded.id, duration: durationSeconds, durationSeconds }
          } finally { if (activeUpload?.controller === controller) activeUpload = undefined }
        }
        if (options.imagesOnly) throw new Error('请选择 PNG、JPEG、WebP 或 HEIC 图片。')
        return parseFile(file)
      },
      imageLimitError: `每轮最多添加 ${limit} 个附件。`, limit,
    }, { images: [], files: files.value })
    preparation = next
    const update = () => {
      if (key !== identity.value || preparation !== next) return
      const data = next.getSnapshot()
      snapshot.value = data
      const ready = new Map(data.files.map(item => [item.id, item.file as StudioFile]))
      for (const image of data.images) {
        const item = data.items.find(item => item.id === image.id)!
        ready.set(image.id, { name: item.name, type: /^data:([^;,]+)/.exec(image.url)?.[1] || item.type, size: item.size, content: image.url, isText: false })
      }
      syncing = true
      try { files.value = data.items.flatMap(item => ready.has(item.id) ? [ready.get(item.id)!] : []) }
      finally { syncing = false }
    }
    unsubscribe = next.subscribe(update)
    snapshot.value = next.getSnapshot()
  }
  watch([identity, files], () => { if (!syncing) reset() }, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { unsubscribe(); activeUpload?.controller.abort(); preparation.cancel() })
  return {
    snapshot, counts, referenceIssue, pending: computed(() => snapshot.value.pending > 0),
    failed: computed(() => snapshot.value.items.some(item => item.status === 'failed')),
    add: (values: File[]) => {
      if ((unref(options.mediaReferences) || unref(options.videoOnly)) && snapshot.value.items.reduce((total, item) => total + item.size, 0) + values.reduce((total, file) => total + file.size, 0) > 64 * 1024 ** 2) return Promise.reject(new Error('参考素材合计不能超过 64 MiB，请减少附件或压缩后重试。'))
      const incoming = values.map(file => {
        const heic = /\.(heic|heif)$/i.exec(file.name)
        if (heic && !file.type.startsWith('image/')) return new File([file], file.name, { type: `image/${heic[1]!.toLowerCase()}` })
        const extension = /\.(mp4|mp3|wav|flac|ogg|oga)$/i.exec(file.name)?.[1]?.toLowerCase()
        const type = extension && ({ mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg' } as Record<string, string>)[extension]
        return type && (!file.type || file.type === 'audio/x-wav') ? new File([file], file.name, { type }) : file
      })
      if (options.referenceLimits) {
        const nextCounts = incoming.reduce((counts, file) => {
          counts[file.type.startsWith('video/') ? 'videos' : file.type.startsWith('audio/') ? 'audios' : 'images']++
          return counts
        }, { ...counts.value })
        const issue = referenceCountIssue(nextCounts, options.referenceLimits.value)
        if (issue) return Promise.reject(new Error(issue))
      }
      if (unref(options.videoOnly)) for (const file of incoming) {
        if (file.type !== 'video/mp4') admissionErrors.set(file, '请选择 MP4 视频。')
      }
      return preparation.add(incoming)
    },
    wait: (signal: AbortSignal) => preparation.wait(signal),
    remove: (id: string) => { if (activeUpload?.itemId === id) activeUpload.controller.abort(); preparation.remove(id) },
    removeAt: (index: number) => {
      const item = snapshot.value.items.filter(item => item.status === 'ready')[index]
      if (item) preparation.remove(item.id)
    },
    retry: () => {
      if (referenceIssue.value) throw new Error(referenceIssue.value)
      if (unref(options.videoOnly) && snapshot.value.items.some(file => file.type !== 'video/mp4')) throw new Error('请选择 MP4 视频。')
      preparation.retry()
    }, cancel: () => { activeUpload?.controller.abort(); preparation.cancel() },
  }
}
