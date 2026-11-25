import { watch, type ComputedRef, type InjectionKey } from 'vue'
import { session } from './state'
import type { CanvasAnnotation, CanvasEditDraft, CanvasReferenceImage } from './image-canvas'
import type { CanvasPosition, CanvasViewport } from './canvas-viewport'

export type CanvasSubmitOptions = { scope: string; signal: AbortSignal; onRegistered: () => void }
export type StudioCanvasContext = {
  scope: ComputedRef<string>
  label: ComputedRef<string>
  model: ComputedRef<string>
  submit: (draft: CanvasEditDraft, options: CanvasSubmitOptions) => Promise<void>
}
export const studioCanvasKey: InjectionKey<StudioCanvasContext> = Symbol('studio-canvas')
export type CanvasState = { annotations: CanvasAnnotation[]; references: CanvasReferenceImage[]; overall: string; positions?: Record<string, CanvasPosition>; viewport?: CanvasViewport }
const drafts = new Map<string, string>()
watch(() => session.user?.id, () => drafts.clear())
export function readCanvasDraft(key: string): CanvasState | undefined {
  const value = drafts.get(key)
  return value ? JSON.parse(value) : undefined
}
export function saveCanvasDraft(key: string, value: CanvasState) {
  drafts.delete(key)
  drafts.set(key, JSON.stringify(value))
  let bytes = [...drafts.values()].reduce((total, draft) => total + draft.length * 2, 0)
  while (drafts.size > 10 || bytes > 24 * 1024 * 1024) {
    const oldest = drafts.keys().next().value!
    bytes -= drafts.get(oldest)!.length * 2
    drafts.delete(oldest)
  }
}
