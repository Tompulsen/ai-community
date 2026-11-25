import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.beforeEach(async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    if (!localStorage.getItem('ai-community-next:appearance:v1')) {
      localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light', light: 'paper', dark: 'jade' }))
    }
  })
})

for (const [width, height] of [[1440, 1000], [1024, 640]]) {
test(`light expands and dark retracts at the collapsed and expanded button center at ${width}px`, async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await page.goto('/discover')
  const root = page.locator('html'), button = page.locator('.rail-theme')
  for (const expanded of [false, true]) {
    if (expanded) await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
    for (const mode of ['dark', 'light']) {
      const before = (await button.boundingBox())!
      await button.focus()
      await page.keyboard.press('Space')
      const pseudoElement = mode === 'dark' ? '::view-transition-old(root)' : '::view-transition-new(root)'
      await page.waitForFunction(pseudoElement => document.getAnimations().some(animation =>
        (animation.effect as KeyframeEffect | null)?.pseudoElement === pseudoElement), pseudoElement)
      const frames = await page.evaluate(pseudoElement => {
        const animation = document.getAnimations().find(animation =>
          (animation.effect as KeyframeEffect | null)?.pseudoElement === pseudoElement)!
        animation.pause(); animation.currentTime = 180
        return (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.clipPath)
      }, pseudoElement)
      const x = before.x + before.width / 2, y = before.y + before.height / 2
      expect(frames[mode === 'dark' ? 1 : 0]).toBe(`circle(0px at ${x}px ${y}px)`)
      const radius = Number(/^circle\(([^p]+)/.exec(String(frames[mode === 'dark' ? 0 : 1]))![1])
      expect(await page.evaluate(pseudoElement => getComputedStyle(document.documentElement, pseudoElement).zIndex, pseudoElement)).toBe('2')
      expect(radius).toBeGreaterThanOrEqual(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) - 0.01)
      await button.dispatchEvent('click')
      await expect(root).toHaveAttribute('data-color-scheme', mode)
      await expect(root).toHaveAttribute('data-theme', mode === 'dark' ? 'jade' : 'paper')
      await expect(button).toHaveCSS('transition-duration', '0s')
      await page.screenshot({ path: testInfo.outputPath(`reveal-${expanded}-${mode}.png`) })
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()))
      await expect(root).not.toHaveClass(/theme-reveal/)
      await expect(button).toBeFocused()
      expect(await button.boundingBox()).toEqual(before)
    }
  }
  await page.reload()
  await expect(root).toHaveAttribute('data-color-scheme', 'light')
  expect(errors).toEqual([])
})
}

test('dark retraction stays clipped after its last frame until the snapshot is removed', async ({ page }) => {
  await page.goto('/discover')
  await page.locator('.rail-theme').click()
  await page.waitForFunction(() => document.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect | null)?.pseudoElement === '::view-transition-old(root)'))
  const ending = await page.evaluate(async () => {
    const animation = document.getAnimations().find(animation =>
      (animation.effect as KeyframeEffect | null)?.pseudoElement === '::view-transition-old(root)')!
    const frames = (animation.effect as KeyframeEffect).getKeyframes()
    animation.finish()
    await animation.finished
    return {
      expected: frames.at(-1)!.clipPath,
      actual: getComputedStyle(document.documentElement, '::view-transition-old(root)').clipPath,
    }
  })
  expect(ending.actual).toBe(ending.expected)
  await expect(page.locator('html')).not.toHaveClass(/theme-reveal/)
  expect(await page.evaluate(() => document.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition-')))).toBe(false)
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
})

for (const fallback of ['reduced-motion', 'unsupported', 'skipped'] as const) {
  test(`theme still switches with ${fallback}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    if (fallback === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(fallback => {
      const state = window as typeof window & { themeTransitionCalls: number }
      state.themeTransitionCalls = 0
      const start = document.startViewTransition.bind(document)
      if (fallback === 'unsupported') Object.defineProperty(document, 'startViewTransition', { value: undefined })
      else document.startViewTransition = update => {
        state.themeTransitionCalls++
        const transition = start(update)
        if (fallback === 'skipped') transition.skipTransition()
        else throw new Error('Reduced motion must bypass View Transitions')
        return transition
      }
    }, fallback)
    await page.goto('/discover')
    for (const mode of ['dark', 'light']) {
      await page.locator('.rail-theme').click()
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', mode)
      await expect(page.locator('html')).not.toHaveClass(/theme-reveal/)
    }
    expect(await page.evaluate(() => (window as typeof window & { themeTransitionCalls: number }).themeTransitionCalls)).toBe(fallback === 'skipped' ? 2 : 0)
    expect(errors).toEqual([])
  })
}
