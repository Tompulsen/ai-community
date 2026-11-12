import type { Work } from './data'
import { notify, session } from './state'
import { submitCreation } from './native-studio'

export type StudioKind = 'text' | 'image' | 'video'

export function queueBackgroundWork(work: Work) {
  if (!session.user) { notify('请先登录后生成。'); return }
  if (work.kind === 'resource' || !work.prompt.trim()) return
  void submitCreation({
    kind: work.kind, model: work.model, prompt: work.prompt, sourceWorkId: work.id,
    size: work.kind === 'video' ? '1280x720' : '1024x1024', aspect_ratio: work.kind === 'video' ? '16:9' : '1:1',
    n: 1, duration: 8,
    references: (work.referenceFiles || []).filter(file => file.type.startsWith('image/')),
  }).catch(error => notify(error instanceof Error ? error.message : '生成请求失败。'))
  notify('已提交生成，请在任务浮窗查看进度。')
}
