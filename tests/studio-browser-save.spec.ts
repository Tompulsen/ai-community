import { confirmImageDownload } from './helpers/image-download'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'

async function fixture(page: Page) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(String(test.info().project.use.baseURL)).hostname)) {
    const runtime = await readFile('server/runtime.ts', 'utf8')
    const policy = runtime.match(/'Content-Security-Policy': "([^"]+)"/)![1]!
    await page.route('**/create/image', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
    })
  }
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const state = { available: true, generations: 0, originals: 0, downloads: 0, count: 1 }
  page.on('download', () => state.downloads++)
  await page.route('**/api/new-api/model-groups**', route => route.fulfill({ json: { success: true, data: {
    selectedGroup: 'auto', selectedTokenId: 41, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }],
  } } }))
  await page.route('**/api/creation/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (url.pathname === '/api/creation/media') {
      if (!url.searchParams.has('variant')) state.originals++
      return state.available ? route.fulfill({ contentType: 'image/jpeg', body: image }) : route.fulfill({ status: 502 })
    }
    if (url.pathname === '/api/creation/generate') {
      state.generations++
      return route.fulfill({ json: { status: 'succeeded', outputs: Array.from({ length: state.count }, (_, i) => ({ url: `https://media.example/${state.generations}-${i}.jpg` })), tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('browser-save-fixture')) return
    sessionStorage.setItem('browser-save-fixture', '1')
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: false }))
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  return { state, image }
}
async function send(page: Page) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('浏览器保存原图')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-response')).toHaveCount(1)
}
async function storedImages(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio-media', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction(['tasks', 'originals'])
      const getAll = (name: string) => new Promise<any[]>(resolve => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result)
      })
      const [tasks, originals] = await Promise.all([getAll('tasks'), getAll('originals')])
      return { urls: tasks.filter(t => t.owner === '17').flatMap(t => t.value.urls), sizes: originals.filter(a => a.owner === '17').map(a => a.blob.size) }
    } finally { db.close() }
  })
}

