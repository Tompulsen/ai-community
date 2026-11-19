import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('profile previews show the numeric Octopus account and real username at desktop and phone widths', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  fixture.state.user.username = 'root'
  await mkdir('.impeccable/review/account-number', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await page.goto('/account?tab=profile')
    await page.locator('.profile-preview > summary').click()
    const identity = page.locator('.profile-preview-body > span')
    await expect(identity).toHaveText('章鱼号：17')
    await expect(page.locator('.profile-identity dd').first()).toHaveText('root')
    await expect(page.getByRole('textbox', { name: '登录用户名', exact: true })).toHaveCount(0)
    await expect(identity).not.toContainText('na_')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/account-number/${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: '返回账户设置', exact: true }).click()
  await page.getByRole('button', { name: '我的账户', exact: true }).click()
  await expect(page).toHaveURL(/tab=balance/)
  await expect(page.locator('.profile-preview-body')).toHaveCount(0)
})

test('profile editing keeps the verified account number and username read-only', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account')
  await page.getByRole('textbox', { name: '社区昵称', exact: true }).fill('章鱼小白')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  const mutation = fixture.mutations.find(item => item.path === '/api/profile')
  expect(mutation?.body).toMatchObject({ name: '章鱼小白' })
  expect(mutation?.body).not.toHaveProperty('accountId')
  expect(mutation?.body).not.toHaveProperty('username')
  await expect(page.locator('.profile-preview-body > span')).toHaveText('章鱼号：17')
  await expect(page.locator('.profile-identity dd').first()).toHaveText('octopusfixture')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '社区昵称', exact: true })).toHaveValue('章鱼小白')
  await page.locator('.profile-preview > summary').click()
  await expect(page.locator('.profile-preview-body')).toContainText('章鱼号：17')
  await page.goto('/discover')
  await page.locator('.profile-toggle').click()
  await expect(page.locator('.menu-title')).toHaveText('章鱼小白章鱼号：17')
})
