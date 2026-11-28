import { confirmImageDownload } from './helpers/image-download'
import { readDownloadArchive } from './helpers/download-archive'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'

async function fixture(page: Page, gallery = false) {
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
  await page.addInitScript(gallery => {
    if (sessionStorage.getItem('browser-save-fixture')) return
    sessionStorage.setItem('browser-save-fixture', '1')
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: gallery }))
  }, gallery)
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
      const request = indexedDB.open('community-studio-media')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction(['tasks', 'originals', 'contents'])
      const getAll = (name: string) => new Promise<any[]>(resolve => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result)
      })
      const [tasks, originals, contents] = await Promise.all([getAll('tasks'), getAll('originals'), getAll('contents')])
      return { urls: tasks.filter(t => t.owner === '17').flatMap(t => t.value.urls), sizes: [...originals, ...contents].filter(a => a.owner === '17' && a.blob).map(a => a.blob.size) }
    } finally { db.close() }
  })
}

test('pending originals show a loading placeholder and gallery covers share their browser save', async ({ page }, info) => {
  const { state, image } = await fixture(page, true)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const reads: string[] = []
  await page.route('**/api/creation/media?**', async route => {
    reads.push(new URL(route.request().url()).searchParams.get('variant') || 'original')
    await pending
    await route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  try {
    await send(page)
    await expect.poll(() => reads.length).toBe(1)
    await expect(page.locator('.creation-image').getByRole('status')).toHaveText('正在加载图片')
    await expect(page.locator('.browser-save')).toHaveText('生成完成，正在保存图片到此浏览器（0/1）…')
    await expect(page.locator('.creation-image img')).toHaveCount(0)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`image-loading-${width}.png`) })
    }
    await page.getByRole('button', { name: '作品库', exact: true }).click()
    const library = page.getByRole('dialog', { name: '作品库', exact: true })
    await expect(library.getByText('正在加载封面', { exact: true })).toBeAttached()
    await page.waitForTimeout(250)
    expect(reads).toEqual(['original'])
    release()
    await expect.poll(() => library.locator('.cover-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
    await expect.poll(async () => (await storedImages(page)).sizes).toEqual([image.length])
    await expect(page.locator('.creation-image-preview img')).toHaveJSProperty('complete', true)
    await expect.poll(() => page.locator('.creation-image-preview img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(reads).toEqual(['original'])
    await page.unroute('**/api/creation/media?**')
    state.available = false
    const originals = state.originals
    await page.reload()
    await page.getByRole('button', { name: '作品库', exact: true }).click()
    await expect.poll(() => page.locator('.cover-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
    expect(state.originals).toBe(originals)
    expect(state.generations).toBe(1)
  } finally { release() }
})

for (const mode of ['server', 'stream']) test(`a slow ${mode} image shows its available preview while saving the original`, async ({ page }) => {
  const { state, image } = await fixture(page)
  const { default: sharp } = await import('sharp')
  const preview = await sharp(image).resize(40, 40).webp().toBuffer()
  const source = mode === 'server' ? '/api/creation/media?requestId=saved-image&index=0' : 'https://media.example/stream.jpg'
  let release!: () => void, previews = 0
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/generate', route => {
    state.generations++
    const result = { type: 'result', status: 'succeeded', outputs: [{ url: source }], tokenId: 41, protocol: 'sync' }
    return mode === 'server' ? route.fulfill({ json: result }) : route.fulfill({ contentType: 'text/event-stream',
      body: [ { type: 'preview', url: `data:image/webp;base64,${preview.toString('base64')}` }, result ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
  })
  await page.route('**/api/creation/media?**', async route => {
    if (new URL(route.request().url()).searchParams.has('variant')) {
      previews++
      return route.fulfill({ contentType: 'image/webp', body: preview })
    }
    state.originals++
    await held
    await route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  try {
    await send(page)
    const result = page.locator('.creation-response')
    await expect(result.locator('.browser-save')).toContainText('（0/1）')
    await expect.poll(() => result.getByRole('img', { name: '生成图片预览' }).evaluateAll(images => (images[0] as HTMLImageElement)?.naturalWidth)).toBe(40)
    expect((await storedImages(page)).urls).toEqual([source])
    release()
    await expect(result.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
    await expect.poll(() => result.locator('.creation-image-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(40)
    expect((await storedImages(page)).sizes).toContain(image.length)
    expect(previews).toBe(mode === 'server' ? 1 : 0)
    expect(state.originals).toBe(1)
    expect(state.generations).toBe(1)
  } finally { release() }
})

for (const allowPreview of [true, false]) test(`a private original denied after preview access ${allowPreview} can be retried`, async ({ page }) => {
  const { state, image } = await fixture(page)
  const source = '/api/creation/media?requestId=private-result&index=0'
  await page.route('**/api/creation/generate', route => {
    state.generations++
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: source }], protocol: 'sync', tokenId: 41 } })
  })
  let release!: () => void, authorized = false, previews = 0
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media?**', async route => {
    if (new URL(route.request().url()).searchParams.has('variant')) {
      previews++
      return allowPreview ? route.fulfill({ contentType: 'image/jpeg', body: image }) : route.fulfill({ status: 403 })
    }
    state.originals++
    await held
    return authorized ? route.fulfill({ contentType: 'image/jpeg', body: image }) : route.fulfill({ status: 403 })
  })
  try {
    await send(page)
    await expect.poll(() => previews).toBe(1)
    const preview = page.getByRole('img', { name: '生成图片预览', exact: true })
    if (allowPreview) await expect(preview).toBeVisible()
    else await expect(page.locator('.creation-image').getByRole('status')).toHaveText('正在加载图片')
    release()
    await expect(page.locator('.browser-save')).toContainText('当前账号无权读取此图片')
    await expect(page.getByRole('button', { name: '重新加载图片', exact: true })).toBeVisible()
    await expect(preview).toHaveCount(allowPreview ? 1 : 0)
    expect((await storedImages(page)).sizes).toEqual([])
    authorized = true
    await page.getByRole('button', { name: '重试保存图片', exact: true }).click()
    await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
    await expect.poll(() => page.locator('.creation-image-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    expect(state.originals).toBe(2)
    expect(previews).toBe(1)
    expect(state.generations).toBe(1)
  } finally { release() }
})

test('a blocked local original shows retry and loads after another tab releases its database transaction', async ({ page, context }) => {
  const { state } = await fixture(page)
  await send(page)
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  const blocker = await context.newPage()
  await blocker.goto('/assets/brand/octopus-community.jpg')
  await blocker.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('community-studio-media')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('originals', 'readwrite'), store = tx.objectStore('originals')
      const hold = () => { store.get(['17', 'hold']).onsuccess = () => { resolve(); hold() } }
      hold()
    }
  }))
  try {
    await page.addInitScript(() => {
      const timeout = AbortSignal.timeout.bind(AbortSignal)
      AbortSignal.timeout = ms => timeout(ms === 60000 ? 500 : ms)
    })
    await page.reload()
    const retry = page.getByRole('button', { name: '重新加载图片', exact: true })
    await expect(retry).toBeVisible()
    await blocker.close()
    await retry.click()
    await expect.poll(() => page.locator('.creation-image-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    expect(state.originals).toBe(1)
    expect(state.generations).toBe(1)
  } finally { if (!blocker.isClosed()) await blocker.close() }
})

test('a stalled gallery original stops spinning and retries the same result', async ({ page }) => {
  const { state, image } = await fixture(page, true)
  await page.evaluate(() => {
    const fetchMedia = window.fetch, timeout = window.setTimeout.bind(window)
    ;(window as any).stallGalleryImage = true
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: any[]) => timeout(handler, ms && ms >= 30000 ? ms / 100 : ms, ...args)) as typeof setTimeout
    window.fetch = async (...args) => {
      if ((window as any).stallGalleryImage && new URL(String(args[0]), location.href).pathname === '/api/creation/media') {
        return new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { headers: { 'Content-Type': 'image/jpeg' } })
      }
      return fetchMedia(...args)
    }
  })
  await send(page)
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  const retry = library.getByRole('button', { name: '重新加载封面：浏览器保存原图', exact: true })
  await expect(retry).toBeVisible({ timeout: 8000 })
  await expect(library.getByText('正在加载封面', { exact: true })).toHaveCount(0)
  expect((await storedImages(page)).sizes).toEqual([])
  await page.evaluate(() => { (window as any).stallGalleryImage = false })
  await retry.click()
  await expect.poll(() => library.locator('.cover-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
  await library.getByRole('button', { name: '重试保存图片', exact: true }).click()
  await expect.poll(async () => (await storedImages(page)).sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
})

test('persistent network failure offers image retry without an unbounded native fallback', async ({ page }) => {
  const { state, image } = await fixture(page)
  const reads: string[] = []
  let fail = true
  await page.route('**/api/creation/media?**', route => {
    reads.push(route.request().resourceType())
    return fail ? route.abort('connectionreset') : route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  await send(page)
  const retry = page.getByRole('button', { name: '重新加载图片', exact: true })
  await expect(retry).toBeVisible()
  expect(reads.every(type => type === 'fetch')).toBe(true)
  fail = false
  await retry.click()
  await expect.poll(() => page.locator('.creation-image-preview img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true)
  expect(state.generations).toBe(1)
})

test('a recovered legacy request switches to its upstream task and saves the original after reload', async ({ page }) => {
  const { state, image } = await fixture(page)
  let requestId = '', recoveries = 0, taskReads = 0
  await page.route('**/api/creation/generate', route => {
    state.generations++
    requestId = route.request().postDataJSON().requestId
    return route.fulfill({ status: 202, json: { status: 'pending', requestId, outputs: [], protocol: 'async', tokenId: 41 } })
  })
  await page.route('**/api/creation/requests/**', route => {
    const url = new URL(route.request().url())
    expect(url.pathname).toBe(`/api/creation/requests/${requestId}`)
    if (url.searchParams.has('upstreamId')) {
      taskReads++
      expect(url.searchParams.get('upstreamId')).toBe('legacy-image-task')
      expect(url.searchParams.get('kind')).toBe('image')
      expect(url.searchParams.get('tokenId')).toBe('41')
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/legacy.jpg' }], protocol: 'async', tokenId: 41 } })
    }
    recoveries++
    return route.fulfill({ json: recoveries === 1
      ? { status: 'pending', requestId, outputs: [], protocol: 'async', tokenId: 41 }
      : { status: 'pending', upstreamId: 'legacy-image-task', outputs: [], protocol: 'async', tokenId: 41 } })
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
  await expect(page.getByText('图片已保存到此浏览器', { exact: true })).toBeVisible()
  expect((await storedImages(page)).sizes).toEqual([image.length])
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
  expect([...(await readDownloadArchive(file)).values()]).toEqual([image, image])
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
      : route.fulfill({ json: mode === 'async' ? { status: 'pending', upstreamId: 'browser-task', protocol: 'async', tokenId: 41 } : output })
  })
  await page.route('**/api/creation/requests/**', route => {
    expect(new URL(route.request().url()).searchParams.get('upstreamId')).toBe('browser-task')
    return route.fulfill({ json: output })
  })
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

for (const stage of ['headers', 'body', 'cancel']) test(`a non-cooperative original ${stage} releases browser saving and supports retry without generation`, async ({ page }) => {
  const { state, image } = await fixture(page)
  await page.evaluate(stage => {
    const originalFetch = window.fetch, timeout = window.setTimeout.bind(window)
    ;(window as any).stuckOriginal = true
    ;(window as any).originalAttempts = 0
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: any[]) => timeout(handler, ms && ms >= 30000 ? ms / 200 : ms, ...args)) as typeof setTimeout
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.href)
      if ((window as any).stuckOriginal && url.pathname === '/api/creation/media' && !url.searchParams.has('variant')) {
        ;(window as any).originalAttempts++
        if (stage === 'headers') return new Promise<Response>(() => {})
        return new Response(new ReadableStream({
          start(controller) { if (stage === 'cancel') controller.enqueue(new Uint8Array([1])) },
          cancel() { return new Promise<void>(() => {}) },
        }), { status: stage === 'cancel' ? 502 : 200, headers: { 'Content-Type': 'image/jpeg' } })
      }
      return originalFetch(...args)
    }
  }, stage)
  await send(page)
  const status = page.locator('.browser-save')
  await expect(status).toHaveClass(/failed/, { timeout: 10000 })
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(await page.evaluate(() => (window as any).originalAttempts)).toBeGreaterThanOrEqual(3)
  expect((await storedImages(page)).sizes).toEqual([])
  await page.evaluate(() => { (window as any).stuckOriginal = false })
  await status.getByRole('button', { name: '重试保存图片', exact: true }).click()
  await expect(status).toHaveText('图片已保存到此浏览器')
  expect((await storedImages(page)).sizes).toEqual([image.length])
  await expect.poll(() => page.locator('.creation-image-preview img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
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

for (const code of [401, 403, 404, 413]) test(`original HTTP ${code} neither bypasses the error nor commits a local image`, async ({ page }) => {
  const { state, image } = await fixture(page)
  let attempts = 0, nativeReads = 0
  await page.route('**/api/creation/media?**', route => {
    if (new URL(route.request().url()).searchParams.has('variant')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (route.request().resourceType() === 'fetch') attempts++
    else nativeReads++
    return route.fulfill({ status: code })
  })
  await send(page)
  await expect(page.locator('.browser-save')).toHaveClass(/failed/)
  // Display and browser saving can start separately after an immediate rejection.
  expect(attempts).toBeGreaterThan(0)
  expect(attempts).toBeLessThanOrEqual(2)
  expect(nativeReads).toBe(0)
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

test('display, preview and download reuse one original when browser storage is full', async ({ page }) => {
  const { image, state } = await fixture(page)
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (mode === 'readwrite' && Array.isArray(names) && names.includes('originals')) throw new DOMException('Full', 'QuotaExceededError')
      return Reflect.apply(transaction, this, [names, mode, options])
    }
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('浏览器空间不足')
  await expect.poll(() => page.locator('.creation-image img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const height = await page.locator('.creation-image').evaluate(element => element.getBoundingClientRect().height)
    await page.locator('.creation-image').evaluate(element => { element.style.transform = 'translateX(200vw)' })
    await expect(page.locator('.creation-image img')).toHaveCount(0)
    expect(await page.locator('.creation-image').evaluate(element => element.getBoundingClientRect().height)).toBe(height)
    await page.locator('.creation-image').evaluate(element => { element.style.transform = '' })
    await expect.poll(() => page.locator('.creation-image img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  }
  expect(state.originals).toBe(1)
  state.available = false
  await page.locator('.creation-image-preview').click()
  const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect(viewer).toBeVisible()
  await expect.poll(() => viewer.locator('.lightbox-content img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  const pending = page.waitForEvent('download')
  await viewer.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  expect(await readFile((await (await pending).path())!)).toEqual(image)
  expect(state.originals).toBe(1)
  expect(state.generations).toBe(1)
  expect((await storedImages(page)).sizes).toEqual([])
})

test('browser fetch failure shows retry and preserves the explicit original download', async ({ page }) => {
  const { state } = await fixture(page)
  await page.evaluate(() => {
    const originalFetch = window.fetch
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.href)
      if (url.pathname === '/api/creation/media' && !url.searchParams.has('variant')) throw new TypeError('Failed to fetch')
      return originalFetch(...args)
    }
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('原图传输中断')
  await expect(page.getByRole('button', { name: '重新加载图片', exact: true })).toBeVisible()
  await expect(page.locator('.creation-image img')).toHaveCount(0)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  // Browser-native downloads bypass Playwright's mocked page routes.
  const url = new URL((await pending).url())
  expect(url.origin).toBe(new URL(page.url()).origin)
  expect(url.pathname).toBe('/api/creation/media')
  expect(url.searchParams.get('url')).toBe('https://media.example/1-0.jpg')
  expect(url.searchParams.has('variant')).toBe(false)
  expect(state.generations).toBe(1)
  expect((await storedImages(page)).sizes).toEqual([])
})

test('retry discards an undecodable original and reads a fresh image', async ({ page }) => {
  const { image, state } = await fixture(page)
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (mode === 'readwrite' && Array.isArray(names) && names.includes('originals')) throw new DOMException('Full', 'QuotaExceededError')
      return Reflect.apply(transaction, this, [names, mode, options])
    }
  })
  let corrupt = true
  await page.route('**/api/creation/media?**', route => {
    if (new URL(route.request().url()).searchParams.has('variant')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    state.originals++
    return route.fulfill({ contentType: 'image/jpeg', body: corrupt ? Buffer.from('invalid image') : image })
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('浏览器空间不足')
  await expect(page.getByRole('button', { name: '重新加载图片', exact: true })).toBeVisible()
  corrupt = false
  await page.getByRole('button', { name: '重新加载图片', exact: true }).click()
  await expect.poll(() => page.locator('.creation-image img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  expect(state.originals).toBe(2)
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

test('multi-image progress keeps generation complete and retries only the missing original', async ({ page }) => {
  const { state, image } = await fixture(page)
  state.count = 2
  let failing = true, firstReads = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media?**', async route => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('variant')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (url.searchParams.get('url')?.endsWith('-0.jpg')) {
      firstReads++
      return route.fulfill({ contentType: 'image/jpeg', body: image })
    }
    await gate
    return failing ? route.fulfill({ status: 502 }) : route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  await send(page)
  await expect(page.locator('.browser-save')).toContainText('生成完成，正在保存图片到此浏览器（1/2）')
  release()
  await expect(page.locator('.browser-save')).toContainText('尚未保存到此浏览器')
  const saved = await storedImages(page)
  expect(saved.urls[0]).toMatch(/^studio-asset:/)
  expect(saved.urls[1]).toMatch(/^https:/)
  expect(saved.sizes).toEqual([image.length])
  expect(await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name))!
    return (await import(/* @vite-ignore */ path)).creation.tasks[0].phase
  })).toBe('complete')
  const reads = firstReads
  failing = false
  await page.getByRole('button', { name: '重试保存图片', exact: true }).click()
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  expect(firstReads).toBe(reads)
  const repaired = await storedImages(page)
  expect(repaired.urls.every(url => url.startsWith('studio-asset:'))).toBe(true)
  expect(repaired.sizes).toEqual([image.length])
  expect(state.generations).toBe(1)
  expect(state.downloads).toBe(0)
})
