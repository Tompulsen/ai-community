import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function galleryFixture(page: Page, count = 185, outputs = 1) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#365d7d' } }).jpeg().toBuffer()
  const generation: unknown[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path.endsWith('/media')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path.endsWith('/generate')) generation.push(route.request().postDataJSON())
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 })
    const live = new Set<string>(), create = URL.createObjectURL, revoke = URL.revokeObjectURL
    ;(window as any).__liveURLs = live
    URL.createObjectURL = function (blob) { const url = create.call(this, blob); live.add(url); return url }
    URL.revokeObjectURL = function (url) { live.delete(url); return revoke.call(this, url) }
    if (sessionStorage.getItem('browser-stability-fixture')) return
    sessionStorage.setItem('browser-stability-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'stable-empty', mediaConversationsMigrated: true,
      sessions: [{ id: 'stable-empty', creationKind: 'text', topic: '空会话', model: 'gpt-5', lastUpdate: now, settings: {}, skillIds: [], messages: [] }],
    } }))
  })
  await page.route('**/__browser-stability-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage fixture</title>' }))
  await page.goto('/__browser-stability-fixture')
  await page.evaluate(async ({ count, outputs }) => {
    const store = await import('/src/studio-task-store.ts'), now = Date.now()
    const tasks = Array.from({ length: count }, (_, index) => ({
      id: `stable-${index}`, owner: '17', conversationId: `stable-${index}`, kind: 'image', model: 'gpt-image-2',
      prompt: `历史作品 ${String(index).padStart(3, '0')}`, createdAt: now - index, settledAt: now,
      phase: 'complete', protocol: 'sync', references: [], text: '',
      urls: Array.from({ length: outputs }, (_, output) => `https://media.example/${index}-${output}.jpg`), request: {},
    }))
    await store.saveTaskSnapshot('17', tasks)
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48
    canvas.getContext('2d')!.fillRect(0, 0, 64, 48)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp'))
    for (const task of tasks) for (const [index, url] of task.urls.entries()) await store.saveTaskPreview('17', task.id, JSON.stringify(['image', url]), blob, undefined, index)
  }, { count, outputs })
  await page.goto('/create/text')
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library.locator('.gallery-item')).toHaveCount(Math.min(count * outputs, 60))
  return { account, library, generation }
}

test('long low-memory gallery pages bound DOM and release offscreen URLs without losing selection', async ({ page }, info) => {
  const { library, generation } = await galleryFixture(page)
  const scroll = library.locator('.gallery-scroll'), samples: { cards: number; images: number; urls: number }[] = []
  await expect(library.locator('.gallery-cover img').first()).toBeVisible()
  await library.getByRole('button', { name: '批量操作', exact: true }).click()
  await library.getByRole('checkbox', { name: '选择 历史作品 000', exact: true }).check()
  for (let index = 0; index < 3; index++) {
    for (const fraction of [0, .5, 1]) {
      await scroll.evaluate((element, fraction) => { element.scrollTop = element.scrollHeight * fraction }, fraction)
      await page.waitForTimeout(120)
      samples.push(await page.evaluate(() => ({ cards: document.querySelectorAll('.gallery-item').length, images: document.querySelectorAll('.gallery-cover img').length, urls: (window as any).__liveURLs.size })))
    }
    await library.getByRole('button', { name: /^(下一页|加载更多)$/ }).click()
  }
  await info.attach('gallery-memory-samples', { body: JSON.stringify(samples), contentType: 'application/json' })
  await writeFile(info.outputPath('gallery-memory-samples.json'), JSON.stringify(samples, null, 2))
  await expect(library.locator('.gallery-item')).toHaveCount(5)
  await expect(library.locator('.gallery-stats')).toContainText('已选 1')
  for (let index = 0; index < 3; index++) await library.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(library.getByRole('checkbox', { name: '选择 历史作品 000', exact: true })).toBeChecked()
  await scroll.evaluate(element => { element.scrollTop = 0 })
  await expect(library.locator('.gallery-cover img').first()).toBeVisible()
  expect(samples.every(sample => sample.cards <= 60 && sample.images <= 24 && sample.urls <= 30)).toBe(true)
  await page.getByRole('button', { name: '关闭作品库', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__liveURLs.size)).toBeLessThanOrEqual(2)
  expect(generation).toEqual([])
})

