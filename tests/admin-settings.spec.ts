import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultLotterySettings } from '../server/business/lottery'
import { mockUnifiedAccount } from './helpers/account-fixture'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3YQAAAAASUVORK5CYII=', 'base64')
async function adminFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  const state = {
    settings: { brand: '旧站点名称', logoUrl: '', registrationOpen: false, defaultModels: { image: 'kept-model' } },
    config: { communityPublicationMode: 'before', communityAutoBanEnabled: true, communityViolationThreshold: 3,
      communityFeedMode: 'shuffle', communityFeedPoolSize: 200, communityPullToRefresh: true,
      uploadLimits: { image: 20, video: 100, audio: 20, document: 20, other: 10 } },
    ads: Array.from({ length: 4 }, (_, i) => ({ id: `communityAd${i + 1}`, enabled: false, title: i === 1 ? '保留在第二槽' : '', imageUrl: '', linkUrl: '' })),
    revision: 1, conflict: false, failRead: '',
  }
  const writes: { path: string; body: Record<string, any> }[] = []
  await page.route('**/api/site', route => route.fulfill({ json: { brand: state.settings.brand, logoUrl: state.settings.logoUrl } }))
  await page.route('**/legacy-files/logo1', route => route.fulfill({ contentType: 'image/png', body: png }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, maxFileSizeMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'logo1', url: '/legacy-files/logo1', name: 'logo.png', type: 'image/png', size: png.length } } }))
  await page.route('**/api/admin/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.conflict) return route.fulfill({ status: 409, json: { message: '配置版本已变化' } })
      if (body.version !== `version-${state.revision}`) return route.fulfill({ status: 409, json: { message: '版本不匹配' } })
      state.revision++
      if (path === '/api/admin/settings') Object.assign(state.settings, body.settings)
      if (path.endsWith('/config')) { const { version, ...config } = body; Object.assign(state.config, config) }
      if (path.endsWith('/ads')) state.ads = body.items
    } else if (state.failRead && path.endsWith(state.failRead)) return route.fulfill({ status: 503, json: { message: '配置加载失败，请重试' } })
    const version = `version-${state.revision}`
    if (path === '/api/admin/settings') return route.fulfill({ json: { settings: state.settings, version } })
    if (path.endsWith('/config')) return route.fulfill({ json: { config: state.config, version } })
    if (path.endsWith('/ads')) return route.fulfill({ json: { items: state.ads, version } })
    return route.fulfill({ json: { items: [] } })
  })
  return { state, writes, account }
}
async function openTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name, exact: true }).click()
}

test('site branding and an uploaded logo save only their own fields and survive reload', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '站点设置')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('旧站点名称')
  await page.getByLabel('站点名称', { exact: true }).fill('新的创作社区')
  await page.getByLabel('上传 Logo', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByLabel('Logo 图片地址', { exact: true })).toHaveValue('/legacy-files/logo1')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.getByRole('link', { name: '新的创作社区首页', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('管理 · 新的创作社区')
  expect(fixture.writes[0]!.body).toEqual({ settings: { brand: '新的创作社区', logoUrl: '/legacy-files/logo1' }, version: 'version-1' })
  expect(fixture.state.settings.defaultModels.image).toBe('kept-model')
  expect(fixture.state.settings.registrationOpen).toBe(false)
  await page.reload(); await openTab(page, '站点设置')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('新的创作社区')
  await expect(page.getByAltText('站点 Logo 预览')).toBeVisible()
  await page.getByRole('button', { name: '移除 Logo', exact: true }).click()
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.locator('.brand img')).toHaveCount(0)
})

