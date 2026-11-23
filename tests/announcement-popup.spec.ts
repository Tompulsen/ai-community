import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const notices = [
  { id: 'news1', title: '社区功能更新', text: '现在可以继续浏览与创作。\n原有作品仍然保留。', display: 'dialog' },
  { id: 'news2', title: '创作活动说明', text: '<img src=x onerror="alert(1)"> 作为正文显示', display: 'dialog' },
  { id: 'normal', title: '普通公告不弹出', text: '正常列表公告', display: 'normal' },
]
async function fixture(page: Page, options: { authenticated?: boolean; items?: typeof notices; fail?: boolean } = {}) {
  const account = await mockUnifiedAccount(page, options.authenticated)
  let reads = 0
  await page.route('**/api/announcements?popup=1', route => {
    reads++
    return route.fulfill(options.fail ? { status: 503, json: { message: '暂不可用' } } : { json: { items: options.items ?? notices } })
  })
  return { ...account, reads: () => reads }
}
const popup = (page: Page) => page.getByRole('dialog', { name: '社区公告', exact: true })

for (const authenticated of [false, true]) test(`announcements show once per open page for ${authenticated ? 'members' : 'guests'}, not refresh or navigation`, async ({ page, context }) => {
  const state = await fixture(page, { authenticated })
  await page.goto('/discover')
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator('article')).toHaveCount(2)
  await expect(popup(page).locator('img')).toHaveCount(0)
  await expect(popup(page)).not.toContainText('普通公告不弹出')
  await popup(page).getByRole('button', { name: '我知道了' }).click()
  await page.reload()
  await expect(page.locator('.app-footer')).toBeVisible()
  await expect(popup(page)).not.toBeVisible()
  await page.locator('.app-footer').getByRole('link', { name: '公告', exact: true }).click()
  await expect(page).toHaveURL(/\/messages/)
  await expect(popup(page)).not.toBeVisible()
  expect(state.reads()).toBe(1)
  expect(state.mutations.filter(item => /announcements|notifications\/read/.test(item.path))).toHaveLength(0)
  const reopened = await context.newPage()
  await fixture(reopened, { authenticated })
  await reopened.goto('/discover')
  await expect(popup(reopened)).toBeVisible()
  await reopened.close()
})

test('escape closes the popup and later announcement updates wait for a new visit', async ({ page }) => {
  const rows = structuredClone(notices)
  const state = await fixture(page, { items: rows })
  await page.goto('/discover')
  await expect(popup(page).getByRole('button', { name: '我知道了' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(popup(page)).not.toBeVisible()
  rows[0]!.text = 'Changed after dismissal'
  await page.reload()
  await expect(page.locator('.app-footer')).toBeVisible()
  await expect(popup(page)).not.toBeVisible()
  expect(state.reads()).toBe(1)
})

test('an opener-created tab gets its own popup despite copied session storage, and refresh stays quiet', async ({ page, context }) => {
  await fixture(page)
  await page.goto('/discover')
  await popup(page).getByRole('button', { name: '我知道了' }).click()
  const created = context.waitForEvent('page')
  await page.evaluate(() => { window.open('about:blank', '_blank') })
  const child = await created
  const state = await fixture(child)
  await child.goto('/discover')
  expect(await child.evaluate(() => !!window.opener)).toBe(true)
  await expect(popup(child)).toBeVisible()
  await child.keyboard.press('Escape')
  await child.reload()
  await expect(child.locator('.app-footer')).toBeVisible()
  await expect(popup(child)).not.toBeVisible()
  await child.goto('/discover?from=header')
  await expect(child.locator('.app-footer')).toBeVisible()
  await expect(popup(child)).not.toBeVisible()
  expect(state.reads()).toBe(1)
  await child.close()
})

for (const failure of [false, true]) test(`empty or failed announcement loading never interrupts browsing (${failure})`, async ({ page }) => {
  const state = await fixture(page, { items: [], fail: failure })
  await page.goto('/discover')
  await expect.poll(state.reads).toBe(1)
  await expect(popup(page)).not.toBeVisible()
  await page.reload()
  await expect(page.locator('.app-footer')).toBeVisible()
  expect(state.reads()).toBe(1)
})

test('admin and login pages do not launch public announcement popups', async ({ page, context }) => {
  const state = await fixture(page, { authenticated: true })
  state.state.user.isAdmin = true
  await page.goto('/admin?tab=announcements')
  await expect(page.getByRole('region', { name: '公告管理', exact: true })).toBeVisible()
  await expect(popup(page)).not.toBeVisible()
  expect(state.reads()).toBe(0)
  const login = await context.newPage()
  const guest = await fixture(login)
  await login.goto('/account')
  await expect(popup(login)).not.toBeVisible()
  expect(guest.reads()).toBe(0)
  await login.close()
})

test('a delayed response cannot pop over another page after navigation', async ({ page }) => {
  await fixture(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/announcements?popup=1', async route => { await held; await route.fulfill({ json: { items: notices } }).catch(() => {}) })
  const started = page.waitForRequest('**/api/announcements?popup=1')
  await page.goto('/discover')
  await started
  await page.locator('.app-footer').getByRole('link', { name: '公告', exact: true }).click()
  release()
  await expect(page).toHaveURL(/\/messages/)
  await expect(popup(page)).not.toBeVisible()
  await page.reload()
  await expect(popup(page)).not.toBeVisible()
})

for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) test(`long announcement remains readable and keyboard accessible at ${width} in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 800 })
  await fixture(page, { items: [{ ...notices[0]!, title: '很长的社区公告标题'.repeat(8), text: '活动规则与使用说明。'.repeat(800) }] })
  await page.goto('/discover')
  await page.evaluate(theme => (window as any).communityAppearance.set({ mode: theme }), theme)
  await expect(popup(page)).toBeVisible()
  const bounds = await popup(page).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.width).toBeLessThanOrEqual(width)
  expect(bounds!.height).toBeLessThanOrEqual(800)
  expect(await popup(page).locator('.announcement-popup-content').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press('Shift+Tab')
  expect(await popup(page).evaluate(el => el.contains(document.activeElement))).toBe(true)
  const violations = (await new AxeBuilder({ page }).include('.announcement-popup').analyze()).violations
  expect(violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`announcement-${width}-${theme}.png`) })
  await popup(page).getByRole('button', { name: '关闭公告', exact: true }).click()
  await expect(popup(page)).not.toBeVisible()
})
