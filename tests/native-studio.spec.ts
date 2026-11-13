import { mkdir, readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const screenshotDirectory = '.impeccable/review/native-studio'
const asset = 'public/assets/brand/octopus-community.jpg'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile(asset)
  const calls: { path: string; body: Record<string, unknown>; csrf?: string }[] = []
  let uploads = 0
  await page.route('**/legacy-files/**', route => route.fulfill({ contentType: 'image/jpeg', body: image }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => {
    uploads++
    return route.fulfill({ json: { file: { id: `fixture-file-${uploads}`, url: `/legacy-files/file-${uploads}.jpg`, name: 'creation.jpg', type: 'image/jpeg', size: image.length } } })
  })
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [] } })
    calls.push({ path: '/api/works', body: route.request().postDataJSON() })
    return route.fulfill({ json: { work: { id: 'published-native-work', status: 'pending' } } })
  })
  await page.route('**/api/creation/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { items: [
      { id: 'fixture-image', name: '图片测试模型', kinds: ['image'], protocol: 'openai' },
      { id: 'fixture-video', name: '视频测试模型', kinds: ['video'], protocol: 'openai' },
      { id: 'fixture-text', name: '文本测试模型', kinds: ['text'], protocol: 'openai' },
    ] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    calls.push({ path, body: request.method() === 'POST' ? request.postDataJSON() : {}, csrf: request.headers()['x-csrf-token'] })
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/creation.jpg' }], tokenId: 41, protocol: 'openai' } })
  })
  return { ...account, calls, image, uploads: () => uploads }
}

test('native image generation uses the existing account, uploads references and publishes to the community', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('章鱼在海底图书馆阅读')
  await page.locator('.reference-upload input').setInputFiles(asset)
  await expect(page.locator('.reference-list li')).toHaveCount(1)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await expect(page.locator('.creation-media img')).toBeVisible()
  expect(await page.locator('.creation-media img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const generation = state.calls.find(call => call.path === '/api/creation/generate')!
  expect(generation.body).toMatchObject({ kind: 'image', model: 'fixture-image', referenceUrls: ['/legacy-files/file-1.jpg'], n: 1 })
  expect(generation.body.requestId).toMatch(/^[a-f\d-]{36}$/)
  expect(generation.csrf).toBe('unified-account-fixture')
  expect(generation.body).not.toHaveProperty('tokenId')
  await mkdir(screenshotDirectory, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshotDirectory}/image-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill('海底图书馆')
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '作品已提交审核' })).toBeVisible()
  const publication = state.calls.find(call => call.path === '/api/works')!
  expect(publication.body).toMatchObject({ kind: 'image', title: '海底图书馆', fileIds: ['fixture-file-2'], requestId: generation.body.requestId })
  expect(state.uploads()).toBe(2)
  expect(errors).toEqual([])
})

