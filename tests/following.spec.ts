import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const author = { id: 'author25', username: 'author', name: '作品作者', bio: '分享创作过程', count: 1, worksCount: 1, followed: false, requested: false, followsYou: false, isLocked: false, followersCount: 3, followingCount: 2 }
const work = { id: 'followwork', authorId: author.id, title: '关注功能测试作品', author: author.name, avatar: '作', kind: 'resource', cover: '', body: '作品正文', prompt: '', tags: [], model: '', date: '2026-11-13T00:00:00Z', status: 'published', version: 1, likes: 0, liked: false, saved: false, owned: false, fileIds: [] }

async function fixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  const state = { author: { ...author }, failFollow: false, writes: [] as any[], reads: 0 }
  await page.route('**/api/works/**', route => route.fulfill({ json: route.request().url().endsWith('/comments') ? { items: [], nextCursor: null } : { work } }))
  await page.route('**/api/users/**', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-new-api-user']).toBe(account.state.user.accountId)
      state.writes.push(route.request().postDataJSON())
      if (state.failFollow) return route.fulfill({ status: 503, json: { message: '关注失败，请重试。' } })
      const active = route.request().postDataJSON().active
      state.author.followed = active && !state.author.isLocked
      state.author.requested = active && state.author.isLocked
      return route.fulfill({ json: { ...state.author } })
    }
    state.reads++
    return route.fulfill({ json: { user: state.author, ...state.author, items: [] } })
  })
  return { account, state }
}

test('work author can be followed from the work detail', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/work/followwork')
  await expect(page.getByRole('heading', { name: work.title })).toBeVisible()
  await page.getByRole('button', { name: '关注作者', exact: true }).click({ timeout: 2500 })
  await expect(page.getByRole('button', { name: '取消关注', exact: true })).toBeVisible()
  expect(f.state.writes).toEqual([{ active: true }])
  await page.getByRole('button', { name: '取消关注', exact: true }).click()
  await expect(page.getByRole('button', { name: '关注作者', exact: true })).toBeEnabled()
  expect(f.state.writes).toEqual([{ active: true }, { active: false }])
})

test('locked author request can be withdrawn; failed writes preserve the relationship', async ({ page }) => {
  const { state } = await fixture(page); state.author.isLocked = true
  await page.goto('/work/followwork')
  state.failFollow = true
  await page.getByRole('button', { name: '关注作者', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '关注失败' })).toBeVisible()
  await expect(page.getByRole('button', { name: '关注作者', exact: true })).toBeEnabled()
  state.failFollow = false
  await page.getByRole('button', { name: '关注作者', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤回关注申请' })).toHaveText('等待通过')
  await page.getByRole('button', { name: '撤回关注申请' }).click()
  await expect(page.getByRole('button', { name: '关注作者', exact: true })).toBeEnabled()
})

test('returning to a work refreshes a request accepted while away', async ({ page }) => {
  const { state } = await fixture(page); state.author.requested = true
  await page.goto('/work/followwork')
  await expect(page.getByRole('button', { name: '撤回关注申请' })).toBeEnabled()
  await page.locator('a[href="/discover"]').first().click()
  state.author.requested = false; state.author.followed = true
  await page.goBack()
  await expect(page.getByRole('button', { name: '取消关注', exact: true })).toBeEnabled()
  expect(state.reads).toBeGreaterThanOrEqual(2)
})

test('guest follow preserves the return path and an author never follows themselves', async ({ page }) => {
  const { account } = await fixture(page, false)
  await page.goto('/work/followwork')
  const link = page.getByRole('link', { name: '关注作者', exact: true })
  await expect(link).toHaveAttribute('href', '/account?returnTo=/work/followwork')
  account.state.authenticated = true; account.state.user.id = author.id
  await page.reload()
  await expect(page.getByRole('heading', { name: work.title })).toBeVisible()
  await expect(page.getByRole('button', { name: '关注作者', exact: true })).toHaveCount(0)
})

async function settingsFixture(page: Page) {
  await mockUnifiedAccount(page, true)
  const state = {
    settings: { isLocked: false, autoAcceptFollowed: false, followApprovalLocalSeconds: null, followingVisibility: 'public', followersVisibility: 'public' },
    failSave: false, saves: [] as any[], actions: [] as any[],
    requests: [{ id: 'req1', user: author }, { id: 'req2', user: { ...author, id: 'author26', name: '另一位作者' } }],
  }
  await page.route('**/api/account/privacy', route => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().headers()['x-new-api-user']).toBe('17')
      state.saves.push(route.request().postDataJSON())
      if (state.failSave) return route.fulfill({ status: 409, json: { message: '隐私设置已在其他页面修改，请重新加载后再保存。' } })
      const { version, ...settings } = route.request().postDataJSON(); state.settings = settings
    }
    return route.fulfill({ json: { settings: state.settings, version: `v${state.saves.length}` } })
  })
  await page.route('**/api/follow-requests**', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-new-api-user']).toBe('17')
      state.actions.push(route.request().postDataJSON())
      const id = new URL(route.request().url()).pathname.split('/').pop()
      state.requests = state.requests.filter(item => item.id !== id)
      return route.fulfill({ json: { ...author, followsYou: true } })
    }
    return route.fulfill({ json: { items: state.requests, total: state.requests.length, nextCursor: null } })
  })
  return state
}

