import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shots = '.taste-skill/unified-conversations-20261115'
async function fixture(page: Page, mode = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const calls: any[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
    ] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/generate') {
      const body = route.request().postDataJSON(); calls.push(body)
      return route.fulfill({ json: { status: 'succeeded', outputs: body.kind === 'text' ? [{ text: '文字回答' }] : [{ url: `https://media.example/${calls.length}.${body.kind === 'video' ? 'mp4' : 'png'}` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(() => {
    if (!location.pathname.startsWith('/create/') || sessionStorage.getItem('conversation-fixture')) return
    sessionStorage.setItem('conversation-fixture', '1')
    const now = Date.now()
    const task = (id: string, kind: string, conversationId: string, prompt: string, time: number) => ({
      id, owner: '17', kind, conversationId, model: kind === 'video' ? 'sora-2' : 'gpt-image-2', prompt,
      createdAt: now - time, settledAt: now - time + 1, phase: 'complete', protocol: 'sync', references: [],
      urls: ['https://media.example/sample.png'], text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    })
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([
      task('image-a2', 'image', 'image-a', '追加的图片', 3000),
      task('image-a1', 'image', 'image-a', '图片会话A', 5000),
      task('image-b1', 'image', 'image-b', '图片会话B', 4000),
      task('video-a1', 'video', 'video-a', '视频会话A', 2000),
    ]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'text-a', sessions: [
        { id: 'text-a', topic: '文字会话A', model: 'gpt-5', lastUpdate: now - 1000, settings: {}, skillIds: [], draft: '文字草稿', messages: [] },
        { id: 'text-b', topic: '文字会话B', model: 'gpt-5', lastUpdate: now - 6000, settings: {}, skillIds: [], messages: [] },
      ],
    } }))
  })
  await page.goto(`/create/${mode}`)
  await expect(page.locator('.studio-sidebar .conversation-record')).toHaveCount(5)
  return { ...account, calls }
}
async function snapshot(page: Page, key = 'native-chat') {
  return page.evaluate(async key => {
    const name = `octopus:user-17:${key}`
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result) })
    const raw = await new Promise<unknown>(resolve => {
      const transaction = db.transaction('keyval', 'readonly'), request = transaction.objectStore('keyval').get(name)
      request.onsuccess = () => resolve(request.result); transaction.oncomplete = () => db.close()
    })
    return JSON.parse(typeof raw === 'string' ? raw : localStorage.getItem(name + ':fallback') || localStorage.getItem(name) || 'null')
  }, key)
}
async function select(page: Page, names: string[]) {
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
  for (const name of names) await sidebar.getByRole('checkbox', { name: `选择对话：${name}`, exact: true }).check()
  return sidebar
}

