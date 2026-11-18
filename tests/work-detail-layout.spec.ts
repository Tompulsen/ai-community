import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Work, WorkComment } from '../src/data'
import { mockUnifiedAccount } from './helpers/account-fixture'

const portrait = { id: 'portrait', name: 'portrait.png', type: 'image/png', url: '/__detail/portrait.svg' }
const landscape = { id: 'landscape', name: 'landscape.png', type: 'image/png', url: '/__detail/landscape.svg' }
const work: Work = {
  id: 'detailwork', authorId: 'detailauthor', version: 1, fileIds: [portrait.id], files: [portrait],
  kind: 'image', title: 'Editorial portrait · 光影记录', author: '创作者', avatar: '创',
  cover: portrait.url, coverAspectRatio: 9 / 16, tags: ['摄影'], prompt: '保留完整画面与细节。\n'.repeat(100),
  model: '创作模型', likes: 3, date: '2026-11-16T00:00:00Z', viewsCount: 42, repliesCount: 1,
  owned: false, liked: false, saved: false, status: 'published',
}
const comment: WorkComment = {
  id: 'firstcomment', userId: 'reader', author: '读者', text: '这张作品的光影很自然。',
  owned: false, removable: false, likesCount: 2, date: '2026-11-16T00:00:00Z',
}

async function fixture(page: Page, selected: Work = { ...work }, authenticated = true) {
  await mockUnifiedAccount(page, authenticated)
  const state = { failComment: false, failRelated: false, comments: [] as unknown[] }
  const items = [selected, ...Array.from({ length: 24 }, (_, index) => ({
    ...work, id: `related${index}`, title: `作品 ${index + 1}`,
    cover: index % 2 ? landscape.url : portrait.url, coverAspectRatio: index % 2 ? 16 / 9 : 9 / 16,
  }))]
  await page.route('**/__detail/*.svg', route => {
    const wide = route.request().url().includes('landscape')
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 800 : 450}" height="${wide ? 450 : 800}"><rect width="100%" height="100%" fill="#60765d"/><rect x="10%" y="10%" width="80%" height="80%" fill="#ccd6c9"/></svg>` })
  })
  await page.route('**/api/works**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/works') return state.failRelated
      ? route.fulfill({ status: 503, json: { message: '暂时无法加载' } })
      : route.fulfill({ json: { items, nextCursor: null } })
    const current = items.find(item => path === `/api/works/${item.id}`)
    if (current) return route.fulfill({ json: { work: current } })
    if (path.endsWith('/view')) return route.fulfill({ json: { viewsCount: 43 } })
    if (path.endsWith('/comments')) {
      if (request.method() === 'POST') {
        state.comments.push(request.postDataJSON())
        return state.failComment
          ? route.fulfill({ status: 503, json: { message: '评论发送失败，请重试。' } })
          : route.fulfill({ json: { comment: { ...comment, id: 'newcomment', author: '测试创作者', text: request.postDataJSON().text } } })
      }
      return route.fulfill({ json: { items: [comment], nextCursor: null } })
    }
    return route.fulfill({ json: { ok: true } })
  })
  return state
}

