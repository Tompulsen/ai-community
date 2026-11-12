import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('account settings show the numeric Octopus account and real username at desktop and phone widths', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  fixture.state.user.username = 'root'
  await mkdir('.impeccable/review/account-number', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await page.goto('/account')
    const identity = page.getByLabel('章鱼账号', { exact: true })
    await expect(identity).toHaveText('账号ID:17 @root')
    await expect(identity).not.toContainText('na_')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/account-number/${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: '账户与余额', exact: true }).click()
  await expect(page.locator('dt', { hasText: '账号ID' })).toBeVisible()
  await expect(page.locator('.info-list dd').first()).toHaveText('17')
})

test('profile editing keeps the verified account number and username read-only', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account')
  await page.getByRole('textbox', { name: '显示名称', exact: true }).fill('新的显示名称')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  const mutation = fixture.mutations.find(item => item.path === '/api/profile')
  expect(mutation?.body).toMatchObject({ name: '新的显示名称' })
  expect(mutation?.body).not.toHaveProperty('accountId')
  expect(mutation?.body).not.toHaveProperty('username')
  await expect(page.getByLabel('章鱼账号', { exact: true })).toHaveText('账号ID:17 @octopusfixture')
})
