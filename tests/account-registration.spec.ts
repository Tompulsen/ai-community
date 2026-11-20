import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { TurnstileApi } from '../src/turnstile'
import { mockUnifiedAccount } from './helpers/account-fixture'

type WidgetOptions = Parameters<TurnstileApi['render']>[1]
type TestWindow = Window & typeof globalThis & { turnstile: TurnstileApi; registrationWidgets: WidgetOptions[] }

async function fillRegistration(page: Page) {
  await page.getByRole('textbox', { name: '用户名', exact: true }).fill('new-creator')
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('creator@example.com')
  await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('a1b2c3')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByLabel('确认密码', { exact: true }).fill('fixture-password')
}

async function completeChallenge(page: Page, token: string) {
  await expect.poll(() => page.evaluate(() => (window as TestWindow).registrationWidgets.length)).toBeGreaterThan(0)
  await page.evaluate(value => (window as TestWindow).registrationWidgets.at(-1)!.callback?.(value), token)
}

test('registration stays in the community and preserves the return destination for the later login', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  const popups: string[] = []
  page.on('popup', popup => popups.push(popup.url()))
  const invite = 'wf' + 'a'.repeat(24)
  await page.goto(`/account?invite=${invite}&returnTo=%2Flibrary%3Ftab%3Dsaved`)
  await page.getByRole('link', { name: '注册账号', exact: true }).click()
  await expect(page.getByRole('form', { name: '注册章鱼账号', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('mode')).toBe('register')
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/library?tab=saved')
  await expect(page.getByRole('textbox', { name: '邀请码（选填）', exact: true })).toHaveCount(0)
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '用户名或邮箱', exact: true })).toHaveValue('new-creator')
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('')
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/register')).toEqual([{
    path: '/api/new-api/register',
    body: { username: 'new-creator', password: 'fixture-password', email: 'creator@example.com', verification_code: 'a1b2c3', aff_code: invite },
  }])
  expect(fixture.state.accountAuthenticated).toBe(false)
  expect(fixture.state.authenticated).toBe(false)
  expect(fixture.mutations.some(item => ['/api/new-api/login', '/api/session/register', '/api/session/login', '/api/account/connect'].includes(item.path))).toBe(false)
  expect(popups).toEqual([])
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/library\?tab=saved$/)
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/login')).toEqual([{
    path: '/api/new-api/login', body: { username: 'new-creator', password: 'fixture-password' },
  }])
})

test('affiliate attribution survives login mode changes without QX invitation controls', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  const cached = 'wf' + 'c'.repeat(24)
  await page.addInitScript(value => sessionStorage.setItem('ai-community-next:invite', value), cached)
  await page.goto('/account?mode=register&qx_ref=Manual123')
  await expect(page.locator('input[name="qx_invite_code"]')).toHaveCount(0)
  await page.getByRole('link', { name: '立即登录', exact: true }).click()
  await page.getByRole('link', { name: '注册账号', exact: true }).click()
  await expect(page.locator('input[name="qx_invite_code"]')).toHaveCount(0)
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  const registration = fixture.mutations.find(item => item.path === '/api/new-api/register')
  expect(registration?.body.aff_code).toBe(cached)
  expect(registration?.body).not.toHaveProperty('qx_invite_code')
})

for (const qxCode of ['abcd1234', 'invalid-code']) test(`registration ignores legacy QX parameter ${qxCode} and preserves affiliate attribution`, async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  const cached = 'wf' + 'd'.repeat(24), linkedInvite = 'wf' + 'e'.repeat(24)
  await page.addInitScript(value => sessionStorage.setItem('ai-community-next:invite', value), cached)
  await page.goto(`/account?mode=register&aff=Link123&invite=${linkedInvite}&qx_ref=${qxCode}`)
  await expect(page.locator('input[name="qx_invite_code"]')).toHaveCount(0)
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  const registrations = fixture.mutations.filter(item => item.path === '/api/new-api/register')
  expect(registrations).toHaveLength(1)
  expect(registrations[0]!.body.aff_code).toBe('Link123')
  expect(registrations[0]!.body).not.toHaveProperty('qx_invite_code')
})

