import { expect, it, vi } from 'vitest'
import { createMaterialUpload } from '../shared/studio/material-upload'
import { createGenerationProgress } from '../shared/studio/generation-progress'
import { getResponseMetrics } from '../shared/studio/chat-response-metrics'
import type { ChatMessage } from '../shared/studio/types'
import type { ParsedFile } from '../shared/studio/file-upload'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const raw = (name: string, type = 'image/png') => new File(['bytes'], name, { type })
const parsed = (file: File): ParsedFile => ({ name: file.name, type: file.type, size: file.size, content: 'data:text/plain;base64,eA==', isText: false })
const loaders = () => ({ loadImage: vi.fn(async (_file: File) => 'data:image/png;base64,eA=='), loadFile: vi.fn(async (file: File) => parsed(file)), imageLimitError: '最多10个', limit: 10 })
it('publishes per-file states, keeps ten image slots and rejects additions beyond the complete queue', async () => {
  const upload = createMaterialUpload(loaders())
  const batch = upload.add(Array.from({ length: 10 }, (_, index) => raw(`${index}.png`)))
  expect(upload.getSnapshot().pending).toBe(10)
  await expect(upload.add([raw('overflow.png')])).rejects.toThrow('10')
  await batch
  expect(upload.getSnapshot().images).toHaveLength(10)
  expect(upload.getSnapshot().items.every(item => item.status === 'ready')).toBe(true)
})
it('retries only failed files and retains successful files', async () => {
  const options = loaders()
  options.loadFile.mockRejectedValueOnce(new Error('无法读取')).mockResolvedValueOnce(parsed(raw('retry.txt', 'text/plain')))
  const upload = createMaterialUpload(options)
  await upload.add([raw('ready.png'), raw('retry.txt', 'text/plain')])
  expect(upload.getSnapshot().items.map(item => item.status)).toEqual(['ready', 'failed'])
  upload.retry()
  await upload.wait(new AbortController().signal)
  expect(options.loadImage).toHaveBeenCalledTimes(1)
  expect(options.loadFile).toHaveBeenCalledTimes(2)
  expect(upload.getSnapshot().items.every(item => item.status === 'ready')).toBe(true)
})
it('cancels/removes queued work, discards late reads and isolates another conversation', async () => {
  const options = loaders(), slow = deferred<string>()
  options.loadImage.mockReturnValueOnce(slow.promise)
  const old = createMaterialUpload(options), next = createMaterialUpload(loaders())
  const batch = old.add([raw('slow.png'), raw('queued.png')])
  old.cancel()
  for (const item of old.getSnapshot().items) old.remove(item.id)
  await next.add([raw('new.png')])
  slow.resolve('late image')
  await batch
  expect(old.getSnapshot().images).toEqual([])
  expect(options.loadImage).toHaveBeenCalledTimes(1)
  expect(next.getSnapshot().items.map(item => item.name)).toEqual(['new.png'])
})
it('times actual output changes only, excluding first-token wait, usage-only packets and non-streamed single packets', () => {
  const observe = createGenerationProgress()
  expect(observe('hello', '', 30000)).toBeUndefined()
  expect(observe('hello world', '', 31000)).toEqual({ outputTokens: 3, durationMs: 1000 })
  expect(observe('hello world', '', 60000)).toBeUndefined()
  const anotherRound = createGenerationProgress()
  expect(anotherRound('new', '', 80000)).toBeUndefined()
  expect(anotherRound('new output', '', 80500)?.durationMs).toBe(500)
})
it('keeps reported token speeds separate from estimates and preserves previous usable statistics', () => {
  const previous: ChatMessage = { id: 'old', role: 'assistant', content: 'old', responseMetrics: { usage: { outputTokens: 100 }, generationDurationMs: 2000 } }
  const latest: ChatMessage = { id: 'new', role: 'assistant', content: '', streaming: true }
  expect(getResponseMetrics([previous, latest])).toMatchObject({ outputTokensPerSecond: 50, speedIsPrevious: true })
  latest.generationProgress = { outputTokens: 20, durationMs: 1000 }
  expect(getResponseMetrics([previous, latest])).toMatchObject({ outputTokensPerSecond: 20, speedIsEstimated: true })
  latest.streaming = false
  latest.responseMetrics = { usage: { outputTokens: 30 }, estimatedOutputTokens: 20, generationDurationMs: 1000 }
  expect(getResponseMetrics([latest])).toMatchObject({ outputTokensPerSecond: 30 })
  expect(getResponseMetrics([latest]).speedIsEstimated).toBeUndefined()
  latest.interrupted = true
  expect(getResponseMetrics([latest]).outputTokensPerSecond).toBeUndefined()
})
