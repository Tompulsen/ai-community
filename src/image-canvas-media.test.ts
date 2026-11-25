import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCanvasImage } from './image-canvas'

const reader = vi.hoisted(() => vi.fn())
vi.mock('./native-studio', () => ({ readCreationImage: reader }))
let decode: 'ok' | 'fail' | 'stall' = 'ok'
beforeEach(() => {
  decode = 'ok'
  reader.mockReset().mockResolvedValue(new Blob(['original'], { type: 'image/png' }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canvas-private')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('Image', class {
    naturalWidth = 1200; naturalHeight = 800
    onload?: () => void; onerror?: () => void
    value = ''
    set src(value: string) {
      this.value = value
      if (value && decode !== 'stall') queueMicrotask(() => decode === 'ok' ? this.onload?.() : this.onerror?.())
    }
    get src() { return this.value }
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('canvas original image lifecycle', () => {
  it('uses the authenticated original reader and releases its private URL only once', async () => {
    const signal = new AbortController().signal
    const result = await loadCanvasImage('studio-asset:original', signal)
    expect(reader).toHaveBeenCalledWith('studio-asset:original', signal)
    expect(result.image.naturalWidth).toBe(1200)
    expect(await result.blob.text()).toBe('original')
    result.dispose(); result.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:canvas-private')
  })
  it('does not fetch an aborted request or allocate an object URL after a late read', async () => {
    const early = new AbortController(); early.abort()
    await expect(loadCanvasImage('private', early.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader).not.toHaveBeenCalled()
    const late = new AbortController()
    let finish!: (blob: Blob) => void
    reader.mockImplementation(() => new Promise<Blob>(resolve => { finish = resolve }))
    const pending = loadCanvasImage('private', late.signal)
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(1))
    late.abort(); finish(new Blob(['original']))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
  it('cleans up on failed decoding and permits a fresh retry', async () => {
    decode = 'fail'
    await expect(loadCanvasImage('image')).rejects.toThrow('无法解码')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    decode = 'ok'
    const retry = await loadCanvasImage('image'); retry.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
  it('cancels or times out stalled decoding without leaving image resources alive', async () => {
    decode = 'stall'
    const controller = new AbortController(), pending = loadCanvasImage('image', controller.signal)
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    const timeout = loadCanvasImage('image')
    const rejected = expect(timeout).rejects.toThrow('解码超时')
    await vi.advanceTimersByTimeAsync(15001)
    await rejected
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
