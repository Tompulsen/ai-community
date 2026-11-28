import { httpError } from '../auth.ts'

const transferLimit = 200
const maxWaitingPerAccount = 14
const activeByAccount = new Map<string, number>()
const waiting = new Map<string, Set<() => void>>()
let active = 0

function startNext() {
  let selected: string | undefined
  let fewestActive = Infinity
  for (const account of waiting.keys()) {
    const count = activeByAccount.get(account) ?? 0
    if (count < fewestActive) {
      selected = account
      fewestActive = count
      if (count === 0) break
    }
  }
  if (selected === undefined) return
  const queue = waiting.get(selected)!
  const next = queue.values().next().value!
  queue.delete(next)
  // Move this account to the back for the next tie.
  waiting.delete(selected)
  if (queue.size) waiting.set(selected, queue)
  next()
}

function occupy(account: string) {
  active++
  activeByAccount.set(account, (activeByAccount.get(account) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    active--
    const count = activeByAccount.get(account)! - 1
    if (count) activeByAccount.set(account, count)
    else activeByAccount.delete(account)
    startNext()
  }
}

export async function acquireOriginalTransfer(account: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  if (active < transferLimit) return occupy(account)
  const queue = waiting.get(account) ?? new Set<() => void>()
  if (queue.size >= maxWaitingPerAccount || (!queue.size && waiting.size >= transferLimit)) {
    throw httpError(503, '原图传输繁忙，请稍后重试。')
  }
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', cancel)
      resolve(occupy(account))
    }
    const cancel = () => {
      queue.delete(start)
      if (!queue.size) waiting.delete(account)
      reject(signal.reason)
    }
    queue.add(start)
    waiting.set(account, queue)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