test('a single large multi-image result is paged without truncating outputs or selection', async ({ page }) => {
  const { library, generation } = await galleryFixture(page, 1, 125)
  await library.getByRole('button', { name: '批量操作', exact: true }).click()
  await library.getByRole('button', { name: '全选筛选结果', exact: true }).click()
  await expect(library.locator('.gallery-stats')).toContainText('已选 125')
  await library.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(library.locator('.gallery-item.selected')).toHaveCount(60)
  await library.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(library.locator('.gallery-item.selected')).toHaveCount(5)
  await library.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(library.locator('.gallery-item.selected')).toHaveCount(60)
  expect(generation).toEqual([])
})

async function emptyFixture(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, items: [] } }))
  await page.route('**/__browser-stability-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Browser fixture</title>' }))
  await page.goto('/__browser-stability-fixture')
}

test('conversation entry and switching load only the selected attachments and recover from a failed session', async ({ page }, info) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let generations = 0
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/generate')) generations++
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.route('**/__browser-stability-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Chat fixture</title>' }))
  await page.goto('/__browser-stability-fixture')
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#365d7d' } }).png().toBuffer()
  const content = `![Generated Image](data:image/png;base64,${Buffer.concat([png, Buffer.alloc(80_000)]).toString('base64')})`
  await page.evaluate(async content => {
    const { set } = await import('/shared/studio/studio-keyval.ts')
    const name = 'octopus:user-17:native-chat'
    const sessions = ['first', 'second', 'missing'].map((id, index) => ({ id, creationKind: 'text', topic: ['第一张生成图片', '未读取生成图片', '附件读取失败'][index],
      model: 'gpt-5', lastUpdate: Date.now() - index, settings: {}, skillIds: [], messages: [{ id: id + '-message', role: 'assistant', content: { __octopusChatAsset: id } }] }))
    await set(name, JSON.stringify({ version: 1, __octopusChatAssets: { format: 'octopus-chat-assets-v1', ids: ['first', 'second', 'missing'] },
      state: { _hasHydrated: true, activeId: 'first', mediaConversationsMigrated: true, sessions } }))
    await set(`${name}:asset:first`, content); await set(`${name}:asset:second`, content + '\nsecond')
    await set(`${name}:asset:missing`, content + '\nmissing')
  }, content)
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get
    ;(window as any).__chatAssetReads = []
    IDBObjectStore.prototype.get = function (key) {
      if (String(key).includes(':asset:')) (window as any).__chatAssetReads.push(String(key))
      if ((window as any).__failMissing && String(key).endsWith(':asset:missing')) return get.call(this, '__unavailable_for_test__')
      return get.call(this, key)
    }
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/text')
  const composer = page.getByRole('textbox', { name: '消息', exact: true }), sidebar = page.locator('.studio-sidebar')
  const moduleState = () => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/src\/native-chat\.ts(?:\?|$)/.test(url))!
    const { chats } = await import(/* @vite-ignore */ path)
    return { active: chats.activeId, contents: chats.sessions.map((chat: any) => ({ id: chat.id, type: typeof chat.messages[0]?.content })), reads: (window as any).__chatAssetReads }
  })
  try {
    await expect(composer).toBeVisible()
    expect(await moduleState()).toMatchObject({ active: 'first', contents: [{ id: 'first', type: 'string' }, { id: 'second', type: 'object' }, { id: 'missing', type: 'object' }], reads: ['octopus:user-17:native-chat:asset:first'] })
    await page.setViewportSize({ width: 390, height: 900 })
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    const history = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
    await history.getByRole('searchbox', { name: '搜索对话', exact: true }).fill('未读取生成图片')
    await expect(history.getByRole('button', { name: '未读取生成图片', exact: true })).toBeVisible()
    expect((await moduleState()).reads).toEqual(['octopus:user-17:native-chat:asset:first'])
    await history.getByRole('searchbox', { name: '搜索对话', exact: true }).fill('')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await sidebar.getByRole('button', { name: '未读取生成图片', exact: true }).click()
    await expect(composer).toBeVisible()
    await expect.poll(async () => (await moduleState()).active).toBe('second')
    expect(await moduleState()).toMatchObject({ contents: [{ id: 'first', type: 'object' }, { id: 'second', type: 'string' }, { id: 'missing', type: 'object' }] })
    await page.reload()
    await expect(composer).toBeVisible()
    await page.evaluate(() => { (window as any).__failMissing = true })
    await sidebar.getByRole('button', { name: '附件读取失败', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '原始记录已保留' })).toBeVisible()
    await expect(composer).toHaveCount(0)
    await sidebar.getByRole('button', { name: '新对话', exact: true }).first().click()
    await expect(composer).toBeVisible()
    await expect(composer).toHaveValue('')
    expect((await moduleState()).contents.some(value => value.id === 'missing' && value.type === 'object')).toBe(true)
    expect(errors).toEqual([]); expect(generations).toBe(0)
  } finally {
    const debug = await page.evaluate(() => {
      for (const element of document.querySelectorAll('*')) {
        let component = (element as any).__vueParentComponent
        while (component) {
          if (component.type.__file?.endsWith('/CreateView.vue')) {
            const state = component.setupState
            return { loaded: state.conversationLoaded, loading: state.conversationLoading, issue: state.conversationIssue,
              current: state.currentConversation?.id, ready: state.chats?.ready, query: state.route?.query }
          }
          component = component.parent
        }
      }
    })
    await info.attach('conversation-state', { body: JSON.stringify({ debug, state: await moduleState(), errors }), contentType: 'application/json' })
    await writeFile(info.outputPath('conversation-state.json'), JSON.stringify({ debug, state: await moduleState(), errors }, null, 2))
  }
})

