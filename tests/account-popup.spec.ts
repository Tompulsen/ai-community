import { expect, test } from '@playwright/test'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

test('an existing account login enters community without another password or authorization', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.studioAuthenticated = true
  await page.goto('/account?returnTo=%2Flibrary')
  await expect(page).toHaveURL(/\/library$/)
  expect(fixture.mutations.filter(item => item.path === '/api/account/session')).toHaveLength(1)
  expect(fixture.mutations.some(item => item.path === '/studio/api/new-api/login' || item.path === '/api/account/connect')).toBe(false)
})

test('upstream account verification completes before community session synchronization', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.requiresVerification = true
  await page.goto('/account')
  await fillAccountLogin(page)
  await expect(page.getByRole('heading', { name: '验证章鱼账号', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '账号验证码或恢复码', exact: true }).fill('123456')
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/discover$/)
  expect(fixture.mutations.filter(item => item.path === '/studio/api/new-api/login-2fa')).toEqual([
    { path: '/studio/api/new-api/login-2fa', body: { code: '123456' } },
  ])
})

test('a synchronization error keeps the user on the login page with a clear error', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  await page.goto('/account')
  fixture.state.syncFailure = true
  await fillAccountLogin(page)
  await expect(page.getByRole('alert')).toHaveText('账号同步暂时不可用。')
  await expect(page.getByRole('form', { name: '登录章鱼账号' })).toBeVisible()
  await expect(page).toHaveURL(/\/account$/)
})

test('a configured human verification token goes to the existing account login endpoint', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  fixture.state.turnstileSiteKey = 'fixture-site-key'
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.turnstile={render:function(el,options){options.callback("fixture-verification-token");return "fixture-widget"},remove:function(){}}',
  }))
  await page.goto('/account')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/discover$/)
  expect(fixture.mutations.find(item => item.path === '/studio/api/new-api/login')?.body).toEqual({
    username: 'octopus-user', password: 'fixture-password', turnstile_token: 'fixture-verification-token',
  })
})

test('returning to the account page refreshes an account changed in another tab', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account')
  await expect(page.locator('.account-identity')).toHaveText('@octopusfixture')
  fixture.state.user = { ...fixture.state.user, id: 'secondAccountUser', username: 'secondaccount' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.account-identity')).toHaveText('@secondaccount')
})
