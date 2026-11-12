import { expect, test, type Page } from '@playwright/test'

const origin = process.env.COMMUNITY_REGRESSION_ORIGIN || 'http://localhost:18775'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use a local preview for mocked account tests.')
test.use({ baseURL: origin, serviceWorkers: 'block' })

const user = { id: 'fixtureSecurityUser', username: 'securityfixture', name: '安全测试用户', bio: '', isAdmin: false, isModerator: false }
const currentSession = 'a'.repeat(64), otherSession = 'b'.repeat(64)
const recoveryCodes = Array.from({ length: 10 }, (_, index) => `ABCD1234${String(index).padStart(2, '0')}`)
interface Mutation { path: string; body: Record<string, unknown> }
interface Response { status?: number; json: unknown }

async function mockAccount(page: Page, authenticated = true) {
  const unexpected: string[] = [], mutations: Mutation[] = [], reads: string[] = []
  const state = {
    authenticated, twoFactorEnabled: false, emailReset: false,
    devices: [
      { id: currentSession, current: true, createdAt: '2026-11-12T00:00:00Z', ip: '127.0.0.1', userAgent: 'Fixture current device' },
      { id: otherSession, current: false, createdAt: '2026-11-11T00:00:00Z', ip: '127.0.0.2', userAgent: 'Fixture other device' },
    ],
  }
  let mutate: (input: Mutation) => Response = () => ({ status: 501, json: { error: 'Unexpected account mutation' } })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== new URL(origin).origin) { unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() === 'GET') {
      reads.push(url.pathname)
      if (url.pathname === '/api/session') return route.fulfill({ json: { user: state.authenticated ? user : null, csrfToken: 'fixture-csrf' } })
      if (url.pathname === '/api/account') return route.fulfill({ json: { linked: false, balance: null } })
      if (url.pathname === '/api/security/status') return route.fulfill({ json: {
        hasPassword: true, twoFactorEnabled: state.twoFactorEnabled, recoveryCodesRemaining: state.twoFactorEnabled ? 10 : 0, emailReset: state.emailReset,
      } })
      if (url.pathname === '/api/security/sessions') return route.fulfill({ json: { items: state.devices } })
      if (url.pathname === '/api/security/logins') return route.fulfill({ json: { items: [], nextCursor: null } })
      if (url.pathname === '/api/security/capabilities') return route.fulfill({ json: { emailReset: state.emailReset } })
      if (['/api/notifications', '/api/tags', '/api/creators', '/api/announcements', '/api/community/ads'].includes(url.pathname)) return route.fulfill({ json: { items: [] } })
    } else if (request.method() === 'POST' && url.pathname.startsWith('/api/security/')) {
      const input: Mutation = { path: url.pathname, body: request.postDataJSON() }
      mutations.push(input)
      const response = mutate(input)
      if (response.status === 501) unexpected.push(`${request.method()} ${url.pathname}`)
      return route.fulfill(response)
    }
    unexpected.push(`${request.method()} ${url.pathname}`)
    return route.fulfill({ status: 501, json: { error: 'Unexpected account fixture request' } })
  })
  return { state, unexpected, mutations, reads, handle: (handler: typeof mutate) => { mutate = handler } }
}

