import { expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shots = '.taste-skill/unified-dialogue-20261115'

for (const kind of ['text', 'image', 'video'] as const) test(`${kind} uses the shared user/model dialogue during generation and after completion`, async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  await page.route('**/api/creation/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/media')) return route.fulfill({ contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg', body: kind === 'video' ? video : image })
    if (path.endsWith('/generate')) {
      requests++
      await waiting
      return route.fulfill({ json: { status: 'succeeded', outputs: kind === 'text' ? [{ text: '这是模型的回答。' }] : [{ url: `https://media.example/result.${kind === 'video' ? 'mp4' : 'jpg'}` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(`/create/${kind}`)
  const input = page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })
  await expect(input).toBeVisible()
  await input.fill('请帮我创作一只小猫')
  await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
  const user = page.locator('.studio-message.user'), model = page.locator('.studio-message.assistant')
  try {
    await expect(user).toHaveCount(1)
    await expect(model).toHaveCount(1)
    await expect(user.locator('.message-bubble')).toHaveText('请帮我创作一只小猫')
    await expect(model.locator('.message-heading strong')).toHaveText(kind === 'text' ? 'gpt-5' : kind === 'image' ? 'gpt-image-2' : 'sora-2')
    await expect(model.locator('.ai-status')).toBeVisible()
    await expect(model.locator('.ai-status')).toContainText(kind === 'video' ? '正在生成视频' : '正在思考')
    await expect(page.locator('.generation-steps, .generation-waiting')).toHaveCount(0)
    await expect(user.locator('.message-avatar')).toBeVisible()
    await mkdir(shots, { recursive: true })
    for (const [width, theme] of [[1440, 'dark'], [390, 'light'], [320, 'dark']] as const) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
      await user.scrollIntoViewIfNeeded()
      const bounds = await user.evaluate(element => {
        const frame = element.getBoundingClientRect(), bubble = element.querySelector('.message-bubble')!.getBoundingClientRect()
        return { right: Math.abs(frame.right - bubble.right), width: bubble.width, frameWidth: frame.width, radius: getComputedStyle(element.querySelector('.message-bubble')!).borderBottomRightRadius }
      })
      expect(bounds.right).toBeLessThan(2)
      expect(bounds.width).toBeLessThan(bounds.frameWidth)
      expect(bounds.radius).toBe('6px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(input).toBeInViewport()
      await page.screenshot({ path: `${shots}/${kind}-active-${width}-${theme}.png` })
    }
  } finally { release() }
  await expect(model.locator('.ai-status')).toHaveCount(0)
  await expect(input).toHaveValue('')
  if (kind === 'text') await expect(model.locator('.message-content')).toContainText('这是模型的回答。')
  else {
    await expect(model.locator(kind === 'image' ? '.creation-image-preview img' : 'video')).toBeVisible()
    if (kind === 'video') {
      await expect(model.locator('video')).toHaveAttribute('controls', '')
      await model.getByRole('button', { name: '放大视频', exact: true }).click()
      const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
      await expect(viewer.locator('video')).toBeVisible()
      await expect.poll(() => viewer.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
      await page.keyboard.press('Escape')
      await expect(viewer).not.toBeVisible()
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await model.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${shots}/${kind}-complete.png` })
  expect(requests).toBe(1)
  expect(errors).toEqual([])
})
