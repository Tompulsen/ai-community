import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const counts = { feeds: 0, models: 0, prices: 0, documents: 0 }
  page.on('request', request => { if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) counts.documents++ })
  await page.route('**/api/works/feed', route => {
    counts.feeds++
    return route.fulfill({ json: { items: [{ id: 'stableWork', authorId: 'author', title: '稳定展示的作品', author: '创作者', avatar: '创',
      kind: 'image', cover: '/assets/brand/octopus-community.jpg', coverAspectRatio: 1, tags: ['风景'], prompt: '', model: '', likes: 1,
      date: '2026-11-28T00:00:00Z', owned: false, liked: false, saved: false, status: 'published' }], nextCursor: null } })
  })
  await page.route('**/api/creation/models**', route => {
    counts.models++
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
  })
  await page.route('**/api/new-api/model-pricing', route => {
    counts.prices++
    return route.fulfill({ json: { success: true, data: { userId: 17, currency: '积分', rows: [
      { model: 'gpt-image-2', group: 'auto', price: '500 积分', requestPrice: 500, imageCountMultiplier: true, billing: '每次请求' },
    ] } } })
  })
  await page.goto('/discover')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await expect(page.locator('.billing-estimate')).toHaveText('500 积分')
  await expect(page.locator('[data-work-id]')).toHaveCount(1)
  const prompt = page.getByRole('textbox', { name: '创作描述', exact: true })
  await prompt.fill('保留正在编辑的提示词')
  await page.evaluate(() => {
    const composer = document.querySelector('.discovery-creation')!
    const grid = document.querySelector('.discover-grid')!
    ;(window as any).originalCommunityNodes = [composer, grid]
    ;(window as any).communityChanges = []
    new MutationObserver(() => {
      if (![composer, grid].every(node => node.isConnected)) (window as any).communityChanges.push('remounted')
    }).observe(document.querySelector('#main')!, { childList: true, subtree: true })
  })
  return { account, counts, prompt }
}

for (const width of [390, 1440]) test(`same-account renewal preserves community content and draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const { account, counts, prompt } = await fixture(page)
  const before = { ...counts }
  account.state.authenticated = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/account/session', async route => { await gate; await route.fallback() })
  try {
    const syncing = page.waitForRequest('**/api/account/session')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await syncing
    expect(await page.evaluate(() => (window as any).communityChanges)).toEqual([])
    await expect(page.locator('#main')).toHaveAttribute('inert', '')
    release()
    await expect.poll(() => account.state.authenticated).toBe(true)
    await expect(page.locator('.billing-estimate')).toHaveText('500 积分')
    await expect(prompt).toHaveValue('保留正在编辑的提示词')
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '')
    expect(await page.evaluate(() => (window as any).originalCommunityNodes.every((node: Element) => node.isConnected))).toBe(true)
    expect(counts.feeds).toBe(before.feeds)
    expect(counts.models).toBe(before.models)
    expect(counts.documents).toBe(1)
  } finally { release() }
})

test('renewal to a different account clears the old community view and its composer', async ({ page }) => {
  const { account, prompt } = await fixture(page)
  account.state.authenticated = false
  account.state.user = { ...account.state.user, id: 'otherAccountUser', accountId: '18' }
  const syncing = page.waitForResponse('**/api/account/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await syncing
  await expect.poll(() => page.evaluate(() => (window as any).originalCommunityNodes.every((node: Element) => node.isConnected))).toBe(false)
  await expect(prompt).toHaveValue('')
  await expect(page.locator('#main')).not.toHaveAttribute('inert', '')
})

test('failed renewal clears the old account and releases the page for retry', async ({ page }) => {
  const { account } = await fixture(page)
  account.state.authenticated = false
  account.state.syncFailure = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert')).toContainText('账号同步暂时不可用')
  await expect.poll(() => page.evaluate(() => (window as any).originalCommunityNodes.every((node: Element) => node.isConnected))).toBe(false)
  await expect(page.locator('.profile-toggle')).toHaveCount(0)
  await expect(page.locator('#main')).not.toHaveAttribute('inert', '')
})

test('same-account focus refresh keeps the displayed estimate and makes one pricing request', async ({ page }) => {
  const { counts, prompt } = await fixture(page)
  const before = { ...counts }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/model-pricing', async route => { await gate; await route.fallback() })
  try {
    const refreshed = page.waitForResponse('**/api/session')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await expect(page.locator('.billing-estimate')).toHaveText('500 积分')
    release()
    await expect.poll(() => counts.prices).toBe(before.prices + 1)
    await expect(prompt).toHaveValue('保留正在编辑的提示词')
    expect(counts.feeds).toBe(before.feeds)
    expect(counts.models).toBe(before.models)
    expect(counts.documents).toBe(1)
  } finally { release() }
})

test('an idle signed-in community keeps its document, cards and draft through background polling', async ({ page }) => {
  test.setTimeout(60000)
  const { counts, prompt } = await fixture(page)
  const before = { ...counts }
  await page.waitForTimeout(35000)
  expect(counts.documents).toBe(1)
  expect(counts.feeds).toBe(before.feeds)
  expect(counts.models).toBe(before.models)
  await expect(prompt).toHaveValue('保留正在编辑的提示词')
  expect(await page.evaluate(() => (window as any).communityChanges)).toEqual([])
})
