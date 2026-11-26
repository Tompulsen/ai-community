import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
const originalImage = await sharp({ create: { width: 96, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()

async function fixture(page: Page) {
  await page.route('**/__media-actions', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><main></main></body></html>' }))
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  await page.goto('/__media-actions')
  await page.evaluate(async () => {
    const { session } = await import('/src/state.ts')
    session.user = { id: '17', username: 'fixture' }
    const studio = await import('/src/native-studio.ts')
    await studio.initializeCreation()
    window.mediaTest = studio
  })
}

for (const action of ['delete', 'switch', 'disable']) test(`automatic browser saving respects ${action} before a pending automatic download`, async ({ page }) => {
  await fixture(page)
  let entered = false, release!: () => void, downloads = 0
  const blocked = new Promise<void>(resolve => { release = resolve })
  page.on('download', () => downloads++)
  await page.route('**/api/creation/generate', route => route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/held.png' }] } }))
  await page.route('**/api/creation/media**', async route => {
    entered = true; await blocked
    await route.fulfill({ contentType: 'image/png', body: originalImage }).catch(() => {})
  })
  await page.evaluate(async () => {
    const studio = window.mediaTest
    await studio.updateMediaSettings(true)
    const task = await studio.submitCreation({ kind: 'image', model: 'test', prompt: 'held result', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 })
    window.pendingBrowserSave = studio.cacheCreationImages(task)
  })
  await expect.poll(() => entered).toBe(true)
  await page.evaluate(async action => {
    const studio = window.mediaTest
    if (action === 'delete') await studio.removeCreationTasks([studio.creation.tasks[0].id])
    if (action === 'disable') await studio.updateMediaSettings(false)
    if (action === 'switch') {
      const { session } = await import('/src/state.ts')
      session.user = { id: '18' }
      await (await import('/node_modules/.vite/deps/vue.js')).nextTick()
      await studio.initializeCreation()
    }
  }, action)
  release()
  await page.evaluate(() => window.pendingBrowserSave)
  expect(downloads).toBe(0)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    return { count: window.mediaTest.creation.tasks.length, own: (await store.getTaskPage('17')).total,
      foreign: (await store.getTaskPage('18')).total, bytes: await store.getTaskStorageSize('18') }
  })
  expect(result).toEqual({ count: action === 'disable' ? 1 : 0, own: action === 'delete' ? 0 : 1, foreign: 0, bytes: 0 })
})

test('concurrent automatic caching and download preserve every local image pointer', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'image/png', body: originalImage }))
  const downloaded = page.waitForEvent('download')
  await page.evaluate(async () => {
    const studio = window.mediaTest
    const task = { id: 'concurrent', owner: '17', kind: 'image', model: 'test', prompt: 'two images', phase: 'complete', protocol: 'sync', createdAt: 1,
      urls: ['https://media.example/0.png', 'https://media.example/1.png'], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 2, duration: 8 } }
    studio.creation.tasks.push(task)
    await studio.prepareCreationHistory()
    await Promise.all([studio.cacheCreationImages(task), studio.downloadCreation(task, 1, undefined, undefined, 'jpeg'), studio.cacheCreationImages(task)])
  })
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/\.jpg$/)
  const saved = await readFile((await file.path())!)
  expect((await sharp(saved).metadata()).format).toBe('jpeg')
  expect((await sharp(saved).metadata()).width).toBe(96)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts'), tasks = await store.readTaskSnapshot('17')
    return { urls: tasks[0].urls, originals: await Promise.all(tasks[0].urls.map(async url => Array.from(new Uint8Array(await (await store.readTaskAsset('17', url)).arrayBuffer())))) }
  })
  expect(result).toEqual({ urls: ['studio-asset:concurrent:0', 'studio-asset:concurrent:1'], originals: [Array.from(originalImage), Array.from(originalImage)] })
})

