import { confirmImageDownload } from './helpers/image-download'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import type { Work, WorkComment } from '../src/data'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

const portrait = { id: 'portrait', name: 'portrait.png', type: 'image/png', url: '/assets/__detail/portrait.svg' }
const landscape = { id: 'landscape', name: 'landscape.png', type: 'image/png', url: '/assets/__detail/landscape.svg' }
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
  await page.route('**/assets/__detail/*.svg', route => {
    const wide = route.request().url().includes('landscape')
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 800 : 450}" height="${wide ? 450 : 800}"><rect width="100%" height="100%" fill="#60765d"/><rect x="10%" y="10%" width="80%" height="80%" fill="#ccd6c9"/></svg>` })
  })
  await page.route('**/api/works**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/works') {
      const url = new URL(request.url())
      state.queries.push(url)
      const limit = Number(url.searchParams.get('limit') || 20)
      const start = state.relatedItems.findIndex(item => item.id === url.searchParams.get('cursor')) + 1
      const items = state.relatedItems.slice(start, start + limit)
      const nextCursor = state.nextCursor ?? (start + limit < state.relatedItems.length ? items.at(-1)?.id : null)
      return state.failRelated
        ? route.fulfill({ status: 503, json: { message: '暂时无法加载' } })
        : route.fulfill({ json: { items, nextCursor } })
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

for (const width of [320, 390, 1440]) test(`skill detail exposes installation and downloads without a text-generation action at ${width}px`, async ({ page }) => {
  const skill = { platform: 'ComfyUI', version: '0.3+', installation: '解压技能包\n导入 workflow.json\n<script>alert(1)</script>' }
  const selected: Work = { ...work, kind: 'resource', isSkill: true, prompt: '', body: '上传参考图片后运行工作流。', sourceUrl: 'https://example.com/workflow',
    files: [{ id: 'workflow1', name: 'workflow.json', type: 'application/json', url: '/legacy-files/workflow1' }], generation: { skill } }
  await fixture(page, selected)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/work/detailwork')
  if (width < 1000) await page.getByText('技能与安装信息', { exact: true }).click()
  await expect(page.getByRole('button', { name: '制作同款', exact: true })).toHaveCount(0)
  await expect(page.locator('.work-properties')).toContainText('ComfyUI')
  await expect(page.locator('.work-properties')).toContainText('0.3+')
  await expect(page.getByText(skill.installation, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开资源链接' })).toHaveAttribute('href', selected.sourceUrl!)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.detail-focus').analyze()).violations).toEqual([])
  await page.screenshot({ path: test.info().outputPath(`skill-detail-${width}.png`) })
})

test('manually supplied video parameters are visible on the work detail', async ({ page }) => {
  await fixture(page, { ...work, kind: 'video', generation: { parameters: { version: 1, kind: 'video', size: '1920x1080', aspect_ratio: '16:9', duration: 8.001,
    videoOptions: { resolution: '1080p', seed: '42', customParameters: '{"fps":23.976}' } } } })
  await page.goto('/work/detailwork')
  for (const value of ['1920x1080', '16:9', '8.001', '1080p', '42', '23.976']) await expect(page.locator('.work-properties')).toContainText(value)
})

