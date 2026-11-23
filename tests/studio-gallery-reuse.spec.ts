import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, count = 3, multi = false, failures = false, relativeDate = false) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const pictures = await Promise.all(['#41759b', '#955557', '#58806a'].map(background => sharp({
    create: { width: 800, height: 600, channels: 3, background },
  }).jpeg().toBuffer()))
  const generation: any[] = [], media: string[] = []
  const gate = { enabled: false, release: () => {}, entered: 0 }
  const waiting = new Promise<void>(resolve => { gate.release = resolve })
  await page.route('**/api/creation/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/media')) {
      media.push(url.searchParams.get('url') || '')
      if (gate.enabled) { gate.entered++; await waiting }
      const index = Number(/output-(\d)/.exec(url.searchParams.get('url') || '')?.[1] || 0)
      return route.fulfill({ contentType: 'image/jpeg', body: pictures[index % 3]! }).catch(() => {})
    }
    if (path.endsWith('/generate')) {
      generation.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: `https://media.example/new-${generation.length}.jpg` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(({ count, multi, failures, boundaryImage }) => {
    if (sessionStorage.getItem('gallery-reuse-fixture')) return
    sessionStorage.setItem('gallery-reuse-fixture', '1')
    const now = Date.now(), tasks = Array.from({ length: count }, (_, index) => ({
      id: `reuse-${index}`, conversationId: `reuse-${index}`, owner: '17', kind: 'image',
      model: index % 2 ? 'flux' : 'gpt-image-2', prompt: `作品 ${index}`,
      createdAt: boundaryImage && index === count - 1 ? now - 7 * 86400000 + 30000 : now - index * 1000, settledAt: now,
      phase: failures && index < 3 ? ['error', 'attention', 'paused'][index] : 'complete',
      ...(failures && index === 2 ? { legacy: true, tokenId: 41 } : {}),
      protocol: 'sync', references: [], text: '', urls: boundaryImage ? [boundaryImage] : failures && index < 3 ? [] : Array.from({ length: multi && index === 0 ? 3 : 1 }, (_, output) => `https://media.example/${index}/output-${output}.jpg`),
      ...(boundaryImage ? { browserSave: { state: 'saved' } } : {}),
      request: { size: '800x600', aspect_ratio: '4:3', n: multi && index === 0 ? 3 : 1, duration: 8 },
    }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify(tasks))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'gallery-text', mediaConversationsMigrated: true,
      sessions: [{ id: 'gallery-text', creationKind: 'text', topic: '作品库测试', model: 'gpt-5', settings: {}, skillIds: [], messages: [] }],
    } }))
  }, { count, multi, failures, boundaryImage: relativeDate ? `data:image/jpeg;base64,${pictures[0]!.toString('base64')}` : '' })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library).toBeVisible()
  await expect(library.locator('.gallery-item')).toHaveCount(failures ? Math.max(0, count - 3) : Math.min(count, 60) + (multi ? 2 : 0))
  return { library, ...account, generation, media, gate }
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const { readTaskSnapshot } = await import('/src/studio-task-store.ts')
    return await readTaskSnapshot('17')
  })
}
async function setOwner(page: Page, id: string) {
  await page.evaluate(async id => {
    const statePath = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/state\.ts(?:\?|$)/.test(name))!
    const { session } = await import(/* @vite-ignore */ statePath)
    session.user = { ...session.user, id }
  }, id)
}

