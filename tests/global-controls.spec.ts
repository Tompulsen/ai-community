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

function menuAppearance(element: HTMLElement) {
  const style = getComputedStyle(element, '::picker(select)')
  return { background: style.backgroundColor, border: style.borderTopWidth, radius: style.borderRadius,
    font: style.fontFamily, shadow: style.boxShadow, order: style.positionTryOrder }
}

for (const mode of ['light', 'dark'] as const) {
  test(`shared picker keeps keyboard selection in admin settings (${mode})`, async ({ page }) => {
    await mockSettings(page)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1',
      JSON.stringify({ mode, light: 'cloud', dark: 'sage' })), mode)
    await page.goto('/account?tab=privacy')
    const privacyAppearance = await page.getByRole('combobox', { name: '关注列表可见范围', exact: true }).evaluate(menuAppearance)
    await page.goto('/admin?tab=settings')
    const picker = page.getByRole('combobox', { name: '内容发布方式', exact: true })
    await expect(picker).toHaveValue('before')
    expect(await picker.evaluate(menuAppearance)).toEqual(privacyAppearance)
    const colors = await picker.evaluate(element => ({
      trigger: getComputedStyle(element).backgroundColor,
      menu: getComputedStyle(element, '::picker(select)').backgroundColor,
    }))
    expect(colors.menu).toBe(colors.trigger)
    await picker.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveValue('after')
    await expect(picker).toBeFocused()
    await expect(page.getByText('新投稿直接公开，管理员可在审核列表中处理。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '保存社区设置', exact: true })).toBeEnabled()
  })
}

test('shared selection and danger states remain distinct on hover in every palette', async ({ page }) => {
  await mockSettings(page)
  await page.goto('/admin?tab=settings')
  await expect(page.locator('.admin-content')).toBeVisible()
  await page.evaluate(() => {
    const buttons = [
      { className: 'button subtle selected', name: 'Shared selection fixture', pressed: true },
      { className: 'button subtle', name: 'Ordinary button fixture', pressed: false },
      { className: 'button danger', name: 'Danger button fixture', pressed: false },
      { className: 'button destructive', name: 'Destructive button fixture', pressed: false },
    ].map(({ className, name, pressed }) => {
      const button = document.createElement('button')
      button.className = className
      button.type = 'button'
      button.textContent = name
      button.setAttribute('aria-pressed', String(pressed))
      button.style.transition = 'none'
      return button
    })
    document.querySelector('.admin-content')!.prepend(...buttons)
  })
  const selected = page.getByRole('button', { name: 'Shared selection fixture', exact: true })
  const ordinary = page.getByRole('button', { name: 'Ordinary button fixture', exact: true })
  const themes = await page.evaluate(() => window.communityAppearance.themes.map(theme => ({ mode: theme.mode, id: theme.id })))
  for (const theme of themes) {
    await page.evaluate(theme => window.communityAppearance.set({ mode: theme.mode, [theme.mode]: theme.id }), theme)
    await page.mouse.move(0, 0)
    const resting = await selected.evaluate(element => getComputedStyle(element).backgroundColor)
    expect(resting).not.toBe(await ordinary.evaluate(element => getComputedStyle(element).backgroundColor))
    await ordinary.hover()
    const normalHover = await ordinary.evaluate(element => getComputedStyle(element).backgroundColor)
    await selected.hover()
    const selectedHover = await selected.evaluate(element => getComputedStyle(element).backgroundColor)
    expect(selectedHover).not.toBe(resting)
    expect(selectedHover).not.toBe(normalHover)
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    const contrast = await selected.evaluate(element => {
      const context = document.createElement('canvas').getContext('2d')!
      const luminance = (color: string) => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => {
          const channel = value / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        })
        return .2126 * r! + .7152 * g! + .0722 * b!
      }
      const ratio = (a: string, b: string) => {
        const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return (values[0]! + .05) / (values[1]! + .05)
      }
      const style = getComputedStyle(element)
      return { text: ratio(style.color, style.backgroundColor), border: ratio(style.borderColor, style.backgroundColor) }
    })
    expect(contrast.text, `${theme.id} selected text`).toBeGreaterThanOrEqual(4.5)
    expect(contrast.border, `${theme.id} selected border`).toBeGreaterThanOrEqual(3)
    await ordinary.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(selected).toBeFocused()
    expect(await selected.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px')
    for (const name of ['Danger button fixture', 'Destructive button fixture']) {
      const button = page.getByRole('button', { name, exact: true })
      await page.mouse.move(0, 0)
      const resting = await button.evaluate(element => ({
        color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
      }))
      await button.hover()
      expect(await button.evaluate(element => ({
        color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
      }))).toEqual(resting)
    }
  }
})

test('saved work icons keep a readable selected state on hover in every palette', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/works?*', route => route.fulfill({ json: { items: [{
    id: 'saved-state', authorId: 'fixtureAccountUser', title: '收藏状态检查', author: '测试创作者',
    kind: 'image', cover: '/assets/brand/octopus-community.jpg', tags: [], likes: 0,
    liked: false, saved: true, status: 'published', date: '2026-11-21T00:00:00Z',
  }], nextCursor: null } }))
  await page.goto('/discover')
  const saved = page.getByRole('button', { name: '取消收藏：收藏状态检查', exact: true })
  await expect(saved).toBeVisible()
  const themes = await page.evaluate(() => window.communityAppearance.themes.map(theme => ({ mode: theme.mode, id: theme.id })))
  for (const theme of themes) {
    await page.evaluate(theme => window.communityAppearance.set({ mode: theme.mode, [theme.mode]: theme.id }), theme)
    await saved.hover()
    const ink = await page.locator('[data-work-id="saved-state"]').evaluate(element => getComputedStyle(element).color)
    await expect(saved).toHaveCSS('color', ink)
    await expect(saved).toHaveAttribute('aria-pressed', 'true')
  }
})

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