for (const width of [390, 1440]) for (const format of ['gif', 'webp'] as const) {
  test(`existing ${format} source comments and replies animate inline at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await fixture(page)
    const pixels = Buffer.concat([Buffer.alloc(48 * 48 * 3), Buffer.alloc(48 * 48 * 3, 255)])
    const animated = await sharp(pixels, { raw: { width: 48, height: 96, channels: 3, pageHeight: 48 } })
      .toFormat(format, { delay: [240, 240], loop: 0 }).toBuffer()
    const thumbnail = await sharp(animated).webp().toBuffer()
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2)
    const file = { id: 'commentanimation', name: `同款作品.${format}`, type: `image/${format}`,
      url: '/legacy-files/commentanimation', thumbnailUrl: '/legacy-files/commentanimation?variant=thumbnail', processing: 'ready' as const }
    const reads: string[] = []
    await page.route('**/legacy-files/commentanimation*', route => {
      const url = new URL(route.request().url()); reads.push(url.searchParams.get('variant') || 'original')
      return route.fulfill({ contentType: url.searchParams.get('variant') === 'thumbnail' ? 'image/webp' : file.type,
        body: url.searchParams.get('variant') === 'thumbnail' ? thumbnail : animated })
    })
    await page.route('**/api/works/detailwork/comments**', route => {
      const reply = new URL(route.request().url()).searchParams.has('parentId')
      return route.fulfill({ json: { items: [{ ...comment, id: reply ? 'animationreply' : comment.id,
        text: '我的同款作品', repliesCount: reply ? 0 : 1, files: [file] }], nextCursor: null } })
    })
    await page.goto('/work/detailwork')
    if (width < 640) await page.getByRole('button', { name: '跳转评论', exact: true }).click()
    const posted = page.locator('#comment-firstcomment')
    const image = posted.locator(':scope > .comment-media img')
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveAttribute('src', `${file.url}?variant=original`)
    await expect(image).toHaveAttribute('loading', 'lazy')
    await expect(image.locator('..')).toHaveAttribute('href', file.url)
    await image.evaluate((element: HTMLImageElement) => element.decode())
    const colors = new Set<number>()
    // Screenshots capture displayed animation frames; drawing an animated img to canvas only captures its first frame.
    for (let attempt = 0; attempt < 10 && colors.size < 2; attempt++) {
      const frame = await image.screenshot({ animations: 'allow' })
      const sample = await sharp(frame).resize(1, 1).raw().toBuffer()
      colors.add(sample[0]! > 128 ? 255 : 0)
      if (colors.size < 2) await page.waitForTimeout(80)
    }
    expect(colors.size, 'the visible comment must display distinct animation frames').toBe(2)
    await posted.getByRole('button', { name: '查看 1 条回复', exact: true }).click()
    await expect(page.locator('#comment-animationreply .comment-media img')).toHaveAttribute('src', await image.getAttribute('src') as string)
    expect(reads).not.toContain('thumbnail')
    await page.screenshot({ path: testInfo.outputPath(`comment-animation-${format}-${width}.png`) })
  })
}

test('finishing comment processing never switches an animation back to its still thumbnail', async ({ page }) => {
  await fixture(page); await page.clock.install()
  const file = { id: 'processinganimation', name: '动画.webp', type: 'image/webp', url: '/legacy-files/processinganimation' }
  await page.route('**/legacy-files/processinganimation*', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="teal"/></svg>' }))
  await page.route('**/api/works/detailwork/comments', route => route.fulfill({ json: {
    items: [{ ...comment, files: [{ ...file, processing: 'processing' }] }], nextCursor: null,
  } }))
  let refreshes = 0
  await page.route('**/api/works/detailwork/comments/firstcomment/files', route => {
    refreshes++
    return route.fulfill({ json: { files: [{ ...file, processing: 'ready', thumbnailUrl: `${file.url}?variant=thumbnail` }] } })
  })
  await page.goto('/work/detailwork')
  const posted = page.locator('#comment-firstcomment'), image = posted.locator('.comment-media img')
  await image.scrollIntoViewIfNeeded()
  await expect(image).toHaveAttribute('src', `${file.url}?variant=original`)
  await page.clock.runFor(6000)
  await expect.poll(() => refreshes).toBe(1)
  await expect(posted.getByText('素材处理中', { exact: true })).toHaveCount(0)
  await expect(image).toHaveAttribute('src', `${file.url}?variant=original`)
  await page.clock.runFor(15000); expect(refreshes).toBe(1)
})

test('detail and recommendations adapt without cropping, overlap or horizontal overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  await page.goto('/work/detailwork')
  await expect(page.locator('.related-works .work-card')).toHaveCount(7)
  await page.locator('.related-works').getByRole('button', { name: '加载更多', exact: true }).click()
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

for (const width of [390, 1440]) test(`work images, references and downloads retain the original PNG bytes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const file = { id: 'jpegwork', name: '作品.webp', type: 'image/webp', url: '/legacy-files/jpegwork', processing: 'ready' as const }
  const reference = { ...file, id: 'jpegref', name: '参考图.webp', url: '/legacy-files/jpegref' }
  const original = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#12345680' } }).png().toBuffer()
  await fixture(page, { ...work, files: [file], referenceFiles: [reference] })
  await page.route('**/legacy-files/jpeg*', route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.has('format')).toBe(false)
    if (url.searchParams.get('width') === '96') expect(url.searchParams.get('variant')).toBe('thumbnail')
    else expect(url.searchParams.get('variant')).toBe('original')
    return route.fulfill({ contentType: 'image/png', body: original })
  })
  await page.goto('/work/detailwork')
  await expect(page.locator('.material-thumbnail img').first()).toHaveAttribute('src', '/legacy-files/jpegwork?variant=thumbnail&width=96')
  const img = page.locator('.detail-media img')
  await expect(img).toHaveAttribute('src', '/legacy-files/jpegwork?variant=original')
  await img.evaluate((image: HTMLImageElement) => image.decode())
  if (width > 640) {
    await expect(page.getByRole('button', { name: '下载 作品.webp', exact: true })).toBeVisible()
  }
  await img.click()
  const dialog = page.getByRole('dialog', { name: '作品文件预览', exact: true })
  await expect(dialog.locator('img')).toHaveAttribute('src', '/legacy-files/jpegwork?variant=original')
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  const download = await pending
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  expect(await readFile((await download.path())!)).toEqual(original)
  await dialog.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: '预览 参考图.webp', exact: true }).click()
  if (width > 640) await page.locator('.detail-media img').click()
  await expect(dialog.locator('img')).toHaveAttribute('src', '/legacy-files/jpegref?variant=original')
})

