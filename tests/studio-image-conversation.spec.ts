import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, kind = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const calls: any[] = [], uploads: string[] = []
  let selectedGroup = 'auto'
  await page.route('**/api/new-api/model-groups**', route => {
    const select = new URL(route.request().url()).pathname.endsWith('/select')
    if (select) { selectedGroup = route.request().postDataJSON().group; return route.fulfill({ json: { success: true, data: { group: selectedGroup, selectedTokenId: 41 } } }) }
    return route.fulfill({ json: { success: true, data: { selectedGroup, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }, { id: 'image', name: '图片', ratio: 1 }], selectedTokenId: 41 } } })
  })
  await page.route('**/api/uploads**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { imagesMb: 20, filesMb: 20, videosMb: 100 } })
    uploads.push('uploaded')
    return route.fulfill({ json: { file: { id: `upload${uploads.length}`, name: 'reference.png', url: `/legacy-files/upload${uploads.length}`, type: 'image', size: image.length } } })
  })
  await page.route('**/legacy-files/**', route => route.fulfill({ contentType: 'image/jpeg', body: image }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'gemini-3-pro-image-preview', kinds: ['image'] },
      { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
    ] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/generate') {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: `https://media.example/output-${calls.length}.png` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('image-conversation-fixture')) return
    sessionStorage.setItem('image-conversation-fixture', '1')
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'image-a', mediaConversationsMigrated: true, sessions: [
        { id: 'image-a', mediaConversationId: 'image-a', creationKind: 'image', topic: '图片对话', model: 'gpt-image-2', lastUpdate: Date.now(), settings: {}, skillIds: [], messages: [] },
        { id: 'image-b', mediaConversationId: 'image-b', creationKind: 'image', topic: '另一图片对话', model: 'gpt-image-2', lastUpdate: Date.now() - 1, settings: {}, skillIds: [], messages: [] },
      ],
    } }))
  })
  await page.goto(`/create/${kind}`)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(kind === 'video' ? 'sora-2' : kind === 'text' ? 'gpt-5' : 'gpt-image-2')
  return { calls, uploads, image }
}
async function send(page: Page, prompt: string, turns: number) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(prompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(turns)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
}

test('follow-up carries the previous image and history in one session, with independent drafts', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '一只白猫', 1)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '背景改成蓝色', 2)
  expect(calls[0].imageContext.turns).toEqual([])
  expect(calls[1].referenceUrls).toEqual(['https://media.example/output-1.png'])
  expect(calls[1].imageContext.turns).toEqual([{ prompt: '一只白猫', images: ['https://media.example/output-1.png'] }])
  expect(calls[1].conversationId).toBeUndefined()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('当前对话的草稿')
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '另一图片对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await sidebar.getByRole('button', { name: '图片对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('当前对话的草稿')
  await expect(page.locator('.creation-turn')).toHaveCount(2)
})

test('regeneration and edited prompts preserve alternate versions and use the selected branch for follow-up', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '一只白猫', 1)
  await page.getByRole('button', { name: '重新生成此轮', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveText('2 / 2')
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await page.getByRole('button', { name: '上一个版本', exact: true }).click()
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveText('1 / 2')
  await send(page, '戴上帽子', 2)
  expect(calls[2].referenceUrls).toEqual(['https://media.example/output-1.png'])
  await page.getByRole('button', { name: '编辑并重新生成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('一只黑猫')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.locator('.creation-request')).toContainText('一只黑猫')
  expect(calls[3].imageContext.turns).toEqual([])
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.locator('.creation-request')).toContainText('一只黑猫')
})

test('automatic references follow the latest result; clearing context and deleting turns keep gallery data', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '第一张', 1)
  await send(page, '第二张', 2)
  await send(page, '修改第二张', 3)
  expect(calls[2].referenceUrls).toEqual(['https://media.example/output-2.png'])
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '全新图片', 4)
  expect(calls[3].imageContext.turns).toEqual([])
  expect(calls[3].referenceUrls).toEqual([])
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: 800, height: viewport.height })
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '多选消息', exact: true }).click()
  await page.setViewportSize(viewport)
  await page.getByRole('checkbox', { name: '选择消息：第二张', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择消息：修改第二张', exact: true }).check()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除所选消息', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  const count = await page.evaluate(async () => {
    const { readTaskSnapshot } = await import('/src/studio-task-store.ts')
    return (await readTaskSnapshot('17'))?.length
  })
  expect(count).toBe(4)
})

