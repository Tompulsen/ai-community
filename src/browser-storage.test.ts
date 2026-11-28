import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatStorageBytes, storagePressure } from './browser-storage'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

describe('browser storage pressure', () => {
  it('keeps unavailable and invalid usage unknown instead of reporting zero', () => {
    expect(storagePressure(null, 10 ** 9)).toBe('unknown')
    expect(storagePressure(Number.NaN, 10 ** 9)).toBe('unknown')
    expect(storagePressure(-1, 10 ** 9)).toBe('unknown')
    expect(formatStorageBytes(null)).toBe('暂无法读取')
    expect(formatStorageBytes(0)).toBe('0 KiB')
  })
  it('uses absolute thresholds with quota pressure as an additional signal', () => {
    expect(storagePressure(500 * 1024 ** 2 - 1, null)).toBe('normal')
    expect(storagePressure(500 * 1024 ** 2, null)).toBe('mild')
    expect(storagePressure(1024 ** 3 - 1, null)).toBe('mild')
    expect(storagePressure(1024 ** 3, null)).toBe('strong')
    expect(storagePressure(90, 100)).toBe('strong')
    expect(storagePressure(89, 100)).toBe('normal')
    expect(storagePressure(0, 0)).toBe('normal')
  })
})

describe('browser estimate monitoring', () => {
  it('does not treat a missing API or a rejected estimate as an empty store', async () => {
    vi.stubGlobal('navigator', {})
    const storage = await import('./browser-storage')
    expect(await storage.refreshBrowserStorage()).toMatchObject({ usage: null, quota: null, pressure: 'unknown' })
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.reject(new Error('denied')) } })
    expect(await storage.refreshBrowserStorage(true)).toMatchObject({ usage: null, quota: null, pressure: 'unknown' })
  })
  it('bounds a stalled API call so recovery controls can become available', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { storage: { estimate: () => new Promise(() => {}) } })
    const storage = await import('./browser-storage')
    const request = storage.refreshBrowserStorage()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await request).toMatchObject({ usage: null, quota: null, pressure: 'unknown' })
  })
  it('merges concurrent requests and throttles routine write notifications', async () => {
    const estimate = vi.fn(async () => ({ usage: 600 * 1024 ** 2, quota: 5 * 1024 ** 3 }))
    vi.stubGlobal('navigator', { storage: { estimate } })
    const storage = await import('./browser-storage')
    const first = storage.refreshBrowserStorage(), second = storage.refreshBrowserStorage()
    expect(first).toBe(second)
    expect(await first).toMatchObject({ pressure: 'mild' })
    await storage.refreshBrowserStorage()
    expect(estimate).toHaveBeenCalledTimes(1)
    await storage.refreshBrowserStorage(true)
    expect(estimate).toHaveBeenCalledTimes(2)
  })
  it('normalizes incomplete and nonsensical estimate values independently', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1024, quota: 0 }) } })
    const storage = await import('./browser-storage')
    expect(await storage.refreshBrowserStorage()).toMatchObject({ usage: 1024, quota: null, pressure: 'normal' })
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: -1, quota: Infinity }) } })
    expect(await storage.refreshBrowserStorage(true)).toMatchObject({ usage: null, quota: null, pressure: 'unknown' })
  })
  it('does not let a later small write hide a failed media save', async () => {
    const storage = await import('./browser-storage')
    storage.notifyBrowserStorageFailure(new DOMException('full', 'QuotaExceededError'))
    storage.notifyBrowserStorageChanged()
    expect(storage.browserStorageWriteFailure()).toBe('quota')
    storage.clearBrowserStorageFailure()
    expect(storage.browserStorageWriteFailure()).toBe(null)
  })
  it('rejects an invalid cleanup account before touching IndexedDB', async () => {
    const open = vi.fn()
    vi.stubGlobal('indexedDB', { open })
    const storage = await import('./browser-storage')
    await expect(storage.clearOwnerThumbnailCache('')).rejects.toThrow('请选择有效的本地账号')
    await expect(storage.clearOwnerThumbnailCache('x\u0000')).rejects.toThrow('请选择有效的本地账号')
    await expect(storage.readMediaStorageInventory('x'.repeat(201))).rejects.toThrow('请选择有效的本地账号')
    expect(open).not.toHaveBeenCalled()
  })
})
