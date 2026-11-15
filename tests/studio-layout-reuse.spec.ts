import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shots = '.taste-skill/layout-reuse-20261115'
async function fixture(page: Page, kind = 'text') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const errors: string[] = [], mutations: { method: string; path: string }[] = [], generations: any[] = []
  page.on('pageerror', error => errors.push(error.message))
  const tokens = [{ id: 41, name: '社区密钥', status: 1, group: 'auto', remain_quota: 1000000, used_quota: 100000, unlimited_quota: false, expired_time: -1, model_limits_enabled: false, model_limits: '', auto_groups: [], cross_group_retry: true }]
  await page.route('**/api/new-api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const data: Record<string, unknown> = {
      '/api/new-api/status': { enabled: true, configured: true, quotaPerUnit: 500000, currencySymbol: '$' },
      '/api/new-api/session': { selectedTokenId: 41 },
      '/api/new-api/groups': [{ id: 'auto', name: 'Auto' }],
      '/api/new-api/auto-groups': { supported: false, defaultGroups: [], maxCount: 0 },
      '/api/new-api/tokens': { items: tokens, total: tokens.length },
    }
    if (path.startsWith('/api/new-api/tokens/')) {
      mutations.push({ method: request.method(), path })
      if (request.method() === 'DELETE') tokens.splice(0)
      return route.fulfill({ json: { success: true, data: {} } })
    }
    if (path in data) return route.fulfill({ json: { success: true, data: data[path] } })
    return route.fallback()
  })
  const body = '请用简洁的语言回答。', sha256 = createHash('sha256').update(body).digest('hex')
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [{ id: 'writing', name: '写作', description: '整理内容与文字表达。', body, sha256 }, { id: 'translation', name: '翻译', description: '保持原意并使用自然的表达。', body, sha256 }] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: true, items: [{ id: 'community-tools', status: 'active' }] } })
    if (path.endsWith('/generate')) generations.push(route.request().postDataJSON())
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('reuse-layout-fixture')) return
    sessionStorage.setItem('reuse-layout-fixture', '1')
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'a', mediaConversationsMigrated: true,
      projects: [{ id: 'p', name: '视觉项目', createdAt: Date.now() }],
      sessions: [
        { id: 'a', topic: '示例对话', model: 'gpt-5', lastUpdate: Date.now(), messages: [], settings: {}, skillIds: [], draft: '保留输入草稿' },
        { id: 'b', topic: '项目里的对话', projectId: 'p', model: 'gpt-5', lastUpdate: Date.now() - 1, messages: [], settings: {}, skillIds: [] },
      ],
    } }))
  })
  await page.goto(`/create/${kind}`)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(kind === 'text' ? 'gpt-5' : kind === 'image' ? 'gpt-image-2' : 'sora-2')
  await mkdir(shots, { recursive: true })
  return { account, errors, mutations, generations }
}
async function confirmDelete(page: Page, accepted = true) {
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: accepted ? '确认删除' : '取消', exact: true }).click()
}

test('project menus remain usable inside the phone drawer and preserve project conversations on deletion', async ({ page }) => {
  const state = await fixture(page)
  const sidebar = page.locator('.studio-sidebar')
  expect(await sidebar.locator('.conversation-record').last().evaluate(element => element.getBoundingClientRect().height)).toBe(32)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: '项目：视觉项目', exact: true }).locator('.project-count')).toHaveText('1')
  await sidebar.getByRole('button', { name: '项目操作：视觉项目', exact: true }).click()
  const menu = page.getByRole('menu', { name: '项目操作', exact: true })
  await expect(menu).toBeVisible()
  await page.screenshot({ path: `${shots}/project-menu-mobile.png` })
  await menu.getByRole('menuitem', { name: '重命名项目：视觉项目', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名项目', exact: true })
  await rename.getByRole('textbox', { name: '项目名称', exact: true }).fill('新项目名称')
  await rename.getByRole('button', { name: '保存', exact: true }).click()
  await sidebar.getByRole('button', { name: '项目操作：新项目名称', exact: true }).click()
  await menu.getByRole('menuitem', { name: '删除项目：新项目名称', exact: true }).click()
  await confirmDelete(page, false)
  await expect(sidebar.getByRole('button', { name: '项目：新项目名称', exact: true })).toBeVisible()
  await sidebar.getByRole('button', { name: '项目操作：新项目名称', exact: true }).click()
  await menu.getByRole('menuitem', { name: '删除项目：新项目名称', exact: true }).click()
  await confirmDelete(page)
  await expect(sidebar.locator('.project-heading')).toHaveCount(0)
  await expect(sidebar.locator('.conversation-record')).toHaveCount(2)
  expect(state.generations).toHaveLength(0); expect(state.errors).toEqual([])
})

