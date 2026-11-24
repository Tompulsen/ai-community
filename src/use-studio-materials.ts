import { computed, onBeforeUnmount, shallowRef, unref, watch, type Ref } from 'vue'
import { createMaterialUpload, type MaterialUploadSnapshot } from '../shared/studio/material-upload'
import { parseFile, type ParsedFile } from '../shared/studio/file-upload'
import { prepareStudioImage } from './studio-image-upload'
import { api, session, uploadFile } from './state'
import type { WorkFile } from './data'

export type StudioFile = ParsedFile & { sourceUrl?: string; fromWorkId?: string; referenceId?: string; duration?: number }
export function useStudioMaterials(files: Ref<StudioFile[]>, identity: Ref<string>, options: { limit?: Ref<number>; imagesOnly?: boolean; videoOnly?: Ref<boolean> } = {}) {
  const snapshot = shallowRef<MaterialUploadSnapshot>({ items: [], files: [], images: [], pending: 0 })
  let preparation: ReturnType<typeof createMaterialUpload>, unsubscribe = () => {}, syncing = false
  let activeUpload: AbortController | undefined
  function reset() {
    unsubscribe()
    activeUpload?.abort()
    preparation?.cancel()
    const key = identity.value
    const limit = unref(options.limit) ?? 10
    const next = createMaterialUpload({
      loadImage: file => {
        if (unref(options.videoOnly)) throw new Error('请上传一个 MP4 源视频。')
        return prepareStudioImage(file, options.imagesOnly)
      },
      loadFile: async file => {
        if (unref(options.videoOnly)) {
          if (file.type !== 'video/mp4') throw new Error('请选择 MP4 视频。')
          const controller = new AbortController(), owner = session.user?.id
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
          activeUpload = controller
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
              if (key !== identity.value || preparation !== next || owner !== session.user?.id) throw new DOMException('已取消源视频处理。', 'AbortError')
              const result = await api<{ file: WorkFile }>(`/api/uploads/${encodeURIComponent(id)}`, { signal, expectedAccount: owner })
              if (!result.file || result.file.id !== id) throw new Error('源视频处理状态无效，请重新上传。')
              uploaded = result.file
            }
            signal.throwIfAborted()
            if (key !== identity.value || preparation !== next || owner !== session.user?.id) throw new DOMException('已取消源视频处理。', 'AbortError')
            if (uploaded.processing === 'failed') throw new Error('源视频处理失败，请重新上传。')
            if (uploaded.processing !== 'ready') throw new Error('源视频处理状态无效，请重新上传。')
            if (uploaded.type !== 'video/mp4') throw new Error('源视频格式无效，请重新上传 MP4 视频。')
            return { name: uploaded.name, type: uploaded.type, size: uploaded.size || file.size, content: uploaded.url, isText: false, referenceId: uploaded.id }
          } finally { if (activeUpload === controller) activeUpload = undefined }
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
  watch([identity, files, () => unref(options.videoOnly)], () => { if (!syncing) reset() }, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { unsubscribe(); activeUpload?.abort(); preparation.cancel() })
  return {
    snapshot, pending: computed(() => snapshot.value.pending > 0),
    failed: computed(() => snapshot.value.items.some(item => item.status === 'failed')),
    add: (values: File[]) => preparation.add(values.map(file => {
      const heic = /\.(heic|heif)$/i.exec(file.name)
      return heic && !file.type.startsWith('image/') ? new File([file], file.name, { type: `image/${heic[1]!.toLowerCase()}` }) : file
    })),
    wait: (signal: AbortSignal) => preparation.wait(signal),
    remove: (id: string) => { if (snapshot.value.items.find(item => item.id === id)?.status === 'processing') activeUpload?.abort(); preparation.remove(id) },
    removeAt: (index: number) => {
      const item = snapshot.value.items.filter(item => item.status === 'ready')[index]
      if (item) preparation.remove(item.id)
    },
    retry: () => preparation.retry(), cancel: () => { activeUpload?.abort(); preparation.cancel() },
  }
}
