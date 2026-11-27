import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readStudioEntry, saveStudioEntry, type StudioEntry } from './studio-entry'
import { del, get, set, studioStore } from '../shared/studio/studio-keyval'

vi.mock('../shared/studio/studio-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), studioStore: vi.fn() }))
const values = new Map<string, string>()
const payload = (owner: string | null = '17'): Extract<StudioEntry, { references: unknown }> => ({ owner, kind: 'image', prompt: '保留完整参考图', references: [{ name: 'reference.png', url: 'data:image/png;base64,AAAA' }] })
const key = 'ai-community-next:studio-entry:legacy'
beforeEach(() => {
  values.clear()
  vi.mocked(get).mockReset().mockResolvedValue(undefined)
  vi.mocked(set).mockReset().mockResolvedValue()
  vi.mocked(del).mockReset().mockResolvedValue()
  vi.mocked(studioStore).mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())

it('stores large complete inputs in IndexedDB without requiring sessionStorage access', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new DOMException('Blocked', 'SecurityError') }, setItem: () => { throw new DOMException('Blocked', 'SecurityError') } })
  const value = payload()
  value.references[0]!.url += 'A'.repeat(6 * 1024 * 1024)
  const id = await saveStudioEntry(value)
  expect(set).toHaveBeenCalledWith('ai-community-next:studio-entry:' + id, expect.objectContaining({ owner: '17', entry: value, expiresAt: expect.any(Number) }))
})

for (const [name, expected] of [['QuotaExceededError', '存储空间不足'], ['SecurityError', '禁止访问本地存储'], ['UnknownError', '创作输入暂存失败']]) {
  it(`distinguishes ${name} without deleting the caller input`, async () => {
    vi.mocked(set).mockRejectedValue(new DOMException('storage failure', name))
    const value = payload(), before = structuredClone(value)
    await expect(saveStudioEntry(value)).rejects.toThrow(expected)
    expect(value).toEqual(before)
    expect(del).not.toHaveBeenCalled()
  })
}

it('rejects a different owner without modifying their saved input', async () => {
  vi.mocked(get).mockResolvedValue({ version: 1, owner: '17', expiresAt: Date.now() + 10000, entry: payload() })
  await expect(readStudioEntry('legacy', '18')).rejects.toThrow('账号已切换')
  expect(studioStore).not.toHaveBeenCalled()
  expect(del).not.toHaveBeenCalled()
})

it('migrates a legacy entry only after the durable write succeeds', async () => {
  values.set(key, JSON.stringify(payload()))
  vi.mocked(studioStore).mockResolvedValue({ version: 1, owner: '17', expiresAt: Date.now() + 10000, entry: payload() })
  expect(await readStudioEntry('legacy', '17')).toEqual(payload())
  expect(studioStore).toHaveBeenCalledWith('readwrite', expect.any(Function))
  expect(values.has(key)).toBe(false)
})

it('preserves legacy input when migration fails', async () => {
  values.set(key, JSON.stringify(payload()))
  vi.mocked(studioStore).mockRejectedValue(new DOMException('Disk unavailable', 'UnknownError'))
  await expect(readStudioEntry('legacy', '17')).rejects.toThrow('暂存失败')
  expect(values.get(key)).toBe(JSON.stringify(payload()))
})

it('does not migrate another account legacy entry', async () => {
  values.set(key, JSON.stringify(payload()))
  await expect(readStudioEntry('legacy', '18')).rejects.toThrow('账号已切换')
  expect(set).not.toHaveBeenCalled()
  expect(values.has(key)).toBe(true)
})

it('does not revive or delete the record of a consumed entry', async () => {
  vi.mocked(get).mockResolvedValue({ version: 1, owner: '17', expiresAt: Date.now() + 10000, consumed: true })
  values.set(key, JSON.stringify(payload()))
  await expect(readStudioEntry('legacy', '17')).rejects.toThrow('已处理或已失效')
  expect(studioStore).not.toHaveBeenCalled()
  expect(del).not.toHaveBeenCalled()
})

it('retains guest input through login and rejects expired input', async () => {
  vi.mocked(get).mockResolvedValue({ version: 1, owner: null, expiresAt: Date.now() + 10000, entry: payload(null) })
  expect((await readStudioEntry('legacy', '17')).owner).toBeNull()
  vi.mocked(get).mockResolvedValue({ version: 1, owner: '17', expiresAt: Date.now() - 1, entry: payload() })
  await expect(readStudioEntry('legacy', '17')).rejects.toThrow('已失效')
  expect(studioStore).toHaveBeenCalledWith('readwrite', expect.any(Function))
})

it('validates the entry before creating a stored record', async () => {
  await expect(saveStudioEntry({ ...payload(), prompt: '' })).rejects.toThrow('请输入提示词')
  expect(set).not.toHaveBeenCalled()
})
