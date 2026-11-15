import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const shots = '.taste-skill/mobile-workbench-20261115'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const posts: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) posts.push(new URL(request.url()).pathname)
  })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { currency: 'USD', rows: [] } } }))
  await page.route('**/api/new-api/session', route => route.fulfill({ json: { success: true, data: { selectedTokenId: 41 } } }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: path === '/api/creation/models'
      ? { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }] }
      : { items: [], enabled: false } })
  })
  await page.addInitScript(() => {
    if (!location.pathname.startsWith('/create/') || sessionStorage.getItem('mobile-drawer-fixture')) return
    sessionStorage.setItem('mobile-drawer-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'seaside', sessions: [
        {
          id: 'seaside', topic: '海边的周末计划', composerKind: 'text', model: 'gpt-5', settings: {}, skillIds: [], search: 'off',
          draft: '下一步想安排海边露营', lastUpdate: now,
          messages: [
            { id: 'seaside-question', role: 'user', content: '周末想去海边走走，帮我安排一个轻松的一日行程。', createdAt: now - 60000 },
            { id: 'seaside-answer', role: 'assistant', model: 'gpt-5', content: '可以把行程留得宽松一些。\n\n1. 上午沿海边步道散步，找一家咖啡馆坐坐。\n2. 午后逛附近的小店，避开最晒的时候。\n3. 傍晚回到沙滩看日落，再慢慢吃晚饭。\n\n出发前看一下天气和潮汐，给临时改变计划留点空间。', createdAt: now - 50000 },
          ],
        },
        {
          id: 'city-walk', topic: '雨天里的城市漫步', composerKind: 'text', model: 'gpt-5', settings: {}, skillIds: [], search: 'off',
          draft: '保留这段城市散步草稿', lastUpdate: now - 120000,
          messages: [{ id: 'city-question', role: 'user', content: '下雨的时候，有哪些适合散步的地方？', createdAt: now - 120000 }],
        },
      ],
    } }))
  })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('下一步想安排海边露营')
  await mkdir(shots, { recursive: true })
  return { posts }
}

test('mobile workbench drawer closes with backdrop or Escape and restores conversation drafts', async ({ page }) => {
  const state = await fixture(page)
  const open = page.locator('.studio-page-toolbar button[aria-controls="studio-sidebar-drawer"]')
  const drawer = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
  const message = page.getByRole('textbox', { name: '消息', exact: true })
  await expect(open).toHaveAttribute('aria-controls', 'studio-sidebar-drawer')
  await expect(open).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.chat-toolbar')).toBeHidden()
  await page.locator('.chat-messages').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: `${shots}/chat-390.png` })
  await open.click()
  await expect(drawer).toBeVisible()
  await expect(open).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.getByRole('searchbox', { name: '搜索对话', exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: '新对话', exact: true })).toBeVisible()
  await expect(drawer.locator('a[href="/account"]')).toBeVisible()
  expect(await page.evaluate(() => document.querySelector('#studio-sidebar-drawer')!.contains(document.activeElement))).toBe(true)
  await page.screenshot({ path: `${shots}/drawer-390.png` })
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(open).toBeFocused()
  await expect(message).toHaveValue('下一步想安排海边露营')
  await open.click()
  const bounds = (await drawer.boundingBox())!
  const viewport = page.viewportSize()!
  expect(bounds.width).toBeLessThan(viewport.width)
  await page.mouse.click(viewport.width - 4, viewport.height / 2)
  await expect(drawer).toBeHidden()
  await expect(open).toBeFocused()
  await open.click()
  const search = drawer.getByRole('searchbox', { name: '搜索对话', exact: true })
  await search.fill('城市漫步')
  await expect(drawer.getByRole('button', { name: '海边的周末计划', exact: true })).toHaveCount(0)
  await drawer.getByRole('button', { name: '雨天里的城市漫步', exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(message).toHaveValue('保留这段城市散步草稿')
  await open.click()
  await search.fill('')
  await drawer.getByRole('button', { name: '海边的周末计划', exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(message).toHaveValue('下一步想安排海边露营')
  expect(state.posts).toEqual([])
  await page.evaluate(() => {
    const appearance = (window as Window & { communityAppearance: { set(value: { mode: string }): boolean } }).communityAppearance
    appearance.set({ mode: 'light' })
  })
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.locator('.chat-messages').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: `${shots}/chat-390-light.png` })
  await open.click()
  await page.screenshot({ path: `${shots}/drawer-390-light.png` })
  await drawer.getByRole('button', { name: '关闭侧边栏', exact: true }).click()
  await expect(open).toBeFocused()
})