test('conflicting site changes keep the draft until the administrator explicitly reloads', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('我的未保存名称')
  fixture.state.settings.brand = '另一管理员的名称'; fixture.state.revision++; fixture.state.conflict = true
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('我的未保存名称')
  await page.getByRole('button', { name: '刷新站点设置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('我的未保存名称')
  await page.getByRole('button', { name: '刷新站点设置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并刷新', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('另一管理员的名称')
})

test('failed admin reads do not become empty editable ads or tags', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin')
  for (const [path, tab, control] of [['/ads', '广告位', '保存广告位'], ['/tags', '内容标签', '添加标签']]) {
    fixture.state.failRead = path!
    await openTab(page, tab!)
    await expect(page.getByRole('alert')).toContainText('配置加载失败')
    await expect(page.getByRole('button', { name: control!, exact: true })).toHaveCount(0)
    await expect(page.getByText('此分类暂无标签')).toHaveCount(0)
    fixture.state.failRead = ''
    await page.getByRole('button', { name: `刷新${tab}`, exact: true }).click()
    await expect(page.getByRole('button', { name: control!, exact: true })).toBeVisible()
  }
})

test('community settings and advertisements submit their loaded version without moving empty slots', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '社区设置')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('5')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.writes[0]!.body).toMatchObject({ version: 'version-1', communityViolationThreshold: 5 })
  await openTab(page, '广告位')
  await expect(page.locator('.ad-editor')).toHaveCount(4)
  await expect(page.getByLabel('标题', { exact: true }).nth(1)).toHaveValue('保留在第二槽')
  await page.getByRole('button', { name: '保存广告位', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(2)
  expect(fixture.writes[1]!.body.version).toBe('version-2')
  expect(fixture.writes[1]!.body.items.map((item: { title: string }) => item.title)).toEqual(['', '保留在第二槽', '', ''])
})

test('site settings remain usable on desktop and narrow phones', async ({ page }) => {
  await adminFixture(page)
  await mkdir('.impeccable/review/account-admin', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/admin'); await openTab(page, '站点设置')
    await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('旧站点名称')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '保存站点设置', exact: true })).toBeVisible()
    await page.screenshot({ path: `.impeccable/review/account-admin/site-${width}.png`, fullPage: true })
  }
})

test('moderators and ordinary accounts cannot read site settings', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  const reads: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/settings') reads.push(request.url()) })
  await page.goto('/admin')
  await expect(page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name: '站点设置' })).toHaveCount(0)
  expect(reads).toEqual([])
})

test('long configured names fit both the site header and guest login branding', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.settings.brand = 'Community'.repeat(8)
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin')
    await expect(page.locator('.brand')).toHaveText(fixture.state.settings.brand)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  fixture.account.state.authenticated = false; fixture.account.state.accountAuthenticated = false
  await page.goto('/account')
  await expect(page.locator('.auth-mobile-brand')).toHaveText(fixture.state.settings.brand)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a save response from a closed settings tab cannot overwrite a newer saved brand', async ({ page }) => {
  const fixture = await adminFixture(page)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let delayed = false
  await page.route('**/api/admin/settings', async route => {
    const request = route.request()
    if (request.method() !== 'PATCH' || request.postDataJSON().settings.brand !== '第一次保存') return route.fallback()
    const body = request.postDataJSON()
    Object.assign(fixture.state.settings, body.settings); fixture.state.revision++
    const response = { settings: { ...fixture.state.settings }, version: `version-${fixture.state.revision}` }
    delayed = true; await wait
    await route.fulfill({ json: response })
  })
  await page.goto('/admin'); await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('第一次保存')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect.poll(() => delayed).toBe(true)
  await openTab(page, '内容标签')
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('第二次保存')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.locator('.brand')).toHaveText('第二次保存')
  const completed = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/admin/settings'))
  release(); await completed; await page.waitForTimeout(100)
  await expect(page.locator('.brand')).toHaveText('第二次保存')
  await expect(page).toHaveTitle('管理 · 第二次保存')
})