test('browser-save reads are bounded and invalid or oversized originals never replace their source', async ({ page }) => {
  await fixture(page)
  let active = 0, maximum = 0, reads = 0
  await page.route('**/api/creation/media**', async route => {
    active++; reads++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 80))
    const source = new URL(route.request().url()).searchParams.get('url') || ''
    await route.fulfill({ contentType: source.endsWith('4.png') ? 'text/html' : 'image/png', body: Buffer.from('original'),
      headers: source.endsWith('5.png') ? { 'content-length': String(33 * 1024 ** 2) } : {} })
    active--
  })
  const result = await page.evaluate(async () => {
    const studio = window.mediaTest
    for (let i = 0; i < 6; i++) studio.creation.tasks.push({ id: `bounded-${i}`, owner: '17', kind: 'image', model: 'test', prompt: 'bounded', phase: 'complete', protocol: 'sync', createdAt: i,
      urls: [`https://media.example/${i}.png`], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } })
    await Promise.all(studio.creation.tasks.map(task => studio.cacheCreationImages(task)))
    return studio.creation.tasks.map(task => ({ state: task.browserSave.state, local: task.urls[0].startsWith('studio-asset:'), phase: task.phase }))
  })
  expect(maximum).toBe(2)
  expect(reads).toBe(6)
  expect(result).toEqual([...Array(4).fill({ state: 'saved', local: true, phase: 'complete' }), ...Array(2).fill({ state: 'failed', local: false, phase: 'complete' })])
})

test('a visible history record created in another tab is loaded safely and saved without reviving deleted records', async ({ page }) => {
  await fixture(page)
  const other = await page.context().newPage()
  await fixture(other)
  const task = await other.evaluate(async () => {
    const studio = window.mediaTest
    const task = { id: 'other-tab', owner: '17', kind: 'image', model: 'test', prompt: 'other tab result', phase: 'complete', protocol: 'sync', createdAt: 1,
      urls: ['https://media.example/other.png'], text: '', references: [], browserSave: { state: 'saving' }, request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } }
    studio.creation.tasks.push(task)
    await studio.prepareCreationHistory()
    return task
  })
  await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'image/png', body: originalImage }))
  await page.evaluate(task => window.mediaTest.cacheCreationImages(task), task)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks[0].browserSave.state)).toBe('saved')
  await other.evaluate(() => window.mediaTest.removeCreationTasks(['other-tab']))
  await page.evaluate(async task => {
    const studio = window.mediaTest
    studio.creation.tasks = []
    await studio.cacheCreationImages(task, true)
    await studio.prepareCreationHistory()
  }, task)
  expect(await page.evaluate(async () => (await (await import('/src/studio-task-store.ts')).getTaskPage('17')).total)).toBe(0)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks.length)).toBe(0)
  await other.close()
})

test('video @ references support keyboard selection, removal numbering and IME without submitting', async ({ page }) => {
  await fixture(page)
  await page.evaluate(async () => {
    const { createApp, h, reactive } = await import('/node_modules/.vite/deps/vue.js')
    const { default: Prompt } = await import('/src/components/StudioVideoPrompt.vue')
    const state = reactive({ prompt: '', references: [{ name: 'first.png', url: '/first.png' }, { name: 'second.png', url: '/second.png' }], submitted: 0 })
    window.promptTest = state
    createApp({ render: () => h(Prompt, { modelValue: state.prompt, references: state.references, 'onUpdate:modelValue': value => state.prompt = value, onSubmit: () => state.submitted++ }) }).mount('main')
  })
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('@')
  await expect(page.getByRole('listbox', { name: '选择参考图' })).toBeVisible()
  await prompt.press('ArrowDown')
  await prompt.press('Enter')
  await expect(prompt).toHaveValue('@图片2 ')
  expect(await page.evaluate(() => window.promptTest.submitted)).toBe(0)
  await prompt.fill('@')
  await prompt.dispatchEvent('compositionstart')
  await prompt.press('Enter')
  expect(await page.evaluate(() => window.promptTest.submitted)).toBe(0)
  await prompt.dispatchEvent('compositionend')
  await prompt.press('Escape')
  await page.waitForTimeout(220)
  await prompt.press('Enter')
  expect(await page.evaluate(() => window.promptTest.submitted)).toBe(1)
  await prompt.fill('@')
  await page.getByRole('option').nth(0).click()
  await expect(prompt).toHaveValue('@图片1 ')
  await page.setViewportSize({ width: 390, height: 844 })
  await prompt.fill('@')
  const bounds = await page.getByRole('listbox').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
})

