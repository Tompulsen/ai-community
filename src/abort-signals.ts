// AbortSignal.any is unavailable in older browsers used by the studio.
export function combineAbortSignals(signals: readonly AbortSignal[]) {
  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()
  const dispose = () => {
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
    listeners.clear()
  }
  const abort = (signal: AbortSignal) => { controller.abort(signal.reason); dispose() }
  try {
    for (const signal of new Set(signals)) {
      if (signal.aborted) { abort(signal); break }
      const listener = () => abort(signal)
      listeners.set(signal, listener)
      signal.addEventListener('abort', listener, { once: true })
    }
  } catch (error) { dispose(); throw error }
  return { signal: controller.signal, dispose }
}
