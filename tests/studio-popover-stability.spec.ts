import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.beforeEach(async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [
    { id: 'gpt-image-2', kinds: ['image'] },
  ] } }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: {
    rows: [{ model: 'gpt-image-2', group: 'auto', price: '1,000 积分', billing: '每次请求' }], userId: 17, currency: '积分',
  } } }))
})

for (const width of [1440, 390]) {
  for (const [name, label] of [['模型价格', '模型价格'], ['创作模式：图片生成', '创作模式'], ['高级参数', '高级参数']]) {
    test(`${label} opens without a misplaced visible frame at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/create/image')
      await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
      const input = page.getByRole('textbox', { name: '提示词', exact: true })
      await input.fill('保留创作草稿')
      const trigger = page.getByRole('button', { name, exact: true })
      const panel = page.getByRole('dialog', { name: label, exact: true, includeHidden: true })
      for (let opening = 0; opening < 2; opening++) {
        const composer = await page.locator('.studio-composer').boundingBox()
        await panel.evaluate(element => {
          const state = window as typeof window & { __popoverFrames?: number[][] }
          state.__popoverFrames = []
          element.addEventListener('beforetoggle', event => {
            if ((event as ToggleEvent).newState !== 'open') return
            let remaining = 16
            const sample = () => {
              const style = getComputedStyle(element)
              if (element.matches(':popover-open') && style.visibility === 'visible' && style.opacity !== '0') {
                const box = element.getBoundingClientRect()
                state.__popoverFrames!.push([box.x, box.y, box.width, box.height])
              }
              if (--remaining) requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
          }, { once: true })
        })
        await trigger.click()
        await expect(panel).toBeVisible()
        await page.waitForFunction(() => ((window as any).__popoverFrames?.length || 0) >= 6)
        const frames = await page.evaluate(() => (window as any).__popoverFrames as number[][])
        const final = (await panel.boundingBox())!
        for (const frame of frames) {
          expect(frame).toEqual([final.x, final.y, final.width, final.height])
        }
        expect(await page.locator('.studio-composer').boundingBox()).toEqual(composer)
        if (opening === 0) await page.screenshot({ path: test.info().outputPath('open.png') })
        await page.keyboard.press('Escape')
        await expect(panel).toBeHidden()
        await expect(trigger).toBeFocused()
        await expect(input).toHaveValue('保留创作草稿')
      }
    })
  }
}
