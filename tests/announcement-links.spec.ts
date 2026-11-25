import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const destination = 'https://notice.example/join?group=577205236&source=community#invite'
const notice = { id: 'link-notice', type: 'announcement', title: 'QQ交流群', text: `577205236\n欢迎每一位社区小伙伴的加入！\n加入地址：${destination}。\n帮助：www.example.com/help`, display: 'dialog', isRead: false }
const popup = (page: Page) => page.getByRole('dialog', { name: '社区公告', exact: true })
async function fixture(page: Page, text = notice.text) {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/announcements?popup=1', route => route.fulfill({ json: { items: [{ ...notice, text }] } }))
  let read = false
  await page.route('**/api/notifications', route => route.fulfill({ json: { items: [{ ...notice, text, isRead: read }], unreadCounts: { announcement: read ? 0 : 1, activity: 0 } } }))
  await page.route('**/api/notifications/read', route => { read = true; return route.fulfill({ json: { ok: true } }) })
  await page.context().route('https://notice.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>公告目标</title><h1>加入群聊</h1>' }))
  return { read: () => read }
}

test('announcement URLs open the exact destination in a separate tab and preserve the announcement', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  const link = popup(page).getByRole('link').filter({ hasText: destination })
  await expect(link).toHaveAttribute('href', destination)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(popup(page).getByRole('link', { name: /www.example.com/ })).toHaveAttribute('href', 'https://www.example.com/help')
  await expect(popup(page).locator('article p')).toHaveText(notice.text)
  await link.focus()
  const opened = page.waitForEvent('popup')
  await page.keyboard.press('Enter')
  const target = await opened
  await expect(target).toHaveURL(destination)
  expect(await target.evaluate(() => window.opener === null)).toBe(true)
  await expect(popup(page)).toBeVisible()
  await expect(page).toHaveURL(/\/discover$/)
  await target.close()
})

test('message centre announcement links avoid nested anchors and keep read status', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover')
  await popup(page).getByRole('button', { name: '我知道了' }).click()
  await page.goto('/messages?tab=announcement')
  const card = page.locator('.inbox-notification').filter({ hasText: notice.title })
  const link = card.getByRole('link').filter({ hasText: destination })
  await expect(link).toHaveAttribute('href', destination)
  expect(await link.evaluate(el => el.parentElement?.closest('a,button') === null)).toBe(true)
  const opened = page.waitForEvent('popup')
  await link.click()
  const target = await opened
  await expect(target).toHaveURL(destination)
  await expect(page).toHaveURL(/\/messages\?tab=announcement$/)
  await expect.poll(state.read).toBe(true)
  await expect(card.getByLabel('未读', { exact: true })).toHaveCount(0)
  await target.close()
})

test('announcement text stays literal, blocks unsafe URLs, and keeps balanced URL punctuation', async ({ page }) => {
  const text = '群号577205236\n<img src=x onerror="alert(1)">\njavascript:alert(1) data:text/html,test ftp://example.com\nhttps://user:password@example.com/private\n查看（https://notice.example/中文?q=一&x=2#说明）。\n文档 (https://notice.example/wiki/Test_(sample)).\n访问 HTTP://notice.example/plain!\n请访问「https://notice.example/join」。或『https://notice.example/next』。\n说明 (https://notice.example/end.)'
  await fixture(page, text)
  await page.goto('/discover')
  await expect(popup(page).locator('article p')).toHaveText(text)
  await expect(popup(page).locator('img,script,iframe')).toHaveCount(0)
  await expect(popup(page).getByRole('link')).toHaveCount(6)
  await expect(popup(page).getByRole('link').nth(0)).toHaveAttribute('href', new URL('https://notice.example/中文?q=一&x=2#说明').href)
  await expect(popup(page).getByRole('link').nth(1)).toHaveAttribute('href', 'https://notice.example/wiki/Test_(sample)')
  await expect(popup(page).getByRole('link').nth(2)).toHaveAttribute('href', 'http://notice.example/plain')
  await expect(popup(page).getByRole('link').nth(3)).toHaveAttribute('href', 'https://notice.example/join')
  await expect(popup(page).getByRole('link').nth(4)).toHaveAttribute('href', 'https://notice.example/next')
  await expect(popup(page).getByRole('link').nth(5)).toHaveAttribute('href', 'https://notice.example/end')
})

for (const width of [320, 1440]) for (const theme of ['light', 'dark']) test(`long announcement links wrap and remain accessible at ${width} in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await fixture(page, notice.text + '\nhttps://notice.example/help?token=' + 'a'.repeat(320))
  await page.goto('/discover')
  await page.evaluate(theme => (window as any).communityAppearance.set({ mode: theme }), theme)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).getByRole('link')).toHaveCount(3)
  const content = popup(page).locator('.announcement-popup-content')
  expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await popup(page).getByRole('link').first().focus()
  await expect(popup(page).getByRole('link').first()).toBeFocused()
  expect((await new AxeBuilder({ page }).include('.announcement-popup').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`announcement-links-${width}-${theme}.png`) })
})
