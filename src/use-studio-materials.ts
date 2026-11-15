import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { createMaterialUpload, type MaterialUploadSnapshot } from '../shared/studio/material-upload'
import { parseFile, type ParsedFile } from '../shared/studio/file-upload'

export type StudioFile = ParsedFile & { sourceUrl?: string; fromWorkId?: string }
export function useStudioMaterials(files: Ref<StudioFile[]>, identity: Ref<string>) {
  const snapshot = shallowRef<MaterialUploadSnapshot>({ items: [], files: [], images: [], pending: 0 })
  let preparation: ReturnType<typeof createMaterialUpload>, unsubscribe = () => {}, syncing = false
  function reset() {
    unsubscribe()
    preparation?.cancel()
    const key = identity.value
    const next = createMaterialUpload({
      loadImage: async file => (await parseFile(file)).content, loadFile: parseFile,
      imageLimitError: '每轮最多添加 10 个附件。', limit: 10,
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
    add: (values: File[]) => preparation.add(values), remove: (id: string) => preparation.remove(id),
    retry: () => preparation.retry(), cancel: () => preparation.cancel(),
  }
}