test('image and video conversations join the same selection, deletion and undo transaction without deleting gallery results', async ({ page }) => {
  const state = await fixture(page)
  const sidebar = await select(page, ['图片会话A', '视频会话A', '文字会话B'])
  await expect(sidebar.getByRole('checkbox')).toHaveCount(5)
  await expect(sidebar.getByRole('status')).toHaveText('已选 3 项')
  page.once('dialog', dialog => dialog.accept())
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(2)
  await expect(sidebar.getByRole('button', { name: '图片会话B', exact: true })).toHaveAttribute('aria-current', 'page')
  const history = await snapshot(page, 'native-creation-history')
  expect(history).toHaveLength(4)
  await sidebar.getByRole('button', { name: '撤销删除', exact: true }).click()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(5)
  await expect(sidebar.getByRole('button', { name: '图片会话A', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.creation-request')).toHaveCount(2)
  await page.reload()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(5)
  expect(state.calls).toHaveLength(0)
})

test('deleting an unrelated conversation preserves the active media draft and deleted records stay absent on reload', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('不要覆盖的图片草稿')
  const sidebar = await select(page, ['视频会话A'])
  page.once('dialog', dialog => dialog.accept())
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('不要覆盖的图片草稿')
  await page.reload()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(4)
  await expect(sidebar.getByRole('button', { name: '视频会话A', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('不要覆盖的图片草稿')
  expect(await snapshot(page, 'native-creation-history')).toHaveLength(4)
  expect(state.calls).toHaveLength(0)
})

test('switching from text to media and deleting an active text conversation navigate to the correct conversation kind', async ({ page }) => {
  const state = await fixture(page), sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '文字会话A', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('文字草稿')
  await sidebar.getByRole('button', { name: '图片会话A', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image/)
  await expect(page.locator('.creation-request')).toHaveCount(2)
  await sidebar.getByRole('button', { name: '文字会话A', exact: true }).click()
  await page.setViewportSize({ width: 800, height: 900 })
  await page.getByRole('button', { name: '对话菜单', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除对话', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/video/)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('视频会话A')
  await page.locator('.mobile-conversation-undo').getByRole('button', { name: '撤销删除', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/text/)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('文字草稿')
  expect(state.calls).toHaveLength(0)
})

test('the background task entry opens its own media conversation rather than the previously active one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const state = await fixture(page)
  await page.goto('/community')
  const dock = page.getByRole('complementary', { name: '后台生成任务', exact: true })
  await expect(dock).toContainText('视频会话A')
  await dock.getByRole('button', { name: '下一个任务', exact: true }).click()
  await dock.getByRole('button', { name: '下一个任务', exact: true }).click()
  await expect(dock).toContainText('图片会话B')
  await dock.getByRole('button', { name: '查看任务', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('图片会话B')
  await expect(page.locator('.creation-request')).toHaveCount(1)
  await expect(page.locator('.studio-sidebar').getByRole('button', { name: '图片会话B', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(state.calls).toHaveLength(0)
  expect(errors).toEqual([])
})

test('reusing a text task from an active media conversation waits for storage and creates one text session', async ({ page }) => {
  const state = await fixture(page)
  const tasks = await snapshot(page, 'native-creation-history')
  await page.evaluate(tasks => {
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([
      ...tasks, { ...tasks[0], id: 'text-reuse', kind: 'text', model: 'gpt-5', prompt: '复用文字任务', text: '原回答' },
    ]))
  }, tasks)
  await page.goto('/create/text?reuse=text-reuse')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('复用文字任务')
  await expect(page).toHaveURL(/\/create\/text$/)
  await expect(page.locator('.studio-sidebar .conversation-record')).toHaveCount(6)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('复用文字任务')
  await expect(page.locator('.studio-sidebar .conversation-record')).toHaveCount(6)
  expect(state.calls).toHaveLength(0)
})

test('renaming an image conversation persists while further generations append to the same canonical session', async ({ page }) => {
  const state = await fixture(page), sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '重命名对话：图片会话A', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名对话', exact: true })
  await dialog.getByRole('textbox', { name: '对话名称', exact: true }).fill('我的图片创作')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: '我的图片创作', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('在同一个会话里继续生成')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-request')).toHaveCount(3)
  await expect(page.locator('.task-status').last()).toContainText('生成完成')
  await expect(sidebar.locator('.conversation-record')).toHaveCount(5)
  await expect(sidebar.getByRole('button', { name: '我的图片创作', exact: true })).toBeVisible()
  const saved = await snapshot(page), chat = saved.state.sessions.find((chat: any) => chat.topic === '我的图片创作')
  expect(chat.messages).toHaveLength(6)
  expect(chat.mediaConversationId).toBe('image-a')
  const tasks = await snapshot(page, 'native-creation-history')
  expect(tasks.find((task: any) => task.prompt === '在同一个会话里继续生成').conversationId).toBe('image-a')
  await page.reload()
  await expect(sidebar.getByRole('button', { name: '我的图片创作', exact: true })).toBeVisible()
  await expect(page.locator('.creation-request')).toHaveCount(3)
  expect(state.calls).toHaveLength(1)
})

test('new media conversations reserve a stable ID for the first and subsequent turns', async ({ page }) => {
  await fixture(page)
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '新建创作', exact: true }).click()
  const message = page.getByRole('textbox', { name: '提示词', exact: true })
  for (const prompt of ['新的独立创作', '独立创作的第二轮']) {
    await message.fill(prompt)
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await expect(page.locator('.task-status').last()).toContainText('生成完成')
  }
  await expect(page.locator('.creation-request')).toHaveCount(2)
  await expect(sidebar.locator('.conversation-record')).toHaveCount(6)
  const saved = await snapshot(page), chat = saved.state.sessions.find((chat: any) => chat.topic === '新的独立创作')
  expect(chat.creationKind).toBe('image')
  expect(chat.messages).toHaveLength(4)
  const tasks = (await snapshot(page, 'native-creation-history')).filter((task: any) => task.prompt.startsWith('独立创作') || task.prompt === '新的独立创作')
  expect(tasks).toHaveLength(2)
  expect(tasks.every((task: any) => task.conversationId === chat.mediaConversationId)).toBe(true)
})

test('pointer drag and keyboard reordering persist the mixed conversation order', async ({ page }) => {
  await fixture(page)
  const sidebar = page.locator('.studio-sidebar'), rows = sidebar.locator('.conversation-row')
  const titles = () => sidebar.locator('.conversation-record').allTextContents()
  const before = await titles()
  const first = await rows.first().getByRole('button', { name: /^调整会话顺序：/ }).boundingBox()
  const third = await rows.nth(2).boundingBox()
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2)
  await page.mouse.down()
  await page.mouse.move(first!.x + first!.width / 2, third!.y + third!.height - 4, { steps: 12 })
  await page.mouse.up()
  await expect.poll(titles).not.toEqual(before)
  const afterDrag = await titles()
  await page.reload()
  await expect.poll(titles).toEqual(afterDrag)
  const handle = rows.first().getByRole('button', { name: /^调整会话顺序：/ })
  await handle.focus(); await handle.press('Alt+ArrowDown')
  const expected = [...afterDrag]; [expected[0], expected[1]] = [expected[1]!, expected[0]!]
  await expect.poll(titles).toEqual(expected)
  await page.reload()
  await expect.poll(titles).toEqual(expected)
})

test('projects group all conversation kinds and support batch move, single move, rename and removal', async ({ page }) => {
  const state = await fixture(page), sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '新建项目', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建项目', exact: true })
  await create.getByRole('textbox', { name: '项目名称', exact: true }).fill('视觉项目')
  await create.getByRole('button', { name: '保存', exact: true }).click()
  await select(page, ['图片会话A', '视频会话A', '文字会话A'])
  await sidebar.getByRole('button', { name: '移至项目', exact: true }).click()
  const move = page.getByRole('dialog', { name: '移至项目', exact: true })
  await move.getByRole('combobox', { name: '项目', exact: true }).selectOption({ label: '视觉项目' })
  await move.getByRole('button', { name: '移动', exact: true }).click()
  const project = sidebar.locator('.conversation-section').filter({ has: page.getByRole('button', { name: '项目：视觉项目', exact: true }) })
  await expect(project.locator('.conversation-record')).toHaveCount(3)
  await project.getByRole('button', { name: '项目：视觉项目', exact: true }).click()
  await expect(project.locator('.conversation-record')).toHaveCount(0)
  await project.getByRole('button', { name: '项目：视觉项目', exact: true }).click()
  await page.reload()
  await expect(project.locator('.conversation-record')).toHaveCount(3)
  await select(page, ['文字会话A'])
  await sidebar.getByRole('button', { name: '移至项目', exact: true }).click()
  await move.getByRole('combobox', { name: '项目', exact: true }).selectOption('')
  await move.getByRole('button', { name: '移动', exact: true }).click()
  await expect(project.locator('.conversation-record')).toHaveCount(2)
  await sidebar.getByRole('button', { name: '重命名项目：视觉项目', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名项目', exact: true })
  await rename.getByRole('textbox', { name: '项目名称', exact: true }).fill('我的项目')
  await rename.getByRole('button', { name: '保存', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: '项目：我的项目', exact: true })).toBeVisible()
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: `${shots}/projects-desktop.png` })
  page.once('dialog', dialog => dialog.accept())
  await sidebar.getByRole('button', { name: '删除项目：我的项目', exact: true }).click()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(5)
  await expect(sidebar.locator('.project-heading')).toHaveCount(0)
  expect(state.calls).toHaveLength(0)
})

test('phone history manages image sessions and keeps undo reachable after deleting the current conversation', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 800, height: 900 })
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  const history = page.getByRole('dialog', { name: '历史对话', exact: true })
  await expect(history.locator('.conversation-record')).toHaveCount(5)
  await history.getByRole('button', { name: '关闭历史对话', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 844 })
  const toolbarButtons = await page.locator('.studio-page-toolbar button').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right }
  }))
  expect(toolbarButtons.every(bounds => bounds.left >= 0 && bounds.right <= 320)).toBe(true)
  expect(toolbarButtons.every((bounds, index) => index === 0 || bounds.left >= toolbarButtons[index - 1]!.right)).toBe(true)
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await history.getByRole('button', { name: '多选对话', exact: true }).click()
  await expect(history.getByRole('checkbox')).toHaveCount(5)
  await history.getByRole('checkbox', { name: '选择对话：图片会话A', exact: true }).check()
  expect(await history.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= innerWidth)).toBe(true)
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: `${shots}/selection-mobile.png` })
  page.once('dialog', dialog => dialog.accept())
  await history.getByRole('button', { name: '删除所选', exact: true }).click()
  await expect(history).not.toBeVisible()
  await page.locator('.mobile-conversation-undo').getByRole('button', { name: '撤销删除', exact: true }).click()
  await expect(page.locator('.creation-request')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  state.state.user.id = '18'; state.state.user.accountId = '18'
  await page.reload()
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await expect(history.getByRole('button', { name: '图片会话A', exact: true })).toHaveCount(0)
  await expect(history.getByRole('button', { name: '撤销删除', exact: true })).toHaveCount(0)
  expect(state.calls).toHaveLength(0)
})
