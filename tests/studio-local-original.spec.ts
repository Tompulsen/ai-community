import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, count = 2) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const downloads: string[] = []
  let expired = false, mediaReads = 0, generations = 0
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/media') {
      mediaReads++
      return expired
        ? route.fulfill({ status: 502, contentType: 'text/html', body: '<!doctype html><title>Expired media</title>' })
        : route.fulfill({ contentType: 'image/jpeg', body: image })
    }
    if (path === '/api/creation/generate') generations++
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(count => {
    if (!location.pathname.startsWith('/create/') || sessionStorage.getItem('local-original-fixture')) return
    sessionStorage.setItem('local-original-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'local-original', conversationId: 'local-session', owner: '17', kind: 'image', model: 'gpt-image-2',
      prompt: '保存在本地的图片', createdAt: now, settledAt: now, phase: 'complete', protocol: 'sync',
      urls: Array.from({ length: count }, (_, index) => `https://media.example/original-${index + 1}.jpg`),
      text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: count, duration: 8 },
    }]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'local-session', sessions: [{
        id: 'local-session', topic: '本地原图读取', composerKind: 'image', model: 'gpt-image-2',
        settings: {}, skillIds: [], search: 'off', messages: [], lastUpdate: now,
      }],
    } }))
  }, count)
  await page.goto('/create/image')
  await expect(page.locator('.creation-image-preview img')).toHaveCount(count)
  await expect.poll(() => page.locator('.creation-image-preview img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  return { downloads, expire: () => { expired = true }, mediaReads: () => mediaReads, generations: () => generations }
}

async function storedOriginals(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = (await store.readTaskSnapshot('17'))!.find(task => task.id === 'local-original')!
    const blobs = await Promise.all(task.urls.map(url => store.readTaskAsset('17', url)))
    return { urls: task.urls, sizes: blobs.map(blob => blob?.size || 0) }
  })
}

test('saved image originals render after remote links expire without repeating downloads or generation', async ({ page }) => {
  const state = await fixture(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    await studio.initializeCreation()
    await studio.saveCreationLocally(studio.creation.tasks.find(task => task.id === 'local-original')!)
  })
  await expect.poll(() => state.downloads.length).toBe(2)
  const stored = await storedOriginals(page)
  expect(stored.urls).toEqual(['studio-asset:local-original:0', 'studio-asset:local-original:1'])
  expect(stored.sizes.every(size => size > 0)).toBe(true)
  state.expire()
  const reads = state.mediaReads()
  await page.reload()
  await expect(page.locator('.creation-image-preview img')).toHaveCount(2)
  await expect.poll(() => page.locator('.creation-image-preview img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await expect(page.getByRole('button', { name: '重新加载图片', exact: true })).toHaveCount(0)
  expect(state.mediaReads()).toBe(reads)
  expect(state.downloads).toHaveLength(2)
  expect(state.generations()).toBe(0)
})

test('manual gallery downloads adopt local originals and stale or foreign cache writes are ignored', async ({ page }) => {
  const state = await fixture(page, 1)
  await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    await studio.initializeCreation()
    const snapshot = (await store.getTaskPage('17')).tasks.find(task => task.id === 'local-original')!
    await studio.downloadCreation(snapshot, 0)
  })
  await expect.poll(() => state.downloads.length).toBe(1)
  expect(await storedOriginals(page)).toMatchObject({ urls: ['studio-asset:local-original:0'] })
  const guarded = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    const tasks = (await store.readTaskSnapshot('17'))!
    const task = tasks.find(task => task.id === 'local-original')!
    const blob = (await store.readTaskAsset('17', task.urls[0]!))!
    const deleted = { ...task, id: 'deleted-original', urls: ['https://media.example/deleted.jpg'] }
    await store.saveTaskSnapshot('17', [...tasks, deleted])
    await store.saveTaskSnapshot('17', tasks)
    const missing = await store.saveTaskOriginal('17', 'missing-original', 0, 'https://media.example/missing.jpg', blob)
    const removed = await store.saveTaskOriginal('17', deleted.id, 0, deleted.urls[0]!, blob)
    const mismatched = await store.saveTaskOriginal('17', task.id, 0, 'https://media.example/changed.jpg', blob)
    const foreign = await store.saveTaskOriginal('18', task.id, 0, task.urls[0]!, blob)
    await studio.downloadCreation(deleted)
    const removedInMemory = !studio.creation.tasks.some(task => task.id === deleted.id)
    await studio.prepareCreationHistory()
    const removedOnDisk = !(await store.readTaskSnapshot('17'))!.some(task => task.id === deleted.id)
    return {
      ignored: [missing, removed, mismatched, foreign].every(value => value === undefined),
      removedInMemory, removedOnDisk,
      missingBlob: !await store.readTaskAsset('17', store.taskAssetUrl('missing-original', 0)),
      deletedBlob: !await store.readTaskAsset('17', store.taskAssetUrl(deleted.id, 0)),
      foreignBlob: !await store.readTaskAsset('18', task.urls[0]!),
      retainedBytes: (await store.readTaskAsset('17', task.urls[0]!))?.size,
    }
  })
  expect(guarded).toMatchObject({ ignored: true, removedInMemory: true, removedOnDisk: true, missingBlob: true, deletedBlob: true, foreignBlob: true })
  expect(guarded.retainedBytes).toBeGreaterThan(0)
  await expect.poll(() => state.downloads.length).toBe(2)
  state.expire()
  const reads = state.mediaReads()
  await page.reload()
  await expect.poll(() => page.locator('.creation-image-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
  expect(state.mediaReads()).toBe(reads)
  expect(state.downloads).toHaveLength(2)
  expect(state.generations()).toBe(0)
})
