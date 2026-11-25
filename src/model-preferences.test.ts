import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { modelCategories, modelDescription, modelVendor, searchModels } from '../shared/studio/model-catalog'

vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any, accountUrl: 'https://accounts.example' }), api: vi.fn() }
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
  Object.assign(creation, { models: [], modelTokenId: 41, selectedGroup: 'auto', groupSwitching: false, modelsLoading: false })
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
it('isolates preferences by account and group while surviving token changes', async () => {
  const p = await fixture()
  p.toggleModelFavorite('alias'); p.setModelType('alias', 'image'); p.setModelFormat('alias', 'responses')
  p.creation.modelTokenId = 52
  expect(p.favoriteModel('alias')).toBe(true)
  p.creation.selectedGroup = 'images'
  expect(p.favoriteModel('alias')).toBe(false); expect(p.modelFormat('alias')).toBeUndefined()
  p.creation.modelTokenId = 41
  p.creation.selectedGroup = 'auto'
  expect(p.modelKind({ id: 'alias', kinds: ['text'] })).toBe('image')
  p.session.user = { id: 'creator-a', accountId: '18' } as any
  expect(p.favoriteModel('alias')).toBe(false)
  p.session.user = { id: 'creator-a', accountId: '17' } as any
  expect(p.favoriteModel('alias')).toBe(true); expect(p.modelFormat('alias')).toBe('responses')
})
it('allows favorites and settings for an account without model keys', async () => {
  const p = await fixture()
  p.creation.modelTokenId = null as any
  p.toggleModelFavorite('alias'); p.setModelType('alias', 'image'); p.setModelFormat('alias', 'responses')
  expect(p.favoriteModel('alias')).toBe(true)
  expect(p.modelKind({ id: 'alias' })).toBe('image')
  expect(p.modelFormat('alias')).toBe('responses')
})
it('migrates only verified unambiguous token/group preferences and preserves conflicting originals', async () => {
  const p = await fixture(), { api } = await import('./state')
  const old = (token: number) => JSON.stringify(['account', token, 'alias'])
  Object.assign(p.modelPreferences, { favorites: [old(41), old(52), old(99)], overrides: { [old(41)]: 'image', [old(52)]: 'video' }, apiFormats: { [old(41)]: 'responses' } })
  vi.mocked(api).mockResolvedValue({ issuer: 'https://accounts.example', mappings: { 41: 'auto', 52: 'auto' } })
  await p.migrateModelPreferences()
  p.creation.modelTokenId = null as any
  expect(p.favoriteModel('alias')).toBe(true)
  expect(p.modelFormat('alias')).toBe('responses')
  expect(p.modelType('alias')).toBe('auto')
  expect(p.modelPreferences.overrides[old(41)]).toBe('image')
  expect(p.modelPreferences.overrides[old(52)]).toBe('video')
  expect(p.modelPreferences.favorites).toContain(old(99))
  expect(p.modelPreferences.error).toContain('无法确认')
})
it('legacy catalogues keep their verified token preferences readable and editable if migration is unavailable', async () => {
  const p = await fixture(), old = JSON.stringify(['account', 41, 'alias'])
  Object.assign(p.modelPreferences, { favorites: [old], overrides: { [old]: 'image' }, apiFormats: { [old]: 'responses' } })
  expect(p.favoriteModel('alias')).toBe(true)
  expect(p.modelType('alias')).toBe('image')
  expect(p.modelFormat('alias')).toBe('responses')
  p.toggleModelFavorite('alias'); p.setModelType('alias', 'auto'); p.setModelFormat('alias', 'auto')
  expect(p.favoriteModel('alias')).toBe(false)
  expect(p.modelType('alias')).toBe('auto')
  expect(p.modelFormat('alias')).toBeUndefined()
})
it('reads configured chat formats without treating image formats as chat overrides', async () => {
  const p = await fixture()
  p.creation.models = [{ id: 'alias', apiFormat: 'responses' }, { id: 'image', apiFormat: 'images' }]
  expect(p.configuredModelFormat('alias')).toBe('responses')
  expect(p.configuredModelFormat('image')).toBeUndefined()
  p.setModelFormat('alias', 'claude')
  expect(p.modelFormat('alias')).toBe('claude')
  expect(p.configuredModelFormat('alias')).toBe('responses')
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
it('preserves recognized media types across groups while honoring explicit settings', async () => {
  const p = await fixture()
  p.creation.selectedGroup = '视频'
  const image = { id: 'gpt-image-2', kinds: ['image' as const] }
  expect(p.modelKind(image)).toBe('image')
  p.creation.selectedGroup = '生图'
  expect(p.modelKind({ id: 'sora-2', kinds: ['video'] })).toBe('video')
  p.setModelType(image.id, 'chat')
  expect(p.modelKind(image)).toBe('text')
  expect(p.modelKind({ ...image, configuredKind: 'image' })).toBe('image')
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
it('keeps server-configured model types across group tokens and above stale personal and group overrides', async () => {
  const p = await fixture()
  const model = { id: 'alias', kinds: ['text' as const], configuredKind: 'image' as const }
  p.creation.models = [model]
  p.setModelType('alias', 'video')
  expect(p.modelsForKind('image')).toEqual([model])
  p.creation.modelTokenId = 52; p.creation.selectedGroup = '视频'
  expect(p.modelKind(model)).toBe('image')
  expect(p.modelsForKind('image')).toEqual([model])
  expect(p.modelKind({ id: 'alias', kinds: ['text'] })).toBe('video')
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
