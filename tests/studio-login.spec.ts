import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('guest creation preserves the original page through login', async ({ page }) => {
  await mockUnifiedAccount(page, false)
  await page.goto('/create/video?remix=sourceWork')
  const link = page.getByRole('link', { name: '登录', exact: true }).filter({ visible: true }).last()
  await expect(link).toBeVisible()
  const target = new URL((await link.getAttribute('href'))!, page.url())
  expect(target.pathname).toBe('/account')
  expect(target.searchParams.get('returnTo')).toBe('/create/video?remix=sourceWork')
})

test('the community account opens the native creator without another login or authorization', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  await expect(page.getByRole('region', { name: '创作工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /确认授权|连接创作台|创建令牌/ })).toHaveCount(0)
  expect([...fixture.reads, ...fixture.mutations.map(item => item.path)].some(path => path.includes('/studio/start') || path.includes('/embedded/authorize') || path === '/api/account/connect')).toBe(false)
  expect(errors).toEqual([])
})

test('logout removes the native workspace and previous task identity', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/create/image')
  await expect(page.getByRole('region', { name: '创作工作台', exact: true })).toBeVisible()
  fixture.state.authenticated = false
  fixture.state.accountAuthenticated = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '登录后开始创作', exact: true })).toBeVisible()
  await expect(page.locator('.native-studio, .background-dock')).toHaveCount(0)
})
