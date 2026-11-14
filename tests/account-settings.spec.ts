import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('settings search finds related controls and tabs support links, refresh and browser back', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/account?tab=profile')
  const nav = page.getByRole('navigation', { name: '账户设置', exact: true })
  const search = page.getByRole('searchbox', { name: '搜索设置' })
  await search.fill('密码')
  await expect(nav.getByRole('button')).toHaveCount(1)
  await nav.getByRole('button', { name: '账号安全', exact: true }).click()
  await expect(page).toHaveURL(/\/account\?tab=security$/)
  await expect(page.getByRole('link', { name: '管理章鱼账号' })).toHaveAttribute('href', 'https://accounts.example/')
  await search.fill('不存在的设置')
  await expect(nav.getByRole('status')).toContainText('没有找到相关设置')
  await nav.getByRole('button', { name: '清除搜索' }).click()
  await nav.getByRole('button', { name: '账户与余额', exact: true }).click()
  await expect(page).toHaveURL(/\/account\?tab=balance$/)
  await page.reload()
  await expect(nav.getByRole('button', { name: '账户与余额', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.balance-panel .account-balance')).toHaveText('12.50 USD')
  await page.goBack()
  await expect(nav.getByRole('button', { name: '账号安全', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('heading', { name: '社区内容' })).toHaveCount(0)
  await expect(nav.getByRole('link')).toHaveCount(0)
  await expect(nav.getByRole('button')).toHaveCount(5)
})

test('profile preview is plain text and unsaved edits survive cancelled navigation', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account')
  await page.getByLabel('显示名称', { exact: true }).fill('未保存的昵称')
  await page.getByLabel('个人简介', { exact: true }).fill('<script>draft</script>\n第二行')
  await page.locator('.profile-preview summary').click()
  await expect(page.locator('.profile-preview-body')).toContainText('<script>draft</script>')
  await expect(page.locator('.profile-preview-body script')).toHaveCount(0)
  await page.getByRole('button', { name: '个人资料', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await page.getByRole('button', { name: '账号安全', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('未保存的昵称')
  await page.getByRole('navigation', { name: '账户设置', exact: true }).getByRole('link', { name: '我的作品' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('未保存的昵称')
  await page.getByRole('button', { name: '账户与余额', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page).toHaveURL(/tab=balance$/)
  await page.getByRole('button', { name: '个人资料', exact: true }).click()
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(fixture.state.user.name)
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  expect(fixture.mutations.filter(item => item.path === '/api/profile')).toEqual([])
})

test('the leave guard protects a pending save until success is confirmed', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let saving = false
  await page.route('**/api/profile', async route => {
    saving = true; await wait
    Object.assign(fixture.state.user, route.request().postDataJSON())
    await route.fulfill({ json: { user: fixture.state.user } })
  })
  await page.goto('/account')
  await page.getByLabel('显示名称', { exact: true }).fill('正在保存的资料')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect.poll(() => saving).toBe(true)
  await page.getByRole('button', { name: '账号安全', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('正在保存资料')
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  release()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByRole('button', { name: '账号安全', exact: true }).click()
  await expect(page).toHaveURL(/tab=security$/)
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('switching account cancels an open leave prompt and clears the old draft', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/account')
  await page.getByLabel('显示名称', { exact: true }).fill('旧账号的私密草稿')
  await page.getByRole('button', { name: '账号安全', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  fixture.state.user = { ...fixture.state.user, id: 'anotherAccount', accountId: '18', name: '另一个账号' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('另一个账号')
  await page.getByRole('button', { name: '账号安全', exact: true }).click()
  await expect(page).toHaveURL(/tab=security$/)
  expect(fixture.mutations.filter(item => item.path === '/api/profile')).toEqual([])
})

test('cover upload and removal save through the existing profile endpoint', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 20, filesMb: 20, maxFileSizeMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'cover123', type: 'image/png', name: 'cover.png', size: 68, url: '/assets/brand/octopus-community.jpg' } } }))
  await page.goto('/account')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '更换封面', exact: true }).click()
  await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('fixture image') })
  await expect(page.getByAltText('当前主页封面')).toBeVisible()
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  expect(fixture.mutations.find(item => item.path === '/api/profile')?.body.bannerId).toBe('cover123')
  await page.getByRole('button', { name: '移除封面', exact: true }).click()
  await expect(page.getByAltText('当前主页封面')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('有未保存的修改')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  expect(fixture.mutations.filter(item => item.path === '/api/profile').at(-1)?.body.bannerId).toBe(null)
})

for (const entry of ['sidebar', 'header'] as const) {
  test(`${entry} logout confirms unsaved edits before signing out either session`, async ({ page }) => {
    const fixture = await mockUnifiedAccount(page, true)
    await page.goto('/account')
    await page.getByLabel('显示名称', { exact: true }).fill('退出前的草稿')
    if (entry === 'header') await page.getByLabel('账号菜单', { exact: true }).click()
    const signout = page.locator(entry === 'header' ? '.account-popover' : '.settings-sidebar').getByRole('button', { name: '退出登录', exact: true })
    await signout.click()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('退出前的草稿')
    expect(fixture.mutations.filter(item => item.path.endsWith('/logout'))).toEqual([])
    if (entry === 'header') await page.getByLabel('账号菜单', { exact: true }).click()
    await signout.click()
    await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
    await expect.poll(() => fixture.state.authenticated || fixture.state.accountAuthenticated).toBe(false)
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
}

test('homepage logout still works when no navigation is necessary', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/discover')
  await page.getByLabel('账号菜单', { exact: true }).click()
  await page.locator('.account-popover').getByRole('button', { name: '退出登录', exact: true }).click()
  await expect.poll(() => fixture.state.authenticated || fixture.state.accountAuthenticated).toBe(false)
  await expect(page).toHaveURL(/\/discover$/)
})

test('account panels fit desktop, tablet and narrow phones with accessible controls', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await mkdir('.impeccable/review/account-settings', { recursive: true })
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const tab of ['profile', 'security', 'balance']) {
      await page.goto('/account?tab=' + tab)
      await expect(page.locator('.settings-main')).toBeVisible()
      if (tab === 'security') await expect(page.getByRole('heading', { name: '登录会话' })).toBeVisible()
      else if (tab === 'balance') await expect(page.locator('.balance-panel .account-balance')).toHaveText('12.50 USD')
      else {
        await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('测试创作者')
        await expect(page.getByLabel('头像', { exact: true })).toBeHidden()
        await expect(page.getByLabel('主页封面', { exact: true })).toBeHidden()
        const cover = (await page.locator('.profile-cover').boundingBox())!
        const change = (await page.getByRole('button', { name: '更换封面', exact: true }).boundingBox())!
        expect(change.x).toBeGreaterThanOrEqual(cover.x)
        expect(change.x + change.width).toBeLessThanOrEqual(cover.x + cover.width)
        expect(change.y).toBeGreaterThanOrEqual(cover.y)
        expect(change.y + change.height).toBeLessThanOrEqual(cover.y + cover.height)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const current = page.locator('.account-tabs [aria-current="page"]')
      await expect(current).toBeInViewport()
      await page.screenshot({ path: `.impeccable/review/account-settings/${tab}-${width}.png`, fullPage: true })
      if (width === 1440 || width === 390) {
        const result = await new AxeBuilder({ page }).include('.settings-page').analyze()
        expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
      }
    }
  }
})