test('download retry reads only unfinished originals and never submits generation; reload does not download again', async ({ page }) => {
  await fixture(page)
  let reads = 0
  await page.route('**/api/creation/media**', route => {
    reads++
    if (new URL(route.request().url()).searchParams.get('url')?.includes('second') && reads < 3) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: 'image/png', body: originalImage })
  })
  const requests: string[] = [], downloaded: string[] = [], downloadedBytes: Promise<Buffer>[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('download', download => {
    downloaded.push(download.suggestedFilename())
    downloadedBytes.push(download.path().then(path => readFile(path!)))
  })
  const result = await page.evaluate(async () => {
    const studio = window.mediaTest
    const task = { id: 'download-case', owner: '17', kind: 'image', model: 'test', prompt: 'two originals', phase: 'complete', protocol: 'sync', createdAt: Date.now(), urls: ['https://media.example/first.png', 'https://media.example/second.png'], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 2, duration: 8 } }
    studio.creation.tasks.push(task)
    try { await studio.saveCreationLocally(task) } catch {}
    const failed = { ...studio.creation.tasks[0].localSave }
    await studio.saveCreationLocally(studio.creation.tasks[0])
    return { failed, done: studio.creation.tasks[0].localSave }
  })
  expect(result.failed).toMatchObject({ state: 'failed', completed: 1 })
  expect(result.done).toMatchObject({ state: 'downloadRequested', completed: 2 })
  await expect.poll(() => downloaded.length).toBe(2)
  expect(await Promise.all(downloadedBytes)).toEqual([originalImage, originalImage])
  expect(downloaded.every(name => name.endsWith('.png'))).toBe(true)
  expect(reads).toBe(3)
  expect(requests.filter(url => url.includes('/generate'))).toHaveLength(0)
  await page.reload()
  await page.evaluate(async () => {
    const { session } = await import('/src/state.ts')
    session.user = { id: '17' }
    const studio = await import('/src/native-studio.ts')
    await studio.initializeCreation()
    if (studio.creation.tasks[0].localSave.state !== 'downloadRequested') throw new Error('download state was not restored')
  })
  expect(reads).toBe(3)
  expect(downloaded).toHaveLength(2)
})

test('switching account aborts an outstanding original download without a late file', async ({ page }) => {
  await fixture(page)
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/creation/media**', async route => {
    requested = true
    await blocked
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('original') }).catch(() => {})
  })
  let downloaded = 0
  page.on('download', () => downloaded++)
  await page.evaluate(() => {
    const studio = window.mediaTest
    const task = { id: 'switch', owner: '17', kind: 'image', model: 'test', prompt: 'switch account', phase: 'complete', protocol: 'sync', createdAt: Date.now(), urls: ['https://media.example/late.png'], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } }
    studio.creation.tasks.push(task)
    window.pendingDownload = studio.saveCreationLocally(task).catch(() => {})
  })
  await expect.poll(() => requested).toBe(true)
  await page.evaluate(async () => {
    const { session } = await import('/src/state.ts')
    session.user = { id: '18' }
    await window.pendingDownload
  })
  release()
  expect(downloaded).toBe(0)
})

test('new accounts generate without downloading and can still download manually', async ({ page }) => {
  await fixture(page)
  let downloads = 0
  page.on('download', () => downloads++)
  await page.route('**/api/creation/generate', route => route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/manual.png' }] } }))
  await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'image/png', body: originalImage }))
  await page.evaluate(async () => {
    await window.mediaTest.submitCreation({ kind: 'image', model: 'fixture', prompt: 'manual download', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 })
  })
  expect(await page.evaluate(() => window.mediaTest.mediaSettings.autoDownload)).toBe(false)
  expect(await page.evaluate(() => window.mediaTest.mediaSettings.autoSaveGallery)).toBe(true)
  await page.waitForTimeout(300)
  expect(downloads).toBe(0)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks[0].localSave)).toBeUndefined()
  const downloaded = page.waitForEvent('download')
  await page.evaluate(() => window.mediaTest.downloadCreation(window.mediaTest.creation.tasks[0], 0, undefined, undefined, 'jpeg'))
  expect((await downloaded).suggestedFilename()).toMatch(/^creation-.*-1\.jpg$/)
  expect(downloads).toBe(1)
})

test('generations always cache originals while file downloads remain opt-in', async ({ page }) => {
  await fixture(page)
  let generations = 0, originals = 0, downloads = 0
  await page.route('**/api/creation/generate', route => {
    generations++
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/automatic.png' }] } })
  })
  await page.route('**/api/creation/media**', route => { originals++; return route.fulfill({ contentType: 'image/png', body: originalImage }) })
  page.on('download', () => downloads++)
  await page.evaluate(async () => {
    const studio = window.mediaTest
    await studio.updateMediaSettings(true)
    const input = { kind: 'image', model: 'fixture', prompt: 'automatic download', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 }
    await studio.submitCreation(input)
  })
  await expect.poll(() => downloads).toBe(1)
  await expect.poll(() => page.evaluate(() => window.mediaTest.creation.tasks[0].localSave.state)).toBe('downloadRequested')
  await page.evaluate(async () => {
    const studio = window.mediaTest
    await studio.updateMediaSettings(false)
    await studio.submitCreation({ kind: 'image', model: 'fixture', prompt: 'do not download', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 })
  })
  expect(generations).toBe(2)
  await expect.poll(() => originals).toBe(2)
  expect(downloads).toBe(1)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks[0].localSave)).toBeUndefined()
})