test('a recovered legacy request switches to its upstream task and saves the original after reload', async ({ page }) => {
  const { state, image } = await fixture(page)
  let requestId = '', recoveries = 0, taskReads = 0
  await page.route('**/api/creation/generate', route => {
    state.generations++
    requestId = route.request().postDataJSON().requestId
    return route.fulfill({ status: 202, json: { status: 'pending', requestId, outputs: [], protocol: 'async', tokenId: 41 } })
  })
  await page.route('**/api/creation/requests/**', route => {
    recoveries++
    return route.fulfill({ json: recoveries === 1
      ? { status: 'pending', requestId, outputs: [], protocol: 'async', tokenId: 41 }
      : { status: 'pending', upstreamId: 'legacy-image-task', outputs: [], protocol: 'async', tokenId: 41 } })
  })
  await page.route('**/api/creation/tasks/image/**', route => {
    taskReads++
    expect(new URL(route.request().url()).pathname).toBe('/api/creation/tasks/image/legacy-image-task')
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/legacy.jpg' }], protocol: 'async', tokenId: 41 } })
  })
  await send(page)
  await expect.poll(() => recoveries).toBe(1)
  await page.reload()
  await expect.poll(() => recoveries).toBe(2)
  await expect.poll(() => taskReads, { timeout: 10000 }).toBe(1)
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  expect((await storedImages(page)).sizes).toEqual([image.length])
  state.available = false
  const reads = state.originals
  await page.reload()
  await expect.poll(() => page.locator('.creation-image-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
  expect(state.originals).toBe(reads)
  expect(state.generations).toBe(1)
  expect(taskReads).toBe(1)
})

test('generated images save original bytes automatically and survive an expired upstream after reload without downloading', async ({ page }) => {
  const { state, image } = await fixture(page)
  state.count = 2
  const scriptChecks = await page.evaluate(async () => {
    const script = 'window.__unexpectedLocalMediaScript = true'
    const urls = [`data:text/javascript,${encodeURIComponent(script)}`, URL.createObjectURL(new Blob([script], { type: 'text/javascript' }))]
    try {
      return await Promise.all(urls.map(src => new Promise<string>(resolve => {
        const element = document.createElement('script')
        element.src = src
        element.onload = () => { element.remove(); resolve('loaded') }
        element.onerror = () => { element.remove(); resolve('blocked') }
        document.head.appendChild(element)
      })))
    } finally { URL.revokeObjectURL(urls[1]!) }
  })
  expect(scriptChecks).toEqual(['blocked', 'blocked'])
  expect(await page.evaluate(() => (window as any).__unexpectedLocalMediaScript)).toBeUndefined()
  await send(page)
  await expect.poll(async () => (await storedImages(page)).sizes).toEqual([image.length, image.length])
  expect((await storedImages(page)).urls.every(url => url.startsWith('studio-asset:'))).toBe(true)
  await expect(page.getByText('图片已保存到此浏览器', { exact: true })).toBeVisible()
  expect(state.downloads).toBe(0)
  state.available = false
  const reads = state.originals
  await page.reload()
  await expect(page.locator('.creation-image img')).toHaveCount(2)
  for (const img of await page.locator('.creation-image img').all()) await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0)
  expect(state.originals).toBe(reads)
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
  const download = page.waitForEvent('download', { timeout: 10000 })
  await page.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  const file = await download
  expect((await readFile((await file.path())!))).toEqual(image)
  await page.getByRole('button', { name: '编辑图片', exact: true }).click()
  const nextGeneration = page.waitForRequest('**/api/creation/generate')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  expect((await nextGeneration).postDataJSON().referenceUrls).toEqual([`data:image/jpeg;base64,${image.toString('base64')}`])
})

for (const mode of ['inline', 'stream', 'async']) test(`${mode} completion automatically stores the original image`, async ({ page }) => {
  const { image, state } = await fixture(page)
  const output = { status: 'succeeded', outputs: [{ url: mode === 'inline' ? `data:image/jpeg;base64,${image.toString('base64')}` : 'https://media.example/completed.jpg' }], tokenId: 41, protocol: mode === 'async' ? 'async' : 'sync' }
  await page.route('**/api/creation/generate', route => {
    state.generations++
    return mode === 'stream'
      ? route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'result', ...output })}\n\n` })
      : route.fulfill({ json: mode === 'async' ? { status: 'running', upstreamId: 'browser-task', protocol: 'async', tokenId: 41 } : output })
  })
  await page.route('**/api/creation/tasks/image/browser-task?**', route => route.fulfill({ json: output }))
  await send(page)
  await expect(page.getByText('图片已保存到此浏览器', { exact: true })).toBeVisible()
  expect((await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
})

test('an expired image keeps its record and supports retry without generating again', async ({ page }, info) => {
  const { state, image } = await fixture(page)
  state.available = false
  await send(page)
  const status = page.locator('.creation-response .browser-save')
  await expect(status).toContainText('原图暂时无法读取或链接已失效')
  expect((await storedImages(page)).urls).toEqual(['https://media.example/1-0.jpg'])
  expect((await storedImages(page)).sizes).toEqual([])
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await status.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await new AxeBuilder({ page }).include('.browser-save').analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`save-failed-${width}.png`) })
  }
  state.available = true
  await status.getByRole('button', { name: '重试保存图片', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('图片已保存到此浏览器')
  expect((await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
})

test('original network failures recover without regenerating or saving the preview', async ({ page }) => {
  const { state, image } = await fixture(page)
  const { default: sharp } = await import('sharp')
  const preview = await sharp(image).resize(40, 40).webp().toBuffer()
  let attempts = 0
  await page.route('**/api/creation/media?**', route => {
    if (new URL(route.request().url()).searchParams.has('variant')) return route.fulfill({ contentType: 'image/webp', body: preview })
    if (++attempts < 3) return route.abort('connectionreset')
    return route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  await send(page)
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器', { timeout: 10000 })
  expect(attempts).toBe(3)
  expect((await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
})

test('an interrupted original body retries and persistent network failure supports a fresh manual retry', async ({ page }) => {
  const { state, image } = await fixture(page)
  await page.evaluate(() => {
    const originalFetch = window.fetch
    ;(window as any).originalReads = 0
    ;(window as any).breakOriginalBody = true
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.href)
      if (url.pathname === '/api/creation/media' && !url.searchParams.has('variant')) {
        ;(window as any).originalReads++
        if ((window as any).breakOriginalBody) return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array([255, 216, 255])); },
          pull(controller) { controller.error(new TypeError('Failed to fetch')); },
        }), { headers: { 'Content-Type': 'image/jpeg' } })
      }
      return originalFetch(...args)
    }
  })
  await send(page)
  const status = page.locator('.browser-save')
  await expect(status).toContainText('原图传输中断', { timeout: 10000 })
  expect(await page.evaluate(() => (window as any).originalReads)).toBe(3)
  expect((await storedImages(page)).sizes).toEqual([])
  await page.evaluate(() => { (window as any).breakOriginalBody = false })
  await status.getByRole('button', { name: '重试保存图片', exact: true }).click()
  await expect(status).toHaveText('图片已保存到此浏览器')
  expect((await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
})

test('quota failure cannot commit a local pointer and retry can finish the same generation', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    ;(window as any).denyOriginalSave = true
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if ((window as any).denyOriginalSave && mode === 'readwrite' && Array.isArray(names) && names[1] === 'originals') throw new DOMException('Full', 'QuotaExceededError')
      return Reflect.apply(transaction, this, [names, mode, options])
    }
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('浏览器空间不足')
  expect((await storedImages(page)).urls[0]).toMatch(/^https:/)
  expect((await storedImages(page)).sizes).toEqual([])
  await page.evaluate(() => { (window as any).denyOriginalSave = false })
  await page.getByRole('button', { name: '重试保存图片', exact: true }).click()
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
})

for (const code of [401, 403, 404, 413]) test(`original HTTP ${code} does not retry or commit a local image`, async ({ page }) => {
  const { state, image } = await fixture(page)
  let attempts = 0
  await page.route('**/api/creation/media?**', route => {
    if (new URL(route.request().url()).searchParams.has('variant')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    attempts++
    return route.fulfill({ status: code })
  })
  await send(page)
  await expect(page.locator('.browser-save')).toHaveClass(/failed/)
  expect(attempts).toBe(1)
  expect((await storedImages(page)).sizes).toEqual([])
  expect(state.generations).toBe(1)
})

test('cancelling a save during retry stops further reads and keeps original bytes out of storage', async ({ page }) => {
  const { image } = await fixture(page)
  await page.evaluate(() => {
    const originalFetch = window.fetch
    ;(window as any).originalReads = 0
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.href)
      if (url.pathname === '/api/creation/media' && !url.searchParams.has('variant')) {
        ;(window as any).originalReads++
        throw new TypeError('Failed to fetch')
      }
      return originalFetch(...args)
    }
  })
  await send(page)
  await expect.poll(() => page.evaluate(() => (window as any).originalReads)).toBeGreaterThan(0)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/state\.ts(?:\?|$)/.test(name))!
    const { session } = await import(/* @vite-ignore */ path)
    session.user = null
  })
  const attempts = await page.evaluate(() => (window as any).originalReads)
  await page.waitForTimeout(1400)
  expect(await page.evaluate(() => (window as any).originalReads)).toBe(attempts)
  expect((await storedImages(page)).sizes).toEqual([])
  expect(image.length).toBeGreaterThan(0)
})

test('manual download corrects an earlier browser-save failure after the upstream recovers', async ({ page }) => {
  const { state } = await fixture(page)
  state.available = false
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('尚未保存到此浏览器')
  state.available = true
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  await download
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  expect(state.generations).toBe(1)
})

test('format selection survives the original moving into the browser cache', async ({ page }) => {
  const { state, image } = await fixture(page)
  await send(page)
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  state.available = false
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name))!
    const studio = await import(/* @vite-ignore */ path), task = studio.creation.tasks[0]
    const saved = task.urls[0]
    task.urls[0] = 'https://media.example/pending-cache.jpg'
    ;(window as any).finishCache = () => { task.urls[0] = saved }
    void studio.downloadCreation(task)
  })
  await expect(page.getByRole('dialog', { name: '选择图片下载格式', exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).finishCache())
  const pending = page.waitForEvent('download')
  await confirmImageDownload(page)
  expect(await readFile((await (await pending).path())!)).toEqual(image)
  expect(state.downloads).toBe(1)
})

test('an inline result remains downloadable when browser storage is full', async ({ page }) => {
  const { image, state } = await fixture(page)
  await page.route('**/api/creation/generate', route => {
    state.generations++
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: `data:image/jpeg;base64,${image.toString('base64')}` }], tokenId: 41, protocol: 'sync' } })
  })
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (mode === 'readwrite' && Array.isArray(names) && names.includes('originals')) throw new DOMException('Full', 'QuotaExceededError')
      return Reflect.apply(transaction, this, [names, mode, options])
    }
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('浏览器空间不足')
  const download = page.waitForEvent('download', { timeout: 10000 })
  await page.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  expect(await readFile((await (await download).path())!)).toEqual(image)
  expect((await storedImages(page)).sizes).toEqual([])
  expect(state.generations).toBe(1)
})

test('refresh resumes an interrupted original save and preserves the generation', async ({ page }) => {
  const { image, state } = await fixture(page)
  let blocked = true, entered = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media?**', async route => {
    if (!new URL(route.request().url()).searchParams.has('variant') && blocked) { entered = true; await gate }
    await route.fulfill({ contentType: 'image/jpeg', body: image }).catch(() => {})
  })
  await send(page)
  await expect.poll(() => entered).toBe(true)
  await expect(page.locator('.browser-save')).toContainText('正在保存')
  blocked = false
  await page.reload()
  release()
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  expect((await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
})

test('one failed output does not prevent the other original from being saved', async ({ page }) => {
  const { state, image } = await fixture(page)
  state.count = 2
  await page.route('**/api/creation/media?**', route => new URL(route.request().url()).searchParams.get('url')?.endsWith('-0.jpg')
    ? route.fulfill({ status: 502 }) : route.fulfill({ contentType: 'image/jpeg', body: image }))
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('尚未保存到此浏览器')
  const saved = await storedImages(page)
  expect(saved.urls[0]).toMatch(/^https:/)
  expect(saved.urls[1]).toMatch(/^studio-asset:/)
  expect(saved.sizes).toEqual([image.length])
})