test('thumbnail decoding bounds original reads, cancels queued and active work, and releases resources', async ({ page }) => {
  await emptyFixture(page)
  const result = await page.evaluate(async () => {
    const { imageThumbnail } = await import('/src/studio-media-previews.ts')
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    const decode = HTMLImageElement.prototype.decode, create = URL.createObjectURL, revoke = URL.revokeObjectURL
    const gates: (() => void)[] = [], images: HTMLImageElement[] = [], live = new Set<string>()
    let reads = 0
    HTMLImageElement.prototype.decode = async function () {
      images.push(this)
      await decode.call(this)
      await new Promise<void>(resolve => gates.push(resolve))
    }
    URL.createObjectURL = function (blob) { const url = create.call(this, blob); live.add(url); return url }
    URL.revokeObjectURL = function (url) { live.delete(url); return revoke.call(this, url) }
    const waitFor = async (ready: () => boolean) => { while (!ready()) await new Promise(resolve => setTimeout(resolve, 10)) }
    try {
      const controllers = Array.from({ length: 10 }, () => new AbortController())
      const pending = controllers.map(controller => imageThumbnail(async () => { reads++; return blob }, controller.signal))
      const settled = Promise.allSettled(pending)
      await waitFor(() => gates.length === 2)
      const concurrent = images.length
      controllers.slice(2).forEach(controller => controller.abort())
      gates.splice(0).forEach(resolve => resolve())
      const results = await settled
      const active = new AbortController(), cancelled = imageThumbnail(blob, active.signal)
      const cancellation = cancelled.catch(error => error.name)
      await waitFor(() => gates.length === 1)
      active.abort()
      const cancellationName = await cancellation
      gates.splice(0).forEach(resolve => resolve())
      return { reads, concurrent, fulfilled: results.filter(result => result.status === 'fulfilled').length, rejected: results.filter(result => result.status === 'rejected').length,
        cancellationName, live: live.size, imageSources: images.filter(image => image.hasAttribute('src')).length }
    } finally {
      gates.splice(0).forEach(resolve => resolve())
      HTMLImageElement.prototype.decode = decode; URL.createObjectURL = create; URL.revokeObjectURL = revoke
    }
  })
  expect(result).toEqual({ reads: 2, concurrent: 2, fulfilled: 2, rejected: 8, cancellationName: 'AbortError', live: 0, imageSources: 0 })
})

