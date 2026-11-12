import { expect, test } from '@playwright/test'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

for (const width of [1440, 390]) {
  test(`login returns to the original library view at ${width}px`, async ({ page }) => {
    await mockUnifiedAccount(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/account?returnTo=%2Flibrary%3Ftab%3Dsaved')
    await fillAccountLogin(page)
    await expect(page).toHaveURL(/\/library\?tab=saved$/)
    await expect(page.locator('.auth-page')).toHaveCount(0)
  })
}

test('unsafe return destinations stay inside the community', async ({ page }) => {
  await mockUnifiedAccount(page)
  await page.goto('/account?returnTo=https%3A%2F%2Fother.example%2Fsteal')
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/discover$/)
})

test('skip navigation and account controls retain visible keyboard focus', async ({ page }) => {
  await mockUnifiedAccount(page)
  await page.goto('/account')
  await expect(page.getByRole('form', { name: '登录章鱼账号' })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: '跳至内容', exact: true })
  await expect(skip).toBeFocused()
  expect(await skip.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
  await skip.press('Enter')
  const main = page.locator('main')
  await expect(main).toBeFocused()
  expect(await main.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
  const username = page.getByRole('textbox', { name: '章鱼账号', exact: true })
  await username.focus()
  await expect.poll(() => username.evaluate(element => {
    const style = getComputedStyle(element)
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
  })).toBe(true)
})
