interface Submission {
  entered?: Promise<void>
  resolve?: () => void
  reject?: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
  started: boolean
  waited: boolean
  released: boolean
  reason?: Error
}

const busy = (message: string) => Object.assign(new Error(message), { statusCode: 429, retryAfter: 5, notAccepted: true })

export function createImageSubmissionQueue({ concurrency = 2, capacity = 10, perAccount = 2, waitMs = 30000 } = {}) {
  if (![concurrency, capacity, perAccount, waitMs].every(value => Number.isSafeInteger(value) && value > 0))
    throw new Error('Invalid image submission queue limits')
  let active = 0, reserved = 0
  const accounts = new Map<string, number>(), waiting: Submission[] = []
  const available = (account: string) => reserved < capacity && (accounts.get(account) || 0) < perAccount
  const start = () => {
    while (active < concurrency && waiting.length) {
      const submission = waiting.shift()!
      clearTimeout(submission.timer)
      submission.started = true
      active++
      submission.resolve!()
    }
  }
  function reserve(account: string) {
    if (!available(account)) throw busy('当前图片任务较多，请稍后重试。')
    reserved++
    accounts.set(account, (accounts.get(account) || 0) + 1)
    const submission: Submission = { started: false, waited: false, released: false }
    const release = (reason = busy('图片提交等待已取消。')) => {
      if (submission.released) return
      submission.released = true
      submission.reason = reason
      clearTimeout(submission.timer)
      const index = waiting.indexOf(submission)
      if (index >= 0) waiting.splice(index, 1)
      if (submission.started) active--
      else submission.reject?.(reason)
      reserved--
      const count = accounts.get(account)! - 1
      if (count) accounts.set(account, count)
      else accounts.delete(account)
      start()
    }
    return {
      enter() {
        submission.entered ??= new Promise<void>((resolve, reject) => {
          submission.resolve = resolve; submission.reject = reject
          if (submission.released) { reject(submission.reason); return }
          submission.waited = active >= concurrency
          waiting.push(submission)
          submission.timer = setTimeout(() => release(busy('图片提交等待超时，请稍后重试。')), waitMs)
          submission.timer.unref()
          start()
        })
        return submission.entered
      },
      get waited() { return submission.waited },
      release() { release() },
    }
  }
  return { reserve, available }
}

// shortcut: limits apply to one web process; use shared admission only when scaling to multiple submission workers.
export const imageSubmissions = createImageSubmissionQueue()
