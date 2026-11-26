// Reuse the programmatic dialog lifecycle from studio-confirm.ts.
import { createVNode, render } from 'vue'
import { session } from './state'
import ImageDownloadDialog from './components/ImageDownloadDialog.vue'
import type { ImageDownloadChoice } from '../shared/image-download'

let cancelActive: (() => void) | undefined
export function chooseImageDownloadFormat(signal?: AbortSignal, current: () => boolean = () => true): Promise<ImageDownloadChoice | undefined> {
  cancelActive?.()
  if (signal?.aborted || !current()) return Promise.resolve(undefined)
  const owner = `${session.user?.id}:${session.user?.accountId}`
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  return new Promise(resolve => {
    const host = document.createElement('div')
    let settled = false
    const finish = (format?: ImageDownloadChoice) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      if (cancelActive === cancel) cancelActive = undefined
      const valid = !signal?.aborted && owner === `${session.user?.id}:${session.user?.accountId}` && current()
      render(null, host); host.remove()
      resolve(valid ? format : undefined)
      requestAnimationFrame(() => { if (valid && !cancelActive && trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus({ preventScroll: true }) })
    }
    const cancel = () => finish()
    cancelActive = cancel
    signal?.addEventListener('abort', cancel, { once: true })
    document.body.append(host)
    render(createVNode(ImageDownloadDialog, { onDecision: finish }), host)
  })
}
