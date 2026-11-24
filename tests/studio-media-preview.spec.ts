import { confirmImageDownload } from './helpers/image-download'
import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, kind: 'image' | 'video' = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#287acc' } }).jpeg().toBuffer()
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  await page.route('**/api/creation/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } })
    if (url.pathname === '/api/creation/media') return route.fulfill({
      contentType: url.searchParams.get('kind') === 'video' ? 'video/mp4' : 'image/jpeg',
      body: url.searchParams.get('kind') === 'video' ? video : image,
    })
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(({ kind }) => {
    if (sessionStorage.getItem('media-preview-fixture')) return
    sessionStorage.setItem('media-preview-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'preview-task', owner: '17', kind, model: kind === 'image' ? 'gpt-image-2' : 'sora-2',
      prompt: '预览作品', createdAt: now, settledAt: now, phase: 'complete', protocol: 'sync',
      references: [], text: '', urls: kind === 'image' ? ['https://media.example/first.jpg', 'https://media.example/second.jpg'] : ['https://media.example/video.mp4'],
      request: {},
    }]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'preview-text', mediaConversationsMigrated: true,
      sessions: [{ id: 'preview-text', creationKind: 'text', topic: '预览测试', model: 'gpt-5', lastUpdate: now, settings: {}, skillIds: [], messages: [] }],
    } }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => { (window as any).copiedImageTypes = items.map(item => item.types) },
    } })
  }, { kind })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/create/text', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  if (await page.getByRole('button', { name: '打开侧边栏', exact: true }).isVisible()) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await page.getByRole('button', { name: '预览 预览作品', exact: true }).click()
  const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect(viewer).toBeVisible()
  return { viewer, image, video }
}

test('pinch zoom keeps its focal point and continues with one finger without closing the viewer', async ({ page }) => {
  const { viewer } = await fixture(page)
  const picture = viewer.locator('img'), percent = viewer.getByRole('status', { name: '缩放比例', exact: true })
  await picture.evaluate((element: HTMLImageElement) => element.decode())
  const bounds = (await picture.boundingBox())!, x = bounds.x + bounds.width / 2 + 30, y = bounds.y + bounds.height / 2
  const touch = await page.context().newCDPSession(page)
  const point = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 2, radiusY: 2 })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1,x-40,y),point(2,x+40,y)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1,x-80,y),point(2,x+80,y)] })
  await expect(percent).toHaveText('200%')
  const zoomed = (await picture.boundingBox())!
  expect((x - zoomed.x) / zoomed.width).toBeCloseTo((x - bounds.x) / bounds.width, 3)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(2,x+80,y)] })
  const before = await picture.boundingBox()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1,x-60,y)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(viewer).toBeVisible()
  await expect.poll(async () => (await picture.boundingBox())!.x - before!.x).toBeCloseTo(20,0)
  await viewer.getByRole('button', { name: '重置缩放', exact: true }).click()
  await expect(percent).toHaveText('100%')
  const tap = async () => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1,x,y)] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await tap()
  await expect(viewer).toBeVisible()
  await expect(percent).toHaveText('100%')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1,x,y)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await tap()
  await expect(percent).toHaveText('100%')
  await tap()
  await expect(percent).toHaveText('250%')
  await tap(); await tap()
  await expect(percent).toHaveText('100%')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1,x-15,y),point(2,x+15,y)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1,x-140,y),point(2,x+140,y)] })
  await expect(percent).toHaveText('500%')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1,x-140,y),point(2,x+140,y)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1,x-1,y),point(2,x+1,y)] })
  await expect(percent).toHaveText('10%')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(viewer.locator('.lightbox-content')).not.toHaveClass(/is-dragging/)
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: '重置缩放', exact: true }).click()
  await expect(percent).toHaveText('100%')
  await touch.detach()
  await viewer.getByRole('button', { name: '放大', exact: true }).click()
  await expect(percent).toHaveText('120%')
  await viewer.locator('.lightbox-stage').click({ position: { x: 1, y: 1 } })
  await expect(viewer).not.toBeVisible()
})