test('chat settings retain advanced values and skills stay multiselect with separate MCP controls', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '对话参数', exact: true })
  await expect(parameters.getByLabel('Top P', { exact: true })).not.toBeVisible()
  await parameters.getByLabel('最大输出 Tokens', { exact: true }).fill('2048')
  await parameters.getByLabel('系统提示词', { exact: true }).fill('保持简洁')
  await parameters.locator('.chat-advanced-settings > summary').click()
  await parameters.getByLabel('Top P', { exact: true }).fill('0.5')
  await parameters.getByLabel('保留历史摘要', { exact: true }).check()
  await parameters.getByRole('button', { name: '关闭对话参数', exact: true }).click()
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  const skills = page.getByRole('dialog', { name: '技能与工具', exact: true })
  await skills.getByRole('checkbox', { name: '写作', exact: true }).check()
  await skills.getByRole('checkbox', { name: '翻译', exact: true }).check()
  await expect(page.getByRole('button', { name: '技能与工具', exact: true })).toContainText('技能 2')
  await expect(skills.getByLabel('允许模型使用 community-tools', { exact: true })).not.toBeVisible()
  await skills.locator('.mcp-section > summary').click()
  await skills.getByLabel('允许模型使用 community-tools', { exact: true }).check()
  await page.screenshot({ path: `${shots}/skills-desktop.png` })
  await skills.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '技能与工具', exact: true })).toContainText('技能 2')
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  await expect(parameters.getByLabel('最大输出 Tokens', { exact: true })).toHaveValue('2048')
  await expect(parameters.getByLabel('系统提示词', { exact: true })).toHaveValue('保持简洁')
  await parameters.locator('.chat-advanced-settings > summary').click()
  await expect(parameters.getByLabel('Top P', { exact: true })).toHaveValue('0.5')
  await page.screenshot({ path: `${shots}/chat-settings-desktop.png` })
  expect(state.generations).toHaveLength(0); expect(state.errors).toEqual([])
})

test('parameter grids fit desktop and phones without submitting and discrete video duration uses supported values', async ({ page }) => {
  const state = await fixture(page, 'image')
  for (const kind of ['image', 'video']) {
    if (kind === 'video') await page.goto('/create/video')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), width === 390 ? 'light' : 'dark')
      await page.getByRole('button', { name: '高级参数', exact: true }).click()
      const panel = page.getByRole('dialog', { name: '高级参数', exact: true })
      await panel.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '9:16', exact: true }).check()
      if (kind === 'video') {
        const slider = panel.getByRole('slider', { name: '视频时长', exact: true })
        await slider.fill('2')
        await expect(slider).toHaveAttribute('aria-valuetext', '12 秒')
      }
      expect(await panel.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
      })).toBe(true)
      await page.screenshot({ path: `${shots}/${kind}-parameters-${width}.png` })
      await panel.getByRole('button', { name: '关闭高级参数', exact: true }).click()
    }
  }
  expect(state.generations).toHaveLength(0); expect(state.errors).toEqual([])
})

test('token menus retain editing and use an account-safe site deletion dialog', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('button', { name: '创作台菜单：设置', exact: true }).click()
  await page.getByRole('button', { name: '密钥', exact: true }).click()
  const trigger = page.getByRole('button', { name: '密钥操作 社区密钥', exact: true })
  await expect(page.locator('.token-current')).toHaveText('当前使用')
  await trigger.click()
  const menu = page.getByRole('menu', { name: '密钥操作', exact: true })
  await menu.getByRole('menuitem', { name: '编辑密钥 社区密钥', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '额度（$）', exact: true })).toHaveValue('2')
  await page.getByRole('button', { name: '关闭密钥编辑', exact: true }).click()
  await trigger.click()
  await menu.getByRole('menuitem', { name: '删除密钥 社区密钥', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '删除确认', exact: true })
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.screenshot({ path: `${shots}/delete-confirm-desktop.png` })
  await page.keyboard.press('Escape')
  expect(state.mutations).toHaveLength(0)
  await trigger.click()
  await menu.getByRole('menuitem', { name: '删除密钥 社区密钥', exact: true }).click()
  await confirmDelete(page)
  await expect.poll(() => state.mutations.filter(item => item.method === 'DELETE').length).toBe(1)
  await expect(trigger).toHaveCount(0)
  expect(state.generations).toHaveLength(0); expect(state.errors).toEqual([])
})