test('old library layout has a fixed toolbar, a scrollable grid, narrow two-column cards and full-filter selection', async ({ page }) => {
  const { library, generation } = await fixture(page, 73)
  await library.getByRole('button', { name: '批量选择', exact: true }).click()
  await library.getByRole('button', { name: '全选筛选结果', exact: true }).click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 73')
  await library.locator('.gallery-item .task-prompt').first().click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 72')
  await library.locator('.gallery-item .gallery-cover button').first().click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 73')
  await library.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(73)
  await expect(library.locator('.gallery-item.selected')).toHaveCount(73)
  await library.getByRole('combobox', { name: '按模型筛选', exact: true }).selectOption('flux')
  await expect(library.locator('.gallery-item')).toHaveCount(36)
  await expect(library.locator('.gallery-item.selected')).toHaveCount(0)
  await library.getByRole('combobox', { name: '按模型筛选', exact: true }).selectOption('')
  await expect(library.locator('.gallery-item')).toHaveCount(60)
  await mkdir('.taste-skill/gallery-reuse-20261115', { recursive: true })
  for (const [width, mode] of [[1440, 'dark'], [390, 'light'], [320, 'dark']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), mode)
    await expect(library).toBeVisible()
    await library.locator('.gallery-scroll').evaluate(element => { element.scrollTop = 0 })
    const bounds = await library.evaluate(element => {
      const rect = element.getBoundingClientRect(), scroll = element.querySelector('.gallery-scroll')!
      const styles = getComputedStyle(scroll), grid = getComputedStyle(element.querySelector('.gallery-grid')!)
      return { left: rect.left, right: rect.right, overflow: styles.overflowY, columns: grid.gridTemplateColumns.split(' ').length }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.overflow).toBe('auto')
    expect(bounds.columns).toBe(width < 600 ? 2 : 6)
    await page.screenshot({ path: `.taste-skill/gallery-reuse-20261115/library-${width}-${mode}.png` })
  }
  await library.getByRole('searchbox', { name: '搜索生成记录', exact: true }).fill('不存在')
  await expect(library.getByRole('button', { name: '清除筛选', exact: true })).toBeVisible()
  await library.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(60)
  expect(generation).toHaveLength(0)
})

