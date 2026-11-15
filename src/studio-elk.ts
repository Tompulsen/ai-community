import ELK, { type ElkLayoutArguments, type ElkNode } from 'elkjs/lib/elk-api.js'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'

// Keep Mermaid's ELK layouts while running the large layout engine off the UI thread.
export default class StudioELK {
  async layout<T extends ElkNode>(graph: T, options?: ElkLayoutArguments) {
    // Mermaid's render callbacks and DOM elements cannot cross the Worker boundary.
    const data = JSON.parse(JSON.stringify(graph, (_key, value) => typeof value === 'function' || value instanceof Node ? undefined : value)) as T
    const worker = new Worker(workerUrl)
    // ELK only handles messages; reject load/runtime failures so Mermaid's queue can continue.
    const failure = new Promise<never>((_resolve, reject) => {
      worker.addEventListener('error', event => {
        event.preventDefault()
        reject(new Error(event.message || 'ELK worker failed to load.'))
      }, { once: true })
      worker.addEventListener('messageerror', () => reject(new Error('ELK worker returned an unreadable message.')), { once: true })
    })
    try {
      const engine = new ELK({ workerFactory: () => worker })
      return await Promise.race([engine.layout(data, options), failure])
    } finally {
      worker.terminate()
    }
  }
}
