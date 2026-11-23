import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import type { Work } from '../src/data'
import { mockUnifiedAccount } from './helpers/account-fixture'

const originalUrl = '/legacy-files/displayasset?source=detail&variant=original#frame'
const work: Work = {
  id: 'performancework', authorId: 'creator', version: 1, fileIds: ['displayasset'],
  files: [{ id: 'displayasset', name: 'animation.webp', type: 'image/webp', url: originalUrl, processing: 'ready' }],
  kind: 'image', title: '完整动画作品', author: '创作者', avatar: '创', cover: '', tags: [],
  prompt: '', model: '', likes: 0, date: '2026-11-23T00:00:00Z',
  owned: false, liked: false, saved: false, status: 'published',
}

async function fixture(page: Page) {
  await mockUnifiedAccount(page, true)
  const state = { failDisplay: false, failOriginal: false, reads: [] as string[] }
  const pixels = Buffer.concat([Buffer.alloc(48 * 48 * 3), Buffer.alloc(48 * 48 * 3, 255)])
  const animation = await sharp(pixels, { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } })
    .webp({ delay: [240, 240], loop: 0 }).toBuffer()
  await page.route('**/legacy-files/displayasset*', route => {
    const url = new URL(route.request().url()), variant = url.searchParams.get('variant') || 'original'
    state.reads.push(variant)
    expect(url.searchParams.get('source')).toBe('detail')
    const fails = variant === 'webpublic' ? state.failDisplay : state.failOriginal
    return route.fulfill(fails ? { status: 503, body: 'Fixture media unavailable' }
      : { contentType: 'image/webp', body: animation })
  })
  await page.route('**/api/works**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/works/feed') return route.fulfill({ json: { items: [work], nextCursor: null } })
    if (path === `/api/works/${work.id}`) return route.fulfill({ json: { work } })
    if (path.endsWith('/view')) return route.fulfill({ json: { viewsCount: 1 } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return state
}

async function openWork(page: Page) {
  await page.goto('/discover')
  await page.locator(`.work-card[data-work-id="${work.id}"] .work-cover`).click()
}

test('details show the animated display variant and preserve original preview and download URLs', async ({ page }) => {
  const state = await fixture(page)
  await openWork(page)
  const image = page.locator('.detail-media img')
  await expect(image).toHaveAttribute('src', '/legacy-files/displayasset?source=detail&variant=webpublic#frame')
  await image.evaluate((element: HTMLImageElement) => element.decode())
  const colors = new Set<number>()
  for (let attempt = 0; attempt < 10 && colors.size < 2; attempt++) {
    const sample = await sharp(await image.screenshot({ animations: 'allow' })).resize(1, 1).raw().toBuffer()
    colors.add(sample[0]! > 128 ? 255 : 0)
    if (colors.size < 2) await page.waitForTimeout(80)
  }
  expect(colors.size).toBe(2)
  await expect(page.getByRole('link', { name: '下载 animation.webp', exact: true })).toHaveAttribute('href', originalUrl)
  expect(state.reads).toEqual(['webpublic'])
  await page.getByRole('button', { name: '完整预览 animation.webp', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '作品文件预览', exact: true })
  await expect(preview.locator('img')).toHaveAttribute('src', new URL(originalUrl, page.url()).href)
  await preview.locator('img').evaluate((element: HTMLImageElement) => element.decode())
  expect(state.reads).toEqual(['webpublic', 'original'])
})

test('a failed display image falls back to the original once', async ({ page }) => {
  const state = await fixture(page)
  state.failDisplay = true
  await openWork(page)
  const image = page.locator('.detail-media img')
  await expect(image).toHaveAttribute('src', originalUrl)
  await image.evaluate((element: HTMLImageElement) => element.decode())
  expect(state.reads).toEqual(['webpublic', 'original'])
  await expect(page.locator('.detail-media [role="alert"]')).toHaveCount(0)
})

test('when both variants fail the retry remains available and never loops', async ({ page }) => {
  const state = await fixture(page)
  state.failDisplay = true; state.failOriginal = true
  await openWork(page)
  await expect(page.locator('.detail-media [role="alert"]')).toContainText('文件预览加载失败')
  expect(state.reads).toEqual(['webpublic', 'original'])
  state.failOriginal = false
  await page.locator('.detail-media').getByRole('button', { name: '重新加载', exact: true }).click()
  const image = page.locator('.detail-media img')
  await expect(image).toHaveAttribute('src', originalUrl)
  await image.evaluate((element: HTMLImageElement) => element.decode())
  expect(state.reads).toEqual(['webpublic', 'original', 'original'])
})

test('compact cards open complete details and preserve the list when returning', async ({ page }) => {
  await fixture(page)
  let feedReads = 0, detailReads = 0
  const { prompt, model, fileIds, files, ...summary } = work
  const fullPrompt = 'Full generation prompt available only in the detail response.'
  await page.route('**/api/works/feed', route => {
    feedReads++
    return route.fulfill({ json: { items: [summary], nextCursor: null } })
  })
  await page.route(`**/api/works/${work.id}`, route => {
    detailReads++
    return route.fulfill({ json: { work: { ...work, prompt: fullPrompt } } })
  })
  await openWork(page)
  await expect(page.locator('#work-prompt')).toHaveText(fullPrompt)
  await expect(page.getByRole('link', { name: '下载 animation.webp', exact: true })).toHaveAttribute('href', originalUrl)
  expect(detailReads).toBe(1)
  await page.goBack()
  await expect(page.locator(`.work-card[data-work-id="${work.id}"]`)).toBeVisible()
  expect(feedReads).toBe(1)
})
