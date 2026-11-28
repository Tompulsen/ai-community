import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const stalledPath of ['/api/session', '/api/account/session']) {
  test(`studio recovers from a stalled ${stalledPath} without an endless skeleton`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const account = await mockUnifiedAccount(page)
    account.state.accountAuthenticated = true
    await page.clock.install()
    let stalled = true
    await page.route(`**${stalledPath}`, route => stalled ? undefined : route.fallback())
    await page.goto('/create')
    await expect(page.locator('.native-studio')).toBeVisible()
    await expect(page.locator('.native-studio')).toHaveAttribute('inert', '')
    await expect(page.getByText('正在加载章鱼账号…', { exact: true })).toHaveCount(0)
    await expect(page.locator('.loading-form')).toHaveCount(0)
    await page.clock.fastForward(20_000)
    await expect(page.getByRole('alert')).toContainText('账号加载超时')
    await expect(page.locator('.native-studio')).toBeVisible()
    await expect(page.getByRole('heading', { name: '登录后开始创作' })).toHaveCount(0)
    stalled = false
    account.state.authenticated = true
    account.state.accountAuthenticated = true
    await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
    await expect(page.locator('.studio-account-status')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('studio shows the sign-in entry for a confirmed guest on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const account = await mockUnifiedAccount(page)
  await page.goto('/create')
  await expect(page.getByRole('heading', { name: '登录后开始创作' })).toBeVisible()
  await expect(page.locator('.studio-account-status, .loading-form')).toHaveCount(0)
  expect(account.mutations.map(item => item.path)).not.toContain('/api/account/session')
})

test('studio keeps its shell and hides sign-in while the shared session loads', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/session', async route => { await gate; await route.fallback() })
  await page.goto('/create/image')
  await expect(page.locator('.native-studio')).toBeVisible()
  await expect(page.locator('.native-studio')).toHaveAttribute('inert', '')
  await expect(page.getByText('正在加载章鱼账号…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.header-login')).toHaveCount(0)
  await expect(page.locator('.studio-shell')).toBeVisible()
  await expect(page.locator('.app-footer')).toHaveCount(0)
  const before = await page.locator('#main').boundingBox()
  release()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
  const after = await page.locator('#main').boundingBox()
  expect(after!.x).toBe(before!.x)
  expect(after!.width).toBe(before!.width)
})

test('silent account synchronization does not briefly ask the user to sign in', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  await page.goto('/create/image')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
  account.state.authenticated = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/account/session', async route => { await gate; await route.fallback() })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#main[inert]')).toBeVisible()
  await expect(page.getByText('正在加载章鱼账号…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '登录后开始创作' })).toHaveCount(0)
  await expect(page.locator('.header-login')).toHaveCount(0)
  await expect(page.locator('.studio-shell')).toBeVisible()
  release()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
  expect(account.mutations.map(item => item.path)).not.toContain('/api/new-api/login')
})

test('global session retry returns to loading instead of showing guest actions', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let attempts = 0
  await page.route('**/api/session', async route => {
    if (++attempts === 1) return route.fulfill({ status: 503, json: { message: '账号暂时无法连接' } })
    await gate
    await route.fallback()
  })
  await page.goto('/create/image')
  await expect(page.getByRole('alert')).toContainText('账号暂时无法连接')
  await expect(page.locator('.native-studio')).toBeVisible()
  await expect(page.locator('.header-login')).toHaveCount(0)
  await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.native-studio[inert]')).toBeVisible()
  await expect(page.getByText('正在加载章鱼账号…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '登录后开始创作' })).toHaveCount(0)
  release()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
})

test('community navigation reuses the account without a second session read or login', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  await page.goto('/discover')
  await expect(page.locator('.profile-toggle')).toBeVisible()
  const readsBefore = account.reads.filter(path => path === '/api/session').length
  await page.getByRole('link', { name: '创作台', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
  expect(account.reads.filter(path => path === '/api/session')).toHaveLength(readsBefore)
  expect(account.mutations.filter(item => !['/api/works/feed', '/api/creation/models'].includes(item.path))).toEqual([])
})

test('a background session outage keeps the workspace and its draft without an account notice', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  await page.goto('/create/image')
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('保留当前草稿')
  await page.route('**/api/session', route => route.fulfill({ status: 503, json: { message: '账号刷新暂时不可用' } }))
  const refreshed = page.waitForResponse('**/api/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await refreshed
  await expect(prompt).toHaveValue('保留当前草稿')
  await expect(page.locator('.native-studio')).not.toHaveAttribute('inert', '')
  await expect(page.getByText('账号刷新暂时不可用', { exact: false })).toHaveCount(0)
  await expect(page.locator('.studio-account-status, .header-login')).toHaveCount(0)
  expect(account.mutations.filter(item => item.path !== '/api/creation/models')).toEqual([])
})

test('text mode shows an empty composer while identity is restored without loading a guest draft', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  await page.route('**/api/session', () => {})
  await page.addInitScript(() => {
    localStorage.setItem('octopus:user-undefined:native-creation-draft:text', JSON.stringify({ prompt: '不应读取匿名草稿' }))
  })
  await page.goto('/create/text')
  await expect(page.locator('.native-chat .chat-empty')).toBeVisible()
  await expect(page.locator('.native-chat textarea')).toBeDisabled()
  await expect(page.locator('.native-chat textarea')).toHaveValue('')
  await expect(page.locator('.studio-account-status, .header-login')).toHaveCount(0)
  expect(account.mutations).toEqual([])
})
