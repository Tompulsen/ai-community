import { vi } from 'vitest'
import type { CreationTask } from './native-studio'

export function mockStudioTaskStorage() {
  // Generation protocol tests run in Node; browser tests exercise real IDB failures and transactions.
  const tasks = new Map<string, CreationTask>(), assets = new Map<string, Blob>()
  vi.doMock('./studio-task-store', async importOriginal => ({
    ...await importOriginal<typeof import('./studio-task-store')>(),
    saveTaskChanges: vi.fn(async (owner: string, captured: ReadonlyMap<string, string>) => {
      const saved = new Map([...captured].map(([id, raw]) => [id, JSON.parse(raw) as CreationTask]))
      for (const [id, task] of saved) tasks.set(`${owner}:${id}`, structuredClone(task))
      return saved
    }),
    readTaskSnapshot: vi.fn(async (owner: string) => structuredClone([...tasks.values()].filter(task => task.owner === owner))),
    saveReferenceImage: vi.fn(async (owner: string, blob: Blob) => {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      const url = `studio-asset:reference-${blob.type.split('/')[1]}-${hash}:0`
      assets.set(`${owner}:${url}`, blob)
      return url
    }),
    readTaskAsset: vi.fn(async (owner: string, url: string) => assets.get(`${owner}:${url}`)),
  }))
  // Keep these tests focused on polling deadlines; coalescing has dedicated queue and browser coverage.
  vi.doMock('../shared/studio/latest-write-queue', async importOriginal => {
    const actual = await importOriginal<typeof import('../shared/studio/latest-write-queue')>()
    return { ...actual, createDeferredWriteQueue: <T>(write: (value: T) => Promise<void>) => {
      const queue = actual.createLatestWriteQueue(write)
      let pending = Promise.resolve()
      return Object.assign((value: T) => pending = queue(value), { flush: () => pending })
    } }
  })
}
