import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/session') return route.fulfill({ json: { user: null, csrfToken: 'login-fixture' } })
    if (path === '/api/security/capabilities') return route.fulfill({ json: { emailReset: true } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
})

test('reference login fits desktop, tablet and small phones', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir('.impeccable/review/account-login', { recursive: true })
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: '欢迎回来！', exact: true })).toBeVisible()
    const form = page.getByRole('form', { name: '登录社区', exact: true })
    await expect(form).toBeVisible()
    await expect(page.locator('.app-header, .app-footer, .mobile-nav')).toHaveCount(0)
    await expect(page.locator('.auth-visual')).toBeVisible({ visible: width >= 1024 })
    const input = page.getByRole('textbox', { name: '用户名或邮箱' })
    await expect(input).toHaveCSS('height', '48px')
    const connect = page.getByRole('button', { name: '使用章鱼账号登录', exact: true })
    await expect(connect).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const element of [form, input, connect]) {
      const bounds = (await element.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    }
    if (width === 1440 || width === 390) {
      const result = await new AxeBuilder({ page }).include('main').analyze()
      expect(result.violations).toEqual([])
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `.impeccable/review/account-login/${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('characters follow the pointer, respond to password visibility and stop for reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/account')
  const scene = page.locator('.login-characters')
  await expect(scene).toHaveAttribute('data-motion-active', 'true')
  const pupil = scene.locator('.character-pupil').first()
  await page.mouse.move(20, 20)
  const first = await pupil.evaluate(element => getComputedStyle(element).transform)
  await page.mouse.move(1300, 600)
  await expect.poll(() => pupil.evaluate(element => getComputedStyle(element).transform)).not.toBe(first)
  const password = page.getByLabel('密码', { exact: true })
  await password.fill('fixture-password')
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('fixture-password')
  await expect(scene.locator('.purple')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(scene).toHaveAttribute('data-motion-active', 'false')
  await expect(pupil).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
})

test('password recovery and community credentials keep their existing API contracts', async ({ page }) => {
  let signedIn = false
  await page.route('**/api/session', route => route.fulfill({ json: {
    user: signedIn ? { id: 'login-user', username: 'fixture-creator', name: '测试创作者' } : null,
    csrfToken: 'login-fixture',
  } }))
  await page.route('**/api/account', route => route.fulfill({ json: { linked: false, balance: null } }))
  await page.route('**/api/session/login', route => {
    expect(route.request().postDataJSON()).toEqual({ login: 'fixture-creator', password: 'fixture-password', token: '123456', recoveryCode: 'fixture-recovery' })
    signedIn = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/account')
  await page.getByRole('button', { name: '忘记密码？', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '已验证邮箱', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回登录', exact: true }).click()
  await page.getByRole('textbox', { name: '用户名或邮箱' }).fill('fixture-creator')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.locator('.login-factor summary').click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('123456')
  await page.getByRole('textbox', { name: '恢复码', exact: true }).fill('fixture-recovery')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '账户设置', exact: true })).toBeVisible()
  await expect(page.locator('.auth-page')).toHaveCount(0)
  await expect(page.locator('.app-header')).toBeVisible()
})