for (const [cached, linked, expected] of [
  ['Ab9', '', 'Ab9'],
  ['001234', '', '001234'],
  ['Old3', 'New4', 'New4'],
] as const) test(`registration prioritizes explicit affiliate codes over cached ${cached} and historical welfare links`, async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  await page.addInitScript(({ cached, legacy }) => {
    sessionStorage.setItem('ai-community-next:referral-invite', cached)
    sessionStorage.setItem('ai-community-next:invite', legacy)
  }, { cached, legacy: 'wf' + 'a'.repeat(24) })
  await page.goto('/account?mode=register' + (linked ? '&aff=' + linked : ''))
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.find(item => item.path === '/api/new-api/register')?.body.aff_code).toBe(expected)
})

test('legacy numeric lottery invitation IDs never become affiliate codes', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  await page.addInitScript(() => sessionStorage.setItem('ai-community-next:invite', '17'))
  await page.goto('/account?mode=register&invite=23')
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.find(item => item.path === '/api/new-api/register')?.body).not.toHaveProperty('aff_code')
})

test('sending email, registering and logging in consume separate human verification challenges', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.turnstileSiteKey = 'fixture-site-key'
  await page.addInitScript(() => {
    const browser = window as TestWindow
    browser.registrationWidgets = []
    browser.turnstile = {
      render(container, options) {
        container.textContent = '安全验证'
        browser.registrationWidgets.push(options)
        return String(browser.registrationWidgets.length)
      },
      remove() {},
    }
  })
  await page.goto('/account?mode=register')
  await fillRegistration(page)
  const send = page.getByRole('button', { name: '发送验证码', exact: true })
  await expect(send).toBeDisabled()
  await expect(page.getByRole('button', { name: '注册账号', exact: true })).toBeDisabled()
  await completeChallenge(page, 'mail-challenge')
  await send.click()
  await expect.poll(() => fixture.mutations.filter(item => item.path === '/api/new-api/registration-code')).toEqual([{
    path: '/api/new-api/registration-code', body: { email: 'creator@example.com', turnstile_token: 'mail-challenge' },
  }])
  await expect(page.getByRole('button', { name: '注册账号', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /秒/ })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => (window as TestWindow).registrationWidgets.length)).toBe(2)
  expect(await page.evaluate(() => (window as TestWindow).registrationWidgets.map(widget => widget.action))).toEqual(['registration', 'registration'])
  await completeChallenge(page, 'register-challenge')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  expect(fixture.mutations.find(item => item.path === '/api/new-api/register')?.body.turnstile_token).toBe('register-challenge')
  expect(fixture.mutations.some(item => item.path === '/api/new-api/login')).toBe(false)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => (window as TestWindow).registrationWidgets.length)).toBe(3)
  await completeChallenge(page, 'login-challenge')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/discover$/)
  expect(fixture.mutations.find(item => item.path === '/api/new-api/login')?.body.turnstile_token).toBe('login-challenge')
})

test('password confirmation and upstream errors keep registration recoverable without creating a session', async ({ page }, info) => {
  const fixture = await mockUnifiedAccount(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/account?mode=register&aff=Keep1234')
  await fillRegistration(page)
  await page.getByLabel('确认密码', { exact: true }).fill('different-password')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/密码/)
  await page.screenshot({ path: info.outputPath('registration-mismatch-390.png'), fullPage: true })
  expect(fixture.mutations.some(item => item.path === '/api/new-api/register')).toBe(false)
  await page.getByLabel('确认密码', { exact: true }).fill('fixture-password')
  fixture.state.registrationError = '邮箱已被使用，请更换邮箱。'
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(fixture.state.registrationError)
  await expect(page.getByRole('textbox', { name: '用户名', exact: true })).toHaveValue('new-creator')
  await expect(page.getByRole('textbox', { name: '邮箱', exact: true })).toHaveValue('creator@example.com')
  expect(fixture.state.accountAuthenticated).toBe(false)
  fixture.state.registrationError = ''
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('another@example.com')
  await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('a1b2c3')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByLabel('确认密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/register').every(item => item.body.aff_code === 'Keep1234' && !('qx_invite_code' in item.body))).toBe(true)
  await page.screenshot({ path: info.outputPath('registration-success-login-390.png'), fullPage: true })
})