test('wheel zoom follows the cursor, drag stays in bounds, and rotation and keyboard reset remain usable', async ({ page }) => {
  const { viewer } = await fixture(page)
  const picture = viewer.locator('img'), stage = viewer.locator('.lightbox-stage')
  const percent = viewer.getByRole('status', { name: '缩放比例', exact: true })
  await picture.evaluate((element: HTMLImageElement) => element.decode())
  const before = (await picture.boundingBox())!, x = before.x + before.width / 2 + 45, y = before.y + before.height / 2
  await page.mouse.move(x, y)
  await page.mouse.wheel(0, -Math.log(2) / .002)
  await expect(percent).toHaveText('200%')
  const after = (await picture.boundingBox())!
  expect((x - after.x) / after.width).toBeCloseTo((x - before.x) / before.width, 3)
  await page.mouse.down(); await page.mouse.move(x + 2000, y + 1000); await page.mouse.up()
  const panned = (await picture.boundingBox())!, viewport = (await stage.boundingBox())!
  expect(panned.x).toBeCloseTo(viewport.x, 0)
  expect(panned.y + panned.height / 2).toBeCloseTo(viewport.y + viewport.height / 2, 0)
  await page.setViewportSize({ width: 900, height: 390 })
  await expect.poll(async () => {
    const image = (await picture.boundingBox())!, box = (await stage.boundingBox())!
    return Math.abs(image.x + image.width / 2 - box.x - box.width / 2)
  }).toBeLessThan(1)
  await page.keyboard.press('0'); await expect(percent).toHaveText('100%')
  await page.keyboard.press('+'); await expect(percent).toHaveText('120%')
  await page.keyboard.press('-'); await expect(percent).toHaveText('100%')
  const targets = await viewer.locator('.viewer-button').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }
  }))
  expect(targets.every(box => box.width >= 44 && box.height >= 44)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.media-lightbox[open]').analyze()).violations).toEqual([])
})

test('shared gallery viewer preserves original pixels, zooms, pans, changes items, downloads and copies', async ({ page }) => {
  const { viewer, image } = await fixture(page)
  const picture = viewer.locator('img'), percent = viewer.getByRole('status', { name: '缩放比例', exact: true })
  await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
  await expect(percent).toHaveText('100%')
  await viewer.getByRole('button', { name: '放大', exact: true }).click()
  await expect(percent).toHaveText('120%')
  await viewer.getByRole('button', { name: '放大', exact: true }).click()
  const content = viewer.locator('.lightbox-content')
  const box = (await content.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20)
  await expect(content).toHaveClass(/is-dragging/)
  await page.mouse.up()
  await expect(content).not.toHaveClass(/is-dragging/)
  await expect(picture).toHaveAttribute('style', /translate\(35px, 0px\)/)
  await content.dispatchEvent('pointercancel', { pointerId: 91 })
  await viewer.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(percent).toHaveText('100%')
  await expect(viewer.getByRole('combobox', { name: '预览图片序号', exact: true })).toHaveValue('1')
  await content.dblclick()
  await expect(percent).toHaveText('250%')
  await content.dblclick()
  await expect(percent).toHaveText('100%')
  await content.dispatchEvent('wheel', { deltaY: -10000 })
  await expect(percent).toHaveText('500%')
  await expect(viewer.getByRole('button', { name: '放大', exact: true })).toBeDisabled()
  await content.dispatchEvent('wheel', { deltaY: 10000 })
  await expect(percent).toHaveText('10%')
  await expect(viewer.getByRole('button', { name: '缩小', exact: true })).toBeDisabled()
  await viewer.getByRole('button', { name: '复制图片', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).copiedImageTypes)).toEqual([['image/png']])
  const downloadPromise = page.waitForEvent('download')
  await viewer.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  const download = await downloadPromise
  const downloaded = await readFile((await download.path())!)
  expect(downloaded.equals(image)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(viewer).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('preview download survives its original being cached during export', async ({ page }) => {
  const { viewer } = await fixture(page)
  const files: string[] = []
  page.on('download', file => files.push(file.suggestedFilename()))
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name))!
    const studio = await import(/* @vite-ignore */ path), task = studio.creation.tasks.find((task: any) => task.id === 'preview-task')
    await studio.cacheCreationImages(task, true)
    task.urls[0] = 'https://media.example/not-yet-cached.jpg'
    ;(window as any).previewTask = task
  })
  await viewer.locator('img').evaluate((image: HTMLImageElement) => image.decode())
  await viewer.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  await expect.poll(() => files.length, { timeout: 3000 }).toBe(1)
  expect(await page.evaluate(() => (window as any).previewTask.urls[0])).toBe('studio-asset:preview-task:0')
  await expect(viewer.getByRole('alert')).toHaveCount(0)
})

