import { chromium, expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const [width, populated] of [[1440, false], [390, false], [320, false], [1440, true], [390, true], [320, true]] as const) {
  test(`returning from studio keeps the ${populated ? 'populated' : 'empty'} community frame stable at ${width}px`, async ({ launchOptions, baseURL }) => {
    const browser = await chromium.launch({
      ...launchOptions,
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: [...(launchOptions.args || []), '--disable-features=OverlayScrollbar,OverlayScrollbars'],
    })
    try {
      const page = await browser.newPage({ baseURL, viewport: { width, height: 900 } })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const account = await mockUnifiedAccount(page, true)
      await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [
        { id: 'gpt-image-2', kinds: ['image'] },
      ] } }))
      if (populated) await page.route(/\/api\/works(?:\?|$)/, async route => {
        await new Promise(resolve => setTimeout(resolve, 200))
        await route.fulfill({ json: { items: Array.from({ length: 10 }, (_, index) => ({
          id: `return-work-${index}`, authorId: 'fixtureAccountUser', title: `作品 ${index + 1}`,
          author: '测试创作者', avatar: '测', version: 1, fileIds: [], kind: 'image',
          cover: '/assets/brand/octopus-community.jpg', coverAspectRatio: 1, tags: [], prompt: '', model: '',
          likes: 0, date: '2026-11-20T00:00:00Z', owned: false, liked: false, saved: false, status: 'published',
        })), nextCursor: null } })
      })
      await page.goto('/create/image')
      await expect(page.locator('.native-chat')).toBeVisible()
      await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
      if (width < 1000) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
      await page.evaluate(() => {
        const state = window as typeof window & { __returnFrames?: Record<string, number[]>[]; __returnReady?: boolean; __returnSampled?: boolean; __returnGridShifts?: number[] }
        state.__returnFrames = []
        state.__returnGridShifts = []
        new PerformanceObserver(list => {
          for (const entry of list.getEntries() as any[]) {
            if (entry.sources.some((source: any) => source.node instanceof Element && source.node.closest('.bento-grid'))) {
              state.__returnGridShifts!.push(entry.value)
            }
          }
        }).observe({ type: 'layout-shift' })
        document.addEventListener('click', () => {
          let remaining = 10
          const sample = () => {
            if (document.querySelector('.community-shell')) {
              const frame: Record<string, number[]> = { viewport: [scrollX, scrollY, document.documentElement.clientWidth] }
              for (const selector of ['.community-rail', '.app-header', '.header-inner', '#header-search', '.gooey-submit', '.header-actions', '.profile-toggle', '.desktop-nav', '.discover-page', '.discovery-toolbar', '.mobile-header-row', '.bento-grid', '.work-card:nth-child(7)']) {
                const element = document.querySelector(selector)
                if (!element?.checkVisibility()) continue
                const box = element.getBoundingClientRect()
                frame[selector] = [box.x, box.y, box.width, ...(['.discover-page', '.bento-grid'].includes(selector) ? [] : [box.height])]
              }
              state.__returnFrames!.push(frame)
              if (state.__returnReady && !--remaining) { state.__returnSampled = true; return }
            }
            requestAnimationFrame(() => setTimeout(sample, 0))
          }
          requestAnimationFrame(() => setTimeout(sample, 0))
        }, { once: true, capture: true })
      })
      await page.getByRole('link', { name: '探索社区', exact: true }).click()
      await expect(page.locator(populated ? '.work-card' : '.discovery-empty').first()).toBeVisible()
      await page.evaluate(() => { (window as any).__returnReady = true })
      await page.waitForFunction(() => (window as any).__returnSampled)
      const frames = await page.evaluate(() => (window as any).__returnFrames as Record<string, number[]>[])
      await test.info().attach('return-frames', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' })
      expect(await page.evaluate(() => (window as any).__returnGridShifts)).toEqual([])
      const final = frames.at(-1)!
      for (const frame of frames) {
        for (const [selector, box] of Object.entries(frame)) {
          if (selector !== 'viewport' && final[selector]) expect(box, selector).toEqual(final[selector])
        }
      }
      expect(account.mutations).toEqual([])
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath('community.png') })
    } finally {
      await browser.close()
    }
  })
}
