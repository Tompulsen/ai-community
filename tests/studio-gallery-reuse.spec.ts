import { confirmImageDownload } from './helpers/image-download'
import { readDownloadArchive } from './helpers/download-archive'
import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
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
  await page.route('**/api/creation/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/media')) {
      media.push(url.searchParams.get('url') || '')
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
  await expect(library.locator('.gallery-item')).toHaveCount(failures ? Math.min(60, Math.max(0, count - 3)) : Math.min(count + (multi ? 2 : 0), 60))
  return { library, ...account, generation, media, pictures }
}
async function selectAll(library: Locator) {
  await library.getByRole('button', { name: '批量操作', exact: true }).click()
  await library.getByRole('button', { name: '全选筛选结果', exact: true }).click()
}
async function exportSelection(page: Page, library: Locator) {
  const download = page.waitForEvent('download')
  await library.getByRole('button', { name: '导出所选', exact: true }).click()
  await confirmImageDownload(page)
  return download
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
  await selectAll(library)
  await expect(library.locator('.batch-toolbar')).toContainText('已选 73')
  await library.locator('.gallery-item .task-prompt').first().click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 72')
  await library.locator('.gallery-item .gallery-cover button').first().click()
  await expect(library.locator('.batch-toolbar')).toContainText('已选 73')
  await library.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(13)
  await expect(library.locator('.gallery-item.selected')).toHaveCount(13)
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
  await confirmImageDownload(page)
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
  await expect(library.getByRole('switch', { name: '自动下载作品', exact: true })).not.toBeChecked()
  await library.getByRole('switch', { name: '自动下载作品', exact: true }).check()
  await library.getByRole('switch', { name: '自动收录作品', exact: true }).uncheck()
  await expect(library.getByRole('switch', { name: '自动下载作品', exact: true })).toBeChecked()
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
  await library.getByRole('switch', { name: '自动下载作品', exact: true }).uncheck()
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

for (const action of ['stop', 'switch account'] as const) {
  test(`pending export produces no late downloads after ${action}`, async ({ page }) => {
    const { library, state, generation } = await fixture(page, 3)
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    await expect(library.locator('.gallery-cover img')).toHaveCount(3)
    await expect.poll(() => library.locator('.gallery-cover img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await page.evaluate(() => {
      const blob = Response.prototype.blob
      Response.prototype.blob = function () {
        const result = blob.call(this)
        if (this.headers.get('content-type') === 'application/zip') {
          Response.prototype.blob = blob
          result.then(() => { (window as any).exportSettled = true }, () => { (window as any).exportSettled = true })
        }
        return result
      }
      const stream = Blob.prototype.stream
      let originals = 0
      Blob.prototype.stream = function () {
        const source = stream.call(this)
        if (this.type !== 'image/jpeg' || ++originals !== 2) return source
        Blob.prototype.stream = stream
        const reader = source.getReader()
        const gate = new Promise<void>(resolve => { (window as any).releaseExport = resolve })
        return new ReadableStream({
          async pull(controller) {
            await gate
            const { done, value } = await reader.read()
            if (done) controller.close()
            else controller.enqueue(value)
          },
          cancel: reason => reader.cancel(reason),
        })
      }
    })
    try {
      await selectAll(library)
      await library.getByRole('button', { name: '导出所选', exact: true }).click()
      await confirmImageDownload(page)
      await expect.poll(() => page.evaluate(() => Boolean((window as any).releaseExport))).toBe(true)
      await expect(library.getByRole('progressbar', { name: '作品导出进度', exact: true })).toBeVisible()
      if (action === 'stop') {
        await library.getByRole('button', { name: '停止下载', exact: true }).click()
      } else {
        state.user.id = '18'; await setOwner(page, '18')
        await expect(library).not.toBeVisible()
        state.user.id = '17'; await setOwner(page, '17')
        await page.getByRole('button', { name: '作品库', exact: true }).click()
      }
      await expect.poll(() => page.evaluate(() => Boolean((window as any).exportSettled))).toBe(true)
      expect(downloads).toHaveLength(0)
    } finally { await page.evaluate(() => (window as any).releaseExport?.()) }
    await expect(library.locator('.gallery-item')).toHaveCount(3)
    await expect(library.locator('.gallery-export')).toHaveCount(0)
    expect(downloads).toHaveLength(0)
    expect(generation).toHaveLength(0)
  })
}

test('three selected originals download together after retrying a missing second image', async ({ page }) => {
  const { library, pictures } = await fixture(page, 1, true)
  const downloads: Download[] = []
  page.on('download', download => downloads.push(download))
  await expect(library.locator('.browser-save').first()).toHaveText('图片已保存到此浏览器')
  await expect.poll(() => library.locator('.gallery-cover img').evaluateAll(images => images.length === 3 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await selectAll(library)
  await expect(library.locator('.gallery-stats')).toContainText('已选 3 件')
  await expect(library.getByRole('checkbox', { name: '选择当前页' })).toHaveCount(0)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name))!
    const { forgetCreationImage } = await import(/* @vite-ignore */ path)
    forgetCreationImage('studio-asset:reuse-0:1')
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'originals' && Array.isArray(key) && key[1] === 'reuse-0:1') {
        IDBObjectStore.prototype.get = get
        return get.call(this, ['17', 'missing-original'])
      }
      return get.call(this, key)
    }
  })
  await library.getByRole('button', { name: '导出所选', exact: true }).click()
  await confirmImageDownload(page)
  await expect(library.getByRole('alert')).toContainText('第 2 项导出失败')
  expect(downloads).toHaveLength(0)

  const retry = page.waitForEvent('download')
  await library.getByRole('button', { name: '重新导出', exact: true }).click()
  await confirmImageDownload(page)
  const entries = await readDownloadArchive(await retry)
  expect([...entries.keys()]).toEqual([1, 2, 3].map(index => expect.stringContaining(`creation-reuse-0-${index}.jpg`)))
  expect([...entries.values()].map((file, index) => file.equals(pictures[index]!))).toEqual([true, true, true])
  expect(downloads).toHaveLength(1)
})