test('video viewer uses native controls and releases playback resources on close', async ({ page }) => {
  const { viewer } = await fixture(page, 'video')
  const video = viewer.locator('video')
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute('controls', '')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  await video.evaluate(async (element: HTMLVideoElement) => {
    const previous = document.createElement('video')
    previous.src = element.src; previous.muted = true; previous.loop = true
    document.body.append(previous); (window as any).previousVideo = previous
    await previous.play()
  })
  expect(await page.evaluate(() => (window as any).previousVideo.paused)).toBe(false)
  await video.evaluate((element: HTMLVideoElement) => element.play())
  await expect.poll(() => page.evaluate(() => (window as any).previousVideo.paused)).toBe(true)
  await video.evaluate((element: HTMLVideoElement) => { (window as any).previewVideo = element })
  await viewer.getByRole('button', { name: '关闭媒体预览', exact: true }).click()
  await expect(viewer).not.toBeVisible()
  expect(await page.evaluate(() => {
    const element = (window as any).previewVideo as HTMLVideoElement
    return { paused: element.paused, source: element.getAttribute('src'), connected: element.isConnected }
  })).toEqual({ paused: true, source: null, connected: false })
})

test('viewer resolves delayed stored assets, rejects unsafe sources and closes on owner changes', async ({ page }) => {
  await fixture(page)
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const componentPath = '/src/components/studio-message/StudioMediaPreview.vue'
    // Import the component's exact Vite runtime URL so the harness shares Vue's ref owner.
    const source = await (await fetch(componentPath)).text()
    const vuePath = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1]!
    const { createApp, h, ref, nextTick } = await import(vuePath)
    const { default: Preview } = await import(componentPath)
    const handle = ref(), items = ref([{ src: undefined, kind: 'image', alt: '延迟图片' }])
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(Preview, { ref: handle, items: items.value, label: '独立预览' }) })
    app.mount(host); await nextTick(); await handle.value.open()
    ;(window as any).previewHarness = { handle, items, app, host }
  })
  const viewer = page.getByRole('dialog', { name: '独立预览', exact: true })
  await expect(viewer.getByRole('status').filter({ hasText: '正在加载原文件' })).toBeVisible()
  await page.evaluate(async () => {
    const { items } = (window as any).previewHarness
    const response = await fetch('/api/creation/media?url=https://media.example/stored.jpg&kind=image')
    items.value = [{ src: URL.createObjectURL(await response.blob()), kind: 'image', alt: '延迟图片' }]
  })
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
  await page.evaluate(() => { (window as any).previewHarness.items.value = [{ src: 'javascript:alert(1)', kind: 'image' }] })
  await expect(viewer.locator('img')).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: '下载图片', exact: true })).toBeDisabled()
  await page.evaluate(async () => {
    const statePath = '/src/state.ts', { session } = await import(statePath)
    session.user = { ...session.user, id: 'other-owner' }
  })
  await expect(viewer).not.toBeVisible()
})