test('storage estimates deduplicate concurrent reads, retain unknown values and never equate quota with RAM', async ({ page }) => {
  await emptyFixture(page)
  const result = await page.evaluate(async () => {
    const storage = await import('/src/browser-storage.ts')
    let calls = 0, release!: (value: StorageEstimate) => void
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: () => { calls++; return new Promise(resolve => { release = resolve }) } } })
    const pending = Array.from({ length: 12 }, () => storage.refreshBrowserStorage(true))
    release({ usage: 1024 ** 3, quota: 4 * 1024 ** 3 })
    const values = await Promise.all(pending)
    await storage.refreshBrowserStorage()
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
    const unknown = await storage.refreshBrowserStorage(true)
    return { calls, pressure: values[0]!.pressure, same: values.every(value => value === values[0]), unknown, display: storage.formatStorageBytes(unknown.usage) }
  })
  expect(result).toMatchObject({ calls: 1, pressure: 'strong', same: true, unknown: { usage: null, quota: null, pressure: 'unknown' }, display: '暂无法读取' })
})

test('independent recovery avoids heavy history and deletes only explicitly selected thumbnail caches', async ({ page }, info) => {
  await emptyFixture(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio-media', 2)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const name of ['tasks', 'previews']) db.createObjectStore(name, { keyPath: ['owner', 'id'] })
        db.createObjectStore('originals', { keyPath: ['owner', 'key'] })
        db.createObjectStore('contents', { keyPath: ['owner', 'identity'] })
        db.createObjectStore('meta', { keyPath: 'owner' })
      }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['tasks', 'previews', 'originals', 'contents', 'meta'], 'readwrite')
    for (const owner of ['17', '18']) {
      tx.objectStore('tasks').put({ owner, id: 'work', value: { prompt: '历史原图', urls: ['studio-asset:work:0'] } })
      tx.objectStore('previews').put({ owner, id: 'work', blob: new Blob(['thumbnail'], { type: 'image/webp' }) })
      tx.objectStore('originals').put({ owner, key: 'work:0', identity: 'shared-original', taskId: 'work' })
      tx.objectStore('contents').put({ owner, identity: 'shared-original', blob: new Blob(['original-' + owner], { type: 'image/png' }) })
      tx.objectStore('meta').put({ owner, revision: 'tasks-unchanged', storageRevision: 'before' })
      localStorage.setItem(`octopus:user-${owner}:native-chat`, JSON.stringify({ history: 'x'.repeat(750_000) }))
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error) })
    db.close()
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 1.5 * 1024 ** 3, quota: 2 * 1024 ** 3 }) } })
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = function (key) { if (key.includes('native-chat')) throw new Error('Recovery read heavy chat history'); return get.call(this, key) }
  })
  const resources: string[] = [], errors: string[] = []
  page.on('request', request => resources.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/storage-recovery')
  await expect(page.getByRole('heading', { name: '浏览器存储恢复', exact: true })).toBeVisible()
  await expect(page.getByText('1.50 GiB', { exact: true })).toBeVisible()
  const clean = page.getByRole('button', { name: '清理所选账号的缩略图缓存', exact: true })
  await expect(clean).toBeDisabled()
  await page.getByRole('combobox', { name: '选择要整理的本地账号', exact: true }).selectOption('17')
  await expect(clean).toBeEnabled(); await clean.click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await clean.click(); await page.getByRole('button', { name: '确认清理缩略图', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已清理账号 17 的 1 条缩略图缓存' })).toBeVisible()
  expect(resources.some(url => /\/src\/(?:App\.vue|native-studio\.ts|studio-task-store\.ts|router\.ts)/.test(url))).toBe(false)
  expect(errors).toEqual([])
  const result = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio-media'); request.onsuccess = () => resolve(request.result) })
    const get = (name: string) => new Promise<any[]>(resolve => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result) })
    const [tasks, previews, originals, contents, meta] = await Promise.all(['tasks', 'previews', 'originals', 'contents', 'meta'].map(get))
    db.close()
    return { taskOwners: tasks.map(value => value.owner), previewOwners: previews.map(value => value.owner), originalOwners: originals.map(value => value.owner),
      blobs: await Promise.all(contents.map(value => value.blob.text())), revisions: meta.map(value => value.revision), chatOwners: ['17', '18'].filter(owner => Object.keys(localStorage).includes(`octopus:user-${owner}:native-chat`)) }
  })
  expect(result).toEqual({ taskOwners: ['17', '18'], previewOwners: ['18'], originalOwners: ['17', '18'], blobs: ['original-17', 'original-18'], revisions: ['tasks-unchanged', 'tasks-unchanged'], chatOwners: ['17', '18'] })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`recovery-${width}.png`), fullPage: true })
  }
})

