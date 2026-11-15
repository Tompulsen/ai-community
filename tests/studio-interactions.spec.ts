import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, mode = 'text') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const calls: any[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/new-api/model-groups**', route => route.fulfill({ json: { success: true, data: { selectedGroup: 'auto', selectedTokenId: 41, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }] } } }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } })
    if (path === '/api/creation/media') return route.fulfill({ body: image, contentType: 'image/jpeg' })
    if (path === '/api/creation/generate') {
      const body = route.request().postDataJSON()
      calls.push(body)
      return route.fulfill({ json: { status: 'succeeded', tokenId: 41, protocol: 'sync', outputs: body.kind === 'text'
        ? [{ text: '新的回答' }] : [{ url: `https://media.example/${body.kind}-1.png` }, { url: `https://media.example/${body.kind}-2.png` }] } })
    }
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text } } })
    if (sessionStorage.getItem('interaction-fixture')) return
    sessionStorage.setItem('interaction-fixture', '1')
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'interactions', sessions: [{
        id: 'interactions', topic: '交互细节', model: 'gpt-5', search: 'off', settings: {}, skillIds: [], messages: [
          { id: 'q1', role: 'user', content: '第一条提问', createdAt: Date.now() },
          { id: 'a1', role: 'assistant', content: '第一条回答', createdAt: Date.now(), interactions: { suggestions: ['旧建议不显示'] } },
          { id: 'q2', role: 'user', content: '第二条提问', createdAt: Date.now() },
          { id: 'a2', role: 'assistant', content: '第二条回答，可以继续讨论。', createdAt: Date.now(), interactions: { suggestions: ['展开说明', '给一个例子', '展开说明'] } },
        ],
      }],
    } }))
  })
  await page.goto(`/create/${mode}`)
  await expect(page.getByRole('textbox', { name: mode === 'text' ? '消息' : '提示词', exact: true })).toBeVisible()
  await expect(page.locator('.conversation-title-editor:visible .conversation-title-trigger')).toBeVisible()
  return { ...account, calls, errors, image }
}
async function sendKey(page: Page, key: string) {
  await page.getByRole('button', { name: '创作台菜单：设置', exact: true }).click()
  await page.getByRole('combobox', { name: '发送方式', exact: true }).selectOption(key)
  await page.keyboard.press('Escape')
}

test('text paste and file drop share preparation, preserve normal paste and submit both attachments', async ({ page }) => {
  const state = await fixture(page)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.evaluate((element, base64) => {
    const data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], 'pasted.jpg', { type: 'image/jpeg' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, state.image.toString('base64'))
  await expect(page.locator('.material-status li[data-file-status="ready"]')).toHaveCount(1)
  await page.locator('.native-chat').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['文件内容'], 'notes.txt', { type: 'text/plain' }))
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.material-status li[data-file-status="ready"]')).toHaveCount(2)
  expect(await input.evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', '普通文字')
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })).toBe(true)
  await input.fill('查看这些附件')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.calls.length).toBe(1)
  const content = state.calls[0].chatOptions.messages.at(-1).content
  expect(content.some((part: any) => part.type === 'image_url')).toBe(true)
  expect(content.some((part: any) => part.type === 'file' || part.file)).toBe(true)
  await expect(page.locator('.material-status')).toHaveCount(0)
  expect(state.errors).toEqual([])
})

for (const mode of ['text', 'image', 'video']) {
  test(`${mode} keeps Enter as newline with Ctrl+Enter configured and restores the preference`, async ({ page }) => {
    const state = await fixture(page, mode)
    await sendKey(page, 'Ctrl+Enter')
    await page.reload()
    const input = page.getByRole('textbox', { name: mode === 'text' ? '消息' : '提示词', exact: true })
    await expect(input).toBeVisible()
    await input.fill('第一行')
    await input.press('Enter')
    await expect(input).toHaveValue('第一行\n')
    expect(state.calls).toHaveLength(0)
    await input.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true, isComposing: true }))
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    })
    expect(state.calls).toHaveLength(0)
    await input.press('Control+Enter')
    await expect.poll(() => state.calls.length).toBe(1)
    expect(state.calls[0].kind).toBe(mode)
    await expect(input).toHaveValue('')
    expect(state.errors).toEqual([])
  })
}

