import { afterEach, expect, it, vi } from 'vitest'
import { combineAbortSignals } from './abort-signals'

afterEach(() => vi.restoreAllMocks())

it('uses the first already-aborted reason without retaining earlier listeners', () => {
  const active = new AbortController(), first = new AbortController(), second = new AbortController()
  first.abort(new DOMException('Stopped', 'AbortError')); second.abort('later')
  const removed = vi.spyOn(active.signal, 'removeEventListener')
  const combined = combineAbortSignals([active.signal, first.signal, second.signal])
  expect(combined.signal.aborted).toBe(true)
  expect(combined.signal.reason).toBe(first.signal.reason)
  expect(removed).toHaveBeenCalledTimes(1)
  combined.dispose()
  expect(removed).toHaveBeenCalledTimes(1)
})

it('preserves a timeout reason, cleans all listeners, and ignores later cancellation', () => {
  const caller = new AbortController(), deadline = new AbortController()
  const add = vi.spyOn(caller.signal, 'addEventListener')
  const removeCaller = vi.spyOn(caller.signal, 'removeEventListener')
  const removeDeadline = vi.spyOn(deadline.signal, 'removeEventListener')
  const combined = combineAbortSignals([caller.signal, deadline.signal, caller.signal])
  const reason = new DOMException('Expired', 'TimeoutError')
  deadline.abort(reason); caller.abort()
  expect(combined.signal.reason).toBe(reason)
  expect(add).toHaveBeenCalledTimes(1)
  expect(removeCaller).toHaveBeenCalledTimes(1)
  expect(removeDeadline).toHaveBeenCalledTimes(1)
})

it('releases listeners when work completes without aborting the caller', () => {
  const caller = new AbortController(), combined = combineAbortSignals([caller.signal])
  combined.dispose(); combined.dispose(); caller.abort()
  expect(combined.signal.aborted).toBe(false)
  const empty = combineAbortSignals([])
  expect(empty.signal.aborted).toBe(false)
  empty.dispose()
})

it('cleans earlier registrations if initialization fails', () => {
  const first = new AbortController(), failing = new AbortController()
  const removed = vi.spyOn(first.signal, 'removeEventListener')
  vi.spyOn(failing.signal, 'addEventListener').mockImplementation(() => { throw new Error('Cannot register') })
  expect(() => combineAbortSignals([first.signal, failing.signal])).toThrow('Cannot register')
  expect(removed).toHaveBeenCalledTimes(1)
})