test('deleting a result cancels an in-flight download without restoring the deleted record', async ({ page }) => {
  await fixture(page)
  let requested = false, release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media**', async route => {
    requested = true; await blocked
    await route.fulfill({ contentType: 'image/png', body: originalImage }).catch(() => {})
  })
  let downloads = 0
  page.on('download', () => downloads++)
  await page.evaluate(() => {
    const studio = window.mediaTest
    const task = { id: 'delete-download', owner: '17', kind: 'image', model: 'fixture', prompt: 'delete this', phase: 'complete', protocol: 'sync', createdAt: Date.now(), urls: ['https://media.example/delete.png'], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } }
    studio.creation.tasks.push(task)
    window.pendingDownload = studio.saveCreationLocally(task).catch(() => {})
  })
  await expect.poll(() => requested).toBe(true)
  await page.evaluate(async () => { await window.mediaTest.removeCreationTasks(['delete-download']); await window.pendingDownload })
  release()
  expect(downloads).toBe(0)
  expect(await page.evaluate(async () => { const store = await import('/src/studio-task-store.ts'); return (await store.readTaskSnapshot('17'))?.length })).toBe(0)
})

test('recovering a fallback merges existing database records and preserves the old migration source', async ({ page }) => {
  await fixture(page)
  await page.evaluate(async () => {
    const studio = window.mediaTest
    const task = { id: 'fallback-record', owner: '17', kind: 'image', model: 'fixture', prompt: 'first', phase: 'complete', protocol: 'sync', createdAt: Date.now(), urls: ['https://media.example/original.png'], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } }
    studio.creation.tasks.push(task, { ...task, id: 'newer-database-record', prompt: 'keep this database-only record' })
    await studio.prepareCreationHistory()
    localStorage.setItem('octopus:user-17:native-creation-history:v2-fallback', JSON.stringify([{ ...task, prompt: 'fallback edit' }]))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', 'migration-backup')
  })
  await page.reload()
  const result = await page.evaluate(async () => {
    const { session } = await import('/src/state.ts')
    session.user = { id: '17' }
    const studio = await import('/src/native-studio.ts')
    await studio.initializeCreation()
    return { prompts: studio.creation.tasks.map(task => task.prompt).sort(), legacy: localStorage.getItem('octopus:user-17:native-creation-history:fallback'), fallback: localStorage.getItem('octopus:user-17:native-creation-history:v2-fallback') }
  })
  expect(result.prompts).toEqual(['fallback edit', 'keep this database-only record'])
  expect(result.legacy).toBe('migration-backup')
  expect(result.fallback).toBeNull()
})

test('video workspace reference menu keeps numbered mentions correct after removing an uploaded image', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  let uploaded = 0, generations = 0
  await page.route('**/api/uploads**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { imagesMb: 20, filesMb: 20, videosMb: 100 } })
    uploaded++
    return route.fulfill({ json: { file: { id: `ref-${uploaded}`, name: `image-${uploaded}.jpg`, url: `/legacy-files/ref-${uploaded}`, type: 'image', size: image.length } } })
  })
  await page.route('**/legacy-files/**', route => route.fulfill({ contentType: 'image/jpeg', body: image }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'sora-2', kinds: ['video'] }] } })
    if (path.endsWith('/generate')) generations++
    return route.fulfill({ json: {} })
  })
  await page.goto('/create/video')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('sora-2')
  await page.locator('.studio-composer input[type=file]').first().setInputFiles([{ name: 'first.jpg', mimeType: 'image/jpeg', buffer: image }, { name: 'second.jpg', mimeType: 'image/jpeg', buffer: image }])
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('从 @')
  await page.getByRole('option').nth(1).click()
  await expect(prompt).toHaveValue('从 @图片2 ')
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await expect(prompt).toHaveValue('从 @图片1 ')
  await prompt.fill('从 @')
  await expect(page.getByRole('listbox', { name: '选择参考图' })).toBeVisible()
  expect((await new AxeBuilder({ page }).include('.prompt-field').include('.video-reference-menu').analyze()).violations).toEqual([])
  await mkdir('.taste-skill/media-library-20261115', { recursive: true })
  await page.screenshot({ path: '.taste-skill/media-library-20261115/video-reference-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.taste-skill/media-library-20261115/video-reference-mobile.png' })
  await prompt.press('Escape')
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  expect(generations).toBe(0)
})