test('workbench input stays below one compact header at narrow, keyboard and tablet sizes', async ({ page }) => {
  const state = await fixture(page)
  for (const [width, height] of [[390, 844], [320, 568], [390, 420], [768, 1024]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('.studio-page-toolbar')).toBeVisible()
    await expect(page.locator('.chat-toolbar')).toBeHidden()
    await expect(page.locator('.studio-sidebar')).toBeHidden()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    const layout = await page.evaluate(() => {
      const composer = document.querySelector('.studio-composer')!
      const input = composer.querySelector('.composer-input')!.getBoundingClientRect()
      const send = composer.querySelector('.composer-submit')!
      const button = send.getBoundingClientRect()
      const frame = composer.getBoundingClientRect()
      const toolbar = document.querySelector('.studio-page-toolbar')!.getBoundingClientRect()
      return {
        composerCount: document.querySelectorAll('.studio-composer').length,
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1,
        contained: frame.left >= 0 && frame.right <= innerWidth && frame.bottom <= innerHeight + 1,
        headerHeight: toolbar.height, inputBottom: input.bottom, sendTop: button.top,
        sendWidth: button.width, sendHeight: button.height,
        radius: parseFloat(getComputedStyle(composer).borderTopLeftRadius),
        sendIconVisible: !!send.querySelector('svg')?.getClientRects().length,
      }
    })
    expect(layout.composerCount).toBe(1)
    expect(layout.overflow).toBe(false)
    expect(layout.contained).toBe(true)
    expect(layout.headerHeight).toBeLessThanOrEqual(76)
    if (width <= 639) {
      expect(layout.radius).toBeGreaterThanOrEqual(16)
      expect(layout.sendTop).toBeGreaterThanOrEqual(layout.inputBottom - 1)
      expect(layout.sendWidth).toBeCloseTo(layout.sendHeight, 0)
      expect(layout.sendIconVisible).toBe(true)
    }
    if (width === 320) await page.screenshot({ path: `${shots}/chat-320.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.studio-sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开侧边栏', exact: true })).toBeHidden()
  await expect(page.locator('.chat-toolbar')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('下一步想安排海边露营')
  await page.screenshot({ path: `${shots}/chat-1440.png` })
  expect(state.posts).toEqual([])
})

test('compact workbench keeps library, models and text or image parameters reachable', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  const menu = page.getByRole('dialog', { name: '创作台菜单', exact: true })
  for (const name of ['作品库', '模型价格', '消费记录', '密钥', '复制对话', '删除对话', '清除上下文']) {
    await expect(menu.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await menu.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '作品库', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('下一步想安排海边露营')
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  const models = page.getByRole('dialog', { name: '选择模型', exact: true })
  await expect(models.getByRole('searchbox', { name: '搜索模型', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '对话参数', exact: true })
  await expect(parameters.getByRole('button', { name: /^联网搜索：/ })).toBeVisible()
  await expect(parameters.locator('summary').filter({ hasText: '技能与工具' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await models.getByRole('button', { name: 'gpt-image-2', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image/)
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '画面比例', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '新建创作', exact: true })).toBeVisible()
  expect(state.posts).toEqual([])
  expect(errors).toEqual([])
})
