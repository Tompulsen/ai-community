import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

test('settings and personal editing keep separate destinations including legacy links after login', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page)
  await page.goto('/account?returnTo=/account?tab=profile')
  await fillAccountLogin(page)
  await expect(page).toHaveURL('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue(fixture.state.user.name)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toBeVisible()
  await page.goto('/account')
  await expect(page.locator('.privacy-settings')).toBeVisible()
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '个人资料', exact: true })).toHaveCount(0)
})

test('a foreign profile cannot open the editor by changing the query', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.route('**/api/users/other', route => route.fulfill({ json: { user: { ...fixture.state.user, id: 'other', isSelf: true } } }))
  await page.goto('/community?creator=other&edit=profile')
  await expect(page.locator('.profile-copy h1')).toBeVisible()
  await expect(page.locator('.profile-editor')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toHaveCount(0)
})

test('a guest using the direct legacy profile URL reaches their homepage editor after login', async ({ page }) => {
  await mockUnifiedAccount(page)
  await page.goto('/account?tab=profile')
  await fillAccountLogin(page)
  await expect(page).toHaveURL('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('测试创作者')
})

test('returning to the page preserves unsaved profile text', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue(fixture.state.user.name)
  await page.getByLabel('社区昵称', { exact: true }).fill('还未保存的名字')
  await page.getByLabel('个人简介', { exact: true }).fill('切换窗口后继续编辑')
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await refreshed
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('还未保存的名字')
  await expect(page.getByLabel('个人简介', { exact: true })).toHaveValue('切换窗口后继续编辑')
})

test('an uploaded avatar stays in the draft after session refresh and reaches the profile save', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 20, filesMb: 20, maxFileSizeMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'avatar123', type: 'image/png', name: 'avatar.png', size: 68, url: '/assets/brand/octopus-community.jpg' } } }))
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue(fixture.state.user.name)
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'avatar.jpg', mimeType: 'image/jpeg', buffer: await readFile('public/assets/brand/octopus-community.jpg') })
  await page.getByRole('button', { name: '确认裁切', exact: true }).click()
  await expect(page.getByAltText('当前头像')).toBeVisible()
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await refreshed
  await expect(page.getByAltText('当前头像')).toBeVisible()
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect.poll(() => fixture.mutations.find(item => item.path === '/api/profile')?.body.avatarId).toBe('avatar123')
})

test('temporary session failure preserves the draft and a refused save keeps it editable', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await page.getByLabel('社区昵称', { exact: true }).fill('断网也保留的名字')
  await page.route('**/api/session', route => route.fulfill({ status: 503, json: { message: '账号服务暂时不可用' } }))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert')).toContainText('账号服务暂时不可用')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('断网也保留的名字')
  await page.unroute('**/api/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.route('**/api/profile', route => route.fulfill({ status: 503, json: { message: '保存暂时失败' } }))
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存暂时失败')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('断网也保留的名字')
  await expect(page.getByRole('button', { name: '保存资料', exact: true })).toBeEnabled()
})

test('switching accounts while upload limits are pending never uploads into the new account', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let requested = false, uploaded = false, cancelled = false
  page.on('requestfailed', request => { if (new URL(request.url()).pathname === '/api/uploads/limits') cancelled = true })
  await page.route('**/api/uploads/limits', async route => {
    requested = true; await wait
    await route.fulfill({ json: { imagesMb: 20, videosMb: 20, filesMb: 20, maxFileSizeMb: 20 } })
  })
  await page.route('**/api/uploads', route => { uploaded = true; return route.fulfill({ json: { file: { id: 'wrongAccountFile' } } }) })
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue(fixture.state.user.name)
  await page.getByLabel('头像', { exact: true }).setInputFiles({ name: 'private.jpg', mimeType: 'image/jpeg', buffer: await readFile('public/assets/brand/octopus-community.jpg') })
  await page.getByRole('button', { name: '确认裁切', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  fixture.state.user = { ...fixture.state.user, id: 'secondAccount', accountId: '18', username: 'second', name: '第二个账号' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveCount(0)
  release()
  await expect.poll(() => cancelled).toBe(true)
  expect(uploaded).toBe(false)
  await page.goto('/community?creator=secondAccount&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('第二个账号')
  await expect(page.getByAltText('当前头像')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存资料', exact: true })).toBeEnabled()
})

test('a late unauthorized save from the old account cannot sign out the new one', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let saving = false
  await page.route('**/api/profile', async route => {
    saving = true; await wait
    await route.fulfill({ status: 401, json: { message: '旧会话过期', code: 'AUTH_REQUIRED' } })
  })
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await page.getByLabel('社区昵称', { exact: true }).fill('旧账号草稿')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect.poll(() => saving).toBe(true)
  fixture.state.user = { ...fixture.state.user, id: 'secondAccount', name: '第二个账号' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveCount(0)
  const completed = page.waitForResponse('**/api/profile')
  release(); await completed
  await page.waitForTimeout(100)
  await page.goto('/community?creator=secondAccount&edit=profile')
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('第二个账号')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('saved profile values persist after reopening the account page', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await page.getByLabel('社区昵称', { exact: true }).fill('保存后的新名字')
  await page.getByLabel('个人简介', { exact: true }).fill('多行简介\n第二行')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  await page.reload()
  await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('保存后的新名字')
  await expect(page.getByLabel('个人简介', { exact: true })).toHaveValue('多行简介\n第二行')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.profile-copy h1')).toHaveText('保存后的新名字')
  await expect(page.locator('.profile-copy > .profile-bio')).toHaveText('多行简介\n第二行')
})