test('detail and recommendations adapt without cropping, overlap or horizontal overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  await page.goto('/work/detailwork')
  await expect(page.locator('.related-works .work-card')).toHaveCount(24)
  for (const width of [2560, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible()
    await page.locator('.detail-media > img').evaluate((image: HTMLImageElement) => image.decode())
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON()
      const img = document.querySelector<HTMLImageElement>('.detail-media > img')!
      return { focus: box('.detail-focus'), related: box('.related-works'), media: box('.detail-media'),
        info: box('.detail-info'), composer: box('.comment-input-row'), img: box('.detail-media > img'),
        fit: getComputedStyle(img).objectFit, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    expect(boxes.overflow).toBe(false)
    expect(boxes.fit).toBe('contain')
    expect(boxes.img.height).toBeGreaterThan(100)
    expect(boxes.img.bottom).toBeLessThanOrEqual(boxes.media.bottom + 1)
    if (width >= 1280) {
      expect(boxes.related.left).toBeGreaterThanOrEqual(boxes.focus.right + 15)
      expect(boxes.related.top).toBeCloseTo(boxes.focus.top, 0)
    } else if (width >= 1000) expect(boxes.related.top).toBeGreaterThanOrEqual(boxes.focus.bottom)
    else {
      await expect(page.getByRole('button', { name: '更多作品', exact: true })).toBeVisible()
      await expect(page.locator('.related-works')).toBeHidden()
    }
    if (width >= 1000) {
      expect(boxes.info.left).toBeGreaterThan(boxes.media.left)
      expect(boxes.composer.bottom).toBeLessThanOrEqual(900)
    } else expect(boxes.focus.height).toBe(848)
    await page.screenshot({ path: `test-results/work-detail-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})

test('desktop comments stay available and failed submission preserves the reply draft', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/work/detailwork')
  await page.getByRole('button', { name: '跳转评论' }).click()
  const input = page.getByRole('textbox', { name: '发表评论', exact: true })
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: '回复', exact: true }).click()
  const reply = page.getByRole('textbox', { name: '回复内容', exact: true })
  await expect(reply).toBeFocused()
  await reply.fill('谢谢分享！')
  state.failComment = true
  await page.getByRole('button', { name: '发布评论', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '评论发送失败' })).toBeVisible()
  await expect(reply).toHaveValue('谢谢分享！')
  await page.getByRole('button', { name: '取消回复' }).click()
  state.failComment = false
  await page.getByRole('button', { name: '发布评论', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.locator('#comment-newcomment')).toContainText('谢谢分享！')
  expect(state.comments).toEqual([
    { text: '谢谢分享！', replyToId: comment.id, fileIds: [] },
    { text: '谢谢分享！', fileIds: [] },
  ])
})

test('prompt disclosure, file navigation, reference images and preview remain usable', async ({ page }) => {
  await fixture(page, { ...work, files: [portrait, landscape], referenceFiles: [{ ...landscape, id: 'reference', name: 'reference.png' }] })
  await page.goto('/work/detailwork')
  await expect(page.getByRole('button', { name: '复制提示词' })).toBeHidden()
  await page.getByText('提示词与作品信息', { exact: true }).click()
  await expect(page.locator('.prompt-section p')).toHaveText(work.prompt)
  await expect(page.getByRole('button', { name: '复制提示词' })).toBeVisible()
  await page.locator('.detail-visual .media-page-controls').getByRole('button', { name: '下一个文件' }).click()
  await expect(page.locator('.detail-media > img')).toHaveAttribute('alt', landscape.name)
  await page.getByRole('button', { name: '预览 reference.png', exact: true }).click()
  await expect(page.locator('.media-page-controls')).toContainText('参考图')
  await page.getByRole('button', { name: '放大预览' }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeHidden()
  await expect(page.getByRole('link', { name: '制作同款' })).toHaveAttribute('href', '/create/image?remix=detailwork&prepare=1')
})

test('related links load another work and browser back restores the original detail', async ({ page }) => {
  await fixture(page)
  await page.goto('/work/detailwork')
  await page.locator('.related-works [data-work-id="related0"] .work-cover').click()
  await expect(page).toHaveURL('/work/related0')
  await expect(page.getByRole('heading', { name: '作品 1', exact: true })).toBeVisible()
  await expect(page.locator('.related-works [data-work-id="related0"]')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible()
})

test('resource content and guest login work when recommendations fail', async ({ page }) => {
  const state = await fixture(page, { ...work, kind: 'resource', cover: '', files: [], body: '资源正文\n'.repeat(100) }, false)
  state.failRelated = true
  await page.goto('/work/detailwork')
  await expect(page.locator('.resource-article')).toContainText('资源正文')
  await expect(page.getByRole('link', { name: '登录后发表评论' })).toHaveAttribute('href', '/account?returnTo=/work/detailwork')
  await expect(page.getByRole('link', { name: '制作同款' })).toHaveAttribute('href', '/create/text?remix=detailwork&prepare=1')
  await expect(page.locator('.related-works')).toHaveCount(0)
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '请先登录' })).toBeVisible()
})

test('detail controls and both themes remain accessible on desktop and mobile', async ({ page }) => {
  await fixture(page)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/work/detailwork')
      await page.evaluate(mode => window.communityAppearance.set({ mode }), colorScheme)
      expect(await page.evaluate(() => window.communityAppearance.mode)).toBe(colorScheme)
      if (width < 1000) await page.getByRole('button', { name: '跳转评论' }).click()
      await expect(page.locator('#comment-firstcomment')).toBeVisible()
      if (width < 1000) await page.getByRole('button', { name: '关闭评论' }).click()
      expect((await new AxeBuilder({ page }).include('.detail-focus').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    }
  }
})
