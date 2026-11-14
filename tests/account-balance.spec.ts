import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('balance sits before the avatar, refreshes and fits desktop/mobile headers', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let balance = 12.5, failed = false
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/account', route => failed
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { linked: true, subject: '17', balance, currencySymbol: 'USD' } }))
  await page.goto('/discover')
  const indicator = page.locator('.account-balance')
  await expect(indicator).toHaveText('12.5')
  await expect(indicator).toHaveAttribute('title', '可用余额 USD 12.5')
  expect(await indicator.evaluate(element => element.nextElementSibling?.classList.contains('profile-menu'))).toBe(true)
  await expect(indicator.locator('svg')).toBeVisible()
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const amount = await indicator.boundingBox()
    const avatar = await page.locator('.profile-toggle').boundingBox()
    expect(amount!.x + amount!.width).toBeLessThanOrEqual(avatar!.x)
    expect(avatar!.x + avatar!.width).toBeLessThanOrEqual(width)
    const logo = await page.locator('.brand-mark').boundingBox()
    expect(logo!.x).toBeGreaterThanOrEqual(0)
    expect(logo!.width).toBeGreaterThanOrEqual(28)
    expect(logo!.x + logo!.width).toBeLessThan(amount!.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/header-balance-20261114/header-${width}.png` })
  }
  balance = 9.123456
  await indicator.click()
  await expect(indicator).toHaveText('9.1235')
  await expect(indicator).toHaveAttribute('title', '可用余额 USD 9.123456')
  balance = 123456789.123456
  await indicator.click()
  await expect(indicator).toHaveAttribute('title', '可用余额 USD 123456789.123456')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  balance = 9.123456
  failed = true
  await indicator.click()
  await expect(indicator).toHaveText('—')
  await expect(indicator).toBeEnabled()
  failed = false
  await indicator.click()
  await expect(indicator).toHaveText('9.1235')

  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/create/image')
  await expect(indicator).toBeVisible()
  await expect(page.locator('.billing-balance')).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(indicator).toBeHidden()
  await expect(page.locator('.billing-balance')).toBeVisible()
  await expect(page.locator('.billing-balance')).toContainText('9.1235')
  await page.screenshot({ path: '.taste-skill/header-balance-20261114/studio-mobile.png' })
  expect(errors).toEqual([])
})
