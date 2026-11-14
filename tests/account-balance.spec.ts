import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('balance links to account settings, refreshes and fits desktop/mobile headers', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let balance = 89.9996, failed = false
  const currencySymbol = '\u2726'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/account', route => failed
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { linked: true, subject: '17', balance, currencySymbol } }))
  await page.goto('/discover')
  const indicator = page.locator('.header-actions .account-balance')
  await expect(indicator).toHaveText(`90.00 ${currencySymbol}`)
  await expect(indicator).toHaveAttribute('title', `可用余额 ${currencySymbol} 89.9996`)
  await expect(indicator).toHaveAttribute('href', '/account?tab=balance')
  expect(await indicator.evaluate(element => element.nextElementSibling?.classList.contains('profile-menu'))).toBe(true)
  await expect(indicator.locator('svg')).toHaveCount(0)
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
    await page.screenshot({ path: `.taste-skill/balance-display-20261114/header-${width}.png` })
  }
  balance = 9.123456
  await indicator.click()
  await expect(page).toHaveURL(/\/account\?tab=balance$/)
  await expect(page.getByRole('navigation', { name: '账户设置', exact: true }).getByRole('button', { name: '账户与余额', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(indicator).toHaveText(`9.12 ${currencySymbol}`)
  await expect(indicator).toHaveAttribute('title', `可用余额 ${currencySymbol} 9.123456`)
  balance = 123456789.123456
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(indicator).toHaveAttribute('title', `可用余额 ${currencySymbol} 123456789.123456`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  balance = 9.123456
  failed = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(indicator).toHaveText('—')
  await expect(indicator).toHaveAttribute('href', '/account?tab=balance')
  await expect(indicator).toHaveAttribute('title', '查看账户与余额')
  failed = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(indicator).toHaveText(`9.12 ${currencySymbol}`)
  balance = 0
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(indicator).toHaveText(`0.00 ${currencySymbol}`)
  balance = 9.123456

  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/create/image')
  await expect(indicator).toBeVisible()
  await expect(page.locator('.billing-balance')).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(indicator).toBeHidden()
  await expect(page.locator('.billing-balance')).toBeVisible()
  await expect(page.locator('.billing-balance')).toContainText('9.12')
  await page.screenshot({ path: '.taste-skill/balance-display-20261114/studio-mobile.png' })
  await page.goto('/account?tab=balance')
  await expect(indicator).toHaveText(`9.12 ${currencySymbol}`)
  await expect(page.locator('.balance-panel .account-balance')).toHaveText(`9.12 ${currencySymbol}`)
  await page.goto('/discover')
  await indicator.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/account\?tab=balance$/)
  expect(errors).toEqual([])
})