test('switching identity closes a pending confirmation without deleting anything', async ({ page }) => {
  const state = await fixture(page)
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
  await sidebar.getByRole('checkbox', { name: '选择对话：示例对话', exact: true }).check()
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '删除确认', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const { session } = await import('/src/state.ts')
    session.user = { ...session.user!, id: '18', accountId: '18' }
  })
  await expect(page.getByRole('dialog', { name: '删除确认', exact: true })).toHaveCount(0)
  expect(state.mutations).toHaveLength(0)
  expect(state.errors).toEqual([])
})

test('single conversation menu moves, removes, renames and deletes only its captured target', async ({ page }) => {
  const state = await fixture(page), sidebar = page.locator('.studio-sidebar')
  const menu = page.getByRole('menu', { name: '对话操作', exact: true })
  const open = (topic = '示例对话') => sidebar.getByRole('button', { name: `对话操作：${topic}`, exact: true }).click()
  await expect(sidebar.locator('[data-conversation-id="a"] time')).toHaveAttribute('datetime', /T/)
  await open()
  await menu.getByRole('menuitem', { name: '移至项目', exact: true }).click()
  await page.getByRole('dialog', { name: '移至项目', exact: true }).getByRole('button', { name: '移至项目：视觉项目', exact: true }).click()
  await expect(sidebar.locator('[data-conversation-id="a"]')).toHaveAttribute('data-project-id', 'p')
  await open()
  await menu.getByRole('menuitem', { name: '移出项目', exact: true }).click()
  await expect(sidebar.locator('[data-conversation-id="a"]')).toHaveAttribute('data-project-id', '')
  await open()
  await menu.getByRole('menuitem', { name: '重命名对话：示例对话', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名对话', exact: true })
  await rename.getByRole('textbox', { name: '对话名称', exact: true }).fill('重命名后的对话')
  await rename.getByRole('button', { name: '保存', exact: true }).click()
  await open('重命名后的对话')
  await menu.getByRole('menuitem', { name: '多选对话', exact: true }).click()
  await expect(sidebar.getByRole('checkbox', { name: '选择对话：重命名后的对话', exact: true })).toBeChecked()
  await sidebar.getByRole('button', { name: '取消多选', exact: true }).click()
  await open('重命名后的对话')
  await menu.getByRole('menuitem', { name: '删除对话：重命名后的对话', exact: true }).click()
  await confirmDelete(page)
  await expect(sidebar.locator('[data-conversation-id="a"]')).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: '项目里的对话', exact: true })).toBeVisible()
  expect(state.errors).toEqual([]); expect(state.generations).toHaveLength(0)
})

test('phone sheets stay at the bottom with nested search, keyboard resizing and desktop restoration', async ({ page }) => {
  const state = await fixture(page)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: '对话参数', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '对话参数', exact: true })
    await expect.poll(() => panel.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(844)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().left === 0)).toBe(true)
    await panel.getByRole('button', { name: '联网搜索：联网', exact: true }).click()
    const search = page.getByRole('dialog', { name: '联网搜索', exact: true })
    await expect(search).toBeVisible()
    await search.getByRole('button', { name: '快速搜索', exact: true }).click()
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '联网搜索：快速搜索', exact: true }).click()
    await search.getByRole('button', { name: '关闭联网', exact: true }).click()
    await page.setViewportSize({ width, height: 520 })
    await expect.poll(() => panel.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(520)
    await page.screenshot({ path: `.taste-skill/reuse-round2-20261115/sheet-${width}.png` })
    await panel.getByRole('button', { name: '关闭对话参数', exact: true }).click()
    await expect(page.getByRole('button', { name: '对话参数', exact: true })).toBeFocused()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  expect(await page.getByRole('dialog', { name: '对话参数', exact: true }).evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(480)
  expect(state.errors).toEqual([]); expect(state.generations).toHaveLength(0)
})