test('asynchronous video waits can stop and recover with GET using the original token and protocol', async ({ page }) => {
  const state = await fixture(page)
  let submissions = 0, queries = 0
  const queryMetadata: URLSearchParams[] = []
  await page.route('**/api/creation/generate', route => {
    submissions++
    return route.fulfill({ json: { status: 'pending', upstreamId: 'upstream-video', tokenId: 83, protocol: 'async', outputs: [], progress: 20 } })
  })
  await page.route('**/api/creation/tasks/video/**', route => {
    queries++; queryMetadata.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: queries === 1
      ? { status: 'pending', upstreamId: 'upstream-video', tokenId: 83, protocol: 'async', progress: 35, outputs: [] }
      : { status: 'succeeded', upstreamId: 'upstream-video', tokenId: 83, protocol: 'async', mediaPath: 'videos/upstream-video/content', outputs: [] } })
  })
  await page.goto('/create/video')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('水母在深海发光')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => queries).toBe(1)
  await page.getByRole('button', { name: '停止等待', exact: true }).click()
  await expect(page.locator('.task-message')).toContainText('上游任务可能仍在执行')
  await page.reload()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(submissions).toBe(1)
  expect(queries).toBe(2)
  for (const query of queryMetadata) {
    expect(query.get('protocol')).toBe('async')
    expect(query.get('tokenId')).toBe('83')
  }
  const source = new URL((await page.locator('.creation-media video').getAttribute('src'))!, page.url())
  expect(source.pathname).toBe('/api/creation/media')
  expect(source.searchParams.get('path')).toBe('videos/upstream-video/content')
  expect(source.searchParams.get('tokenId')).toBe('83')
  expect(source.searchParams.get('kind')).toBe('video')
  await page.goto('/library')
  await expect(page.getByRole('complementary', { name: '后台生成任务', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看任务', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/video$/)
  expect(state.mutations.some(item => item.path.includes('authorize'))).toBe(false)
})

test('an uncertain paid request stays in history and is never automatically submitted again', async ({ page }) => {
  await fixture(page)
  let submissions = 0
  await page.route('**/api/creation/generate', route => {
    submissions++
    return route.fulfill({ status: 503, json: { message: '上游响应中断' } })
  })
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留一次请求的记录')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('需要核对')
  await expect(page.locator('.task-message')).toContainText('请勿自动重复提交')
  await page.reload()
  await expect(page.locator('.task-status')).toContainText('需要核对')
  expect(submissions).toBe(1)
  let recoveries = 0
  await page.route('**/api/creation/requests/**', route => { recoveries++; return route.fulfill({ json: { status: 'indeterminate', outputs: [] } }) })
  await page.getByRole('button', { name: '继续查询', exact: true }).click()
  await expect.poll(() => recoveries).toBe(1)
  expect(submissions).toBe(1)
})

test('legacy tasks without the original token stay untouched while base64 image results still render', async ({ page }) => {
  const state = await fixture(page)
  let queries = 0
  await page.route('**/api/creation/tasks/**', route => { queries++; return route.fulfill({ json: { status: 'failed', outputs: [] } }) })
  await page.route('**/api/creation/generate', route => route.fulfill({ json: {
    status: 'succeeded', tokenId: 41, protocol: 'openai', outputs: [{ b64_json: state.image.toString('base64') }],
  } }))
  await page.goto('/create/image')
  await page.evaluate(() => {
    localStorage.setItem('octopus:user-17:task:missing-token', JSON.stringify({
      id: 'missing-token', kind: 'image', model: 'fixture-image', prompt: '缺少原始令牌的旧任务', upstreamId: 'legacy-upstream', protocol: 'async',
    }))
    localStorage.setItem('octopus:user-17:task:custom-source', JSON.stringify({
      id: 'custom-source', kind: 'video', model: 'fixture-video', prompt: '自定义接口的旧任务', upstreamId: 'custom-upstream', tokenId: 83, customApiBase: 'https://custom.example', protocol: 'openai',
    }))
  })
  await page.reload()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await expect(page.locator('.task-message')).toContainText('缺少原始令牌')
  expect(queries).toBe(0)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('生成可读取的图片数据')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await expect.poll(() => page.locator('.creation-media img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(await page.locator('.creation-media img').getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(queries).toBe(0)
})

test('native text results can download and publish without a separate chat account', async ({ page }) => {
  const state = await fixture(page)
  await page.route('**/api/creation/generate', route => route.fulfill({ json: {
    status: 'succeeded', tokenId: 41, protocol: 'openai', outputs: [{ text: '海底的灯亮了。\\n章鱼开始写作。' }],
  } }))
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('写一个海底故事')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.message-content')).toContainText('章鱼开始写作')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载文本', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.md$/)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '作品已提交审核' })).toBeVisible()
  expect(state.calls.find(call => call.path === '/api/works')?.body).toMatchObject({ kind: 'resource', body: '海底的灯亮了。\\n章鱼开始写作。', fileIds: ['fixture-file-1'] })
})

test('changing the unified account ID clears previous results and isolates drafts even with stale account metadata', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('账号 17 的私有提示词')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  state.state.user.id = '18'
  state.state.user.username = 'another-user'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.history-row')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-image')
  const drafts = await page.evaluate(() => ({
    previous: localStorage.getItem('octopus:user-17:native-creation-draft:image'),
    current: localStorage.getItem('octopus:user-18:native-creation-draft:image'),
  }))
  expect(JSON.parse(drafts.previous!)).toMatchObject({ prompt: '账号 17 的私有提示词' })
  expect(drafts.current || '').not.toContain('私有提示词')
  const history = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result) })
    return new Promise<{ owner: string }[]>(resolve => {
      const transaction = db.transaction('keyval', 'readonly'), request = transaction.objectStore('keyval').get('octopus:user-17:native-creation-history')
      transaction.oncomplete = () => { db.close(); resolve(JSON.parse(request.result)) }
    })
  })
  expect(history.map(task => task.owner)).toEqual(['17'])
})

