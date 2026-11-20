import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

test.beforeEach(async ({ page }) => { await mockUnifiedAccount(page) })

test('single account login fits desktop and small phones with accessible controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir('.impeccable/review/account-login', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: '登录章鱼账号', exact: true })).toBeVisible()
    const form = page.getByRole('form', { name: '登录章鱼账号', exact: true })
    await expect(form).toBeVisible()
    await expect(page.getByText('或使用社区账号', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel(/验证码|恢复码/)).toHaveCount(0)
    await expect(page.locator('.app-header, .app-footer, .mobile-nav')).toHaveCount(0)
    await expect(page.locator('.auth-visual')).toBeVisible({ visible: width >= 1024 })
    await expect(page.getByRole('textbox', { name: '用户名或邮箱', exact: true })).toHaveCSS('height', '48px')
    await expect(page.getByRole('link', { name: '忘记密码？', exact: true })).toHaveAttribute('href', 'https://accounts.example/forgot-password')
    await expect(page.getByRole('link', { name: '注册账号', exact: true })).toHaveAttribute('href', '/account?mode=register')
    await expect(page.getByRole('link', { name: '注册账号', exact: true })).not.toHaveAttribute('target', '_blank')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const result = await new AxeBuilder({ page }).include('main').analyze()
    expect(result.violations).toEqual([])
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `.impeccable/review/account-login/unified-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})

test('characters keep password visibility and reduced motion behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/account')
  const scene = page.locator('.login-characters')
  await expect(scene).toHaveAttribute('data-motion-active', 'true')
  const pupil = scene.locator('.character-pupil').first()
  await page.mouse.move(20, 20)
  const initial = await pupil.evaluate(element => getComputedStyle(element).transform)
  await page.mouse.move(1300, 600)
  await expect.poll(() => pupil.evaluate(element => getComputedStyle(element).transform)).not.toBe(initial)
  const password = page.getByLabel('密码', { exact: true })
  await password.fill('fixture-password')
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('fixture-password')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(scene).toHaveAttribute('data-motion-active', 'false')
  await expect(pupil).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
})

test('password signs into the account service and synchronizes community without a popup', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  const popups: string[] = []
  page.on('popup', popup => popups.push(popup.url()))
  await page.goto('/account')
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/discover$/)
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/login')).toEqual([
    { path: '/api/new-api/login', body: { username: 'octopus-user', password: 'fixture-password' } },
  ])
  expect(fixture.mutations.some(item => ['/api/session/login', '/api/session/register', '/api/account/connect'].includes(item.path))).toBe(false)
  expect(popups).toEqual([])
  await expect(page.locator('.app-header')).toBeVisible()
})


test('a verified ambiguous account still requires a choice before MFA and navigation', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.requiresIdentitySelection = true
  fixture.state.requiresVerification = true
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/account?returnTo=%2Faccount%3Ftab%3Dsecurity')
  await fillAccountLogin(page)
  await expect(page.getByRole('heading', { name: '确认登录账号', exact: true })).toBeVisible()
  expect(fixture.state.accountAuthenticated).toBe(false)
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/login-select')).toHaveLength(0)
  await expect(page.getByLabel('密码', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
  await page.screenshot({ path: '.impeccable/review/account-login/identity-selection-320.png', fullPage: true })
  await page.getByRole('button', { name: '登录 octopusfixture 账号 #17', exact: true }).click()
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/login-select')).toEqual([{ path: '/api/new-api/login-select', body: { selection_id: 'verified-choice' } }])
  await expect(page.getByLabel('账号验证码或恢复码')).toBeVisible()
  expect(fixture.state.accountAuthenticated).toBe(false)
  await page.getByLabel('账号验证码或恢复码').fill('123456')
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/account\?tab=security$/)
  await expect(page.getByText('legacy-creator', { exact: true })).toBeVisible()
})

test('cancelling an account choice clears the password and cannot log in', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.requiresIdentitySelection = true
  await page.goto('/account')
  await fillAccountLogin(page)
  await page.getByRole('button', { name: '返回账号登录', exact: true }).click()
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('')
  expect(fixture.state.accountAuthenticated).toBe(false)
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/login-select')).toHaveLength(0)
  await expect.poll(() => fixture.mutations.filter(item => item.path === '/api/new-api/login-cancel').length).toBe(1)
})