test('MFA setup and confirmation show the returned recovery codes on mobile', async ({ page }) => {
  const fixture = await mockAccount(page)
  const secret = 'JBSWY3DPEHPK3PXP'
  fixture.handle(({ path }) => {
    if (path === '/api/security/mfa/setup') return { json: { secret, uri: `otpauth://totp/fixture?secret=${secret}`, expiresIn: 600 } }
    if (path === '/api/security/mfa/confirm') { fixture.state.twoFactorEnabled = true; return { json: { ok: true, recoveryCodes, user } } }
    return { status: 501, json: { error: 'Unexpected MFA mutation' } }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/account?tab=security')
  await page.getByLabel('当前社区密码', { exact: true }).fill('fixture-current-password')
  await page.getByRole('button', { name: '设置二步验证', exact: true }).click()
  await expect(page.getByLabel('验证器密钥', { exact: true })).toHaveValue(secret)
  await page.getByLabel('验证器中的 6 位验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '确认启用', exact: true }).click()
  await expect(page.getByText('剩余恢复码 10 个。', { exact: true })).toBeVisible()
  await expect(page.locator('.recovery-codes pre')).toHaveText(recoveryCodes.join('\n'))
  await expect(page.getByLabel('当前社区密码', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('二步验证码或恢复码', { exact: true })).toHaveValue('')
  expect(fixture.mutations).toEqual([
    { path: '/api/security/mfa/setup', body: { password: 'fixture-current-password', token: '' } },
    { path: '/api/security/mfa/confirm', body: { password: '', token: '123456' } },
  ])
  expect(fixture.reads.filter(path => path === '/api/session').length).toBeGreaterThanOrEqual(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '我已保存', exact: true }).click()
  await expect(page.locator('.recovery-codes')).toHaveCount(0)
  expect(fixture.unexpected).toEqual([])
})

test('a refused current password preserves the account session and edited password form', async ({ page }) => {
  const fixture = await mockAccount(page)
  fixture.handle(({ path }) => path === '/api/security/password'
    ? { status: 401, json: { error: { code: 'PASSWORD_REQUIRED', message: '当前社区密码不正确。' } } }
    : { status: 501, json: { error: 'Unexpected password mutation' } })
  await page.goto('/account?tab=security')
  await page.getByLabel('当前社区密码', { exact: true }).fill('fixture-wrong-password')
  await page.getByLabel('新密码', { exact: true }).fill('fixture-new-password')
  await page.getByLabel('再次输入新密码', { exact: true }).fill('fixture-new-password')
  const readsBefore = fixture.reads.filter(path => path === '/api/session').length
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('当前社区密码不正确。')
  await expect(page.getByRole('heading', { name: '身份验证', exact: true })).toBeVisible()
  await expect(page.getByRole('form', { name: '登录社区', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('fixture-new-password')
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeEnabled()
  expect(fixture.mutations).toEqual([{ path: '/api/security/password', body: { password: 'fixture-wrong-password', token: '', newPassword: 'fixture-new-password' } }])
  expect(fixture.reads.filter(path => path === '/api/session').length).toBe(readsBefore)
  expect(fixture.unexpected).toEqual([])
})

test('revoking another session refreshes the list and revoking all returns to login', async ({ page }) => {
  const fixture = await mockAccount(page)
  fixture.handle(({ path, body }) => {
    if (path !== '/api/security/sessions/revoke') return { status: 501, json: { error: 'Unexpected session mutation' } }
    if (body.all === true) { fixture.state.authenticated = false; fixture.state.devices = []; return { json: { ok: true, signedOut: true } } }
    fixture.state.devices = fixture.state.devices.filter(device => device.id !== body.id)
    return { json: { ok: true, signedOut: false } }
  })
  await page.goto('/account?tab=security')
  await expect(page.getByText('Fixture other device', { exact: true })).toBeVisible()
  await page.getByLabel('当前社区密码', { exact: true }).fill('fixture-current-password')
  await page.getByRole('button', { name: '撤销此会话', exact: true }).click()
  await expect(page.getByText('Fixture other device', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Fixture current device', { exact: true })).toBeVisible()
  expect(fixture.reads.filter(path => path === '/api/security/sessions').length).toBeGreaterThanOrEqual(2)
  await page.getByLabel('当前社区密码', { exact: true }).fill('fixture-current-password')
  await page.getByRole('button', { name: '退出所有设备并重置登录凭证', exact: true }).click()
  await page.getByRole('button', { name: '确认退出所有设备', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录社区', exact: true })).toBeVisible()
  await expect(page.getByLabel('账号菜单', { exact: true })).toHaveCount(0)
  expect(fixture.mutations).toEqual([
    { path: '/api/security/sessions/revoke', body: { password: 'fixture-current-password', token: '', id: otherSession } },
    { path: '/api/security/sessions/revoke', body: { password: 'fixture-current-password', token: '', all: true } },
  ])
  expect(fixture.reads.filter(path => path === '/api/session').length).toBeGreaterThanOrEqual(3)
  expect(fixture.unexpected).toEqual([])
})

test('the reset link survives URL cleanup and submits the reset token and MFA recovery code', async ({ page }) => {
  const fixture = await mockAccount(page, false)
  const resetToken = 'r'.repeat(43)
  fixture.handle(({ path }) => path === '/api/security/password/reset'
    ? { json: { ok: true } }
    : { status: 501, json: { error: 'Unexpected reset mutation' } })
  await page.goto(`/account?reset=${resetToken}`)
  await expect(page).toHaveURL(`${origin}/account`)
  await expect(page.getByRole('heading', { name: '重置社区密码', exact: true })).toBeVisible()
  await page.getByLabel('新密码', { exact: true }).fill('fixture-reset-password')
  await page.getByLabel('再次输入新密码', { exact: true }).fill('fixture-reset-password')
  await page.getByLabel('二步验证码或恢复码（如已启用）', { exact: true }).fill('ABCD123400')
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '社区密码已重置，请重新登录。' })).toBeVisible()
  expect(fixture.mutations).toEqual([{ path: '/api/security/password/reset', body: { resetToken, newPassword: 'fixture-reset-password', token: 'ABCD123400' } }])
  expect(fixture.reads.filter(path => path === '/api/session').length).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '返回登录', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录社区', exact: true })).toBeVisible()
  expect(fixture.unexpected).toEqual([])
})