test('received requests approve/reject and sent requests cancel with identity binding', async ({ page }) => {
  const state = await settingsFixture(page)
  await page.goto('/account?tab=following')
  await page.getByRole('button', { name: '通过', exact: true }).first().click()
  await expect(page.getByRole('status').filter({ hasText: '已通过' })).toBeVisible()
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待处理的关注申请' })).toBeVisible()
  state.requests = [{ id: 'req3', user: author }]
  await page.getByRole('button', { name: '发出的申请' }).click()
  await page.getByRole('button', { name: '撤回申请', exact: true }).click()
  expect(state.actions).toEqual([{ action: 'accept' }, { action: 'reject' }, { action: 'cancel' }])
})

test('privacy saves explicit changes and protects unsaved settings when switching tabs', async ({ page }) => {
  const state = await settingsFixture(page)
  await page.goto('/account?tab=privacy')
  await page.getByRole('checkbox', { name: /关注请求需要批准/ }).check()
  await page.getByRole('button', { name: '个人资料', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '保留隐私设置修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  state.failSave = true
  await page.getByRole('button', { name: '保存隐私设置' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '其他页面修改' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /关注请求需要批准/ })).toBeChecked()
  state.failSave = false
  await page.getByRole('button', { name: '保存隐私设置' }).click()
  await expect(page.getByRole('status').filter({ hasText: '隐私设置已保存' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /关注请求需要批准/ })).toBeChecked()
  expect(state.saves[0]).toMatchObject({ isLocked: true, version: 'v0' })
})

test('follow settings fit mobile and expose accessible controls', async ({ page }) => {
  await settingsFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const tab of ['following', 'privacy']) {
    await page.goto(`/account?tab=${tab}`)
    await expect(page.getByRole('heading', { name: tab === 'privacy' ? '关注与隐私' : '关注申请', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const violations = (await new AxeBuilder({ page }).include(tab === 'privacy' ? '.privacy-settings' : '.request-settings').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
    expect(violations).toEqual([])
    await page.screenshot({ path: `test-results/follow-${tab}-mobile.png`, fullPage: true })
  }
})

test('a delayed creator response cannot restore the previous account relationship', async ({ page }) => {
  const { account, state } = await fixture(page)
  const previousOwner = account.state.user.id
  let releaseOld!: () => void, markStarted!: () => void
  const oldResponse = new Promise<void>(resolve => { releaseOld = resolve })
  const oldStarted = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/creators', async route => {
    const previous = account.state.user.id === previousOwner
    const person = { ...state.author, followed: previous }
    if (previous) { markStarted(); await oldResponse }
    await route.fulfill({ json: { items: [person] } })
  })
  try {
    await page.goto('/community', { waitUntil: 'domcontentloaded' })
    await oldStarted
    account.state.user = { ...account.state.user, id: 'otherAccountUser', accountId: '18', username: 'otheraccount' }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const follow = page.getByRole('button', { name: '关注', exact: true })
    await expect(follow).toBeEnabled()
    const response = page.waitForResponse(async result => new URL(result.url()).pathname === '/api/creators'
      && (await result.json()).items[0]?.followed === true)
    releaseOld()
    await (await response).finished()
    // Let the old response and Vue's queued updates finish before checking the active account.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(follow).toBeEnabled()
    await follow.click()
    await expect(page.getByRole('button', { name: '取消关注', exact: true })).toBeEnabled()
    expect(state.writes).toEqual([{ active: true }])
  } finally { releaseOld() }
})
