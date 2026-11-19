import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function mockSettings(page: Parameters<typeof mockUnifiedAccount>[0]) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  await page.route('**/api/admin/community/config', route => route.fulfill({ json: {
    version: 'ui-controls-fixture',
    config: {
      communityPublicationMode: 'before', communityAutoBanEnabled: false, communityViolationThreshold: 3,
      communityFeedMode: 'shuffle', communityFeedPoolSize: 200, communityPullToRefresh: true,
      communityModelTypes: [], uploadLimits: { image: 20, video: 100, audio: 20, document: 20, other: 10 },
    },
  } }))
}

for (const mode of ['light', 'dark'] as const) {
  test(`shared picker keeps keyboard selection in admin settings (${mode})`, async ({ page }) => {
    await mockSettings(page)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1',
      JSON.stringify({ mode, light: 'cloud', dark: 'sage' })), mode)
    await page.goto('/admin?tab=settings')
    const picker = page.getByRole('combobox', { name: '内容发布方式', exact: true })
    await expect(picker).toHaveValue('before')
    await picker.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
    const colors = await picker.evaluate(element => ({
      trigger: getComputedStyle(element).backgroundColor,
      menu: getComputedStyle(element, '::picker(select)').backgroundColor,
    }))
    expect(colors.menu).toBe(colors.trigger)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveValue('after')
    await expect(picker).toBeFocused()
    await expect(page.getByText('新投稿直接公开，管理员可在审核列表中处理。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '保存社区设置', exact: true })).toBeEnabled()
  })
}

test.describe('shared picker on touch screens', () => {
  test.use({ isMobile: true, hasTouch: true })
  for (const width of [320, 390]) {
    test(`keeps the previous admin choice when dismissed at ${width}px`, async ({ page }) => {
      await mockSettings(page)
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/admin?tab=settings')
      const picker = page.getByRole('combobox', { name: '内容发布方式', exact: true })
      expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await picker.tap()
      await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Escape')
      await expect(picker).toHaveValue('before')
      await expect(picker).toBeFocused()
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    })
  }
})
