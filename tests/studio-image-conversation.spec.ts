import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
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
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'image-a', mediaConversationsMigrated: true, sessions: [
        { id: 'image-a', mediaConversationId: 'image-a', creationKind: 'image', topic: '图片对话', model: 'gpt-image-2', lastUpdate: Date.now(), settings: {}, skillIds: [], messages: [] },
        { id: 'image-b', mediaConversationId: 'image-b', creationKind: 'image', topic: '另一图片对话', model: 'gpt-image-2', lastUpdate: Date.now() - 1, settings: {}, skillIds: [], messages: [] },
      ],
    } }))
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
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
  await expect(page.locator('.reference-list img')).toHaveAttribute('alt', '接着上一张生成图修改')
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

test('choosing an earlier result overrides automatic reference; clearing context and deleting turns keep gallery data', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '第一张', 1)
  await send(page, '第二张', 2)
  await page.getByRole('button', { name: '使用第 1 张图片继续创作', exact: true }).first().click()
  await send(page, '修改第一张', 3)
  expect(calls[2].referenceUrls).toEqual(['https://media.example/output-1.png'])
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '全新图片', 4)
  expect(calls[3].imageContext.turns).toEqual([])
  expect(calls[3].referenceUrls).toEqual([])
  await page.getByRole('button', { name: '多选消息', exact: true }).click()
  await page.getByRole('checkbox', { name: '选择消息：第二张', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择消息：修改第一张', exact: true }).check()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除所选消息', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('community-studio', 1); req.onsuccess = () => resolve(req.result) })
    const raw = await new Promise<string>(resolve => { const req = db.transaction('keyval').objectStore('keyval').get('octopus:user-17:native-creation-history'); req.onsuccess = () => resolve(req.result) })
    db.close()
    return JSON.parse(raw).length
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
  expect(uploads).toHaveLength(3)
  expect(calls[0].referenceUrls).toEqual(['/legacy-files/upload1', '/legacy-files/upload2', '/legacy-files/upload3'])
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
