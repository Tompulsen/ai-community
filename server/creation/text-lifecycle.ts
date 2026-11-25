import { textGenerationTimeouts } from '../../shared/studio/creation-limits.ts'

// Browser cancellation must not cancel an already paid generation.
export function createTextLifecycle(limits = textGenerationTimeouts) {
  const controller = new AbortController()
  let idle: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const expire = (message: string) => {
    controller.abort(new DOMException(message, 'TimeoutError'))
    dispose()
  }
  const first = setTimeout(() => expire('等待模型首次响应超时。'), limits.response)
  const total = setTimeout(() => expire('本次回答达到最长生成时间，已停止等待。'), limits.total)
  function dispose() {
    disposed = true
    clearTimeout(first); clearTimeout(total); clearTimeout(idle)
  }
  function progress() {
    if (disposed) return
    clearTimeout(idle)
    idle = setTimeout(() => expire('模型长时间未返回新的内容，回答已中断。'), limits.idle)
  }
  return { signal: controller.signal, dispose, progress,
    receivedResponse() { clearTimeout(first); progress() },
  }
}
