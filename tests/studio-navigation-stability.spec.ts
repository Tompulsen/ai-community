import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const [from, width] of [
  ['/discover', 1440], ['/community', 1440], ['/discover', 390], ['/community', 390],
] as const) {
  test(`${from} entry keeps the first studio frame stable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const account = await mockUnifiedAccount(page, true)
    await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } }))
    await page.route(/\/StudioChat\.vue(?:\?|$)/, async route => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.continue()
    })
    await page.goto(from)
    for (let visit = 0; visit < 2; visit++) {
      if (visit) await page.goBack()
      if (width >= 1000) await expect(page.locator('.profile-toggle')).toBeVisible()
      else await expect(page.getByRole('link', { name: '我', exact: true })).toHaveAttribute('href', /creator=fixtureAccountUser/)
      const readsBefore = account.reads.filter(path => path === '/api/session').length
      await page.evaluate(() => {
        const state = window as typeof window & {
          __studioFrames?: Record<string, number[]>[]; __studioSampled?: boolean; __studioReady?: boolean
        }
        state.__studioFrames = []
        state.__studioReady = state.__studioSampled = false
        document.addEventListener('click', () => {
          let remaining = 10
          const sample = () => {
            if (document.querySelector('.studio-shell')) {
              const frame: Record<string, number[]> = {}
              for (const selector of ['#main', '.create-page', '.studio-sidebar', '.studio-composer']) {
                const element = document.querySelector(selector)
                if (!element || !element.checkVisibility()) continue
                const box = element.getBoundingClientRect()
                frame[selector] = [box.x, box.y, box.width, box.height]
              }
              state.__studioFrames!.push(frame)
              if (state.__studioReady && !--remaining) { state.__studioSampled = true; return }
            }
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }, { once: true, capture: true })
      })
      const entry = width >= 1000
        ? page.getByRole('link', { name: '创作台', exact: true }).first()
        : page.locator('.mobile-nav').getByRole('link', { name: '创作', exact: true })
      await entry.click()
      const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
      await expect(prompt).toBeVisible()
      await expect(page.locator('.native-chat')).toBeVisible()
      await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(width >= 1000 ? 'gpt-image-2' : 'sora-2')
      await page.evaluate(() => { (window as any).__studioReady = true })
      await page.waitForFunction(() => (window as any).__studioSampled)
      const frames = await page.evaluate(() => (window as any).__studioFrames as Record<string, number[]>[])
      await test.info().attach(`navigation-${visit}`, { body: JSON.stringify(frames, null, 2), contentType: 'application/json' })
      const final = frames.at(-1)!
      for (const frame of frames) expect(frame).toEqual(final)
      expect(account.reads.filter(path => path === '/api/session')).toHaveLength(readsBefore)
      expect(account.mutations).toEqual([])
      if (visit) await expect(prompt).toHaveValue('保留创作草稿')
      else await prompt.fill('保留创作草稿')
      await page.screenshot({ path: test.info().outputPath(`studio-${visit}.png`) })
    }
  })
}
