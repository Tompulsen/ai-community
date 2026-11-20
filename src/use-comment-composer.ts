import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue'
import type { Work, WorkComment, WorkFile } from './data'
import { api, errorMessage, notify, session, uploadFile } from './state'

export interface CommentAttachment {
  id: string; name: string; type: string; size: number; preview: string
  state: 'queued' | 'uploading' | 'saving' | 'ready' | 'failed'
  progress?: number; error?: string; uploaded?: WorkFile
}
export interface PendingComment {
  id: string; text: string; replyTo: WorkComment | null; attachments: CommentAttachment[]
  state: 'uploading' | 'sending' | 'failed'; error: string
}

export function useCommentComposer(work: Ref<Work | null>, sent: (comment: WorkComment, replyTo: WorkComment | null) => void) {
  const text = ref(''), attachments = ref<CommentAttachment[]>([]), replyTo = ref<WorkComment | null>(null)
  const pending = ref<PendingComment[]>([]), error = ref('')
  const jobs = new Map<string, { file: File; controller: AbortController; done: Promise<void>; finish: () => void; item: CommentAttachment }>()
  const posting = new Set<string>(), posts = new Set<AbortController>()
  let active = 0, version = 0, disposed = false
  const dirty = computed(() => Boolean(text.value.trim() || attachments.value.length || pending.value.length))
  const canSend = computed(() => Boolean(session.user && work.value && (text.value.trim() || attachments.value.length)))
  function release(item: CommentAttachment) {
    const job = jobs.get(item.id)
    jobs.delete(item.id); job?.controller.abort(); job?.finish()
    if (item.preview) URL.revokeObjectURL(item.preview)
  }
  function pump() {
    if (disposed) return
    for (const job of jobs.values()) {
      if (active >= 2) break
      if (job.item.state !== 'queued') continue
      const item = job.item, revision = version
      item.state = 'uploading'; active++
      void uploadFile(job.file, job.controller.signal, percent => {
        if (jobs.get(item.id) !== job || job.controller.signal.aborted) return
        item.progress = percent; item.state = percent === 100 ? 'saving' : 'uploading'
      }).then(file => {
        if (revision !== version || jobs.get(item.id) !== job || job.controller.signal.aborted) return
        item.uploaded = file; item.state = 'ready'; item.progress = 100
      }).catch(cause => {
        if (revision !== version || jobs.get(item.id) !== job || job.controller.signal.aborted) return
        item.state = 'failed'; item.error = errorMessage(cause)
      }).finally(() => { active--; job.finish(); pump() })
    }
  }
  function enqueue(item: CommentAttachment, file: File) {
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    item.state = 'queued'; item.error = ''; item.progress = undefined
    jobs.set(item.id, { file, item, controller: new AbortController(), done, finish })
  }
  function add(files: File[]) {
    error.value = ''
    if (attachments.value.length + files.length > 16) { error.value = '评论最多添加 16 个文件。'; return }
    for (const file of files) {
      const item = reactive<CommentAttachment>({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '', state: 'queued' })
      attachments.value.push(item); enqueue(item, file)
    }
    pump()
  }
  function remove(id: string) {
    const item = attachments.value.find(item => item.id === id)
    if (!item) return
    attachments.value = attachments.value.filter(item => item.id !== id); release(item); pump()
  }
  function retryAttachment(id: string) {
    const job = jobs.get(id)
    if (!job || job.item.state !== 'failed') return
    enqueue(job.item, job.file); pump()
  }
  async function submit(entry: PendingComment) {
    if (posting.has(entry.id) || !pending.value.includes(entry)) return
    const revision = version, workId = work.value?.id, owner = session.user?.id
    if (!workId || !owner) return
    posting.add(entry.id); entry.error = ''; entry.state = 'uploading'
    try {
      await Promise.all(entry.attachments.map(item => jobs.get(item.id)?.done))
      if (revision !== version || !pending.value.includes(entry)) return
      if (entry.attachments.some(item => item.state !== 'ready')) throw new Error('部分附件上传失败，请重试失败附件后发送。')
      entry.state = 'sending'
      const controller = new AbortController(); posts.add(controller)
      let result: { comment: WorkComment }
      try {
        result = await api<{ comment: WorkComment }>(`/api/works/${encodeURIComponent(workId)}/comments`, { method: 'POST',
          body: { text: entry.text, replyToId: entry.replyTo?.id, fileIds: entry.attachments.map(item => item.uploaded!.id) }, signal: controller.signal })
      } finally { posts.delete(controller) }
      if (revision !== version || session.user?.id !== owner || work.value?.id !== workId) return
      sent(result.comment, entry.replyTo)
      pending.value = pending.value.filter(item => item.id !== entry.id)
      for (const item of entry.attachments) release(item)
      notify('评论已发送。')
    } catch (cause) {
      if (revision === version && pending.value.includes(entry)) {
        entry.state = 'failed'; entry.error = `${errorMessage(cause)}${entry.attachments.every(item => item.state === 'ready') ? ' 如连接中断，请先刷新评论确认是否已发送，避免重复。' : ''}`
      }
    } finally { posting.delete(entry.id) }
  }
  function send() {
    if (!canSend.value) return
    const entry = reactive<PendingComment>({ id: crypto.randomUUID(), text: text.value.trim(), replyTo: replyTo.value,
      attachments: [...attachments.value], state: 'uploading', error: '' })
    pending.value.unshift(entry); text.value = ''; attachments.value = []; replyTo.value = null; error.value = ''
    void submit(entry)
  }
  function retry(entry: PendingComment) {
    if (entry.state !== 'failed') return
    for (const item of entry.attachments) if (item.state === 'failed') retryAttachment(item.id)
    void submit(entry)
  }
  function discard(entry: PendingComment) {
    if (entry.state !== 'failed') return
    pending.value = pending.value.filter(item => item.id !== entry.id)
    for (const item of entry.attachments) release(item)
  }
  function reset() {
    version++
    for (const job of [...jobs.values()]) release(job.item)
    for (const controller of posts) controller.abort()
    posts.clear(); posting.clear(); text.value = ''; attachments.value = []; replyTo.value = null; pending.value = []; error.value = ''
  }
  const stopOwner = watch(() => session.user?.id, () => reset(), { flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; stopOwner(); reset() })
  return { text, attachments, replyTo, pending, error, dirty, canSend, add, remove, retryAttachment, send, retry, discard, reset }
}
