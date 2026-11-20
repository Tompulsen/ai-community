import { expect, test, type Page } from '@playwright/test'
import type { TurnstileApi } from '../src/turnstile'
import { mockUnifiedAccount } from './helpers/account-fixture'

type WidgetOptions = Parameters<TurnstileApi['render']>[1]
type TestWindow = Window & {
  turnstile: TurnstileApi
  turnstileTest: { widgets: WidgetOptions[]; removed: string[] }
}

async function mockTurnstile(page: Page) {
  await page.addInitScript(() => {
    const browser = window as TestWindow
    browser.turnstileTest = { widgets: [], removed: [] }
    browser.turnstile = {
      render(container, options) {
        container.textContent = '安全验证'
        browser.turnstileTest.widgets.push(options)
        return String(browser.turnstileTest.widgets.length)
      },
      remove(id) { browser.turnstileTest.removed.push(id) },
    }
  })
}

test.beforeEach(async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.turnstileSiteKey = 'fixture-site-key'
})

test('a slow challenge offers retry without losing credentials or accepting stale callbacks', async ({ page }) => {
  await page.clock.install()
  await mockTurnstile(page)
  const logs: string[] = []
  page.on('console', message => { if (message.type() === 'warning') logs.push(message.text()) })
  await page.goto('/account')
  const username = page.getByRole('textbox', { name: '用户名或邮箱', exact: true })
  const password = page.getByLabel('密码', { exact: true })
  const submit = page.getByRole('button', { name: '登录', exact: true })
  await username.fill('fixture-user')
  await password.fill('fixture-password')
  await expect(page.locator('.account-verification')).toContainText('安全验证')
  await expect(submit).toBeDisabled()
  await page.clock.fastForward(30_000)
  await expect(page.getByRole('status')).toContainText('验证等待时间较长')
  await expect(page.getByRole('status')).toContainText('CHALLENGE_TIMEOUT')
  await page.getByRole('button', { name: '重新验证', exact: true }).click()
  await expect(username).toHaveValue('fixture-user')
  await expect(password).toHaveValue('fixture-password')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as TestWindow).turnstileTest.widgets.length)).toBe(2)
  await page.evaluate(() => {
    const old = (window as TestWindow).turnstileTest.widgets[0]!
    old.callback?.('stale-secret-token')
    old['error-callback']?.('110200')
    old['expired-callback']?.()
    old['timeout-callback']?.()
  })
  await expect(submit).toBeDisabled()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.evaluate(() => (window as TestWindow).turnstileTest.widgets[1]!.callback?.('current-secret-token'))
  await expect(submit).toBeEnabled()
  await page.clock.fastForward(31_000)
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('link', { name: '浏览社区', exact: true }).click()
  await expect(page).toHaveURL(/\/discover$/)
  await page.evaluate(() => {
    const old = (window as TestWindow).turnstileTest.widgets[1]!
    old.callback?.('unmounted-secret-token')
    old['error-callback']?.('110200')
    old['expired-callback']?.()
    old['timeout-callback']?.()
  })
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('CHALLENGE_TIMEOUT')
  expect(logs.join(' ')).not.toMatch(/fixture-user|fixture-password|secret-token|fixture-site-key/)
})

for (const scenario of [
  { code: '110200', text: '配置异常', logged: '110200' },
  { code: '200500', text: '验证连接失败', logged: '200500' },
  { code: '110620', text: '验证已超时', logged: '110620' },
  { code: 'unsafe-token-content', text: '人机验证暂时不可用', logged: 'CHALLENGE_ERROR' },
]) {
  test(`challenge failure ${scenario.code} shows a safe diagnostic and recovers`, async ({ page }) => {
    await mockTurnstile(page)
    const logs: string[] = []
    page.on('console', message => { if (message.type() === 'warning') logs.push(message.text()) })
    await page.goto('/account')
    await expect(page.locator('.account-verification')).toContainText('安全验证')
    await page.evaluate(code => (window as TestWindow).turnstileTest.widgets[0]!['error-callback']?.(code), scenario.code)
    await expect(page.getByRole('status')).toContainText(scenario.text)
    await expect(page.getByRole('status')).toContainText(scenario.logged)
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
    expect(logs.join(' ')).toContain(scenario.logged)
    expect(logs.join(' ')).not.toContain('unsafe-token-content')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.impeccable/review/account-login/turnstile-${scenario.logged}-${width}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: '重新验证', exact: true }).click()
    await expect(page.getByRole('status')).toHaveCount(0)
    await page.evaluate(() => (window as TestWindow).turnstileTest.widgets[1]!.callback?.('fixture-token'))
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  })
}

test('expiry and interaction timeout invalidate a completed challenge and offer recovery', async ({ page }) => {
  await mockTurnstile(page)
  await page.goto('/account')
  await expect(page.locator('.account-verification')).toContainText('安全验证')
  const submit = page.getByRole('button', { name: '登录', exact: true })
  await page.evaluate(() => (window as TestWindow).turnstileTest.widgets[0]!.callback?.('fixture-token'))
  await expect(submit).toBeEnabled()
  await page.evaluate(() => (window as TestWindow).turnstileTest.widgets[0]!['expired-callback']?.())
  await expect(submit).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('TOKEN_EXPIRED')
  await page.getByRole('button', { name: '重新验证', exact: true }).click()
  await page.evaluate(() => (window as TestWindow).turnstileTest.widgets[1]!['timeout-callback']?.())
  await expect(page.getByRole('status')).toContainText('INTERACTION_TIMEOUT')
  await expect(submit).toBeDisabled()
})

test.describe('mock SDK transport', () => {
  // The isolated preview blocks external scripts; every HTTPS request stays intercepted here.
  test.use({ bypassCSP: true })
  test.beforeEach(async ({ page }) => {
    await page.route('https://**', route => route.abort())
  })

  test('failed SDK loading can be retried without reloading the account page', async ({ page }) => {
    let attempts = 0
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', route => {
      attempts++
      if (attempts === 1) return route.abort('failed')
      return route.fulfill({ contentType: 'application/javascript', body: `
        window.turnstile = {
          render(container) { container.textContent = '安全验证'; return 'recovered'; },
          remove() {}
        };
      ` })
    })
    await page.goto('/account')
    await expect(page.getByRole('status')).toContainText('SDK_NETWORK_ERROR')
    await page.getByRole('textbox', { name: '用户名或邮箱', exact: true }).fill('fixture-user')
    await page.getByRole('button', { name: '重新验证', exact: true }).click()
    await expect(page.locator('.account-verification')).toContainText('安全验证')
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '用户名或邮箱', exact: true })).toHaveValue('fixture-user')
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
    expect(attempts).toBe(2)
  })

  test('SDK requests that never finish show a timeout and keep login blocked', async ({ page }) => {
    await page.clock.install()
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', () => {})
    await page.goto('/account')
    await expect(page.locator('script[data-octopus-turnstile]')).toHaveCount(1)
    await page.clock.fastForward(15_000)
    await expect(page.getByRole('status')).toContainText('SDK_TIMEOUT')
    await expect(page.getByRole('button', { name: '重新验证', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  })
})