for (const disabled of ['registerEnabled', 'passwordRegisterEnabled'] as const) {
  test(`registration respects ${disabled} while login remains available`, async ({ page }) => {
    const fixture = await mockUnifiedAccount(page)
    fixture.state[disabled] = false
    await page.goto('/account')
    await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '注册账号', exact: true })).toHaveCount(0)
    await page.goto('/account?mode=register')
    await expect(page.getByRole('form', { name: '注册章鱼账号', exact: true })).toHaveCount(0)
    expect(fixture.mutations.some(item => item.path === '/api/new-api/register')).toBe(false)
  })
}

test('password registration stays available when password login is disabled', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.passwordLoginEnabled = false
  await page.goto('/account?mode=register')
  await expect(page.getByRole('form', { name: '注册章鱼账号', exact: true })).toBeVisible()
  await fillRegistration(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/register')).toHaveLength(1)
  expect(fixture.state.accountAuthenticated).toBe(false)
})

test('registration omits email and code when account-center email verification is disabled', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.emailVerificationEnabled = false
  await page.goto('/account?mode=register')
  await expect(page.getByRole('textbox', { name: '邮箱', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '邮箱验证码', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '发送验证码', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: '用户名', exact: true }).fill('new-creator')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByLabel('确认密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/register')).toEqual([{
    path: '/api/new-api/register', body: { username: 'new-creator', password: 'fixture-password' },
  }])
  expect(fixture.state.accountAuthenticated).toBe(false)
})

test('registration requires the enabled account-center agreements before submitting', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.userAgreementEnabled = true
  fixture.state.privacyPolicyEnabled = true
  await page.goto('/account?mode=register')
  await fillRegistration(page)
  await expect(page.getByRole('link', { name: '《用户协议》', exact: true })).toHaveAttribute('href', 'https://accounts.example/user-agreement')
  await expect(page.getByRole('link', { name: '《隐私政策》', exact: true })).toHaveAttribute('href', 'https://accounts.example/privacy-policy')
  const consent = page.getByRole('checkbox')
  await expect(consent).not.toBeChecked()
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  expect(await consent.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  expect(fixture.mutations.some(item => item.path === '/api/new-api/register')).toBe(false)
  await consent.check()
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
  expect(fixture.mutations.filter(item => item.path === '/api/new-api/register')).toHaveLength(1)
})

test('a rate-limited verification email respects Retry-After and preserves the form', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  let attempts = 0
  await page.route('**/api/new-api/registration-code', route => {
    attempts++
    return route.fulfill({ status: 429, headers: { 'Retry-After': '120' }, json: { success: false, message: '发送过于频繁，请稍后重试。' } })
  })
  await page.clock.install()
  await page.goto('/account?mode=register')
  await fillRegistration(page)
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('发送过于频繁，请稍后重试。')
  const countdown = page.getByRole('button', { name: /秒后重发/ })
  await expect(countdown).toHaveText(/^(?:1[01]\d|120) 秒后重发$/)
  await expect(countdown).toBeDisabled()
  await expect(page.getByRole('textbox', { name: '用户名', exact: true })).toHaveValue('new-creator')
  await expect(page.getByRole('textbox', { name: '邮箱', exact: true })).toHaveValue('creator@example.com')
  await expect(page.getByRole('textbox', { name: '邮箱验证码', exact: true })).toHaveValue('a1b2c3')
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('fixture-password')
  await page.clock.fastForward(120_000)
  await expect(page.getByRole('button', { name: '发送验证码', exact: true })).toBeEnabled()
  expect(attempts).toBe(1)
  expect(fixture.mutations.some(item => item.path === '/api/new-api/register')).toBe(false)
  expect(fixture.state.accountAuthenticated).toBe(false)
})

for (const width of [1440, 390, 320]) {
  test(`registration fits ${width}px with accessible controls and preserves navigation`, async ({ page }, info) => {
    await mockUnifiedAccount(page)
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/account?mode=register&returnTo=%2Flibrary%3Ftab%3Dsaved')
    await expect(page.getByRole('heading', { name: '注册章鱼账号', exact: true })).toBeVisible()
    const form = page.getByRole('form', { name: '注册章鱼账号', exact: true })
    await expect(form).toBeVisible()
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    await expect(page.getByRole('textbox', { name: '邮箱验证码', exact: true })).toHaveAttribute('autocomplete', 'one-time-code')
    await expect(page.locator('input[name="qx_invite_code"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`registration-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: '立即登录', exact: true }).click()
    await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/library?tab=saved')
  })
}
