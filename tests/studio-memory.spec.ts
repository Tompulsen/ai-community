import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const turns = 48, originalSize = 1024 ** 2

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(() => {
    const live = new Map<string, number>(), create = URL.createObjectURL, revoke = URL.revokeObjectURL
    ;(window as any).__memoryURLs = live
    URL.createObjectURL = function (value) { const url = create.call(this, value); live.set(url, value instanceof Blob ? value.size : 0); return url }
    URL.revokeObjectURL = function (url) { live.delete(url); return revoke.call(this, url) }
  })
  await page.route('**/__memory-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Memory fixture</title>' }))
  await page.goto('/__memory-fixture')
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  await page.evaluate(async ({ turns, originalSize, image }) => {
    const store = await import('/src/studio-task-store.ts')
    const now = Date.now(), tasks = Array.from({ length: turns * 2 }, (_, index) => ({
      id: `memory-${index}`, conversationId: index < turns ? 'memory-a' : 'memory-b', owner: '17', kind: 'image', model: 'gpt-image-2',
      prompt: `Memory original ${index}`, createdAt: now + index, settledAt: now + index, phase: 'complete', protocol: 'sync',
      urls: [`https://memory.example/${index}.jpg`], text: '', references: [{ url: `studio-asset:memory-${index}:0`, name: `Reference ${index}`, type: 'image/jpeg' }], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    }))
    await store.saveTaskSnapshot('17', tasks)
    const bytes = Uint8Array.from(atob(image), character => character.charCodeAt(0))
    for (const [index, task] of tasks.entries()) {
      const padding = new Uint8Array(originalSize - bytes.length)
      new DataView(padding.buffer).setUint32(padding.length - 4, index)
      await store.saveTaskOriginal('17', task.id, 0, task.urls[0]!, new Blob([bytes, padding], { type: 'image/jpeg' }))
    }
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'memory-a', sessions: ['memory-a', 'memory-b'].map((id, index) => ({
        id, topic: `Memory history ${index + 1}`, composerKind: 'image', model: 'gpt-image-2', settings: {}, skillIds: [], search: 'off', messages: [], lastUpdate: now - index,
      })),
    } }))
  }, { turns, originalSize, image: image.toString('base64') })
  await page.goto('/create/image')
  await expect(page.locator('.creation-response .creation-image')).toHaveCount(turns)
  await expect.poll(() => page.locator('.creation-image-preview img').last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.sent-references img').last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}

async function memory(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters')
  await cdp.detach()
  const retained = await page.evaluate(() => ({
    urls: (window as any).__memoryURLs.size,
    bytes: [...(window as any).__memoryURLs.values()].reduce((sum: number, size: any) => sum + size, 0),
    menus: document.querySelectorAll('.message-context-menu').length,
  }))
  return { ...retained, heap: heap.usedSize, nodes: dom.nodes }
}

test('local image histories retain only visible originals across scrolling, previews and conversations', async ({ page }) => {
  test.setTimeout(90_000)
  await fixture(page)
  const first = await memory(page)
  await page.screenshot({ path: test.info().outputPath('history-memory.png') })
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Memory history 2', exact: true }).click()
  await expect.poll(() => page.locator('.creation-image-preview img').last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const second = await memory(page)
  console.log(JSON.stringify({ imageMemory: { originals: turns * 2, originalSize, first, second } }))
  expect(first.bytes).toBeLessThan(12 * originalSize)
  expect(second.bytes).toBeLessThan(12 * originalSize)
  for (let cycle = 0; cycle < 3; cycle++) {
    const firstImage = page.locator('.creation-response .creation-image').first()
    await firstImage.scrollIntoViewIfNeeded()
    await expect.poll(() => firstImage.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await firstImage.locator('img').click()
    const dialog = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.locator('.lightbox-stage img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.locator('.studio-sidebar').getByRole('button', { name: `Memory history ${cycle % 2 ? 2 : 1}`, exact: true }).click()
    await expect.poll(() => page.locator('.creation-image-preview img').last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
  const after = await memory(page)
  console.log(JSON.stringify({ imageMemoryAfterCycles: after }))
  expect(after.bytes).toBeLessThan(12 * originalSize)
  await page.reload()
  await expect(page.locator('.creation-response .creation-image')).toHaveCount(turns)
  await expect.poll(() => page.locator('.creation-image-preview img').last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const stored = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const tasks = (await store.readTaskSnapshot('17'))!
    return { count: tasks.length, first: (await store.readTaskAsset('17', tasks[0]!.urls[0]!))!.size, foreign: !!await store.readTaskAsset('18', tasks[0]!.urls[0]!) }
  })
  expect(stored).toEqual({ count: turns * 2, first: originalSize, foreign: false })
})

test('history context menus mount only while open and release on dismissal', async ({ page }) => {
  await fixture(page)
  expect(await page.locator('.message-context-menu').count()).toBe(0)
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('.creation-response').last().click({ button: 'right' })
    await expect(page.getByRole('menu', { name: '消息操作', exact: true })).toBeVisible()
    await expect(page.locator('.message-context-menu')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.message-context-menu')).toHaveCount(0)
  }
  await page.locator('.creation-response').last().click({ button: 'right' })
  await page.locator('.studio-sidebar').click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.message-context-menu')).toHaveCount(0)
})

test('local and legacy original reads avoid permanent URLs and keep cached bytes account-scoped', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/works/precheck', route => route.fulfill({ json: { state: 'passed' } }))
  const result = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    const original = await studio.readCreationImage('studio-asset:memory-0:0')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('octopus-gallery-user-17', 1)
      request.onupgradeneeded = () => { request.result.createObjectStore('images'); request.result.createObjectStore('originals') }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['images', 'originals'], 'readwrite')
      transaction.objectStore('images').put({ imageData: '' }, 'memory-legacy')
      transaction.objectStore('originals').put(original, 'memory-legacy')
      transaction.objectStore('images').put({ imageData: '' }, 'memory-large')
      transaction.objectStore('originals').put(new Blob([original, new Uint8Array(32 * 1024 ** 2)], { type: original.type }), 'memory-large')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    const before = (window as any).__memoryURLs.size
    const legacy = await studio.readCreationImage('legacy-gallery:memory-legacy')
    const large = await studio.readCreationImage('legacy-gallery:memory-large')
    const moderation = await studio.moderateCreation({ ...studio.creation.tasks[0]!, id: 'memory-large', urls: ['legacy-gallery:memory-large'] })
    const portable = await studio.portableImage('studio-asset:memory-0:0')
    const after = (window as any).__memoryURLs.size
    const state = await import('/src/state.ts')
    state.session.user = { ...state.session.user!, id: '18' }
    await new Promise(resolve => setTimeout(resolve, 0))
    let foreign = false
    try { await studio.readCreationImage('studio-asset:memory-0:0'); foreign = true } catch { /* No originals belong to this account. */ }
    return { size: legacy.size, largeSize: large.size, moderation: moderation.state, portable: portable.startsWith('data:image/jpeg;base64,'), before, after, foreign }
  })
  expect(result.size).toBe(originalSize)
  expect(result.largeSize).toBe(33 * originalSize)
  expect(result.moderation).toBe('passed')
  expect(result.portable).toBe(true)
  expect(result.after).toBeLessThanOrEqual(result.before)
  expect(result.foreign).toBe(false)
})
