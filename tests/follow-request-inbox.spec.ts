import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const person = { id: 'reader1', username: 'reader', name: '申请者', accountId: '42' }
  const state = { fail: false, received: [{ id: 'request1', user: person }, { id: 'request2', user: { ...person, id: 'reader2', name: '另一位申请者' } }], sent: [{ id: 'sent1', user: person }], actions: [] as string[], read: [] as string[] }
  const items = [
    { id: 'redis:1794435800001-0', type: 'activity', title: '旧的关注申请提醒', url: '/account?tab=following', isRead: false },
    { id: 'redis:1794435800002-0', type: 'activity', title: '新的关注申请提醒', url: '/messages?tab=activity#follow-requests', isRead: false },
  ]
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path === '/api/notifications') return route.fulfill({ json: { items, unreadCounts: { announcement: 0, activity: items.filter(item => !item.isRead).length } } })
    if (path === '/api/notifications/read') {
      const { ids } = request.postDataJSON(); state.read.push(...ids)
      for (const item of items) if (ids.includes(item.id)) item.isRead = true
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/api/follow-requests') {
      const requests = url.searchParams.get('direction') === 'sent' ? state.sent : state.received
      return route.fulfill({ json: { items: requests, total: requests.length, nextCursor: null } })
    }
    if (path.startsWith('/api/follow-requests/')) {
      expect(request.headers()['x-new-api-user']).toBe('17')
      expect(request.headers()['x-csrf-token']).toBe('unified-account-fixture')
      if (state.fail) return route.fulfill({ status: 503, json: { message: '处理失败，请重试' } })
      state.actions.push(request.postDataJSON().action)
      const id = path.split('/').pop()
      state.received = state.received.filter(item => item.id !== id); state.sent = state.sent.filter(item => item.id !== id)
      return route.fulfill({ json: { userId: person.id, followed: false, requested: false, followsYou: true } })
    }
    return route.fallback()
  })
  return { ...account, data: state }
}

test('follow requests are handled within the interaction dialog without changing the page', async ({ page }) => {
  const fixtureData = await fixture(page)
  await page.goto('/discover')
  await page.locator('summary.message-trigger').hover()
  await page.locator('.message-popover').getByRole('button', { name: /互动消息/ }).click()
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true })
  await expect(dialog.getByRole('heading', { name: '关注申请', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('follow-request-dialog-desktop.png'), fullPage: true })
  await dialog.getByRole('button', { name: '通过', exact: true }).first().click()
  await dialog.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '暂无待处理的关注申请' })).toBeVisible()
  await dialog.getByRole('button', { name: '发出的申请', exact: true }).click()
  await dialog.getByRole('button', { name: '撤回申请', exact: true }).click()
  for (const title of ['旧的关注申请提醒', '新的关注申请提醒']) {
    await dialog.getByRole('button', { name: title, exact: true }).click()
    await expect(dialog.getByRole('button', { name: '收到的申请', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog).toBeVisible(); await expect(page).toHaveURL('/discover')
  }
  expect(fixtureData.data.actions).toEqual(['accept', 'reject', 'cancel'])
  await expect.poll(() => fixtureData.data.read.length).toBe(2)
})

test('legacy settings links open the interaction inbox and request failures remain retryable on mobile', async ({ page }) => {
  const fixtureData = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/account?tab=following')
  await expect(page).toHaveURL('/messages?tab=activity#follow-requests')
  fixtureData.data.fail = true
  await page.getByRole('button', { name: '通过', exact: true }).first().click()
  await expect(page.getByRole('alert').filter({ hasText: '处理失败' })).toBeVisible()
  await expect(page.locator('.request-row')).toHaveCount(2)
  fixtureData.data.fail = false
  await page.getByRole('button', { name: '通过', exact: true }).first().click()
  await expect(page.locator('.request-row')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.messages-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await page.screenshot({ path: test.info().outputPath('follow-request-inbox-mobile.png'), fullPage: true })
})

test('the mobile follow-request shortcut opens the interaction dialog in place', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/community')
  await page.getByTitle('社区工具', { exact: true }).click()
  await page.locator('.tools-grid').getByRole('button', { name: '关注申请', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true })
  await expect(dialog.getByRole('heading', { name: '关注申请', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '通过', exact: true }).first().click()
  await expect(dialog.locator('.request-row')).toHaveCount(1)
  await expect(page).toHaveURL('/community')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.message-center-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await page.screenshot({ path: test.info().outputPath('follow-request-dialog-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
