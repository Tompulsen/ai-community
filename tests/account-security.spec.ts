import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('account security belongs to the account center and has no community password form', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/account?tab=security')
  await expect(page.getByRole('heading', { name: '章鱼账号安全', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '管理章鱼账号', exact: true })).toHaveAttribute('href', 'https://accounts.example/')
  await expect(page.getByLabel(/当前社区密码|新密码|再次输入新密码/)).toHaveCount(0)
  await expect(page.getByText('Fixture other device', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('current device logout clears both logins without invoking retired revocation routes', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account?tab=security')
  await expect(page.getByRole('button', { name: '撤销此会话', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '退出当前设备', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  expect(fixture.mutations.filter(item => item.path === '/api/security/sessions/revoke')).toEqual([])
  expect(fixture.mutations.some(item => item.path === '/api/new-api/logout')).toBe(true)
})

test('an old community reset link leads to the account center without sending a reset mutation', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  await page.goto(`/account?reset=${'r'.repeat(43)}`)
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: '找回章鱼账号密码', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: '找回章鱼账号密码', exact: true })).toHaveAttribute('href', 'https://accounts.example/forgot-password')
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '返回登录', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  expect(fixture.mutations.some(item => item.path.startsWith('/api/security/password'))).toBe(false)
})