test('upload, clipboard and drop references share the same attachment flow', async ({ page }) => {
  const { calls, uploads, image } = await fixture(page)
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'upload.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('textbox', { name: '提示词', exact: true }).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const data = new DataTransfer(); data.items.add(new File([bytes], 'pasted.jpg', { type: 'image/jpeg' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, image.toString('base64'))
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await page.locator('.studio-composer').evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const data = new DataTransfer(); data.items.add(new File([bytes], 'dropped.jpg', { type: 'image/jpeg' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  }, image.toString('base64'))
  await expect(page.locator('.reference-list img')).toHaveCount(3)
  await send(page, '使用这三张参考图', 1)
  expect(uploads).toHaveLength(0)
  expect(calls[0].referenceUrls).toEqual(Array(3).fill(`data:image/jpeg;base64,${image.toString('base64')}`))
})

test('sending clears uploaded references from the composer while retaining sent images and conversation context', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await send(page, '使用上传的参考图', 1)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(1)
  expect(calls[0].referenceUrls).toEqual([`data:image/jpeg;base64,${image.toString('base64')}`])
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(1)
  await send(page, '把背景改成蓝色', 2)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  expect(calls[1].referenceUrls).toEqual(['https://media.example/output-1.png'])
  expect(calls[1].imageContext.turns[0].references).toEqual([`data:image/jpeg;base64,${image.toString('base64')}`])
})

async function controlledReader(page: Page) {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL
    let failed = false
    FileReader.prototype.readAsDataURL = function (blob: Blob) {
      if (blob instanceof File && blob.name === 'slow.jpg' && !(window as any).__materialReleased) {
        (window as any).__releaseMaterial = () => { (window as any).__materialReleased = true; read.call(this, blob) }
        return
      }
      if (blob instanceof File && blob.name === 'retry.jpg' && !failed) {
        failed = true
        queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')))
        return
      }
      read.call(this, blob)
    }
  })
}