test('capacity reminders collapse once per level while a later stronger warning remains visible', async ({ page }) => {
  await emptyFixture(page)
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 600 * 1024 ** 2, quota: 4 * 1024 ** 3 }) } })
    const { default: Notice } = await import('/src/components/BrowserStorageNotice.vue')
    const vuePath = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/vue\.js(?:\?|$)/.test(url))!
    const { createApp } = await import(/* @vite-ignore */ vuePath)
    const storagePath = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/src\/browser-storage\.ts(?:\?|$)/.test(url))!
    ;(window as any).__noticeStorage = await import(/* @vite-ignore */ storagePath)
    createApp(Notice).mount(document.body.appendChild(document.createElement('div')))
  })
  const notice = page.getByRole('complementary', { name: '浏览器存储提醒', exact: true })
  await expect(notice).toContainText('浏览器存储使用较多')
  await notice.getByRole('button', { name: '暂时收起', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('community:storage-changed')))
  await expect(notice).toHaveCount(0)
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 1.2 * 1024 ** 3, quota: 4 * 1024 ** 3 }) } })
    const storage = (window as any).__noticeStorage
    await storage.refreshBrowserStorage(true); storage.notifyBrowserStorageChanged()
  })
  await expect(notice).toContainText('建议尽快整理浏览器存储')
  await notice.getByRole('button', { name: '暂时收起', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('community:storage-changed')))
  await expect(notice).toHaveCount(0)
})

test('unsupported storage remains unknown and recovery navigation stays usable', async ({ page }) => {
  const resources: string[] = []
  page.on('request', request => resources.push(request.url()))
  await page.route('**/api/**', route => route.fulfill({ json: { user: null } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Denied', 'SecurityError') } })
  })
  await page.goto('/storage-recovery/')
  await expect(page.getByRole('heading', { name: '浏览器存储恢复', exact: true })).toBeVisible()
  await expect(page.locator('.storage-metrics')).toContainText('暂无法读取')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '清理所选账号的缩略图缓存', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: '返回社区', exact: true })).toBeVisible()
  expect(resources.some(url => /\/src\/(?:App\.vue|native-studio\.ts|studio-task-store\.ts|router\.ts)/.test(url))).toBe(false)
})
