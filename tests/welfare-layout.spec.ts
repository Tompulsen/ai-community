import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { defaultWelfareTasks } from '../shared/welfare-tasks'

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' })

const themes = [
  { id: 'cloud', mode: 'light' }, { id: 'paper', mode: 'light' }, { id: 'mist', mode: 'light' },
  { id: 'sage', mode: 'dark' }, { id: 'midnight', mode: 'dark' }, { id: 'jade', mode: 'dark' },
] as const
const viewports = [{ width: 1280, height: 800 }, { width: 320, height: 740 }]
const drawButton = (page: Page) => page.locator('.draw-console > .button')

async function welfareFixture(page: Page) {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  const day = lotteryDay(new Date())
  const settings = {
    ...defaultLotterySettings(), enabled: true, dailyLimit: 200,
    prizes: defaultDailyLotteryPrizes(5000).map(prize => ({ ...prize, dailyQuota: prize.stock })),
  }
  const state = { fail: false, delay: Promise.resolve(), settings }
  await page.route('**/api/new-api/status', route => route.fulfill({
    json: { success: true, data: { currencySymbol: '积分', pointsPerUsd: 5000 } },
  }))
  await page.route('**/api/lottery/status', async route => {
    await state.delay
    return state.fail ? route.fulfill({ status: 503, json: { error: 'LOTTERY_UNAVAILABLE' } }) : route.fulfill({ json: {
      settings, balance: 3, accountLinked: true, creditReady: true, inviteUrl: '',
      support: { checked: true, eligible: true, amountCnyFen: 1000 },
      daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: 200, remaining: 200, used: 0, participated: false },
      counts: { invites: 0, followers: 0, likes: 0, bestWorkLikes: 0 },
      earned: { invites: 0, followers: 0, likes: 0 },
    } })
  })
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: {
    items: [{ id: 'layout-receipt', createdAt: '2026-11-19T10:00:00Z', prizes: [
      { prizeId: 'pending', name: '待发放奖励', description: '', amountCents: 120, status: 'pending' },
      { prizeId: 'paid', name: '已到账奖励', description: '', amountCents: 80, status: 'fulfilled', legacyPoints: '4000.000000' },
      { prizeId: 'empty', name: '未中奖记录', description: '', amountCents: 0, status: 'empty' },
    ] }], nextCursor: null,
  } }))
  await page.route('**/api/referrals/status*', route => route.fulfill({ json: {
    config: { version: 1, enabled: true, inviterPoints: 5000, inviteePoints: 5000, updatedAt: 1 },
    code: 'wf' + 'a'.repeat(24), inviteUrl: 'https://community.test/activities?invite=wf' + 'a'.repeat(24),
    invited: 0, credited: 0, pending: 0, earnedPoints: 0, asInvitee: null, items: [], nextCursor: 0,
  } }))
  return state
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.id} welfare keeps the draw visible at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await welfareFixture(page)
    await page.setViewportSize(viewport)
    await page.addInitScript(({ id, mode }) => {
      localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({
        mode, light: mode === 'light' ? id : 'cloud', dark: mode === 'dark' ? id : 'sage',
      }))
    }, theme)
    await page.goto('/activities')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    await expect(drawButton(page)).toBeEnabled()
    expect(await page.evaluate(() => scrollY)).toBe(0)
    const button = (await drawButton(page).boundingBox())!
    const footer = await page.locator('.mobile-nav').boundingBox()
    expect(button.y).toBeGreaterThanOrEqual(0)
    expect(button.y + button.height).toBeLessThanOrEqual(footer?.y ?? viewport.height)
    expect(button.x).toBeGreaterThanOrEqual(0)
    expect(button.x + button.width).toBeLessThanOrEqual(viewport.width)
    const buttonPaint = await drawButton(page).evaluate(element => getComputedStyle(element).backgroundImage)
    await drawButton(page).hover()
    expect(await drawButton(page).evaluate(element => getComputedStyle(element).backgroundImage)).toBe(buttonPaint)
    expect(buttonPaint).not.toBe('none')
    await page.mouse.move(0, 0)
    if (viewport.width < 1000) {
      const refresh = (await page.getByRole('button', { name: '刷新活动', exact: true }).boundingBox())!
      const lastTab = (await page.getByRole('button', { name: '奖励记录', exact: true }).boundingBox())!
      expect(refresh.y).toBe(lastTab.y)
      expect(lastTab.x + lastTab.width).toBeLessThanOrEqual(refresh.x)
    }
    await expect(page.locator('.prize-item')).toHaveCount(4)
    await expect(page.locator('.wheel-label')).toHaveText(['一等奖', '二等奖', '三等奖', '🤡'])
    await expect(page.locator('.wheel-label textPath')).toHaveCount(4)
    const arcs = await page.locator('.wheel-label textPath').evaluateAll(labels => labels.map(label => {
      const path = document.getElementById(label.getAttribute('href')!.slice(1))
      return path instanceof SVGPathElement && Number.isFinite(path.getTotalLength()) && path.getTotalLength() > 0
    }))
    expect(arcs.every(Boolean)).toBe(true)
    await expect(page.locator('.lottery-wheel')).not.toContainText('积分')
    const pool = await page.locator('.prize-section, .prize-item, .prize-detail, .prize-availability').evaluateAll(elements =>
      elements.map(element => {
        const bounds = element.getBoundingClientRect()
        return { left: bounds.left, right: bounds.right, fits: element.scrollWidth <= element.clientWidth }
      }))
    for (const bounds of pool) {
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(viewport.width)
      expect(bounds.fits).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${theme.id}-${viewport.width}.png`) })
    expect((await new AxeBuilder({ page }).include('.activity-page').analyze()).violations).toEqual([])
  })
}

for (const theme of ['teal', 'violet', 'sunset'] as const) {
  test(`welfare ${theme} material uses valid gradients and static lamps`, async ({ page }) => {
    const { settings } = await welfareFixture(page)
    settings.wheel.theme = theme
    await page.goto('/activities')
    await expect(drawButton(page)).toBeEnabled()
    await expect(page.locator('.wheel-lights > g')).toHaveCount(24)
    const paints = await page.locator('.lottery-wheel > svg').evaluate(element =>
      [...element.querySelectorAll('[fill^="url("]')].map(part => {
        const id = part.getAttribute('fill')!.slice(5, -1)
        const gradient = document.getElementById(id)
        return Boolean(gradient && [...gradient.querySelectorAll('stop')].every(stop => getComputedStyle(stop).stopColor !== 'rgba(0, 0, 0, 0)'))
      }))
    expect(paints.every(Boolean)).toBe(true)
    await expect(page.locator('.wheel-lights')).toHaveCSS('animation-name', 'none')
    expect((await new AxeBuilder({ page }).include('.draw-section').analyze()).violations).toEqual([])
  })
}

for (const prizeCount of [0, 3, 8, 12, 16]) {
  test(`welfare wheel fits ${prizeCount} configured prizes and long button text`, async ({ page }) => {
    const { settings } = await welfareFixture(page)
    const prizes = settings.prizes
    settings.prizes = Array.from({ length: prizeCount }, (_, index) => ({
      ...prizes[index % prizes.length]!, id: `prize-${index}`, name: '这是一个较长的自定义奖项名称',
    }))
    settings.wheel.buttonText = '这是较长的自定义抽奖按钮名称'
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto('/activities')
    const wheel = page.locator('.lottery-wheel')
    await expect(wheel.locator('.wheel-label')).toHaveCount(prizeCount === 0 ? 4 : prizeCount === 3 ? 6 : prizeCount)
    const geometry = await wheel.evaluate(element => ({
      wheel: element.getBoundingClientRect().toJSON(),
      center: element.querySelector('.wheel-center')!.getBoundingClientRect().toJSON(),
      labels: [...element.querySelectorAll('.wheel-label')].map(label => label.getBoundingClientRect().toJSON()),
    }))
    expect(geometry.center.width).toBeGreaterThanOrEqual(44)
    expect(geometry.center.height).toBeCloseTo(geometry.center.width, 1)
    for (const [index, label] of geometry.labels.entries()) {
      expect(label.left).toBeGreaterThanOrEqual(geometry.wheel.left)
      expect(label.right).toBeLessThanOrEqual(geometry.wheel.right)
      for (const other of geometry.labels.slice(index + 1)) {
        expect(label.right <= other.left || other.right <= label.left || label.bottom <= other.top || other.bottom <= label.top).toBe(true)
      }
    }
    await expect(page.locator('.wheel-center')).toHaveAccessibleName(/这是较长的自定义抽奖按钮名称/)
  })
}

for (const viewport of viewports) {
  test(`welfare tabs keep their own content and records fit at ${viewport.width}px`, async ({ page }, info) => {
    await welfareFixture(page)
    await page.setViewportSize(viewport)
    await page.goto('/activities')
    await expect(page.getByRole('region', { name: '今日福利', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '任务与邀请', exact: true }).click()
    await page.getByRole('button', { name: '查看邀请福利', exact: true }).click()
    await expect(page.getByRole('region', { name: '邀请朋友，共享积分', exact: true })).toBeVisible()
    await expect(page.locator('.daily-overview')).toHaveCount(0)
    await page.getByRole('button', { name: '奖励记录', exact: true }).click()
    await expect(page.locator('.daily-overview')).toHaveCount(0)
    const rows = page.locator('.records-section tbody tr')
    await expect(rows).toHaveCount(3)
    const amounts = ['6,000 积分', '4,000 积分', '--']
    const statuses = ['待发放', '已到账', '未中奖']
    for (let index = 0; index < amounts.length; index++) {
      await expect(rows.nth(index).locator('td[data-label="折合积分"]')).toHaveText(amounts[index]!)
      await expect(rows.nth(index).locator('td[data-label="状态"]')).toHaveText(statuses[index]!)
      await expect(rows.nth(index).locator('td[data-label="折合积分"]')).toBeVisible()
      await expect(rows.nth(index).locator('td[data-label="状态"]')).toBeVisible()
    }
    if (viewport.width === 320) {
      const cells = await rows.locator('td').evaluateAll(elements => elements.map(element => ({
        label: element.getAttribute('data-label'),
        before: getComputedStyle(element, '::before').content,
        display: getComputedStyle(element).display,
        fits: element.scrollWidth <= element.clientWidth,
      })))
      for (const cell of cells) {
        expect(cell.before).toBe(JSON.stringify(cell.label))
        expect(cell.display).toBe('grid')
        expect(cell.fits).toBe(true)
      }
      await expect(rows.first()).toHaveCSS('display', 'block')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`records-${viewport.width}.png`), fullPage: true })
    await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
    await expect(page.getByRole('region', { name: '今日福利', exact: true })).toBeVisible()
    await expect(drawButton(page)).toBeEnabled()
  })
}

test('welfare loading and failed status recover through the refresh control', async ({ page }, info) => {
  const state = await welfareFixture(page)
  let release!: () => void
  state.delay = new Promise<void>(resolve => { release = resolve })
  state.fail = true
  await page.goto('/activities')
  await expect(page.getByRole('status', { name: '正在加载活动', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新活动', exact: true })).toBeDisabled()
  await expect(drawButton(page)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('loading.png') })
  release()
  await expect(page.getByRole('alert')).toContainText('活动或奖励发放暂不可用')
  await expect(page.getByRole('status', { name: '正在加载活动', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('error.png') })
  state.fail = false
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(drawButton(page)).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('recovered.png') })
})
