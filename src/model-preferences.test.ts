import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { modelCategories, modelDescription, modelVendor, searchModels } from '../shared/studio/model-catalog'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }) }
})
vi.mock('./native-studio', async () => {
  const { reactive } = await import('vue')
  return { creation: reactive({ models: [] as any[], modelTokenId: 41, selectedGroup: 'auto', groupSwitching: false, modelsLoading: false }) }
})
const stored = new Map<string, string>()
beforeEach(() => {
  vi.resetModules(); stored.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value) })
})
afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const { session } = await import('./state')
  const { creation } = await import('./native-studio')
  const prefs = await import('./model-preferences')
  session.user = { id: 'creator-a', accountId: '17' } as any
  return { session, creation, ...prefs }
}
it('recognizes slash-prefixed vendors, searches descriptions and sorts category counts', () => {
  const models = [{ id: 'proxy/gpt-5' }, { id: 'gpt-image-2' }, { id: 'claude-opus', description: '长文分析' }, { id: 'custom' }]
  expect(modelVendor('PROXY/CLAUDE-opus').name).toBe('Anthropic')
  expect(searchModels(models, 'anthropic').map(item => item.id)).toEqual(['claude-opus'])
  expect(searchModels(models, '长文').map(item => item.id)).toEqual(['claude-opus'])
  expect(modelCategories(models, id => id === 'custom').map(item => [item.name, item.count])).toEqual([
    ['全部', 4], ['收藏', 1], ['OpenAI', 2], ['Anthropic', 1], ['其他', 1],
  ])
  expect(modelDescription({ id: 'proxy/TAVILY-DEEP' }, 'text')).toContain('高相关')
  expect(modelDescription({ id: 'gpt-5', description: '账号提供的说明' }, 'text')).toBe('账号提供的说明')
})
it('isolates preferences by account and token and restores them for the original identity', async () => {
  const p = await fixture()
  p.toggleModelFavorite('alias'); p.setModelType('alias', 'image'); p.setModelFormat('alias', 'responses')
  p.creation.modelTokenId = 52
  expect(p.favoriteModel('alias')).toBe(false); expect(p.modelFormat('alias')).toBeUndefined()
  p.creation.modelTokenId = 41
  expect(p.modelKind({ id: 'alias', kinds: ['text'] })).toBe('image')
  p.session.user = { id: 'creator-a', accountId: '18' } as any
  expect(p.favoriteModel('alias')).toBe(false)
  p.session.user = { id: 'creator-a', accountId: '17' } as any
  expect(p.favoriteModel('alias')).toBe(true); expect(p.modelFormat('alias')).toBe('responses')
})
it('uses group aliases but explicit overrides win and can be reset', async () => {
  const p = await fixture()
  p.creation.selectedGroup = '生图'
  expect(p.modelKind({ id: 'alias', kinds: ['text'] })).toBe('image')
  p.setModelType('alias', 'video')
  expect(p.modelsForKind('image')).toEqual([])
  expect(p.modelKind({ id: 'alias' })).toBe('video')
  p.setModelType('alias', 'auto')
  expect(p.modelKind({ id: 'alias' })).toBe('image')
})
it('does not partially apply failed saves or allow settings while a group changes', async () => {
  const p = await fixture()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota') } })
  expect(() => p.toggleModelFavorite('gpt-5')).toThrow('保存失败')
  expect(p.favoriteModel('gpt-5')).toBe(false)
  p.creation.groupSwitching = true
  expect(() => p.setModelType('gpt-5', 'image')).toThrow('尚未就绪')
  expect(p.modelType('gpt-5')).toBe('auto')
})
it('recovers from corrupt storage and clears pending choices on identity changes', async () => {
  vi.stubGlobal('localStorage', { getItem: () => '{"overrides": {"unscoped-model": "image"}}', setItem: vi.fn() })
  const p = await fixture()
  expect(p.modelPreferences.error).toContain('无法读取')
  expect(p.modelType('gpt-5')).toBe('auto')
  p.modelChoices.text = 'claude-opus'
  expect(p.takeModelChoice('text', [])).toBe('')
  expect(p.takeModelChoice('text', [{ id: 'claude-opus' }])).toBe('claude-opus')
  expect(p.modelChoices.text).toBe('')
  p.modelChoices.image = 'gpt-image-2'; p.session.user = null
  expect(p.modelChoices.image).toBe('')
})
