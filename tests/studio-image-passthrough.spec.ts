import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const width of [1440, 390]) test(`inline originals go straight to browser storage at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  let generations = 0, originalProxies = 0
  await page.route('**/api/creation/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (url.pathname === '/api/creation/media') { originalProxies++; return route.fulfill({ status: 410, json: { error: { message: '没有服务器原图副本' } } }) }
    if (url.pathname === '/api/creation/generate') {
      generations++
      expect(route.request().headers().prefer).toBeUndefined()
      const { requestId } = route.request().postDataJSON()
      return route.fulfill({ json: { status: 'succeeded', requestId,
        outputs: [{ url: `data:image/jpeg;base64,${image.toString('base64')}` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('直接保存到浏览器')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-response .browser-save')).toHaveText('图片已保存到此浏览器')
  await page.reload()
  await expect(page.locator('.creation-response .browser-save')).toHaveText('图片已保存到此浏览器')
  await page.locator('.creation-image-preview').click()
  const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect(viewer).toBeVisible()
  await expect.poll(() => viewer.locator('img').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(originalProxies).toBe(0)
  expect(generations).toBe(1)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/image-passthrough-${width}.png`, fullPage: true })
})
