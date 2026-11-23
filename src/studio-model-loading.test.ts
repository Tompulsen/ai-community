import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('./state', async () => {
    const { reactive } = await import('vue')
    return { session: reactive({ user: null as any }), api: vi.fn(), accountApi: vi.fn(), errorMessage: (error: Error) => error.message, notify: vi.fn(), uploadFile: vi.fn() }
  })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture() {
  const state = await import('./state')
  const studio = await import('./native-studio')
  state.session.user = { id: 'owner', accountId: '17' } as any
  await studio.initializeCreation()
  let selectedGroup = 'auto'
  const groups = ['auto', 'images', 'video'].map(id => ({ id, name: id }))
  vi.mocked(state.accountApi).mockImplementation(async (route, body) => {
    if (route === 'model-groups/select') { selectedGroup = (body as any).group; return { group: selectedGroup, selectedTokenId: 41 } }
    return { groups, selectedGroup, selectedTokenId: 41 }
  })
  const catalogue = (group: string) => ({ tokenId: group === 'auto' ? 41 : group === 'images' ? 42 : 43,
    items: [{ id: `${group}-model`, kinds: ['image'] }] })
  vi.mocked(state.api).mockImplementation(async (_path, options) => catalogue((options?.body as any)?.group || selectedGroup))
  await studio.loadCreationGroups()
  return { ...state, ...studio, catalogue }
}

it('selects a group immediately and prepares its token and models with one request without changing the shared selection', async () => {
  const p = await fixture(), read = deferred<any>()
  vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const selected = p.selectCreationGroup('images')
  expect(p.creation.selectedGroup).toBe('images')
  expect(p.creation.models).toEqual([])
  read.resolve(p.catalogue('images'))
  await selected
  expect(p.creation.modelTokenId).toBe(42)
  expect(p.creation.models[0]?.id).toBe('images-model')
  expect(p.api).toHaveBeenCalledTimes(1)
  expect(p.api).toHaveBeenCalledWith('/api/creation/models', expect.objectContaining({ method: 'POST', body: { group: 'images' }, expectedAccount: '17' }))
  expect(p.accountApi).not.toHaveBeenCalledWith('model-groups/select', expect.anything(), expect.anything())
})

it('returns to a prepared group without a loading state or another network request', async () => {
  const p = await fixture()
  await p.selectCreationGroup('images'); await p.selectCreationGroup('video')
  vi.mocked(p.api).mockClear()
  const selected = p.selectCreationGroup('images')
  expect(p.creation.selectedGroup).toBe('images')
  expect(p.creation.models[0]?.id).toBe('images-model')
  expect(p.creation.modelTokenId).toBe(42)
  expect(p.creation.modelsLoading || p.creation.groupSwitching).toBe(false)
  await selected
  expect(p.api).not.toHaveBeenCalled()
})

it('keeps prepared models usable during a background refresh and preserves them on a temporary failure', async () => {
  const p = await fixture()
  await p.selectCreationGroup('images'); await p.selectCreationGroup('video')
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61000)
  const read = deferred<any>(); vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const selected = p.selectCreationGroup('images')
  expect(p.creation.models[0]?.id).toBe('images-model')
  expect(p.creation.modelsLoading || p.creation.groupSwitching).toBe(false)
  read.resolve(p.catalogue('images')); await selected; await p.loadCreationModels(true)
  vi.mocked(p.api).mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 502 }))
  await p.loadCreationModels(true)
  expect(p.creation.models[0]?.id).toBe('images-model')
  expect(p.creation.modelTokenId).toBe(42)
  expect(p.creation.modelsError).toContain('temporary outage')
})

it('allows a newer group selection to finish before an older request without leaking its models', async () => {
  const p = await fixture(), first = deferred<any>()
  vi.mocked(p.api).mockImplementation(async (_path, options) => (options?.body as any)?.group === 'images' ? first.promise : p.catalogue('video'))
  const older = p.selectCreationGroup('images')
  await p.selectCreationGroup('video'); await p.waitCreationGroup()
  expect(p.creation.selectedGroup).toBe('video')
  expect(p.creation.models[0]?.id).toBe('video-model')
  first.resolve(p.catalogue('images')); await older
  expect(p.creation.models[0]?.id).toBe('video-model')
  expect(p.creation.modelTokenId).toBe(43)
})

it('does not restore the shared session group over an explicit page selection', async () => {
  const p = await fixture()
  await p.selectCreationGroup('images')
  await p.loadCreationGroups(true)
  expect(p.creation.selectedGroup).toBe('images')
})

