// Programmatic dialog pattern adapted from octopus_chat ui-lib.tsx (MIT).
import { createVNode, render } from 'vue'
import { session } from './state'
import StudioConfirmDialog from './components/StudioConfirmDialog.vue'

let cancelActive: (() => void) | undefined
export function confirmStudioDelete(message: string, current: () => boolean = () => true): Promise<boolean> {
  cancelActive?.()
  const owner = `${session.user?.id}:${session.user?.accountId}`
  return new Promise(resolve => {
    const host = document.createElement('div')
    let settled = false
    const finish = (accepted: boolean) => {
      if (settled) return
      settled = true
      if (cancelActive === cancel) cancelActive = undefined
      const valid = owner === `${session.user?.id}:${session.user?.accountId}` && current()
      render(null, host); host.remove()
      resolve(accepted && valid)
    }
    const cancel = () => finish(false)
    cancelActive = cancel
    document.body.append(host)
    render(createVNode(StudioConfirmDialog, { message, onDecision: finish }), host)
  })
}