test('reference thumbnails scroll horizontally, preview and delete on desktop and touch', async ({ page }) => {
  const { image, uploads } = await fixture(page)
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles(Array.from({ length: 9 }, (_, index) => ({ name: `${index}.jpg`, mimeType: 'image/jpeg', buffer: image })))
  const list = page.locator('.reference-list')
  await expect(list.locator('li')).toHaveCount(9)
  expect(await list.evaluate(element => getComputedStyle(element).flexWrap)).toBe('nowrap')
  await page.getByRole('button', { name: '预览参考图 1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '参考图预览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭参考图预览', exact: true }).click()
  await list.locator('li').first().hover()
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await expect(list.locator('li')).toHaveCount(8)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.screenshot({ path: `.taste-skill/reference-upload-20261115/references-${width}.png` })
    expect(await list.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(width < 1000)
  }
  expect(uploads).toHaveLength(0)
})

test('removing a ready thumbnail preserves pending files and failed items can be retried', async ({ page }) => {
  await controlledReader(page)
  const { image, uploads } = await fixture(page)
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles([
    { name: 'ready.jpg', mimeType: 'image/jpeg', buffer: image },
    { name: 'slow.jpg', mimeType: 'image/jpeg', buffer: image },
    { name: 'retry.jpg', mimeType: 'image/jpeg', buffer: image },
  ])
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(2)
  await page.locator('.reference-list li').first().hover()
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(2)
  await page.evaluate(() => (window as any).__releaseMaterial())
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  await page.getByRole('button', { name: '重试失败附件', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await expect(page.locator('.material-status')).toHaveCount(0)
  expect(uploads).toHaveLength(0)
})

test('retrying a video image preserves the identity of numbered prompt references', async ({ page }) => {
  await controlledReader(page)
  const state = await fixture(page, 'video')
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles(['ready.jpg', 'retry.jpg', 'last.jpg'].map((name, index) => ({
    name, mimeType: 'image/jpeg', buffer: Buffer.concat([state.image, Buffer.from(String(index))]),
  })))
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('让 @图片2 动起来')
  await page.getByRole('button', { name: '重试失败附件', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(3)
  await expect(prompt).toHaveValue('让 @图片3 动起来')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.calls.length).toBe(1)
  expect(state.calls[0].prompt).toBe('让 @图片3 动起来')
  expect(state.calls[0].videoOptions.mode).toBe('reference-to-video')
})

test('touch reference previews and delete controls have separate hit areas', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage(), state = await fixture(page)
    await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'touch.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(page.locator('.reference-list img')).toHaveCount(1)
    await page.getByRole('button', { name: '预览参考图 1', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: '参考图预览', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭参考图预览', exact: true }).tap()
    const remove = page.getByRole('button', { name: '移除参考图 1', exact: true })
    expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: '.taste-skill/reference-upload-20261115/references-touch.png' })
    await remove.tap()
    await expect(page.locator('.reference-list img')).toHaveCount(0)
  } finally { await context.close() }
})

for (const kind of ['image', 'video', 'text']) {
  test(`${kind} waits for local image preparation after send and submits once`, async ({ page }) => {
    await controlledReader(page)
    const state = await fixture(page, kind)
    await page.locator('.studio-composer').getByLabel(kind === 'text' ? '添加附件' : '添加参考图', { exact: true }).setInputFiles({ name: 'slow.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(1)
    await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill('使用这张图片')
    await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消发送', exact: true })).toBeVisible()
    expect(state.calls).toHaveLength(0)
    await page.evaluate(() => (window as any).__releaseMaterial())
    await expect.poll(() => state.calls.length).toBe(1)
    if (kind === 'video') expect(state.calls[0].videoOptions.mode).toBe('image-to-video')
    if (kind === 'text') expect(state.calls[0].chatOptions.messages.at(-1).content.some((part: any) => part.type === 'image_url')).toBe(true)
    else expect(state.calls[0].referenceUrls).toHaveLength(1)
    await expect(page.locator('.reference-list img')).toHaveCount(0)
    expect(state.uploads).toHaveLength(0)
  })
}

test('cancelling material preparation keeps the draft and switching conversations never submits a late read', async ({ page }) => {
  await controlledReader(page)
  const state = await fixture(page)
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'slow.jpg', mimeType: 'image/jpeg', buffer: state.image })
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('保留我的草稿')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await page.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(prompt).toHaveValue('保留我的草稿')
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  await page.locator('.studio-sidebar').getByRole('button', { name: '另一图片对话', exact: true }).click()
  await page.evaluate(() => (window as any).__releaseMaterial())
  await expect(prompt).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  expect(state.calls).toHaveLength(0)
})

test('large local images are compressed before generation without a community upload', async ({ page }) => {
  const state = await fixture(page)
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 700
    const context = canvas.getContext('2d')!, pixels = context.createImageData(canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = Math.random() * 256; pixels.data[index + 1] = Math.random() * 256; pixels.data[index + 2] = Math.random() * 256; pixels.data[index + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  const prepared = await page.locator('.reference-list img').getAttribute('src')
  expect(prepared!.length).toBeLessThanOrEqual(512 * 1024)
  expect(prepared!.length).toBeLessThan(encoded.length)
  await send(page, '使用压缩参考图', 1)
  expect(state.calls[0].referenceUrls[0]).toBe(prepared)
  expect(state.uploads).toHaveLength(0)
})

test('model and group changes affect the next round while retaining history and image sizing on mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  const { calls } = await fixture(page)
  await send(page, '保留人物', 1)
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: '选择分组', exact: true }).click()
  await page.getByRole('button', { name: '图片 · 1×', exact: true }).click()
  await page.getByRole('button', { name: 'gemini-3-pro-image-preview', exact: true }).click()
  await send(page, '让人物微笑', 2)
  expect(calls[1].model).toBe('gemini-3-pro-image-preview')
  expect(calls[1].imageContext.turns).toHaveLength(1)
  await mkdir('.taste-skill/image-conversation-20261115', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const images = page.locator('.creation-image-preview img')
    await expect(images.last()).toBeVisible()
    const ratio = await images.last().evaluate((element: HTMLImageElement) => {
      const rect = element.getBoundingClientRect()
      return Math.abs(rect.width / rect.height - element.naturalWidth / element.naturalHeight)
    })
    expect(ratio).toBeLessThan(.02)
    await page.screenshot({ path: `.taste-skill/image-conversation-20261115/conversation-${width}.png` })
  }
  expect(errors).toEqual([])
})

test('streamed image previews appear before the final result and keep the conversation intact', async ({ page }) => {
  const { image } = await fixture(page)
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('checkbox', { name: '流式预览', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.evaluate(base64 => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (String(input) !== '/api/creation/generate') return original(input, init)
      ;(window as any).__streamInput = JSON.parse(String(init?.body))
      const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.enqueue(encode({ type: 'preview', url: `data:image/jpeg;base64,${base64}` })), 100)
          setTimeout(() => {
            controller.enqueue(encode({ type: 'result', status: 'succeeded', outputs: [{ url: 'https://media.example/final.png' }] }))
            controller.close()
          }, 1500)
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream', 'X-New-Api-Token': '41' } })
    }
  }, image.toString('base64'))
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('预览画面')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('img', { name: '生成中的预览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toBeVisible()
  await expect(page.locator('.creation-image-preview img')).toBeVisible()
  await expect(page.getByRole('img', { name: '生成中的预览', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__streamInput.imageOptions.imageStream)).toBe(true)
  await expect(page.locator('.creation-turn')).toHaveCount(1)
})

test('a rejected generation preserves its prompt and references without automatic resubmission', async ({ page }) => {
  const { image } = await fixture(page)
  let rejected = 0
  await page.route('**/api/creation/generate', route => { rejected++; return route.fulfill({ status: 400, json: { message: '参考图超过当前模型限制，请减少图片。' } }) })
  await page.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这个提示词')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成失败')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这个提示词')
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  expect(rejected).toBe(1)
})
