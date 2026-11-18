import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'

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
    if (new URL(route.request().url()).searchParams.get('url')?.includes('second') && reads < 3) return route.fulfill({ status: 503 })
    return route.fulfill({ contentType: 'image/png', body: Buffer.from('original-image') })
  })
  const requests: string[] = [], downloaded: string[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('download', download => downloaded.push(download.suggestedFilename()))
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
  await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('original bytes') }))
  await page.evaluate(async () => {
    await window.mediaTest.submitCreation({ kind: 'image', model: 'fixture', prompt: 'manual download', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 })
  })
  expect(await page.evaluate(() => window.mediaTest.mediaSettings.autoDownload)).toBe(false)
  expect(await page.evaluate(() => window.mediaTest.mediaSettings.autoSaveGallery)).toBe(true)
  await page.waitForTimeout(300)
  expect(downloads).toBe(0)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks[0].localSave)).toBeUndefined()
  const downloaded = page.waitForEvent('download')
  await page.evaluate(() => window.mediaTest.downloadCreation(window.mediaTest.creation.tasks[0]))
  expect((await downloaded).suggestedFilename()).toMatch(/^creation-.*-1\.png$/)
  expect(downloads).toBe(1)
})

test('completed generations automatically request originals only while the preference is enabled', async ({ page }) => {
  await fixture(page)
  let generations = 0, originals = 0, downloads = 0
  await page.route('**/api/creation/generate', route => {
    generations++
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/automatic.png' }] } })
  })
  await page.route('**/api/creation/media**', route => { originals++; return route.fulfill({ contentType: 'image/png', body: Buffer.from('original bytes') }) })
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
  expect(originals).toBe(1)
  expect(downloads).toBe(1)
  expect(await page.evaluate(() => window.mediaTest.creation.tasks[0].localSave)).toBeUndefined()
})

test('deleting a result cancels an in-flight download without restoring the deleted record', async ({ page }) => {
  await fixture(page)
  let requested = false, release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media**', async route => {
    requested = true; await blocked
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('original bytes') }).catch(() => {})
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
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles([{ name: 'first.jpg', mimeType: 'image/jpeg', buffer: image }, { name: 'second.jpg', mimeType: 'image/jpeg', buffer: image }])
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
