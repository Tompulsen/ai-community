import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('UI preview serves a local signed-in session without browser API mocks', async ({ request }) => {
  const response = await request.get('/api/session')
  expect(response.headers()['x-design-preview']).toBe('mock')
  expect(response.headers()['content-type']).toContain('application/json')
  expect((await response.json()).user.id).toBe('previewCreator')
})

test('UI preview opens settings and saves profile drafts with local data only', async ({ page }) => {
  const external: string[] = [], errors: string[] = []
  page.on('request', request => {
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('Failed to resolve component')) errors.push(message.text())
  })
  await page.goto('/account')
  await expect(page.locator('.privacy-settings')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  for (const tab of ['security', 'theme', 'balance']) {
    await page.goto('/account?tab=' + tab)
    await expect(page.locator('.settings-main')).toBeVisible()
    if (tab === 'balance') await expect(page.getByRole('button', { name: '支付宝', exact: true }).or(page.getByRole('radio', { name: '支付宝', exact: true }))).toBeVisible()
    if (tab === 'security') await expect(page.getByRole('heading', { name: '登录会话', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  await page.goto('/community?creator=previewCreator&edit=profile')
  const nickname = page.getByRole('textbox', { name: '社区昵称', exact: true })
  const original = await nickname.inputValue()
  await nickname.fill('本地资料预览')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  await page.reload()
  await expect(nickname).toHaveValue('本地资料预览')
  await nickname.fill(original)
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toBeVisible()
  await page.goto('/discover')
  await expect(page.locator('.work-card').first()).toBeVisible()
  for (const path of ['/community', '/library', '/messages', '/create/image', '/activities']) {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  await page.goto('/account')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: '账户设置', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('local-ui-preview-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(external).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('local-ui-preview.png') })
})

test('preview uploads stay in memory and privacy changes round-trip locally', async ({ request }) => {
  const bytes = Buffer.from('local preview upload')
  const response = await request.post('/api/uploads', { multipart: {
    file: { name: 'preview.png', mimeType: 'image/png', buffer: bytes },
  } })
  expect(response.ok()).toBe(true)
  const { file } = await response.json()
  expect(file.url).toMatch(/^\/files\/previewUpload\d+$/)
  expect(await (await request.get(file.url)).body()).toEqual(bytes)
  const { settings, version } = await (await request.get('/api/account/privacy')).json()
  await request.patch('/api/account/privacy', { data: { ...settings, isLocked: !settings.isLocked, version } })
  expect((await (await request.get('/api/account/privacy')).json()).settings.isLocked).toBe(!settings.isLocked)
  await request.patch('/api/account/privacy', { data: settings })
})

test('unsupported APIs and payment actions stay local and never fall through to Vite', async ({ request }) => {
  for (const [method, path] of [['GET', '/api/not-implemented'], ['POST', '/api/new-api/wallet/pay'], ['POST', '/api/creation/generate']]) {
    const response = await request.fetch(path, { method, data: {} })
    expect(response.headers()['x-design-preview']).toBe('mock')
    expect(response.headers()['content-type']).toContain('application/json')
    expect(response.status()).toBeGreaterThanOrEqual(400)
  }
})