for (const boundary of ['combined files', 'ZIP headers', 'streamed bytes'] as const) {
  test(`ZIP budget rejects oversized ${boundary} and preserves originals and selection for retry`, async ({ page }) => {
    const { library, pictures, generation } = await fixture(page, 2)
    const downloads: Download[] = []
    page.on('download', download => downloads.push(download))
    await expect(library.locator('.browser-save')).toHaveText(['图片已保存到此浏览器', '图片已保存到此浏览器'])
    await expect.poll(() => library.locator('.gallery-cover img').evaluateAll(images => images.length === 2 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    const before = await stored(page)
    await selectAll(library)
    await page.evaluate(boundary => {
      const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!
      const stream = Blob.prototype.stream
      ;(window as any).restoreExportBudget = () => {
        Object.defineProperty(Blob.prototype, 'size', size)
        Blob.prototype.stream = stream
      }
      if (boundary === 'streamed bytes') {
        Blob.prototype.stream = function () {
          if (this.type !== 'image/jpeg') return stream.call(this)
          Blob.prototype.stream = stream
          // Report a large emitted chunk without allocating a large test buffer.
          const chunk = new Uint8Array(1)
          Object.defineProperty(chunk, 'byteLength', { value: 128 * 1024 * 1024 })
          return new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close() } })
        }
      } else Object.defineProperty(Blob.prototype, 'size', {
        ...size, get() { return this.type === 'image/jpeg' ? (boundary === 'ZIP headers' ? 128 : 80) * 1024 * 1024 : size.get!.call(this) },
      })
    }, boundary)
    try {
      await library.getByRole('button', { name: '导出所选', exact: true }).click()
      await confirmImageDownload(page)
      await expect(library.getByRole('alert')).toContainText('本次导出文件较大，请减少选择后分批导出。作品已保留。单次打包上限为 128 MiB。')
      if (boundary !== 'streamed bytes') await expect(library.getByRole('alert')).toContainText(boundary === 'combined files' ? '第 2 项' : '第 1 项')
      await expect(library.locator('.batch-toolbar')).toContainText('已选 2')
      await expect(library.locator('.gallery-item')).toHaveCount(2)
      expect(downloads).toHaveLength(0)
    } finally { await page.evaluate(() => (window as any).restoreExportBudget()) }
    expect(await stored(page)).toEqual(before)
    const retry = page.waitForEvent('download')
    await library.getByRole('button', { name: '重新导出', exact: true }).click()
    await confirmImageDownload(page)
    const entries = await readDownloadArchive(await retry)
    expect([...entries.keys()]).toEqual([0, 1].map(index => expect.stringContaining(`creation-reuse-${index}-1.jpg`)))
    expect([...entries.values()].every(file => file.equals(pictures[0]!))).toBe(true)
    expect(downloads).toHaveLength(1)
    expect(generation).toHaveLength(0)
  })
}

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

