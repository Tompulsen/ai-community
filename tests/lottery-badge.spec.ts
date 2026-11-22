import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { defaultLotterySettings } from '../server/business/lottery'
import { readFile } from 'node:fs/promises'

async function fixture(page: Page, balance = 2, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  const state = { balance, failed: false, reads: 0, draws: 0 }
  await page.route('**/api/lottery/balance', route => {
    state.reads++
    expect(route.request().headers()['x-new-api-user']).toBe(account.state.user.id)
    return route.fulfill(state.failed ? { status: 503, json: { message: '暂不可用' } }
      : { json: { userId: account.state.user.id, balance: state.balance } })
  })
  await page.route('**/api/lottery/status', route => route.fulfill({ json: {
    settings: { ...defaultLotterySettings(), enabled: true, prizes: [{ id: 'empty', name: '谢谢参与', kind: 'empty', description: '', amountCents: 0, weight: 1, stock: -1, enabled: true }] }, balance: state.balance,
    counts: { likes: 0, bestWorkLikes: 0, followers: 0, invites: 0 }, earned: { likes: 0, followers: 0, invites: 0 },
    creditReady: true, accountLinked: true, consumption: { checked: true, eligible: true, amountCnyFen: 10000 },
  } }))
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/lottery/draw', route => {
    state.draws++; state.balance -= route.request().postDataJSON().count
    return route.fulfill({ json: { id: 'fixture-draw', createdAt: new Date().toISOString(), prizes: [] } })
  })
  return { state, account }
}

for (const [width, mode] of [[320, 'light'], [390, 'dark'], [1440, 'light'], [1440, 'dark']] as const) test(`lottery opportunity hint fits ${width}px ${mode}`, async ({ page }, info) => {
  await fixture(page, 120)
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), mode)
  await page.goto('/discover')
  if (width < 1000) {
    const trigger = page.locator('.tools-trigger')
    await expect(trigger.locator('.tools-welfare-dot')).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-description', /剩余 120 次抽奖机会/)
    await trigger.click()
  }
  const link = width < 1000 ? page.locator('.tools-panel').getByRole('link', { name: '福利中心 99+ 次抽奖机会', exact: true }) : page.locator('.header-welfare')
  await expect(link).toHaveAccessibleName('福利中心 99+ 次抽奖机会')
  await expect(link).toHaveAttribute('aria-description', '剩余 120 次抽奖机会')
  await expect(link).toContainText('99+')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include(width < 1000 ? '.tools-panel' : '.header-actions').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`lottery-badge-${width}-${mode}.png`) })
  await link.focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/activities$/)
})

test('earned chances appear after visible refresh and disappear when consumed', async ({ page }) => {
  const { state } = await fixture(page, 0)
  await page.clock.install()
  await page.goto('/discover')
  const link = page.locator('.header-welfare')
  await expect.poll(() => state.reads).toBe(1)
  await expect(link).toHaveAccessibleName('福利中心')
  state.balance = 1
  await page.clock.fastForward(31000)
  await expect(link).toHaveAccessibleName('福利中心 1 次抽奖机会')
  await link.click()
  await page.getByRole('button', { name: '抽奖 1 次', exact: true }).click()
  await expect.poll(() => state.draws).toBe(1)
  await expect(link).toHaveAccessibleName('福利中心')
  await expect(link.locator('.lottery-count')).toHaveCount(0)
})

test('background tabs do not poll and a resumed page refreshes awarded chances', async ({ page }) => {
  const { state } = await fixture(page, 0)
  await page.clock.install()
  await page.goto('/discover')
  await expect.poll(() => state.reads).toBe(1)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }))
  await page.clock.fastForward(61000)
  expect(state.reads).toBe(1)
  state.balance = 3
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('.header-welfare')).toHaveAccessibleName('福利中心 3 次抽奖机会')
})