it('drops a prepared group after an explicit permission failure instead of leaving it ready', async () => {
  const p = await fixture(); await p.selectCreationGroup('images')
  vi.mocked(p.api).mockRejectedValueOnce(Object.assign(new Error('permission revoked'), { status: 403 }))
  await p.loadCreationModels(true)
  expect(p.creation.modelTokenId).toBeNull()
  expect(p.creation.models).toEqual([])
  expect(p.creation.modelsError).toContain('permission revoked')
})

it('scopes in-flight data to both the community user and the account identity', async () => {
  const p = await fixture(), read = deferred<any>()
  vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const selected = p.selectCreationGroup('images')
  p.session.user = { id: 'owner', accountId: '18' } as any
  const { nextTick } = await import('vue'); await nextTick()
  read.resolve(p.catalogue('images')); await selected
  expect(p.creation.models).toEqual([])
  expect(p.creation.modelTokenId).toBeNull()
  expect(p.creation.selectedGroup).toBeNull()
})

it('does not make a cached group wait for background revalidation before sending', async () => {
  const p = await fixture()
  await p.selectCreationGroup('images'); await p.selectCreationGroup('video')
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000)
  const read = deferred<any>(); vi.mocked(p.api).mockReturnValueOnce(read.promise)
  let ready = false
  await p.selectCreationGroup('images')
  void p.waitCreationGroup().then(() => { ready = true })
  await Promise.resolve()
  expect(ready).toBe(true)
  expect(p.creation.modelTokenId).toBe(42)
  read.resolve(p.catalogue('images'))
  await p.loadCreationModels(true)
})

it('uses low-priority preloading and upgrades an unprepared group only on entry', async () => {
  const p = await fixture(), read = deferred<any>()
  vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const preload = p.preloadCreationModels()
  await Promise.resolve()
  expect(p.api).toHaveBeenCalledWith('/api/creation/models', expect.objectContaining({ priority: 'low', body: { group: 'auto', preload: true } }))
  expect(p.creation.modelsLoading).toBe(false)
  const entered = p.loadCreationModels()
  read.resolve({ prepared: false, items: [] })
  await Promise.all([preload, entered])
  expect(p.api).toHaveBeenCalledTimes(2)
  expect(p.api).toHaveBeenLastCalledWith('/api/creation/models', expect.objectContaining({ body: { group: 'auto' } }))
  expect(p.creation.modelTokenId).toBe(41)
})

it('does not restore an invalidated catalogue from an older pending response', async () => {
  const p = await fixture(), read = deferred<any>()
  vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const old = p.selectCreationGroup('images')
  p.invalidateCreationModels()
  read.resolve(p.catalogue('images')); await old
  expect(p.creation.modelTokenId).toBeNull()
  await p.loadCreationModels()
  expect(p.api).toHaveBeenCalledTimes(2)
  expect(p.creation.modelTokenId).toBe(42)
})

it('keeps a refreshed catalogue when an invalidated older request is rejected later', async () => {
  const p = await fixture(), read = deferred<any>()
  vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const older = p.selectCreationGroup('images')
  p.invalidateCreationModels('images')
  await p.loadCreationModels()
  read.reject(Object.assign(new Error('old permission rejected'), { status: 403 })); await older
  await p.selectCreationGroup('video')
  vi.mocked(p.api).mockClear()
  await p.selectCreationGroup('images')
  expect(p.api).not.toHaveBeenCalled()
  expect(p.creation.modelTokenId).toBe(42)
})

it.each(['JSON', 'SSE'])('marks a %s group-key rejection as an ordinary failure without polling a nonexistent task', async format => {
  const p = await fixture(); await p.selectCreationGroup('images')
  const error = { code: 'NEW_API_GROUP_TOKEN_UNAVAILABLE', message: 'Group key changed' }
  const response = format === 'JSON' ? Response.json({ error, notAccepted: true }, { status: 409 })
    : new Response(`data: ${JSON.stringify({ type: 'error', error: error.message, code: error.code, notAccepted: true })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch)
  const task = await p.submitCreation({ kind: 'image', model: 'images-model', prompt: 'test', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 })
  expect(task.phase).toBe('error')
  expect(task.error).toBe(error.message)
  expect(p.creation.modelTokenId).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]![1].headers['X-New-Api-Group']).toBe('images')
})

it('invalidating a failed previous group does not interrupt preparation of the currently selected group', async () => {
  const p = await fixture(); await p.selectCreationGroup('images')
  const read = deferred<any>(); vi.mocked(p.api).mockReturnValueOnce(read.promise)
  const selected = p.selectCreationGroup('video')
  p.invalidateCreationModels('images')
  read.resolve(p.catalogue('video')); await selected
  expect(p.creation.modelTokenId).toBe(43)
  expect(p.creation.modelsLoading || p.creation.groupSwitching).toBe(false)
})