test('phone conversation settings edit the chosen inactive conversation without changing current draft', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.getByRole('button', { name: '对话操作：项目里的对话', exact: true }).click()
  await page.getByRole('menu', { name: '对话操作', exact: true }).getByRole('menuitem', { name: '对话设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '对话设置', exact: true })
  await settings.getByLabel('系统提示词', { exact: true }).fill('仅修改项目里的对话')
  await settings.getByLabel('最大输出 Tokens', { exact: true }).fill('1024')
  await settings.getByLabel('系统提示词', { exact: true }).click()
  expect(await settings.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(844)
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 520 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => settings.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(520)
  expect(await settings.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(416)
  await page.evaluate(() => {
    delete (window.visualViewport as any).height
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await page.screenshot({ path: '.taste-skill/reuse-round2-20261115/conversation-settings-phone.png' })
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '关闭侧边栏', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留输入草稿')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留输入草稿')
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.getByRole('button', { name: '对话操作：项目里的对话', exact: true }).click()
  await page.getByRole('menu', { name: '对话操作', exact: true }).getByRole('menuitem', { name: '对话设置', exact: true }).click()
  await expect(settings.getByLabel('系统提示词', { exact: true })).toHaveValue('仅修改项目里的对话')
  await expect(settings.getByLabel('最大输出 Tokens', { exact: true })).toHaveValue('1024')
  expect(state.errors).toEqual([]); expect(state.generations).toHaveLength(0)
})

test('compression slider and exact input stay synchronized, bounded and persisted', async ({ page }) => {
  const state = await fixture(page, 'image')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '高级参数', exact: true })
  await parameters.locator('.parameter-advanced > summary').click()
  await parameters.getByRole('combobox', { name: '输出格式', exact: true }).selectOption('webp')
  const input = parameters.getByRole('spinbutton', { name: '压缩质量数值', exact: true })
  const slider = parameters.getByRole('slider', { name: '压缩质量', exact: true })
  await input.fill('67'); await input.press('Tab')
  await expect(slider).toHaveValue('67')
  await slider.fill('82'); await expect(input).toHaveValue('82')
  await input.fill('200'); await input.press('Tab'); await expect(input).toHaveValue('100')
  await input.fill(''); await input.press('Tab'); await expect(input).toHaveValue('100')
  await input.fill('63'); await input.press('Tab')
  await page.screenshot({ path: '.taste-skill/reuse-round2-20261115/compression-desktop.png' })
  await parameters.getByRole('button', { name: '关闭高级参数', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await parameters.locator('.parameter-advanced > summary').click()
  await expect(input).toHaveValue('63')
  expect(state.errors).toEqual([]); expect(state.generations).toHaveLength(0)
})

test('output metrics distinguish measured, estimated, previous, zero and missing statistics', async ({ page }) => {
  const state = await fixture(page)
  const metrics = page.getByRole('group', { name: '对话输出统计', exact: true })
  await expect(metrics.getByRole('button', { name: '输出速度：— tok/s', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/native-chat.ts')!.name
    const { chats } = await import(url)
    chats.sessions.find(chat => chat.id === 'a')!.messages = [{
      id: 'answer', role: 'assistant', content: '统计展示示例',
      responseMetrics: { usage: { inputTokens: 100, outputTokens: 60, cachedInputTokens: 0 }, generationDurationMs: 2000 },
    }]
  })
  await expect(metrics.getByRole('button', { name: '输出速度：30 tok/s', exact: true })).toBeVisible()
  await expect(metrics.getByRole('button', { name: '缓存命中：0%', exact: true })).toBeVisible()
  await page.screenshot({ path: '.taste-skill/reuse-round2-20261115/metrics-desktop.png' })
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/native-chat.ts')!.name
    const { chats } = await import(url)
    chats.sessions.find(chat => chat.id === 'a')!.messages.push({ id: 'live', role: 'assistant', content: '', streaming: true })
  })
  await expect(metrics.getByRole('button', { name: '输出速度：30 tok/s（上一轮）', exact: true })).toBeVisible()
  await metrics.getByRole('button', { name: '缓存命中：0%（上一轮）', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '缓存命中', exact: true })).toContainText('上一轮')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/native-chat.ts')!.name
    const { chats } = await import(url)
    const message = chats.sessions.find(chat => chat.id === 'a')!.messages.at(-1)!
    message.generationProgress = { outputTokens: 25, durationMs: 1000 }
    message.usage = { inputTokens: 100, cachedInputTokens: 20 }
  })
  await expect(metrics.getByRole('button', { name: '输出速度：25 tok/s（估算）', exact: true })).toBeVisible()
  await expect(metrics.getByRole('button', { name: '缓存命中：20%', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 844 })
  await page.screenshot({ path: '.taste-skill/reuse-round2-20261115/metrics-phone.png' })
  expect(state.errors).toEqual([]); expect(state.generations).toHaveLength(0)
})
