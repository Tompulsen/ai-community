import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let generations = 0
  await page.route('**/api/creation/**', route => {
    if (new URL(route.request().url()).pathname === '/api/creation/generate') generations++
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
  })
  await page.goto('/community')
  await page.evaluate(() => {
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'a',
      sessions: ['海边写作', '海底探索', '森林散步', '星空摄影'].map((topic, index) => ({
        id: String.fromCharCode(97 + index), topic, messages: [], settings: {}, skillIds: [],
        draft: index === 0 ? '保留海边草稿' : '', lastUpdate: Date.now(),
      })),
    } }))
  })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留海边草稿')
  return { ...account, generations: () => generations }
}

test('sidebar multiselect cancels safely, deletes only selected chats and preserves the active draft after reload', async ({ page }) => {
  const state = await fixture(page)
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
  await sidebar.getByRole('checkbox', { name: '选择对话：海底探索', exact: true }).check()
  await sidebar.getByRole('checkbox', { name: '选择对话：森林散步', exact: true }).check()
  await expect(sidebar.getByRole('status')).toHaveText('已选 2 项')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留海边草稿')
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '取消', exact: true }).click()
  await expect(sidebar.getByRole('checkbox')).toHaveCount(4)
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(sidebar.getByRole('checkbox')).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: '海边写作', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('button', { name: '星空摄影', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: '海底探索', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留海边草稿')
  expect(state.generations()).toBe(0)
})

test('search prunes hidden selections, Escape cancels and deleting all creates one empty chat', async ({ page }) => {
  const state = await fixture(page), sidebar = page.locator('.studio-sidebar')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  const history = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
  await history.getByRole('button', { name: '多选对话', exact: true }).click()
  await history.getByRole('button', { name: '全选', exact: true }).click()
  await expect(history.getByRole('status')).toHaveText('已选 4 项')
  await history.getByRole('searchbox', { name: '搜索对话', exact: true }).fill('海')
  await expect(history.getByRole('status')).toHaveText('已选 2 项')
  await history.getByRole('button', { name: '取消全选', exact: true }).click()
  await expect(history.getByRole('status')).toHaveText('已选 0 项')
  await expect(history.getByRole('button', { name: '删除所选', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(history.getByRole('toolbar', { name: '对话多选', exact: true })).toHaveCount(0)
  await expect(history.getByRole('button', { name: '多选对话', exact: true })).toBeFocused()
  await history.getByRole('searchbox', { name: '搜索对话', exact: true }).fill('')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
  await sidebar.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '选择模型', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '选择模型', exact: true })).not.toBeVisible()
  await expect(sidebar.getByRole('status')).toHaveText('已选 4 项')
  await page.screenshot({ path: '.taste-skill/chat-multiselect-20261115/desktop.png' })
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(sidebar.locator('.conversation-record')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('')
  await page.reload()
  await expect(sidebar.getByRole('navigation', { name: '全部会话', exact: true }).getByRole('button', { name: '新对话', exact: true })).toBeVisible()
  expect(state.generations()).toBe(0)
})

test('phone history reuses selection, fits narrow viewports and clears selection on account changes', async ({ page }) => {
  const state = await fixture(page)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    const history = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
    await history.getByRole('button', { name: '多选对话', exact: true }).click()
    await history.getByRole('button', { name: '全选', exact: true }).click()
    await expect(history.getByRole('status')).toHaveText('已选 4 项')
    expect(await history.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
    })).toBe(true)
    await page.screenshot({ path: `.taste-skill/chat-multiselect-20261115/mobile-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(history).toBeVisible()
    await expect(history.getByRole('checkbox')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(history).not.toBeVisible()
  }
  state.state.user.id = '18'; state.state.user.accountId = '18'
  await page.reload()
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  const history = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
  await expect(history.getByRole('checkbox')).toHaveCount(0)
  await expect(history.getByRole('button', { name: '海边写作', exact: true })).toHaveCount(0)
  expect(state.generations()).toBe(0)
})