for (const width of [320, 390, 1440]) test(`original and four selectable image formats export real full-size files at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const file = { id: 'formatswork', name: '作品.webp', type: 'image/webp', url: '/legacy-files/formatswork', processing: 'ready' as const }
  const original = await sharp({ create: { width: 123, height: 79, channels: 4, background: { r: 30, g: 100, b: 200, alpha: 0 } } }).webp().toBuffer()
  const jpeg = await sharp(original).flatten({ background: '#fff' }).jpeg().toBuffer()
  const formats = { '原图': 'original', PNG: 'png', WebP: 'webp', 'JPG / JPEG': 'jpeg', GIF: 'gif' } as const
  const requests: string[] = [], downloads: string[] = [], errors: string[] = []
  page.on('download', item => downloads.push(item.suggestedFilename()))
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page, { ...work, files: [file] }, false)
  await page.route('**/legacy-files/formatswork*', async route => {
    const url = new URL(route.request().url()), format = url.searchParams.get('download') as 'original' | 'jpeg' | 'png' | 'webp' | 'gif' | null
    if (!format) return route.fulfill({ contentType: 'image/webp', body: original })
    expect(url.searchParams.get('variant')).toBe('original'); expect(url.searchParams.has('format')).toBe(false)
    requests.push(format)
    if (format === 'original') return route.fulfill({ contentType: 'image/webp', body: original })
    const image = sharp(original)
    return route.fulfill({ contentType: `image/${format}`, body: await (format === 'jpeg' ? image.flatten({ background: '#fff' }).jpeg() : image.toFormat(format)).toBuffer() })
  })
  await page.goto('/work/detailwork')
  if (width > 640) await page.getByRole('button', { name: '下载 作品.webp', exact: true }).click()
  else { await page.locator('.detail-media img').click(); await page.getByRole('button', { name: '下载图片', exact: true }).click() }
  const chooser = page.getByRole('dialog', { name: '选择图片下载格式', exact: true })
  const viewer = page.getByRole('dialog', { name: '作品文件预览', exact: true })
  await expect(chooser.getByRole('radio')).toHaveCount(5)
  await expect(chooser.getByRole('radio', { name: '原图', exact: true })).toBeChecked()
  const box = (await chooser.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width)
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), colorScheme)
    expect((await new AxeBuilder({ page }).include('.image-download-dialog').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`download-formats-${width}-${colorScheme}.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(chooser).not.toBeVisible(); await expect(viewer).toBeVisible()
  expect(requests).toEqual([]); expect(downloads).toEqual([])
  for (const [label, format] of Object.entries(formats)) {
    await viewer.getByRole('button', { name: '下载图片', exact: true }).click()
    const pending = page.waitForEvent('download')
    await confirmImageDownload(page, label)
    const file = await pending
    const exportedFormat = format === 'original' ? 'webp' : format
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${exportedFormat === 'jpeg' ? 'jpg' : exportedFormat}$`))
    const data = await readFile((await file.path())!), metadata = await sharp(data).metadata()
    expect(metadata).toMatchObject({ format: exportedFormat, width: 123, height: 79 })
    if (format === 'original') expect(data).toEqual(original)
    expect((await sharp(data).ensureAlpha().raw().toBuffer())[3]).toBe(format === 'jpeg' ? 255 : 0)
  }
  expect(requests).toEqual(Object.values(formats)); expect(errors).toEqual([])
})

test('original image failures terminate with a visible retry action', async ({ page }) => {
  const file = { id: 'jpegfailed', name: '作品.webp', type: 'image/webp', url: '/legacy-files/jpegfailed', processing: 'ready' as const }
  await page.route('**/__jpeg-failure', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main></main>' }))
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  let reads = 0
  await page.route('**/legacy-files/jpegfailed*', route => { reads++; return route.fulfill({ status: 503 }) })
  await page.goto('/__jpeg-failure')
  await page.evaluate(async file => {
    const vuePath = '/node_modules/.vite/deps/vue.js', componentPath = '/src/components/WorkMedia.vue'
    const { createApp } = await import(vuePath), { default: WorkMedia } = await import(componentPath)
    createApp(WorkMedia, { files: [file], title: '失败重试' }).mount('main')
  }, file)
  await expect(page.locator('.detail-media')).toContainText('文件预览加载失败')
  await expect(page.locator('.detail-media').getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  expect(reads).toBe(1)
})

const scrollbarTest = test.extend({
  launchOptions: async ({ launchOptions }, use) => use({ ...launchOptions, ignoreDefaultArgs: ['--hide-scrollbars'] }),
})
scrollbarTest('related thumbnails settle at the scrollbar boundary and remain stable after scrolling and drawer changes', async ({ page }) => {
  const state = await fixture(page)
  state.relatedItems = Array.from({ length: 6 }, (_, index) => ({ ...work, id: `related${index}` }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/work/detailwork')
  await expect(page.locator('.related-grid .work-card')).toHaveCount(6)
  await page.locator('.related-grid img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))

  async function expectStable() {
    const frames = await page.locator('.related-content').evaluate(async content => {
      const samples: number[][] = []
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame)
        if (frame < 8) continue
        const cards = Array.from(content.querySelectorAll('.work-card')).flatMap(card => {
          const box = card.getBoundingClientRect()
          return [box.x, box.y + content.scrollTop, box.width, box.height]
        })
        samples.push([content.clientWidth, content.scrollHeight, ...cards])
      }
      return samples
    })
    const movement = frames[0]!.map((_, index) => Math.max(...frames.map(frame => frame[index]!)) - Math.min(...frames.map(frame => frame[index]!)))
    expect(Math.max(...movement), 'idle thumbnails must not alternate between layouts').toBeLessThanOrEqual(0.5)
  }

  await expectStable()
  await page.setViewportSize({ width: 1440, height: 760 })
  const content = page.locator('.related-content')
  await content.hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expectStable()
  for (const width of [1280, 2560, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 1000) await page.getByRole('button', { name: '更多作品', exact: true }).click()
    await expect(content).toBeVisible()
    await expectStable()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width < 1000) await page.getByRole('button', { name: '关闭更多作品', exact: true }).click()
  }
})

test('an owned comment can be deleted through the confirmation dialog with a valid JSON request', async ({ page }) => {
  await fixture(page)
  let deleted = false, attempts = 0
  await page.route('**/api/works/detailwork/comments', route => route.fulfill({ json: { items: deleted ? [] : [{ ...comment, owned: true, removable: true }], nextCursor: null } }))
  await page.route('**/api/works/detailwork/comments/firstcomment', route => {
    const request = route.request()
    attempts++
    if (request.method() !== 'DELETE' || request.headers()['content-type'] !== 'application/json') return route.fulfill({ status: 415, json: { message: '请使用正确的请求格式提交。' } })
    expect(request.postDataJSON()).toEqual({})
    expect(request.headers()['x-csrf-token']).toBeTruthy()
    deleted = true
    return route.fulfill({ json: { deleted: true } })
  })
  await page.goto('/work/detailwork')
  await page.getByRole('button', { name: '删除评论', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '删除评论确认' })
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#comment-firstcomment')).toHaveCount(0)
  expect(attempts).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible()
  await expect(page.locator('#comment-firstcomment')).toHaveCount(0)
})

test('desktop comments preserve failed replies separately from the next draft', async ({ page }) => {
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
  const pending = page.locator('.pending-comment')
  await expect(pending).toContainText('谢谢分享！')
  await expect(pending).toContainText('回复 读者')
  await input.fill('这是下一条草稿')
  state.failComment = false
  await pending.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(pending).toHaveCount(0)
  await expect(input).toHaveValue('这是下一条草稿')
  await expect(page.getByRole('status').filter({ hasText: '评论已发送' })).toBeVisible()
  expect(state.comments).toEqual([
    { text: '谢谢分享！', replyToId: comment.id, fileIds: [] },
    { text: '谢谢分享！', replyToId: comment.id, fileIds: [] },
  ])
})

const uploadPng = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS2kAAAAASUVORK5CYII=', 'base64') }
async function uploadLimits(page: Page) {
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 30, videosMb: 100, filesMb: 30, maxFileSizeMb: 100 } }))
}

test('comment uploads preview immediately and save before posting while the next draft remains editable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const state = await fixture(page); await uploadLimits(page)
  await page.addInitScript(() => {
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function(body) {
      if (body instanceof FormData) (window as Window & { commentUpload?: XMLHttpRequest }).commentUpload = this
      return send.call(this, body)
    }
  })
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/uploads', async route => {
    expect(route.request().headers()['x-csrf-token']).toBe('unified-account-fixture')
    await hold
    await route.fulfill({ json: { file: { id: 'uploaded1', name: uploadPng.name, type: uploadPng.mimeType, url: portrait.url, size: 100, processing: 'pending' } } })
  })
  await page.goto('/work/detailwork')
  await page.getByLabel('评论附件', { exact: true }).setInputFiles(uploadPng)
  const attachment = page.locator('.comment-composer .comment-attachments')
  await expect(attachment.locator('img')).toHaveAttribute('src', /^blob:/)
  // Intercepted uploads send no bytes; feed native progress events while holding the server response.
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { commentUpload?: XMLHttpRequest }).commentUpload))).toBe(true)
  await page.evaluate(() => (window as Window & { commentUpload?: XMLHttpRequest }).commentUpload!.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 50, total: 100 })))
  await expect(attachment).toContainText('上传中 50%')
  await expect(attachment.getByRole('progressbar')).toHaveAttribute('value', '50')
  await page.evaluate(() => (window as Window & { commentUpload?: XMLHttpRequest }).commentUpload!.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 100, total: 100 })))
  await expect(attachment).toContainText('正在保存')
  const input = page.getByRole('textbox', { name: '发表评论', exact: true })
  await input.fill('带素材的评论')
  await page.getByRole('button', { name: '发布评论', exact: true }).click()
  const pending = page.locator('.pending-comment')
  await expect(pending).toContainText('等待附件上传')
  expect(state.comments).toHaveLength(0)
  await input.fill('下一条内容')
  await page.setViewportSize({ width: 390, height: 900 })
  await page.getByRole('button', { name: '跳转评论' }).click()
  await expect(input).toBeEnabled(); await expect(pending).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.mobile-comments-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await page.screenshot({ path: 'test-results/comment-upload-mobile.png', fullPage: true })
  release()
  await expect(pending).toHaveCount(0)
  await expect(input).toHaveValue('下一条内容')
  expect(state.comments).toEqual([{ text: '带素材的评论', fileIds: ['uploaded1'] }])
  await expect(page.getByRole('status').filter({ hasText: '评论已发送' })).toBeVisible()
  expect(errors).toEqual([])
})

test('failed comment uploads stay retryable and successful files are reused after send failure', async ({ page }) => {
  const state = await fixture(page); await uploadLimits(page)
  let uploads = 0
  await page.route('**/api/uploads', route => {
    uploads++
    return uploads === 1 ? route.fulfill({ status: 503, json: { message: '素材保存失败' } })
      : route.fulfill({ json: { file: { id: 'uploaded1', name: uploadPng.name, type: uploadPng.mimeType, url: portrait.url, size: 100 } } })
  })
  await page.goto('/work/detailwork')
  await page.getByLabel('评论附件', { exact: true }).setInputFiles(uploadPng)
  await expect(page.locator('.comment-composer')).toContainText('上传失败')
  await page.getByRole('button', { name: '发布评论', exact: true }).click()
  const pending = page.locator('.pending-comment')
  await expect(pending).toHaveAttribute('data-send-state', 'failed')
  expect(state.comments).toHaveLength(0)
  state.failComment = true
  await pending.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(pending).toContainText('评论发送失败')
  expect(uploads).toBe(2)
  state.failComment = false
  await pending.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(pending).toHaveCount(0)
  expect(uploads).toBe(2); expect(state.comments).toHaveLength(2)
  expect(state.comments[0]).toEqual(state.comments[1])
})

test('unfinished comments warn before route changes and can be kept or discarded', async ({ page }) => {
  await fixture(page); await page.goto('/work/detailwork')
  const input = page.getByRole('textbox', { name: '发表评论', exact: true })
  await input.fill('不能丢失的草稿')
  await page.locator('.related-works [data-work-id="related0"] .work-cover').click()
  const dialog = page.getByRole('dialog', { name: '评论尚未保存' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL('/work/detailwork'); await expect(input).toHaveValue('不能丢失的草稿')
  await page.locator('.related-works [data-work-id="related0"] .work-cover').click()
  await dialog.getByRole('button', { name: '放弃并离开', exact: true }).click()
  await expect(page).toHaveURL('/work/related0'); await expect(input).toHaveValue('')
})

test('visible comment media updates processing status and stops polling when ready', async ({ page }) => {
  await fixture(page); await page.clock.install()
  await page.route('**/api/works/detailwork/comments', route => route.fulfill({ json: { items: [{ ...comment, files: [{ ...portrait, processing: 'processing' }] }], nextCursor: null } }))
  let refreshes = 0
  await page.route('**/api/works/detailwork/comments/firstcomment/files', route => {
    refreshes++; return route.fulfill({ json: { files: [{ ...portrait, processing: 'ready' }] } })
  })
  await page.goto('/work/detailwork')
  const posted = page.locator('#comment-firstcomment')
  await posted.scrollIntoViewIfNeeded(); await expect(posted).toContainText('素材处理中')
  await page.clock.runFor(6000)
  await expect.poll(() => refreshes).toBe(1)
  await expect(posted.getByText('素材处理中', { exact: true })).toHaveCount(0)
  await page.clock.runFor(15000); expect(refreshes).toBe(1)
  await page.screenshot({ path: 'test-results/comment-upload-desktop.png', fullPage: true })
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
  const saves: boolean[] = []
  await page.route('**/api/works/detailwork/save', route => {
    const { active } = route.request().postDataJSON()
    saves.push(active)
    return route.fulfill({ json: { work: { ...work, saved: active } } })
  })
  await page.goto('/work/detailwork')
  await expect(page.locator('.resource-article')).toContainText('资源正文')
  await expect(page.getByRole('link', { name: '登录后发表评论' })).toHaveAttribute('href', '/account?returnTo=/work/detailwork')
  await expect(page.getByRole('button', { name: '制作同款' })).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(page.locator('.related-works')).toContainText('同类作品暂时无法加载。')
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '登录后收藏', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/account' && url.searchParams.get('returnTo') === '/work/detailwork')
  await fillAccountLogin(page)
  await expect(page).toHaveURL('/work/detailwork')
  const bookmark = page.getByRole('button', { name: '收藏', exact: true })
  await expect(bookmark).toHaveAttribute('aria-pressed', 'false')
  expect(saves).toEqual([])
  await bookmark.click()
  const saved = page.getByRole('button', { name: '已收藏', exact: true })
  await expect(saved).toHaveAttribute('aria-pressed', 'true')
  await saved.click()
  await expect(bookmark).toHaveAttribute('aria-pressed', 'false')
  expect(saves).toEqual([true, false])
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

test('mobile recommendations first load on opening and keep results on reopening', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await fixture(page)
  await page.goto('/work/detailwork')
  const trigger = page.getByRole('button', { name: '更多作品', exact: true })
  await expect(trigger).toBeVisible()
  expect(state.queries).toHaveLength(0)
  await trigger.click()
  await expect(page.locator('.related-grid .work-card').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await trigger.click()
  await expect(page.locator('.related-grid .work-card').first()).toBeVisible()
  expect(state.queries).toHaveLength(1)
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
  expect(state.queries[0]!.searchParams.get('limit')).toBe('8')
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
  expect(state.queries.at(-1)!.searchParams.get('limit')).toBe('20')
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
      await expect(viewer.getByRole('status', { name: '缩放比例' })).toHaveText('120%')
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
  const document = { id: 'guide', name: '使用说明.pdf', type: 'application/pdf', url: '/assets/__detail/guide.pdf' }
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
  const clip = { id: 'clip', name: 'clip.mp4', type: 'video/mp4', url: '/assets/__detail/clip.mp4' }
  await fixture(page, { ...work, kind: 'video', files: [clip] }, false)
  await page.route('**/assets/__detail/clip.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/poster-black-intro.mp4' }))
  await page.goto('/work/detailwork')
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.media-stage > .media-controls')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '预览 clip.mp4', exact: true })).toBeFocused()
})