test('unavailable counts clear stale hints and recover without interrupting browsing', async ({ page }) => {
  const { state } = await fixture(page)
  await page.clock.install()
  await page.goto('/discover')
  const link = page.locator('.header-welfare')
  await expect(link).toContainText('2')
  state.failed = true
  await page.clock.fastForward(31000)
  await expect(link).toHaveAccessibleName('福利中心')
  state.failed = false; state.balance = 4
  await page.clock.fastForward(31000)
  await expect(link).toHaveAccessibleName('福利中心 4 次抽奖机会')
})

test('guests do not request or display private opportunity counts', async ({ page }) => {
  const { state } = await fixture(page, 3, false)
  await page.goto('/discover')
  await expect(page.locator('.header-welfare')).toHaveAccessibleName('福利中心')
  await expect(page.locator('.lottery-count')).toHaveCount(0)
  expect(state.reads).toBe(0)
})

test('opening welfare refreshes the hint after its existing reward synchronization', async ({ page }) => {
  const { state } = await fixture(page, 0)
  await page.goto('/discover')
  await expect.poll(() => state.reads).toBe(1)
  await page.route('**/api/lottery/status', async route => {
    state.balance = 2
    await route.fallback()
  })
  await page.locator('.header-welfare').click()
  await expect(page.locator('.header-welfare')).toHaveAccessibleName('福利中心 2 次抽奖机会')
})

for (const studio of [false, true]) test(`${studio ? 'studio' : 'upload'} publication immediately refreshes newly awarded opportunities`, async ({ page }) => {
  const { state, account } = await fixture(page, 0)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'cat', name: '摄影', category: 'image' }] } }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'output', name: 'photo.jpg', type: 'image/jpeg', url: '/photo.jpg', size: image.length } } }))
  await page.route('**/photo.jpg', route => route.fulfill({ body: image, contentType: 'image/jpeg' }))
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.balance = 1
    return route.fulfill({ json: { work: { id: 'published', title: '测试作品', status: 'approved' } } })
  })
  if (studio) {
    await page.route('**/api/creation/**', route => {
      const path = new URL(route.request().url()).pathname
      return route.fulfill(path.endsWith('/models') ? { json: { tokenId: 41, items: [{ id: 'fixture-model', kinds: ['image'] }] } }
        : path.endsWith('/media') ? { body: image, contentType: 'image/jpeg' } : { json: { items: [] } })
    })
    await page.addInitScript(() => {
      const task = { id: 'badge-publication', conversationId: 'badge-chat', owner: '17', kind: 'image', phase: 'complete', model: 'fixture-model', protocol: 'sync', prompt: '测试作品', text: '', urls: ['https://media.example/output.jpg'], references: [], createdAt: Date.now(), request: { n: 1 } }
      localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([task]))
      localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: { _hasHydrated: true, activeId: 'badge-chat', mediaConversationsMigrated: true, sessions: [{ id: 'badge-chat', mediaConversationId: 'badge-chat', creationKind: 'image', topic: '测试作品', model: 'fixture-model', settings: {}, skillIds: [], messages: [] }] } }))
    })
    await page.goto('/create/image')
    await page.getByRole('button', { name: '发布作品', exact: true }).click()
  } else await page.goto('/discover?publish=1')
  await expect.poll(() => state.reads).toBe(1)
  const form = page.getByRole('dialog', { name: '发布作品', exact: true })
  if (studio) {
    await form.getByRole('button', { name: '# 摄影', exact: true }).click()
    await form.getByRole('checkbox', { name: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。', exact: true }).check()
  } else {
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image })
    await form.getByLabel('作品标题', { exact: true }).fill('测试作品')
    await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  }
  await form.getByRole('button', { name: studio ? '提交作品' : '提交审核', exact: true }).click()
  await expect.poll(() => state.balance).toBe(1)
  await expect.poll(() => state.reads).toBeGreaterThan(1)
  await expect(page.locator('.lottery-status')).toHaveText('剩余 1 次抽奖机会')
})