test('removing a middle output keeps original indexes, task history, thumbnails and filtered previews', async ({ page }) => {
  const { library, generation } = await fixture(page, 1, true)
  await expect(library.locator('.browser-save').first()).toHaveText('图片已保存到此浏览器')
  await library.locator('.gallery-item').nth(1).getByRole('button', { name: '从作品库移除', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  expect((await stored(page))?.[0]).toMatchObject({ urls: [
    'studio-asset:reuse-0:0', 'studio-asset:reuse-0:1', 'studio-asset:reuse-0:2',
  ], galleryHiddenIndices: [1] })
  await page.reload()
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  await library.getByRole('button', { name: '预览 作品 0', exact: true }).click()
  const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect(viewer.getByRole('combobox', { name: '预览图片序号', exact: true }).locator('option')).toHaveCount(2)
  await viewer.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(viewer.locator('img')).toHaveAttribute('src', /^blob:/)
  const pixel = await viewer.locator('img').evaluate(async (image: HTMLImageElement) => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  })
  expect(pixel.every((value, index) => Math.abs(value - [88, 128, 106][index]!) <= 2)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(library).toBeVisible()
  const download = page.waitForEvent('download')
  await library.locator('.gallery-item').last().getByRole('button', { name: '下载此记录', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('3')
  await library.getByRole('button', { name: '关闭作品库', exact: true }).click()
  await page.locator('.studio-sidebar .studio-record[data-kind="image"]').filter({ hasText: '作品 0' }).click()
  await expect(page.locator('.creation-response .creation-media figure')).toHaveCount(3)
  expect(generation).toHaveLength(0)
})

test('automatic library collection is independent of original downloads and preserves all conversation tasks', async ({ page }) => {
  const { library, generation } = await fixture(page, 1)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await library.getByRole('button', { name: '作品库设置', exact: true }).click()
  await expect(library.getByRole('switch', { name: '自动下载原文件', exact: true })).not.toBeChecked()
  await library.getByRole('switch', { name: '自动下载原文件', exact: true }).check()
  await library.getByRole('switch', { name: '自动收录作品', exact: true }).uncheck()
  await expect(library.getByRole('switch', { name: '自动下载原文件', exact: true })).toBeChecked()
  await library.getByRole('button', { name: '关闭作品库', exact: true }).click()
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('仅下载的新作品')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status').last()).toContainText('生成完成')
  await expect.poll(() => downloads.length).toBe(1)
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(1)
  await library.getByRole('button', { name: '作品库设置', exact: true }).click()
  await library.getByRole('switch', { name: '自动收录作品', exact: true }).check()
  await library.getByRole('switch', { name: '自动下载原文件', exact: true }).uncheck()
  await library.getByRole('button', { name: '关闭作品库', exact: true }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('仅收录的新作品')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status').last()).toContainText('生成完成')
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  const tasks = await stored(page)
  expect(tasks?.some(task => task.prompt === '仅下载的新作品' && task.galleryHidden)).toBe(true)
  expect(tasks?.some(task => task.prompt === '仅收录的新作品' && !task.galleryHidden)).toBe(true)
  expect(downloads).toHaveLength(1)
  expect(generation).toHaveLength(2)
})

test('switching A to B and back aborts a pending export without late files or progress', async ({ page }) => {
  const { library, state, gate, generation } = await fixture(page, 3)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await expect(library.locator('.gallery-cover img')).toHaveCount(3)
  await expect.poll(() => library.locator('.gallery-cover img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.evaluate(() => {
    const fetchOriginal = window.fetch.bind(window)
    ;(window as any).exportEntered = 0
    window.fetch = async (input, init) => {
      if (!String(input).startsWith('blob:')) return fetchOriginal(input, init)
      ;(window as any).exportEntered++
      return new Promise((resolve, reject) => {
        ;(window as any).releaseExport = () => resolve(fetchOriginal(input, init))
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
      })
    }
  })
  try {
    await library.getByRole('button', { name: '导出全部筛选结果', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).exportEntered)).toBe(1)
    await expect(library.getByRole('progressbar', { name: '作品导出进度', exact: true })).toBeVisible()
    state.user.id = '18'; await setOwner(page, '18')
    await expect(library).not.toBeVisible()
    state.user.id = '17'; await setOwner(page, '17')
  } finally { gate.release(); await page.evaluate(() => (window as any).releaseExport?.()) }
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(3)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toHaveLength(0)
  expect(generation).toHaveLength(0)
})

test('failed-record cleanup preserves paused and attention tasks', async ({ page }) => {
  const { library, generation } = await fixture(page, 4, false, true)
  await library.getByRole('button', { name: '作品库设置', exact: true }).click()
  await library.getByRole('button', { name: '清理失败记录', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect.poll(async () => (await stored(page))?.map(task => task.phase).sort()).toEqual(['attention', 'complete', 'paused'])
  await library.getByRole('tab', { name: '任务', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(3)
  expect(generation).toHaveLength(0)
})

test('selected downloads keep nonadjacent output indexes and export-all follows the current filters', async ({ page }) => {
  const { library, generation } = await fixture(page, 4, true)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await library.getByRole('button', { name: '批量选择', exact: true }).click()
  await library.getByRole('checkbox', { name: '选择 作品 0 · 1', exact: true }).check()
  await library.getByRole('checkbox', { name: '选择 作品 0 · 3', exact: true }).check()
  await library.getByRole('button', { name: '下载选中记录', exact: true }).click()
  await expect.poll(() => downloads.length).toBe(2)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toEqual(['creation-reuse-0-1.jpg', 'creation-reuse-0-3.jpg'])
  await library.getByRole('button', { name: '取消选择', exact: true }).click()
  await library.getByRole('combobox', { name: '按模型筛选', exact: true }).selectOption('flux')
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  await library.getByRole('button', { name: '导出全部筛选结果', exact: true }).click()
  await expect.poll(() => downloads.length).toBe(4)
  expect(downloads.slice(2)).toEqual(['creation-reuse-1-1.jpg', 'creation-reuse-3-1.jpg'])
  expect(generation).toHaveLength(0)
})

test('export-all requests every matching download beyond the initially loaded page', async ({ page }) => {
  const { library, generation } = await fixture(page, 65)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click
    ;(window as any).requestedGalleryDownloads = []
    HTMLAnchorElement.prototype.click = function (...args) {
      if (this.download.startsWith('creation-')) (window as any).requestedGalleryDownloads.push(this.download)
      return Reflect.apply(click, this, args)
    }
  })
  await expect(library.locator('.gallery-item')).toHaveCount(60)
  await library.getByRole('button', { name: '导出全部筛选结果', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).requestedGalleryDownloads.length)).toBe(65)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  const requested = await page.evaluate(() => (window as any).requestedGalleryDownloads as string[])
  expect(new Set(requested).size).toBe(65)
  expect(requested).toEqual(expect.arrayContaining(['creation-reuse-0-1.jpg', 'creation-reuse-64-1.jpg']))
  expect(downloads.length).toBeGreaterThan(0)
  expect(generation).toHaveLength(0)
})

test('a pending summary does not block filtered records or retain a previous filter count', async ({ page }) => {
  const { library } = await fixture(page, 65)
  await expect(library.locator('.gallery-stats')).toContainText('65 条')
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    let taskReads = 0
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = Reflect.apply(transaction, this, args)
      if (args[0] === 'tasks' && args[1] !== 'readwrite' && ++taskReads === 2) {
        let handler: ((this: IDBTransaction, event: Event) => unknown) | null = null
        Object.defineProperty(tx, 'oncomplete', { get: () => handler, set: value => { handler = value } })
        tx.addEventListener('complete', event => {
          ;(window as any).releaseGallerySummary = () => handler?.call(tx, event)
        })
      }
      return tx
    }
    ;(window as any).restoreGalleryTransactions = () => { IDBDatabase.prototype.transaction = transaction }
  })
  try {
    await library.getByRole('searchbox', { name: '搜索生成记录', exact: true }).fill('作品 6')
    await expect(library.locator('.gallery-item')).toHaveCount(6)
    await expect(library.locator('.gallery-scroll')).toHaveAttribute('aria-busy', 'false')
    await expect(library.locator('.gallery-stats')).toContainText('— 条')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).releaseGallerySummary))).toBe(true)
    await page.evaluate(() => (window as any).releaseGallerySummary())
    await expect(library.locator('.gallery-stats')).toContainText('6 条')
  } finally {
    await page.evaluate(() => { (window as any).releaseGallerySummary?.(); (window as any).restoreGalleryTransactions?.() })
  }
})

