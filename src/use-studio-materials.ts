import { computed, onBeforeUnmount, shallowRef, unref, watch, type Ref } from 'vue'
import { createMaterialUpload, type MaterialUploadSnapshot } from '../shared/studio/material-upload'
import { parseFile, type ParsedFile } from '../shared/studio/file-upload'
import { prepareStudioImage } from './studio-image-upload'

export type StudioFile = ParsedFile & { sourceUrl?: string; fromWorkId?: string; referenceId?: string }
export function useStudioMaterials(files: Ref<StudioFile[]>, identity: Ref<string>, options: { limit?: Ref<number>; imagesOnly?: boolean } = {}) {
  const snapshot = shallowRef<MaterialUploadSnapshot>({ items: [], files: [], images: [], pending: 0 })
  let preparation: ReturnType<typeof createMaterialUpload>, unsubscribe = () => {}, syncing = false
  function reset() {
    unsubscribe()
    preparation?.cancel()
    const key = identity.value
    const limit = unref(options.limit) ?? 10
    const next = createMaterialUpload({
      loadImage: file => prepareStudioImage(file, options.imagesOnly),
      loadFile: file => {
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
  onBeforeUnmount(() => { unsubscribe(); preparation.cancel() })
  return {
    snapshot, pending: computed(() => snapshot.value.pending > 0),
    failed: computed(() => snapshot.value.items.some(item => item.status === 'failed')),
    add: (values: File[]) => preparation.add(values.map(file => {
      const heic = /\.(heic|heif)$/i.exec(file.name)
      return heic && !file.type.startsWith('image/') ? new File([file], file.name, { type: `image/${heic[1]!.toLowerCase()}` }) : file
    })),
    wait: (signal: AbortSignal) => preparation.wait(signal),
    remove: (id: string) => preparation.remove(id),
    removeAt: (index: number) => {
      const item = snapshot.value.items.filter(item => item.status === 'ready')[index]
      if (item) preparation.remove(item.id)
    },
    retry: () => preparation.retry(), cancel: () => preparation.cancel(),
  }
}
