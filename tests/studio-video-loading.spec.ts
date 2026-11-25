import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, media: (page: Page) => Promise<void>) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let generations = 0
  await page.route('**/api/creation/models', route => route.fulfill({ json: {
    tokenId: 41, items: [{ id: 'sora-2', kinds: ['video'] }],
  } }))
  await page.route('**/api/creation/generate', route => {
    generations++
    return route.fulfill({ json: { status: 'succeeded', tokenId: 41, protocol: 'openai', outputs: [{ url: 'https://media.example/generated.mp4' }] } })
  })
  await media(page)
  await page.goto('/create/video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('缓慢的动，背景附带光效')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  const answer = page.getByRole('article', { name: '模型生成结果', exact: true })
  await expect(answer.getByRole('status').filter({ hasText: '生成完成' })).toBeAttached()
  return { answer, generations: () => generations }
}

test('a newly generated video reserves a usable player while metadata is delayed', async ({ page }) => {
  const bytes = await readFile('tests/fixtures/poster-black-intro.mp4')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const { answer } = await fixture(page, async page => {
    await page.route('**/api/creation/media**', async route => {
      await pending
      await route.fulfill({ contentType: 'video/mp4', body: bytes }).catch(() => {})
    })
  })
  try {
    const video = answer.locator('video')
    await expect(video).toBeVisible()
    const bounds = await video.boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(240)
    expect(bounds!.height).toBeGreaterThanOrEqual(120)
  } finally { release() }
  await expect.poll(() => answer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
})

test('a failed video load offers media-only retry and recovers without generating again', async ({ page }) => {
  const bytes = await readFile('tests/fixtures/poster-black-intro.mp4')
  let reads = 0
  const { answer, generations } = await fixture(page, async page => {
    await page.route('**/api/creation/media**', route => {
      reads++
      return reads === 1
        ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary media outage' })
        : route.fulfill({ contentType: 'video/mp4', body: bytes })
    })
  })
  await expect(answer.getByRole('button', { name: '重新加载视频', exact: true })).toBeVisible()
  await answer.getByRole('button', { name: '重新加载视频', exact: true }).click()
  await expect.poll(() => answer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await answer.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await expect.poll(() => answer.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0)
  expect(generations()).toBe(1)
})

test('video playback remains usable when the browser media database is unavailable', async ({ page }) => {
  const bytes = await readFile('tests/fixtures/poster-black-intro.mp4')
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (name, version) => {
      if (name === 'community-studio-media') throw new DOMException('Media storage unavailable', 'SecurityError')
      return open(name, version)
    }
  })
  const { answer, generations } = await fixture(page, async page => {
    await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'video/mp4', body: bytes }))
  })
  await expect.poll(() => answer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await answer.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await expect.poll(() => answer.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0)
  expect(generations()).toBe(1)
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`portrait video keeps its actual proportions and fits at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const bytes = await readFile('tests/fixtures/portrait-preview.mp4')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { answer } = await fixture(page, async page => {
      await page.route('**/api/creation/media**', route => route.fulfill({ contentType: 'video/mp4', body: bytes }))
    })
    const video = answer.locator('video')
    await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
    await video.scrollIntoViewIfNeeded()
    const dimensions = await video.evaluate((video: HTMLVideoElement) => ({ width: video.videoWidth, height: video.videoHeight }))
    const bounds = (await video.boundingBox())!
    expect(bounds.width / bounds.height).toBeCloseTo(dimensions.width / dimensions.height, 2)
    expect(bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.height).toBeLessThanOrEqual(viewport.height * (viewport.width < 640 ? .32 : .36) + 1)
    await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.play().then(() => !video.paused))).toBe(true)
    await video.evaluate((video: HTMLVideoElement) => video.pause())
    await page.screenshot({ path: testInfo.outputPath(`video-${viewport.width}.png`) })
    expect(errors).toEqual([])
  })
}