test('a missing local source and a stalled original decode both leave a retryable viewer', async ({ page }) => {
  await fixture(page)
  await page.keyboard.press('Escape')
  await page.clock.install()
  await page.evaluate(async () => {
    const componentPath = '/src/components/studio-message/StudioMediaPreview.vue'
    const source = await (await fetch(componentPath)).text()
    const vuePath = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1]!
    const { createApp, h, ref, nextTick } = await import(vuePath)
    const { default: Preview } = await import(componentPath)
    const handle = ref(), items = ref([{ src: 'studio-asset:missing:0', kind: 'image' }])
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(Preview, { ref: handle, items: items.value, label: '独立预览' }) })
    const suppressLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement && event.target.closest('.media-lightbox') && event.target.src.startsWith('blob:')) event.stopImmediatePropagation()
    }
    document.addEventListener('load', suppressLoad, true)
    app.mount(host); await nextTick(); await handle.value.open()
    ;(window as any).previewHarness = { items, suppressLoad }
  })
  const viewer = page.getByRole('dialog', { name: '独立预览', exact: true })
  await page.clock.runFor(15001)
  await expect(viewer.getByText('图片加载失败', { exact: true })).toBeVisible()
  await expect(viewer.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).previewHarness.items.value = [{ src: '/api/creation/media?url=https%3A%2F%2Fmedia.example%2Fdecode.jpg&kind=image', kind: 'image' }] })
  await expect(viewer.locator('img')).toHaveAttribute('src', /^blob:/)
  await expect(viewer.locator('.lightbox-loading')).toBeVisible()
  await page.clock.runFor(15001)
  await expect(viewer.locator('img')).toHaveCount(0)
  await expect(viewer.getByText('图片加载失败', { exact: true })).toBeVisible()
  await page.evaluate(() => document.removeEventListener('load', (window as any).previewHarness.suppressLoad, true))
  await viewer.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(viewer.locator('.lightbox-loading')).toHaveCount(0)
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
})

test('public work originals above the studio storage limit still open in full screen', async ({ page }) => {
  const { image } = await fixture(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '原始媒体预览', exact: true })).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '作品库', exact: true })).not.toBeVisible()
  await page.route('**/files/public-large.jpg*', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.concat([image, Buffer.alloc(33 * 1024 ** 2)]) }))
  await page.evaluate(async () => {
    const componentPath = '/src/components/WorkMedia.vue'
    const source = await (await fetch(componentPath)).text()
    const vuePath = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1]!
    const { createApp, h } = await import(vuePath)
    const { default: WorkMedia } = await import(componentPath)
    const host = document.createElement('div'); document.body.append(host)
    createApp({ render: () => h(WorkMedia, { files: [{ id: 'large-public', url: '/files/public-large.jpg', type: 'image/jpeg', name: '大体积作品' }], title: '大体积作品' }) }).mount(host)
  })
  await page.getByRole('button', { name: '完整预览 大体积作品', exact: true }).click()
  const viewer = page.getByRole('dialog', { name: '作品文件预览', exact: true })
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('img')).toHaveAttribute('src', /\/files\/public-large\.jpg/)
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
  await expect(viewer.getByRole('button', { name: '放大', exact: true })).toBeEnabled()
  await expect(viewer.locator('.lightbox-error')).toHaveCount(0)
})

test('full-screen viewer fits desktop and narrow mobile, honors reduced motion and retries failed media', async ({ page }) => {
  const { viewer } = await fixture(page)
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
  await mkdir('.taste-skill/unified-dialogue-20261115', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
    if (await page.getByRole('button', { name: '打开侧边栏', exact: true }).isVisible()) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    await page.getByRole('button', { name: '作品库', exact: true }).click()
    await page.getByRole('button', { name: '预览 预览作品', exact: true }).click()
    await expect(viewer).toBeVisible()
    await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
    const layout = await viewer.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const controls = element.querySelector('.lightbox-controls')!.getBoundingClientRect()
      const image = element.querySelector('img')!.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, controlsLeft: controls.left, controlsRight: controls.right, controlsTop: controls.top, imageBottom: image.bottom }
    })
    expect(layout.width).toBe(width)
    expect(layout.height).toBe(900)
    expect(layout.controlsLeft).toBeGreaterThanOrEqual(0)
    expect(layout.controlsRight).toBeLessThanOrEqual(width)
    expect(layout.imageBottom).toBeLessThan(layout.controlsTop)
    await page.screenshot({ path: `.taste-skill/unified-dialogue-20261115/media-viewer-${width}.png` })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await viewer.locator('img').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
  await viewer.locator('img').dispatchEvent('error')
  await expect(viewer.getByRole('status').filter({ hasText: '原图加载失败，当前显示预览图。' })).toContainText('重新加载')
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await viewer.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(viewer.locator('.lightbox-original-status')).toHaveCount(0)
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
  await viewer.locator('.lightbox-stage').click({ position: { x: 1, y: 1 } })
  await expect(viewer).not.toBeVisible()
})
