import { reactive, shallowRef } from 'vue'
import type { Work } from './data'
import { notify, session } from './state'

export type StudioKind = 'text' | 'image' | 'video'
export const studioAnchor = shallowRef<HTMLElement | null>(null)
export const studioSession = reactive({
  enabled: false,
  kind: 'image' as StudioKind,
  source: null as Work | null,
  openTaskId: '',
  pending: [] as { requestId: string; sourceWorkId: string; kind: 'image' | 'video'; prompt: string; model: string; references: { name: string; url: string }[] }[],
})

export function queueBackgroundWork(work: Work) {
  if (!session.user) { notify('请先登录后生成。'); return }
  if (work.kind === 'resource' || !work.prompt.trim()) return
  studioSession.enabled = true
  studioSession.pending.push({ requestId: crypto.randomUUID(), sourceWorkId: work.id, kind: work.kind, prompt: work.prompt, model: work.model || '', references: (work.referenceFiles || []).filter(file => file.type.startsWith('image/')).map(file => ({ name: file.name, url: new URL(file.url, window.location.origin).href })) })
  notify('已提交后台生成，请在任务浮窗查看进度。')
}
