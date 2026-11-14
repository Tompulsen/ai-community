import { test, expect } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { readFile } from 'node:fs/promises'

test('desktop sidebar restores media history without submitting and keeps account-tool drafts', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let submissions = 0
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/creation/**', route => {
    if (new URL(route.request().url()).pathname === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (route.request().method() === 'POST') submissions++
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
  })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { rows: [], currency: '¥' } } }))
  await page.addInitScript(() => {
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'layout-test', owner: '17', kind: 'image', model: 'gpt-image-2', prompt: '海边的灯塔',
      createdAt: Date.now(), settledAt: Date.now(), phase: 'complete', protocol: 'sync', references: [],
      urls: ['https://media.example/result.png'], text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    }]))
  })
  await page.goto('/create/image')
  const sidebar = page.getByRole('complementary', { name: '创作导航与历史' })
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole('searchbox').fill('灯塔')
  await sidebar.getByRole('button', { name: '海边的灯塔', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('海边的灯塔')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这个创作草稿')
  await sidebar.getByRole('button', { name: '模型定价', exact: true }).click()
  await expect(page.locator('.studio-account-view')).toBeVisible()
  await page.getByRole('button', { name: '返回创作', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这个创作草稿')
  await sidebar.getByRole('button', { name: '新建创作', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeEmpty()
  expect(submissions).toBe(0)
  expect(errors).toEqual([])
})

test('sidebar adapts at desktop breakpoint and result/composer edges stay aligned', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.goto('/create/image')
  await expect(page.locator('.studio-composer')).toBeVisible()
  for (const width of [2867, 1440, 1024, 999, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const sidebar = page.locator('.studio-sidebar')
    if (width >= 1000) await expect(sidebar).toBeVisible()
    else await expect(sidebar).toBeHidden()
    const composer = await page.locator('.studio-composer').boundingBox()
    const output = await page.locator('.creation-output').boundingBox()
    expect(composer!.x).toBeCloseTo(output!.x, 0)
    expect(composer!.width).toBeCloseTo(output!.width, 0)
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(901)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const width of [1440, 390, 320]) {
  test(`composer menu switches exactly three modes and preserves drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await mockUnifiedAccount(page, true)
    let paidRequests = 0
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/creation/**', route => {
      if (route.request().method() === 'POST') paidRequests++
      const path = new URL(route.request().url()).pathname
      return route.fulfill({ json: path.endsWith('/models') ? { tokenId: 41, items: [
        { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
      ] } : { items: [], enabled: false } })
    })
    await page.goto('/create/image')
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留图片草稿')
    if (width >= 1000) {
      const sidebar = page.locator('.studio-sidebar')
      await expect(sidebar.getByRole('button', { name: '创作', exact: true })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: '图片', exact: true })).toHaveCount(0)
    }
    const trigger = page.getByRole('button', { name: '创作模式', exact: true })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: '创作模式', exact: true })
    await expect(panel.getByRole('group', { name: '创作类型' }).getByRole('button')).toHaveCount(3)
    await expect(panel.getByRole('button', { name: '图片生成', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const box = await panel.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await panel.getByRole('button', { name: '视频生成', exact: true }).click()
    await expect(page).toHaveURL(/\/create\/video/)
    await expect(trigger).toContainText('视频生成')
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留视频草稿')
    await trigger.click()
    await panel.getByRole('button', { name: '对话', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
    await expect(trigger).toContainText('对话')
    await trigger.click()
    await panel.getByRole('button', { name: '图片生成', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留图片草稿')
    await trigger.click()
    await panel.getByRole('button', { name: '视频生成', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留视频草稿')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(paidRequests).toBe(0)
    expect(errors).toEqual([])
  })
}
