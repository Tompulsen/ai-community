import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const longPrice = '上下文 ≤ 272,000 tokens：输入 $7 / 输出 $35 / 缓存读取 $0.7；上下文 > 272,000 tokens：输入 $14 / 输出 $52.5 / 缓存读取 $1.4'
const models = [
  { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
]
for (const kind of ['text', 'image', 'video']) {
  test(`pricing opens above the ${kind} composer without moving it or submitting`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    let submissions = 0
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/creation/**', route => {
      if (route.request().method() === 'POST') submissions++
      return route.fulfill({ json: { tokenId: 41, items: models } })
    })
    await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: {
      rows: models.map(model => ({ model: model.id, group: 'auto', price: longPrice, billing: '上下文分档 · 每百万 tokens' })),
    } } }))
    await page.goto(`/create/${kind}`)
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).not.toHaveValue('')
    const input = page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })
    await input.fill('保留输入内容')
    const trigger = page.getByRole('button', { name: '模型价格', exact: true })
    const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const before = await page.locator('.studio-composer').boundingBox()
      const summary = await trigger.boundingBox()
      expect(summary!.y + summary!.height).toBeLessThanOrEqual(before!.y)
      expect(await page.locator('.studio-composer .studio-billing').count()).toBe(0)
      await expect(trigger).not.toContainText('272,000')
      await trigger.click()
      await expect(panel).toBeVisible()
      await expect(panel.locator('.billing-full-price')).toHaveText(longPrice)
      const bounds = await panel.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.locator('.studio-composer').boundingBox()).toEqual(before)
      await page.screenshot({ path: `.taste-skill/pricing-disclosure-20261114/${kind}-${width}-open.png` })
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(input).toHaveValue('保留输入内容')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await trigger.click()
    await panel.getByRole('button', { name: '查看全部定价', exact: true }).click()
    await expect(page.locator('.studio-account-view')).toBeVisible()
    await page.getByRole('button', { name: '返回创作', exact: true }).click()
    await expect(input).toHaveValue('保留输入内容')
    expect(submissions).toBe(0)
    expect(errors).toEqual([])
  })
}

test('pricing has error recovery and a missing-price state', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let failed = true
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: models } }))
  await page.route('**/api/new-api/model-pricing', route => failed
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { success: true, data: { rows: [] } } }))
  await page.goto('/create/image')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  await expect(panel.getByRole('alert')).toContainText('价格读取失败')
  failed = false
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel).toContainText('当前模型暂无可用定价')
})