test('relative-date pagination and select-all share one boundary while a new-day refresh updates today', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T04:00:00Z'))
  const { library } = await fixture(page, 65, false, false, true)
  await library.getByRole('combobox', { name: '按时间筛选', exact: true }).selectOption('week')
  await expect(library.locator('.gallery-stats')).toContainText('65 条')
  await page.evaluate(() => {
    const open = IDBIndex.prototype.openCursor
    ;(window as any).relativeDateSummaryReads = 0
    IDBIndex.prototype.openCursor = function (...args) {
      const range = args[0]
      if (this.name === 'ownerCreatedAtId' && range instanceof IDBKeyRange && range.upper[1] === Number.MAX_SAFE_INTEGER)
        (window as any).relativeDateSummaryReads++
      return Reflect.apply(open, this, args)
    }
  })
  await page.clock.setFixedTime(new Date('2026-11-23T04:01:00Z'))
  await library.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(65)
  await expect(library.locator('.gallery-scroll')).toHaveAttribute('aria-busy', 'false')
  await expect(library.locator('.gallery-stats')).toContainText('65 条')
  expect(await page.evaluate(() => (window as any).relativeDateSummaryReads)).toBe(0)
  await library.getByRole('button', { name: '批量选择', exact: true }).click()
  await library.getByRole('button', { name: '全选筛选结果', exact: true }).click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 65')
  await library.getByRole('combobox', { name: '按时间筛选', exact: true }).selectOption('today')
  await expect(library.locator('.gallery-stats')).toContainText('64 条')
  const nextDay = await page.evaluate(() => {
    const day = new Date()
    day.setDate(day.getDate() + 1); day.setHours(0, 0, 1, 0)
    return day.getTime()
  })
  await page.clock.setFixedTime(new Date(nextDay))
  await library.getByRole('tab', { name: '任务', exact: true }).click()
  await expect(library.locator('.gallery-stats')).toContainText('0 条')
  await library.getByRole('tab', { name: '作品', exact: true }).click()
  await expect(library.locator('.gallery-stats')).toContainText('0 条')
  await expect(library.locator('.gallery-item')).toHaveCount(0)
})

test('settings escape the short-screen scroll container and Escape returns to the library', async ({ page }) => {
  const { library } = await fixture(page, 1)
  await page.setViewportSize({ width: 320, height: 480 })
  await library.getByRole('button', { name: '作品库设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '作品库设置', exact: true })
  await expect(settings.getByRole('switch', { name: '自动收录作品', exact: true })).toBeVisible()
  const rect = await settings.boundingBox()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(480)
  await page.keyboard.press('Escape')
  await expect(settings).not.toBeVisible()
  await expect(library).toBeVisible()
})

test('mixed task export skips unfinished outputs and deleting completed tasks preserves pending recovery', async ({ page }) => {
  const { library } = await fixture(page, 4, false, true)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await library.getByRole('tab', { name: '任务', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(4)
  await library.getByRole('button', { name: '导出全部筛选结果', exact: true }).click()
  await expect.poll(() => downloads.length).toBe(1)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toEqual(['creation-reuse-3-1.jpg'])
  await library.getByRole('button', { name: '批量选择', exact: true }).click()
  await library.getByRole('button', { name: '全选筛选结果', exact: true }).click()
  await library.getByRole('button', { name: '删除选中记录', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  expect((await stored(page))?.map(task => task.phase).sort()).toEqual(['attention', 'paused'])
})
