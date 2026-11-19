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
  const state = { failComment: false, failRelated: false, comments: [] as unknown[], relatedItems: [] as Work[], nextCursor: null as string | null, queries: [] as URL[] }
  const items = [selected, ...Array.from({ length: 24 }, (_, index) => ({
    ...work, id: `related${index}`, title: `作品 ${index + 1}`,
    cover: index % 2 ? landscape.url : portrait.url, coverAspectRatio: index % 2 ? 16 / 9 : 9 / 16,
  }))]
  state.relatedItems = items
  await page.route('**/__detail/*.svg', route => {
    const wide = route.request().url().includes('landscape')
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 800 : 450}" height="${wide ? 450 : 800}"><rect width="100%" height="100%" fill="#60765d"/><rect x="10%" y="10%" width="80%" height="80%" fill="#ccd6c9"/></svg>` })
  })
  await page.route('**/api/works**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/works') {
      state.queries.push(new URL(request.url()))
      return state.failRelated
        ? route.fulfill({ status: 503, json: { message: '暂时无法加载' } })
        : route.fulfill({ json: { items: state.relatedItems, nextCursor: state.nextCursor } })
    }
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
    await page.locator('.detail-media img').evaluate((image: HTMLImageElement) => image.decode())
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON()
      const img = document.querySelector<HTMLImageElement>('.detail-media img')!
      return { focus: box('.detail-focus'), related: box('.related-works'), media: box('.detail-media'),
        info: box('.detail-info'), composer: box('.comment-input-row'), img: box('.detail-media img'),
        fit: getComputedStyle(img).objectFit, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    expect(boxes.overflow).toBe(false)
    expect(boxes.fit).toBe('contain')
    expect(boxes.img.height).toBeGreaterThan(100)
    expect(boxes.img.bottom).toBeLessThanOrEqual(boxes.media.bottom + 1)
    if (width >= 1000) {
      expect(boxes.related.right).toBeLessThanOrEqual(boxes.focus.left - 19)
      expect(Math.abs(boxes.related.top - boxes.focus.top)).toBeLessThan(1)
      expect(boxes.related.width).toBeLessThanOrEqual(260)
      expect(boxes.media.width).toBeGreaterThan(boxes.info.width)
      await expect(page.getByRole('link', { name: '返回发现', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '复制提示词', exact: true })).toBeVisible()
    }
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
  await expect(page.getByRole('button', { name: '复制提示词' })).toBeVisible()
  await expect(page.getByRole('button', { name: '展开全部提示词' })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: '展开全部提示词' }).click()
  await expect(page.getByRole('button', { name: '收起提示词' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.prompt-section p')).toHaveText(work.prompt)
  await expect(page.getByRole('button', { name: '复制提示词' })).toBeVisible()
  await page.locator('.detail-visual .media-page-controls').getByRole('button', { name: '下一个文件' }).click()
  await expect(page.locator('.detail-media img')).toHaveAttribute('alt', landscape.name)
  await page.getByRole('button', { name: '预览 reference.png', exact: true }).click()
  await expect(page.locator('.media-page-controls')).toContainText('参考图')
  await page.getByRole('button', { name: '放大预览' }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeHidden()
  await expect(page.getByRole('button', { name: '制作同款' })).toHaveAttribute('aria-haspopup', 'dialog')
})

test('one finished work and one reference remain visibly separated and independently selectable', async ({ page }) => {
  await fixture(page, { ...work, referenceFiles: [landscape] })
  await page.goto('/work/detailwork')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const results = page.getByRole('region', { name: '作品文件', exact: true })
    const references = page.getByRole('region', { name: '参考图', exact: true })
    await expect(results.getByRole('heading')).toHaveText('作品文件 · 1')
    await expect(references.getByRole('heading')).toHaveText('参考图 · 1')
    await expect(results.getByRole('button')).toHaveCount(1)
    await expect(references.getByRole('button')).toHaveCount(1)
    await expect(page.locator('.detail-media img')).toHaveAttribute('src', portrait.url)
    await references.getByRole('button', { name: `预览 ${landscape.name}`, exact: true }).click()
    await expect(page.locator('.detail-media img')).toHaveAttribute('src', landscape.url)
    if (width < 1000) { await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeVisible(); await page.keyboard.press('Escape') }
    else await expect(page.locator('.media-page-controls')).toContainText('1 / 1 · 参考图')
    await results.getByRole('button', { name: `预览 ${portrait.name}`, exact: true }).click()
    await expect(page.locator('.detail-media img')).toHaveAttribute('src', portrait.url)
    if (width < 1000) { await expect(page.getByRole('dialog', { name: '作品文件预览' })).toBeVisible(); await page.keyboard.press('Escape') }
    else await expect(page.locator('.media-page-controls')).toContainText('1 / 1 · 作品')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
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
  await expect(page.getByRole('button', { name: '制作同款' })).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(page.locator('.related-works')).toContainText('同类作品暂时无法加载。')
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible()
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
      if (width >= 1000) await page.locator('#comment-firstcomment').scrollIntoViewIfNeeded()
      await expect(page.locator('#comment-firstcomment')).toBeVisible()
      if (width < 1000) await page.getByRole('button', { name: '关闭评论' }).click()
      expect((await new AxeBuilder({ page }).include('.detail-focus').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    }
  }
})

test('same-tag recommendations exclude unrelated works, deduplicate and preserve results across a page retry', async ({ page }) => {
  const selected = { ...work, tags: ['摄影', '光影'] }
  const state = await fixture(page, selected)
  const first = { ...work, id: 'matchphoto' }, second = { ...work, id: 'matchlight', tags: ['光影'] }
  state.relatedItems = [selected, first, second, { ...work, id: 'unrelated', tags: ['动漫'] },
    { ...work, id: 'wrongkind', kind: 'video' }, { ...work, id: 'draft', status: 'draft' }, first]
  state.nextCursor = 'nextpage'
  await page.goto('/work/detailwork')
  await expect(page.locator('.related-works .work-card')).toHaveCount(2)
  expect(state.queries[0]!.searchParams.getAll('tag')).toEqual(['摄影', '光影'])
  expect(state.queries[0]!.searchParams.get('kind')).toBe('image')
  expect(state.queries[0]!.searchParams.get('limit')).toBe('20')
  state.failRelated = true
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.related-works [role="alert"]')).toBeVisible()
  await expect(page.locator('.related-works .work-card')).toHaveCount(2)
  state.failRelated = false
  state.relatedItems = [first, { ...work, id: 'thirdmatch' }]
  state.nextCursor = null
  await page.getByRole('button', { name: '重试加载', exact: true }).click()
  await expect(page.locator('.related-works .work-card')).toHaveCount(3)
  expect(state.queries.at(-1)!.searchParams.get('cursor')).toBe('nextpage')
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '更多作品', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '同类作品', exact: true })
  await expect(drawer.getByRole('link', { name: '全部作品', exact: true })).toBeVisible()
  expect((await new AxeBuilder({ page }).include('.mobile-related-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '更多作品', exact: true })).toBeFocused()
})

test('untagged and unmatched works have an honest empty state', async ({ page }) => {
  const state = await fixture(page, { ...work, tags: [] })
  await page.goto('/work/detailwork')
  await expect(page.locator('.related-works')).toContainText('该作品暂无标签')
  expect(state.queries).toHaveLength(0)
  await page.unroute('**/api/works**')
  const tagged = await fixture(page)
  tagged.relatedItems = []
  await page.reload()
  await expect(page.locator('.related-works')).toContainText('暂无相同标签的同类作品。')
})

test('desktop keyboard reaches the action row after the work information', async ({ page }) => {
  await fixture(page)
  await page.goto('/work/detailwork')
  const like = page.locator('.detail-actions .like-work')
  await like.focus()
  await page.keyboard.press('Shift+Tab')
  expect(await page.locator('.detail-info-scroll').evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  await expect(like).toBeFocused()
})

test('mobile work and reference thumbnails open a full-screen viewer with separate controls', async ({ page }) => {
  await fixture(page, { ...work, title: '预览测试作品', author: '测试作者', body: '作品说明', prompt: '测试提示词', referenceFiles: [landscape] }, false)
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/work/detailwork')
    await expect(page.locator('.media-stage > .media-controls')).toHaveCount(0)
    for (const [name, url] of [[portrait.name, portrait.url], [landscape.name, landscape.url]]) {
      const trigger = page.getByRole('button', { name: `预览 ${name}`, exact: true })
      expect(await trigger.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
      })).toBe(true)
      await trigger.click()
      const viewer = page.getByRole('dialog', { name: '作品文件预览', exact: true })
      await expect(viewer).toBeVisible()
      const picture = viewer.locator('img')
      await picture.evaluate((image: HTMLImageElement) => image.decode())
      await expect(picture).toHaveAttribute('src', new URL(url!, page.url()).href)
      const boxes = await viewer.evaluate(element => {
        const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect().toJSON()
        return { dialog: element.getBoundingClientRect().toJSON(), image: box('img'), actions: box('.lightbox-actions'), controls: box('.lightbox-controls') }
      })
      expect(boxes.dialog.width).toBe(width)
      expect(boxes.dialog.height).toBe(height)
      expect(boxes.image.top).toBeGreaterThanOrEqual(boxes.actions.bottom)
      expect(boxes.image.bottom).toBeLessThanOrEqual(boxes.controls.top)
      expect(boxes.image.left).toBeGreaterThanOrEqual(0)
      expect(boxes.image.right).toBeLessThanOrEqual(width)
      await viewer.getByRole('button', { name: '放大', exact: true }).click()
      await expect(viewer.getByRole('status', { name: '缩放比例' })).toHaveText('150%')
      await viewer.getByRole('button', { name: '重置缩放', exact: true }).click()
      await expect(viewer.getByRole('status', { name: '缩放比例' })).toHaveText('100%')
      await viewer.getByRole('button', { name: '关闭预览', exact: true }).click()
      await expect(trigger).toBeFocused()
    }
    await page.getByRole('button', { name: `完整预览 ${landscape.name}`, exact: true }).click()
    await expect(page.getByRole('dialog', { name: '作品文件预览', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  }
})

test('mobile non-image files retain a native original-file link', async ({ page }) => {
  const document = { id: 'guide', name: '使用说明.pdf', type: 'application/pdf', url: '/__detail/guide.pdf' }
  await fixture(page, { ...work, files: [portrait, document] }, false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work/detailwork')
  const link = page.getByRole('link', { name: '预览 使用说明.pdf', exact: true })
  await expect(link).toHaveAttribute('href', document.url)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('closing a mobile thumbnail preview after switching to desktop restores a surviving control', async ({ page }) => {
  await fixture(page, work, false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work/detailwork')
  await page.getByRole('button', { name: `预览 ${portrait.name}`, exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.material-tray')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: `完整预览 ${portrait.name}`, exact: true })).toBeFocused()
})

test('closing a desktop video preview after switching to mobile restores the video thumbnail', async ({ page }) => {
  const clip = { id: 'clip', name: 'clip.mp4', type: 'video/mp4', url: '/__detail/clip.mp4' }
  await fixture(page, { ...work, kind: 'video', files: [clip] }, false)
  await page.route('**/__detail/clip.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/poster-black-intro.mp4' }))
  await page.goto('/work/detailwork')
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.media-stage > .media-controls')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '预览 clip.mp4', exact: true })).toBeFocused()
})
