import type { Page } from '@playwright/test'

export const accountUser = { id: 'fixtureAccountUser', username: 'octopusfixture', name: '测试创作者', bio: '', isAdmin: false, isModerator: false }
export const currentDevice = 'a'.repeat(64), otherDevice = 'b'.repeat(64)
const accountUrl = 'https://accounts.example'
export interface AccountMutation { path: string; body: Record<string, unknown> }

export async function mockUnifiedAccount(page: Page, authenticated = false) {
  const state = {
    user: { ...accountUser }, authenticated, studioAuthenticated: authenticated,
    requiresVerification: false, passwordLoginEnabled: true, turnstileSiteKey: '', syncFailure: false,
    devices: [
      { id: currentDevice, current: true, createdAt: '2026-11-13T00:00:00Z', ip: '127.0.0.1', userAgent: 'Fixture current device' },
      { id: otherDevice, current: false, createdAt: '2026-11-12T00:00:00Z', ip: '127.0.0.2', userAgent: 'Fixture other device' },
    ],
  }
  const mutations: AccountMutation[] = []
  const reads: string[] = []
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'GET') reads.push(path)
    else mutations.push({ path, body: request.postDataJSON() || {} })
    if (path === '/api/session') return route.fulfill({ json: {
      user: state.authenticated ? state.user : null, csrfToken: 'unified-account-fixture',
      authentication: 'zhangyu', accountUrl,
    } })
    if (path === '/studio/api/new-api/status') return route.fulfill({ json: { success: true, data: {
      enabled: true, configured: true, publicUrl: accountUrl, passwordLoginEnabled: state.passwordLoginEnabled,
      turnstileSiteKey: state.turnstileSiteKey,
    } } })
    if (path === '/studio/api/new-api/login') {
      if (state.requiresVerification) return route.fulfill({ json: { success: true, data: { requires2fa: true } } })
      state.studioAuthenticated = true
      return route.fulfill({ json: { success: true, data: { authenticated: true } } })
    }
    if (path === '/studio/api/new-api/login-2fa') {
      state.studioAuthenticated = true
      return route.fulfill({ json: { success: true, data: { authenticated: true } } })
    }
    if (path === '/api/account/session') {
      if (state.syncFailure) return route.fulfill({ status: 503, json: { message: '账号同步暂时不可用。' } })
      if (!state.studioAuthenticated) return route.fulfill({ status: 401, json: { message: '请先登录章鱼账号。', code: 'ACCOUNT_LOGIN_REQUIRED' } })
      state.authenticated = true
      return route.fulfill({ json: { user: state.user, returnTo: '/discover' } })
    }
    if (path === '/api/account') return route.fulfill({ json: {
      linked: true, issuer: accountUrl, subject: '17', balance: 12.5, currencySymbol: 'USD', accountUrl, studioReady: true,
    } })
    if (path === '/api/security/status') return route.fulfill({ json: { external: true, accountUrl } })
    if (path === '/api/security/sessions') return route.fulfill({ json: { items: state.devices } })
    if (path === '/api/security/logins') return route.fulfill({ json: { items: [], nextCursor: null } })
    if (path === '/api/security/sessions/revoke') {
      const body = request.postDataJSON()
      state.devices = body.all ? [] : state.devices.filter(device => device.id !== body.id)
      if (body.all || body.id === currentDevice) state.authenticated = false
      return route.fulfill({ json: { ok: true, signedOut: !state.authenticated } })
    }
    if (path === '/api/session/logout') {
      state.authenticated = false
      return route.fulfill({ json: { user: null } })
    }
    if (path === '/studio/api/new-api/logout') {
      state.studioAuthenticated = false
      return route.fulfill({ json: { success: true } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null, limits: { maxFileSizeMb: 20 } } })
  })
  return { state, reads, mutations }
}

export async function fillAccountLogin(page: Page) {
  await page.getByRole('textbox', { name: '章鱼账号', exact: true }).fill('octopus-user')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
}