test('manual selection and filtered select-all each download one ZIP containing the chosen originals', async ({ page }) => {
  const { library, generation, pictures } = await fixture(page, 4, true)
  const downloads: Download[] = []
  page.on('download', download => downloads.push(download))
  await expect(library.getByRole('button', { name: /导出全部/ })).toHaveCount(0)
  await library.getByRole('button', { name: '批量操作', exact: true }).click()
  await expect(library.getByRole('button', { name: '导出所选', exact: true })).toBeDisabled()
  await library.getByRole('checkbox', { name: '选择 作品 0 · 1', exact: true }).check()
  await library.getByRole('checkbox', { name: '选择 作品 0 · 3', exact: true }).check()
  const selectedDownload = await exportSelection(page, library)
  expect(selectedDownload.suggestedFilename()).toMatch(/\.zip$/i)
  const selected = await readDownloadArchive(selectedDownload)
  expect([...selected.keys()]).toEqual([
    expect.stringMatching(/creation-reuse-0-1\.jpg$/), expect.stringMatching(/creation-reuse-0-3\.jpg$/),
  ])
  expect([...selected.values()].map((file, i) => file.equals(pictures[i * 2]!))).toEqual([true, true])
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toHaveLength(1)

  await library.getByRole('button', { name: '取消选择', exact: true }).click()
  await library.getByRole('combobox', { name: '按模型筛选', exact: true }).selectOption('flux')
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  await selectAll(library)
  const filtered = await readDownloadArchive(await exportSelection(page, library))
  expect([...filtered.keys()]).toEqual([
    expect.stringMatching(/creation-reuse-1-1\.jpg$/), expect.stringMatching(/creation-reuse-3-1\.jpg$/),
  ])
  expect([...filtered.values()].every(file => file.equals(pictures[0]!))).toBe(true)
  expect(downloads).toHaveLength(2)
  expect(generation).toHaveLength(0)
})

test('select-all exports all 65 originals in one ZIP while only the first 60 cards are loaded', async ({ page }) => {
  const { library, generation, pictures } = await fixture(page, 65)
  const downloads: Download[] = []
  page.on('download', download => downloads.push(download))
  await expect(library.locator('.gallery-item')).toHaveCount(60)
  await selectAll(library)
  await expect(library.locator('.batch-toolbar')).toContainText('已选 65')
  const entries = await readDownloadArchive(await exportSelection(page, library))
  expect([...entries.keys()].map(name => name.slice(name.indexOf('creation-')))).toEqual(
    Array.from({ length: 65 }, (_, i) => `creation-reuse-${i}-1.jpg`),
  )
  expect([...entries.values()].every(file => file.equals(pictures[0]!))).toBe(true)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toHaveLength(1)
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
  await library.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(5)
  await expect(library.locator('.gallery-scroll')).toHaveAttribute('aria-busy', 'false')
  await expect(library.locator('.gallery-stats')).toContainText('65 条')
  expect(await page.evaluate(() => (window as any).relativeDateSummaryReads)).toBe(0)
  await selectAll(library)
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
  await selectAll(library)
  await library.getByRole('button', { name: '导出所选', exact: true }).click()
  await confirmImageDownload(page)
  await expect.poll(() => downloads.length).toBe(1)
  await expect(library.locator('.gallery-export')).toHaveCount(0)
  expect(downloads).toEqual(['creation-reuse-3-1.jpg'])
  await library.getByRole('button', { name: '删除选中记录', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(2)
  expect((await stored(page))?.map(task => task.phase).sort()).toEqual(['attention', 'paused'])
})