test('direct links, browser back and leaving a dirty editor preserve the intended draft', async ({ page }) => {
  await adminFixture(page)
  await page.goto('/admin?tab=settings')
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('7')
  await openTab(page, '站点设置')
  await expect(page.getByRole('dialog', { name: '保留这次修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL(/tab=settings/)
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('7')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await openTab(page, '站点设置')
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('8')
  await page.getByRole('link', { name: '访问社区', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('8')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.locator('.editor-savebar')).toContainText('修改已保存')
  await openTab(page, '站点设置')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('unfinished tag names prompt before leaving and survive cancel', async ({ page }) => {
  await adminFixture(page)
  await page.goto('/admin?tab=tags')
  await page.getByLabel('添加图片标签', { exact: true }).fill('还没添加的标签')
  await openTab(page, '管理概览')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('添加图片标签', { exact: true })).toHaveValue('还没添加的标签')
})

test('lottery configuration changes survive cancelled refresh and cancelled navigation', async ({ page }) => {
  await adminFixture(page)
  await page.route('**/api/admin/lottery/config', route => route.fulfill({ json: { version: 1, settings: defaultLotterySettings() } }))
  await page.goto('/admin?tab=lottery')
  await page.getByLabel('活动标题', { exact: true }).fill('秋日创作活动')
  await page.getByRole('button', { name: '重新读取抽奖配置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('秋日创作活动')
  await openTab(page, '管理概览')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('秋日创作活动')
  await page.getByRole('button', { name: '重新读取抽奖配置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并刷新', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('')
})

const pendingWork = { id: 'work1', title: '山海之间的光', author: '木白', kind: 'image', status: 'pending', version: 1, date: '2026-11-13T02:20:00Z', cover: '' }

test('review requests server filters, loads the next page and keeps revision review semantics', async ({ page }) => {
  await adminFixture(page)
  const requests: URL[] = []
  await page.route('**/api/admin/submissions?**', route => {
    const url = new URL(route.request().url()); requests.push(url)
    if (url.searchParams.get('query')) return route.fulfill({ json: { items: [{ ...pendingWork, id: 'older', title: '更早的匹配作品' }], nextCursor: null } })
    if (url.searchParams.get('cursor')) return route.fulfill({ json: { items: [{ ...pendingWork, id: 'work2', title: '第二页作品' }], nextCursor: null } })
    return route.fulfill({ json: { items: [{ ...pendingWork, status: 'published', revisionPending: true }], nextCursor: 'next-page' } })
  })
  await page.goto('/admin?tab=review')
  await expect(page.getByText('修改待审核', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '通过：山海之间的光' })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('status')).toBe('pending')
  await page.getByRole('button', { name: '加载更多作品', exact: true }).click()
  await expect(page.getByRole('link', { name: '第二页作品', exact: true })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('cursor')).toBe('next-page')
  await page.getByRole('button', { name: '已公开', exact: true }).click()
  await expect.poll(() => requests.at(-1)!.searchParams.get('status')).toBe('published')
  expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false)
  await page.getByLabel('搜索作品或作者', { exact: true }).fill('更早')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByRole('link', { name: '更早的匹配作品', exact: true })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('query')).toBe('更早')
  await expect(page.getByRole('link', { name: '第二页作品', exact: true })).toHaveCount(0)
})

test('admin overview and editor layouts fit desktop, tablet and narrow phones with accessible controls', async ({ page }) => {
  await adminFixture(page)
  await page.route('**/api/admin/submissions?**', route => route.fulfill({ json: { items: [pendingWork,
    { ...pendingWork, id: 'work2', title: '微缩城市 · 雨后的街道', author: '阿树', kind: 'video' },
    { ...pendingWork, id: 'work3', title: '创作灵感整理', kind: 'resource', status: 'published', revisionPending: true },
    { ...pendingWork, id: 'work4', status: 'published' }, { ...pendingWork, id: 'work5', status: 'rejected' }], nextCursor: 'more' } }))
  await mkdir('.impeccable/review/admin-panel', { recursive: true })
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const tab of ['overview', 'settings', 'ads', 'review']) {
      await page.goto('/admin?tab=' + tab)
      await expect(page.locator('.admin-layout')).toBeVisible()
      if (tab === 'overview') await expect(page.getByText('最近载入 5 条', { exact: false })).toBeVisible()
      else if (tab === 'settings') await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
      else if (tab === 'ads') await expect(page.locator('.ad-editor')).toHaveCount(4)
      else await expect(page.locator('.review-table')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: '.impeccable/review/admin-panel/' + tab + '-' + width + '.png', fullPage: true })
      if (width === 1440 && ['overview', 'settings'].includes(tab)) {
        const result = await new AxeBuilder({ page }).include('.admin-page').analyze()
        expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
      }
    }
  }
})

test('a moderator deep link to site settings does not issue privileged reads', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  const privileged: string[] = []
  page.on('request', request => { if (/\/api\/admin\/(settings|community|users|tags|lottery)/.test(request.url())) privileged.push(request.url()) })
  await page.goto('/admin?tab=site')
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '站点设置', exact: true })).toHaveCount(0)
  expect(privileged).toEqual([])
})
