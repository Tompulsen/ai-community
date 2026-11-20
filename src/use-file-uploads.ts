import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { WorkFile } from './data'
import { errorMessage, session, uploadFile } from './state'

export interface UploadStatus {
  state: 'queued' | 'uploading' | 'saving' | 'ready' | 'failed'
  progress?: number
  error?: string
  result?: WorkFile
}
export interface UploadFile extends WorkFile { upload?: UploadStatus }

export function useFileUploads() {
  const items = ref<UploadFile[]>([])
  const jobs = new Map<UploadFile, { file: File; controller: AbortController; done: Promise<void>; finish: () => void }>()
  let active = 0, disposed = false
  const uploading = computed(() => items.value.some(item => item.upload && ['queued', 'uploading', 'saving'].includes(item.upload.state)))
  function pump() {
    if (disposed) return
    for (const [item, job] of jobs) {
      if (active >= 2) break
      if (item.upload?.state !== 'queued') continue
      item.upload.state = 'uploading'; active++
      void uploadFile(job.file, job.controller.signal, percent => {
        if (jobs.get(item) !== job || job.controller.signal.aborted) return
        item.upload!.progress = percent; item.upload!.state = percent === 100 ? 'saving' : 'uploading'
      }).then(result => {
        if (jobs.get(item) !== job || job.controller.signal.aborted) return
        const preview = item.url
        Object.assign(item, result, { url: preview })
        item.upload = { state: 'ready', progress: 100, result }
      }).catch(cause => {
        if (jobs.get(item) !== job || job.controller.signal.aborted) return
        item.upload = { state: 'failed', error: errorMessage(cause) }
      }).finally(() => { active--; job.finish(); pump() })
    }
  }
  function enqueue(item: UploadFile, file: File) {
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    item.upload = { state: 'queued' }
    jobs.set(item, { file, controller: new AbortController(), done, finish })
  }
  function add(files: File[]) {
    const added = files.map(file => {
      const item = reactive<UploadFile>({ id: `local-${crypto.randomUUID()}`, name: file.name, type: file.type, size: file.size,
        url: URL.createObjectURL(file) })
      items.value.push(item); enqueue(item, file)
      return item
    })
    pump(); return added
  }
  function remove(item: UploadFile) {
    const job = jobs.get(item)
    if (!job) return
    jobs.delete(item); job.controller.abort(); job.finish()
    URL.revokeObjectURL(item.url)
    items.value = items.value.filter(value => value !== item)
    pump()
  }
  function retry(item: UploadFile) {
    const job = jobs.get(item)
    if (!job || item.upload?.state !== 'failed') return
    enqueue(item, job.file); pump()
  }
  async function wait(selected: UploadFile[]) {
    await Promise.all(selected.map(item => jobs.get(item)?.done))
    const failed = selected.find(item => item.upload && item.upload.state !== 'ready')
    if (failed) throw new Error(failed.upload?.error || '文件尚未上传成功，请重试或移除后再提交。')
  }
  function reset() {
    for (const [item, job] of jobs) { job.controller.abort(); job.finish(); URL.revokeObjectURL(item.url) }
    jobs.clear(); items.value = []
  }
  watch(() => session.user?.id, reset, { flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; reset() })
  return { add, remove, retry, wait, reset, uploading }
}