test('retired composite owners are discarded instead of being migrated into the unified account history', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result) })
    await new Promise<void>(resolve => {
      const transaction = db.transaction('keyval', 'readwrite')
      transaction.objectStore('keyval').put(JSON.stringify([{
        id: 'retired-owner-task', owner: '17:na_retired_debug_id', kind: 'image', model: 'fixture-image', prompt: '旧内部编号下的调试内容',
        createdAt: Date.now(), phase: 'complete', protocol: 'openai', urls: ['https://media.example/old.jpg'], text: '', references: [],
        request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
      }]), 'octopus:user-17:native-creation-history')
      transaction.oncomplete = () => { db.close(); resolve() }
    })
  })
  await page.reload()
  await expect(page.locator('.history-row')).toHaveCount(0)
  await expect(page.locator('.creation-canvas')).toContainText('开始图片创作')
  expect(state.calls.filter(call => call.path === '/api/creation/generate' || call.path.includes('/tasks/'))).toHaveLength(0)
})

test('legacy account-scoped gallery and video attachments remain readable without mutating their sources', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  await page.evaluate(async bytes => {
    localStorage.setItem('octopus:guest:task:unowned', JSON.stringify({ id: 'unowned', kind: 'image', prompt: '别的账号', model: 'fixture-image' }))
    localStorage.setItem('octopus:user-18:task:unowned-other', JSON.stringify({ id: 'unowned-other', kind: 'video', prompt: '别的账号', model: 'fixture-video' }))
    const snapshotKey = 'octopus:user-17:video-workspace-results'
    const snapshot = JSON.stringify({ version: 1, state: { results: [{ id: 'legacy-video', prompt: '旧视频提示词', model: 'fixture-video', status: 'success', createdAt: 1, url: { __octopusChatAsset: 'video-file' } }] }, __octopusChatAssets: { format: 'octopus-chat-assets-v1', ids: ['video-file'] } })
    const main = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('keyval')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>(resolve => {
      const transaction = main.transaction('keyval', 'readwrite'), store = transaction.objectStore('keyval')
      store.put(snapshot, snapshotKey); store.put('https://media.example/legacy-video.mp4', `${snapshotKey}:asset:video-file`)
      transaction.oncomplete = () => { main.close(); resolve() }
    })
    const gallery = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('octopus-gallery-user-17', 3)
      request.onupgradeneeded = () => { request.result.createObjectStore('images', { keyPath: 'id' }); request.result.createObjectStore('originals'); request.result.createObjectStore('settings', { keyPath: 'key' }) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
    await new Promise<void>(resolve => {
      const transaction = gallery.transaction(['images', 'originals'], 'readwrite')
      for (let index = 0; index < 201; index++) {
        const id = `legacy-image-${index}`
        transaction.objectStore('images').put({ id, prompt: `旧图库图片 ${index}`, model: 'fixture-image', imageData: '', thumbnail: blob, status: 'success', width: 1024, height: 1024, createdAt: 2 + index })
        transaction.objectStore('originals').put(blob, id)
      }
      transaction.oncomplete = () => { gallery.close(); resolve() }
    })
  }, [...state.image])
  await page.reload()
  await expect(page.locator('.history-row')).toHaveCount(201)
  await expect(page.locator('.creation-media img')).toBeVisible()
  await expect.poll(() => page.locator('.creation-media img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '视频', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(1)
  const videoUrl = new URL((await page.locator('.creation-media video').getAttribute('src'))!, page.url())
  expect(videoUrl.searchParams.get('url')).toBe('https://media.example/legacy-video.mp4')
  expect(videoUrl.searchParams.get('kind')).toBe('video')
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result) })
    return new Promise<{ native: unknown[]; snapshot: string; guest: boolean }>(resolve => {
      const transaction = db.transaction('keyval', 'readonly'), store = transaction.objectStore('keyval')
      const native = store.get('octopus:user-17:native-creation-history'), snapshot = store.get('octopus:user-17:video-workspace-results')
      transaction.oncomplete = () => { db.close(); resolve({ native: JSON.parse(native.result), snapshot: snapshot.result, guest: Boolean(localStorage.getItem('octopus:guest:task:unowned')) }) }
    })
  })
  expect(stored.native).toHaveLength(202)
  expect(stored.snapshot).toContain('__octopusChatAsset')
  expect(stored.guest).toBe(true)
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(0)
})