test('suggestions only show for the latest answer, fill without sending and confirm before replacing a draft', async ({ page }) => {
  const state = await fixture(page), suggestions = page.getByRole('group', { name: '继续追问', exact: true })
  await expect(suggestions).toHaveCount(1)
  await expect(suggestions.getByRole('button')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '旧建议不显示', exact: true })).toHaveCount(0)
  await suggestions.getByRole('button', { name: '展开说明', exact: true }).click()
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await expect(input).toHaveValue('展开说明'); await expect(input).toBeFocused()
  page.once('dialog', dialog => dialog.dismiss())
  await suggestions.getByRole('button', { name: '给一个例子', exact: true }).click()
  await expect(input).toHaveValue('展开说明')
  page.once('dialog', dialog => dialog.accept())
  await suggestions.getByRole('button', { name: '给一个例子', exact: true }).click()
  await expect(input).toHaveValue('给一个例子')
  expect(state.calls).toHaveLength(0)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(suggestions).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('message context menus copy selected text, quote, edit and dismiss within the viewport', async ({ page }) => {
  const state = await fixture(page)
  const answer = page.locator('.chat-message.assistant').last()
  await answer.locator('.message-content').evaluate(element => {
    const text = element.querySelector('p')!.firstChild!, range = document.createRange()
    range.setStart(text, 0); range.setEnd(text, 5)
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  })
  await answer.locator('.message-content').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 1435, clientY: 890, bubbles: true, cancelable: true })))
  const menu = page.getByRole('menu', { name: '消息操作', exact: true })
  await expect(menu).toBeVisible()
  const bounds = await menu.boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000)
  expect(bounds!.x).toBeGreaterThan(1000)
  await menu.getByRole('menuitem', { name: '复制选中文字', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__copied)).toBe('第二条回答')
  await answer.locator('.message-content').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '引用消息', exact: true }).click()
  await expect(page.locator('.chat-composer .message-quote')).toContainText('第二条回答')
  await answer.locator('.message-content').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '编辑回答', exact: true }).click()
  await expect(answer.getByRole('textbox', { name: '消息内容', exact: true })).toBeVisible()
  await answer.getByRole('button', { name: '取消', exact: true }).click()
  await answer.locator('.message-content').click({ button: 'right' })
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  expect(state.calls).toHaveLength(0); expect(state.errors).toEqual([])
})

test('sidebar drag, keyboard, cancel, collapse and reload keep layout and draft intact', async ({ page }) => {
  const state = await fixture(page)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.fill('保留草稿')
  const sidebar = page.locator('.studio-sidebar'), separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  const start = await separator.boundingBox()
  await page.mouse.move(start!.x + start!.width / 2, 300); await page.mouse.down(); await page.mouse.move(340, 300, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(340)
  await separator.focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(364)
  await page.reload()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(364)
  await expect(input).toHaveValue('保留草稿')
  const current = await separator.boundingBox()
  await page.mouse.move(current!.x + current!.width / 2, 300); await page.mouse.down(); await page.mouse.move(410, 300); await page.keyboard.press('Escape'); await page.mouse.up()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(364)
  await page.getByRole('button', { name: '折叠侧栏', exact: true }).click()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(72)
  await expect(sidebar.getByRole('button', { name: '模型广场', exact: true })).toBeVisible()
  await page.reload(); await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(72)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await expect(sidebar.locator('.conversation-record').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(364)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(state.calls).toHaveLength(0); expect(state.errors).toEqual([])
  await mkdir('.taste-skill/studio-interactions-20261115', { recursive: true })
  await page.screenshot({ path: '.taste-skill/studio-interactions-20261115/workbench-1440.png' })
})

test('right clicking a later generated image previews that specific image', async ({ page }) => {
  const state = await fixture(page, 'image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('两张图片')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  const images = page.locator('.creation-image-preview')
  await expect(images).toHaveCount(2)
  await expect(page.locator('.creation-image-preview[aria-busy="true"]')).toHaveCount(0)
  await images.nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '查看大图', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '预览图片序号', exact: true })).toHaveValue('1')
  await page.keyboard.press('Escape')
  expect(state.errors).toEqual([])
})

test('preferences are isolated when switching accounts in the same browser', async ({ page }) => {
  const state = await fixture(page)
  await sendKey(page, 'Shift+Enter')
  await page.getByRole('button', { name: '折叠侧栏', exact: true }).click()
  state.state.user.id = '18'; state.state.user.accountId = '18'
  await page.reload()
  await expect(page.getByRole('button', { name: '折叠侧栏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创作台菜单：设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '发送方式', exact: true })).toHaveValue('Enter')
  state.state.user.id = '17'; state.state.user.accountId = '17'
  await page.reload()
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创作台菜单：设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '发送方式', exact: true })).toHaveValue('Shift+Enter')
  expect(state.calls).toHaveLength(0); expect(state.errors).toEqual([])
})

test.describe('touch input', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('mobile settings, line breaks, suggestions and context menu fit the screen', async ({ page }) => {
    const state = await fixture(page), input = page.getByRole('textbox', { name: '消息', exact: true })
    await input.fill('手机输入'); await input.press('Enter')
    await expect(input).toHaveValue('手机输入\n')
    await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '发送方式', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: '发送方式', exact: true }).selectOption('Ctrl+Enter')
    await page.keyboard.press('Escape')
    await input.fill('')
    await page.getByRole('group', { name: '继续追问', exact: true }).getByRole('button', { name: '展开说明', exact: true }).click()
    await expect(input).toHaveValue('展开说明')
    await page.locator('.chat-message.assistant').last().evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 385, clientY: 840, bubbles: true, cancelable: true })))
    const menu = page.getByRole('menu', { name: '消息操作', exact: true })
    await expect(menu).toBeVisible()
    const bounds = await menu.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    expect(bounds!.x).toBeGreaterThan(100)
    expect(bounds!.y).toBeGreaterThan(400)
    await mkdir('.taste-skill/studio-interactions-20261115', { recursive: true })
    await page.screenshot({ path: '.taste-skill/studio-interactions-20261115/menu-390.png' })
    await page.keyboard.press('Escape')
    expect(state.calls).toHaveLength(0); expect(state.errors).toEqual([])
  })
})
