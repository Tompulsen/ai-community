import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
import type { Work } from '../src/data'

const image: Work = {
  id: 'grid-image', authorId: 'grid-creator', version: 1, fileIds: [], kind: 'image',
  title: '完整作品封面', author: '预览创作者', avatar: '创', cover: '/__preview-fixtures/cover.svg',
  tags: [], prompt: '保留完整画面与细节。', model: '模型', likes: 3, date: '2026-11-12T00:00:00Z',
  owned: false, liked: false, saved: false, status: 'published',
}
const resource: Work = {
  ...image, id: 'grid-resource', kind: 'resource', title: '可读的创作记录', cover: '',
  tags: ['Skill'], body: '第一段记录创作步骤。\n第二段保留参数与判断依据。',
}
const localCover = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#60765d"/><rect x="80" y="100" width="480" height="600" fill="#ccd6c9"/></svg>'

async function fixture(page: Page, brokenImage = false, items = [image, resource]) {
  const writes: string[] = []
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://localhost:18775') return route.abort()
    if (url.pathname === '/__preview-fixtures/cover.svg') {
      const ratio = url.searchParams.get('shape') === 'landscape' ? 2
        : items.find(work => work.cover === url.pathname + url.search)?.coverAspectRatio ?? 4 / 5
      const cover = localCover.replaceAll('width="640"', `width="${Math.round(800 * ratio)}"`)
      return brokenImage
        ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing fixture image' })
        : route.fulfill({ contentType: 'image/svg+xml', body: cover })
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() !== 'GET') {
      if (request.method() === 'POST' && url.pathname.endsWith('/view')) return route.fulfill({ json: { viewsCount: 1 } })
      writes.push(`${request.method()} ${url.pathname}`)
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: { user: null } })
    if (url.pathname === '/api/works') return route.fulfill({ json: { items, nextCursor: null } })
    const selected = items.find(work => url.pathname === `/api/works/${work.id}`)
    if (selected) return route.fulfill({ json: { work: selected } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return writes
}

async function openWork(page: Page, work = image) {
  const cover = page.locator(`.work-card[data-work-id="${work.id}"] .work-cover`)
  await cover.click()
  await expect(page).toHaveURL(`/work/${work.id}`)
  await expect(page.getByRole('heading', { name: work.title, exact: true }).first()).toBeVisible()
  await expect(page.locator('.work-grid-preview')).toHaveCount(0)
}

for (const width of [1440, 390]) {
  test(`work cards open details directly by click and keyboard at ${width}px`, async ({ page }) => {
    const writes = await fixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await openWork(page)
    await page.goBack()
    const cover = page.locator(`[data-work-id="${image.id}"] .work-cover`)
    await expect(cover).toHaveAttribute('href', `/work/${image.id}`)
    await expect(cover).not.toHaveAttribute('aria-haspopup')
    await cover.focus()
    await cover.press('Enter')
    await expect(page).toHaveURL(`/work/${image.id}`)
    await expect(page.getByRole('heading', { name: image.title, exact: true }).first()).toBeVisible()
    expect(writes).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('reduced motion preserves direct navigation', async ({ page }) => {
  await fixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/discover')
  await expectWobble(page.locator(`[data-work-id="${image.id}"]`))
  await openWork(page)
})

test('cover proportions fill aligned cards without reordering works across breakpoints', async ({ page }) => {
  const ratios = [16 / 9, 16 / 9, 16 / 9, 16 / 9, 16 / 9, 9 / 16, 4 / 5, 16 / 9, 1, 16 / 9]
  const items = ratios.map((coverAspectRatio, index) => ({
    ...image, id: `proportion-${index}`, cover: `${image.cover}?item=${index}`, coverAspectRatio, kind: index === 3 ? 'video' as const : 'image' as const,
  }))
  await fixture(page, false, items)
  await page.goto('/discover')
  const cards = page.locator('.bento-grid > .work-card')
  await expect(cards).toHaveCount(items.length)
  for (const width of [1440, 1100, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const columns = width >= 1200 ? 5 : width >= 1000 ? 4 : width >= 640 ? 2 : 1
    let filled = 0
    const spans = ratios.map(ratio => {
      const span = columns >= 4 && ratio > 1 && filled < columns - 1 ? 2 : 1
      filled = (filled + span) % columns
      return span
    })
    await expect.poll(() => cards.evaluateAll(elements => elements.map(element => getComputedStyle(element).gridColumnStart))).toEqual(spans.map(span => `span ${span}`))
    const layout = await page.locator('.bento-grid').evaluate(grid => {
      const bounds = grid.getBoundingClientRect()
      return {
        width: bounds.width, left: bounds.left, top: bounds.top,
        items: Array.from(grid.children).map(element => {
          const box = element.getBoundingClientRect()
          const cover = element.querySelector('.work-cover > img, .work-cover > video')!
          const coverBox = cover.getBoundingClientRect()
          return { id: element.getAttribute('data-work-id'), left: box.left, top: box.top, width: box.width, height: box.height,
            fit: getComputedStyle(cover).objectFit, coverWidth: coverBox.width, coverHeight: coverBox.height }
        }),
      }
    })
    const columnWidth = (layout.width - (columns - 1) * 16) / columns
    expect(layout.items.map(item => item.id)).toEqual(items.map(item => item.id))
    let row = 0, column = 0
    for (const [index, item] of layout.items.entries()) {
      const span = spans[index]!
      expect(item.width).toBeCloseTo(columnWidth * span + (span - 1) * 16, 1)
      expect(item.height).toBeCloseTo(columnWidth * 5 / 4, 1)
      expect(item.left).toBeCloseTo(layout.left + column * (columnWidth + 16), 1)
      expect(item.top).toBeCloseTo(layout.top + row * (columnWidth * 5 / 4 + 16), 1)
      expect(item.fit).toBe('cover')
      expect(item.coverWidth).toBeCloseTo(item.width, 1)
      expect(item.coverHeight).toBeCloseTo(item.height, 1)
      column += span
      if (column === columns) { row++; column = 0 }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await openWork(page, items[0]!)
})

test('legacy portrait covers keep 4:5 small cards without server dimensions', async ({ page }) => {
  const items = Array.from({ length: 8 }, (_, index) => ({ ...image, id: `legacy-portrait-${index}` }))
  await fixture(page, false, items)
  await page.goto('/discover')
  const card = page.locator(`[data-work-id="${items[5]!.id}"]`)
  await card.locator('.work-cover > img').evaluate((img: HTMLImageElement) => img.decode())
  await expect(card).toHaveCSS('grid-column-start', 'span 1')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const box = await card.boundingBox()
    expect(box!.width / box!.height).toBeCloseTo(4 / 5, 2)
  }
  await openWork(page, items[5]!)
})

test('legacy landscape covers use their actual image dimensions', async ({ page }) => {
  const landscape = { ...image, id: 'legacy-landscape', cover: `${image.cover}?shape=landscape` }
  await fixture(page, false, [landscape, image])
  await page.goto('/discover')
  const card = page.locator(`[data-work-id="${landscape.id}"]`)
  await card.locator('.work-cover > img').evaluate((img: HTMLImageElement) => img.decode())
  await expect(card).toHaveCSS('grid-column-start', 'span 2')
  await openWork(page, landscape)
})

test('a failed cover still links to the full work', async ({ page }) => {
  await fixture(page, true)
  await page.goto('/discover')
  await expect(page.locator(`[data-work-id="${image.id}"] .work-cover`)).toContainText('封面加载失败')
  expect((await new AxeBuilder({ page }).include('.bento-grid').analyze()).violations).toEqual([])
  await openWork(page)
})

test('resource covers navigate directly to readable content', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  await openWork(page, resource)
  await expect(page.getByText('第一段记录创作步骤。', { exact: false })).toBeVisible()
  await expect(page.getByText('第二段保留参数与判断依据。', { exact: false })).toBeVisible()
})

test('guest likes and saves retain authentication feedback without navigating', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/discover')
  const card = page.locator(`.work-card[data-work-id="${image.id}"]`)
  const like = card.getByRole('button', { name: `喜欢：${image.title}，${image.likes} 赞`, exact: true })
  const save = card.getByRole('button', { name: `收藏：${image.title}`, exact: true })
  for (const action of [like, save]) {
    await action.click()
    await expect(page.getByRole('status').filter({ hasText: '请先登录后再操作。' })).toBeVisible()
    await expect(action).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.work-grid-preview')).toHaveCount(0)
    await expect(page).toHaveURL(/\/discover$/)
  }
  await expect(card.locator('.work-author')).toHaveAttribute('href', `/community?creator=${image.authorId}`)
  expect(writes).toEqual([])
})

function captureRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

async function expectWobble(card: Locator, x = 0, y = 0, scale = 1) {
  await expect.poll(() => card.evaluate((element, expected) => {
    const outer = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    const inner = new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.work-card-content')!).transform)
    const media = element.querySelector('.work-cover > img, .work-cover > video, .work-cover > .media-placeholder')
    const mediaTransform = media ? new DOMMatrixReadOnly(getComputedStyle(media).transform) : undefined
    return Math.max(
      Math.abs(outer.m41 - expected.x), Math.abs(outer.m42 - expected.y),
      Math.abs(inner.m41), Math.abs(inner.m42),
      100 * Math.abs(inner.m11 - 1), 100 * Math.abs(inner.m22 - 1),
      ...(mediaTransform ? [
        Math.abs(mediaTransform.m41 + expected.x * 0.35), Math.abs(mediaTransform.m42 + expected.y * 0.35),
        100 * Math.abs(mediaTransform.m11 - expected.scale), 100 * Math.abs(mediaTransform.m22 - expected.scale),
      ] : []),
    )
  }, { x, y, scale })).toBeLessThan(0.02)
}

test('wobble follows small and wide cards without drifting or moving the grid in either color scheme', async ({ page }) => {
  const errors = captureRuntimeErrors(page)
  const landscape = { ...image, id: 'wobble-landscape', cover: `${image.cover}?shape=landscape`, coverAspectRatio: 2 }
  await fixture(page, false, [image, landscape, resource])
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' })
    await page.goto('/discover')
    const grid = page.locator('.bento-grid')
    await expect(grid.locator('.work-card')).toHaveCount(3)
    const layout = () => grid.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return {
        left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
        columns: getComputedStyle(element).gridTemplateColumns,
        cards: Array.from(element.children, child => {
          const card = child as HTMLElement
          return [card.offsetLeft, card.offsetTop, card.offsetWidth, card.offsetHeight]
        }),
      }
    })
    const baseline = await layout()
    const neighbor = page.locator(`[data-work-id="${resource.id}"]`)
    const neighborBounds = await neighbor.boundingBox()
    for (const work of [image, landscape]) {
      const card = page.locator(`[data-work-id="${work.id}"]`)
      await expect(card).toHaveCSS('grid-column-start', work === image ? 'span 1' : 'span 2')
      const bounds = (await card.boundingBox())!
      const corners = await card.evaluate(element => ({
        radius: element.getAttribute('data-corner-radius'), smoothing: element.getAttribute('data-corner-smoothing'),
        clip: getComputedStyle(element).clipPath,
      }))
      expect(corners.radius).toBe('32')
      expect(corners.smoothing).toBe('0.6')
      expect(corners.clip).not.toBe('none')
      await expect(card.locator('.work-card-content')).toHaveCSS('border-radius', '0px')
      await expect(card.locator('.work-card-content')).toHaveCSS('clip-path', 'none')
      for (const point of [{ x: 0.2, y: 0.25 }, { x: 0.8, y: 0.7 }, { x: 0.06, y: 0.04 }, { x: 0.94, y: 0.04 }, { x: 0.06, y: 0.96 }, { x: 0.94, y: 0.96 }]) {
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await expectWobble(card, 0, 0, 1.06)
        const x = bounds.x + bounds.width * point.x, y = bounds.y + bounds.height * point.y
        const offsetX = Math.max(-12, Math.min(12, (x - bounds.x - bounds.width / 2) / 12))
        const offsetY = Math.max(-12, Math.min(12, (y - bounds.y - bounds.height / 2) / 12))
        for (let repeat = 0; repeat < 3; repeat++) {
          await page.mouse.move(x, y)
          await expectWobble(card, offsetX, offsetY, 1.06)
        }
        const geometry = await card.evaluate(element => ({
          card: element.getBoundingClientRect().toJSON(),
          content: element.querySelector('.work-card-content')!.getBoundingClientRect().toJSON(),
          shade: (() => {
            const style = getComputedStyle(element.querySelector('.work-card-content')!, '::before')
            return { left: parseFloat(style.left), right: parseFloat(style.right), bottom: parseFloat(style.bottom), width: parseFloat(style.width) }
          })(),
          media: element.querySelector('.work-cover > img')!.getBoundingClientRect().toJSON(),
          controls: Array.from(element.querySelectorAll('.save-work, .like-button'), control => control.getBoundingClientRect().toJSON()),
          translation: new DOMMatrixReadOnly(getComputedStyle(element).transform).toJSON(),
        }))
        expect(Math.abs(geometry.translation.m41)).toBeLessThanOrEqual(12)
        expect(Math.abs(geometry.translation.m42)).toBeLessThanOrEqual(12)
        for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
          expect(geometry.content[edge]).toBeCloseTo(geometry.card[edge], 1)
        }
        expect(geometry.shade.left).toBeLessThanOrEqual(0)
        expect(geometry.shade.right).toBeLessThanOrEqual(0)
        expect(geometry.shade.bottom).toBeLessThanOrEqual(0)
        expect(geometry.shade.width).toBeGreaterThanOrEqual(geometry.card.width - 0.01)
        expect(geometry.media.left).toBeLessThanOrEqual(geometry.card.left + 0.1)
        expect(geometry.media.top).toBeLessThanOrEqual(geometry.card.top + 0.1)
        expect(geometry.media.right).toBeGreaterThanOrEqual(geometry.card.right - 0.1)
        expect(geometry.media.bottom).toBeGreaterThanOrEqual(geometry.card.bottom - 0.1)
        for (const control of geometry.controls) {
          expect(control.left).toBeGreaterThanOrEqual(geometry.card.left)
          expect(control.top).toBeGreaterThanOrEqual(geometry.card.top)
          expect(control.right).toBeLessThanOrEqual(geometry.card.right)
          expect(control.bottom).toBeLessThanOrEqual(geometry.card.bottom)
        }
        expect(await layout()).toEqual(baseline)
        expect(await neighbor.boundingBox()).toEqual(neighborBounds)
        await expect(card).toHaveCSS('clip-path', corners.clip)
      }
      await page.mouse.move(4, 4)
      await expectWobble(card)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

for (const deviceScaleFactor of [1.25, 1.75, 2]) {
  test.describe(`card edge pixels at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor })

    test('hovered media stays shaded through the bottom edge at fractional card heights', async ({ page }) => {
      const landscape = { ...image, id: 'pixel-landscape', cover: `${image.cover}?shape=landscape`, coverAspectRatio: 2 }
      await fixture(page, false, [image, landscape])
      await page.route('**/__preview-fixtures/cover.svg*', route => {
        const width = new URL(route.request().url()).searchParams.get('shape') === 'landscape' ? 1600 : 640
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="800"><rect width="100%" height="100%" fill="white"/></svg>`,
        })
      })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.setViewportSize({ width: 1438, height: 900 })
      await page.goto('/discover')
      for (const width of [1438, 1439, 1440]) {
        await page.mouse.move(4, 4)
        await page.setViewportSize({ width, height: 900 })
        for (const work of [image, landscape]) {
          const card = page.locator(`[data-work-id="${work.id}"]`)
          await card.locator('.work-cover > img').evaluate((element: HTMLImageElement) => element.decode())
          await expect(card).toHaveCSS('grid-column-start', work === image ? 'span 1' : 'span 2')
          await page.mouse.move(4, 4)
          await expectWobble(card)
          const bounds = (await card.boundingBox())!
          await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.85)
          await expectWobble(card, Math.min(12, bounds.width * 0.35 / 12), Math.min(12, bounds.height * 0.35 / 12), 1.06)
          const hovered = (await card.boundingBox())!
          const { data, info } = await sharp(await page.screenshot({ scale: 'device' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          const x = Math.round((hovered.x + hovered.width / 2) * deviceScaleFactor)
          const bottom = (hovered.y + hovered.height) * deviceScaleFactor
          let brightest = 0
          for (let y = Math.floor(bottom - 3 * deviceScaleFactor); y <= Math.ceil(bottom) + 2; y++) {
            const offset = (y * info.width + x) * info.channels
            brightest = Math.max(brightest, data[offset]!, data[offset + 1]!, data[offset + 2]!)
          }
          expect(brightest, `${work.id}, ${width}px, DPR ${deviceScaleFactor}`).toBeLessThanOrEqual(54)
        }
      }
    })
  })
}

test('hovered cards navigate directly and wobble still works after returning', async ({ page }) => {
  const errors = captureRuntimeErrors(page)
  const writes = await fixture(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/discover')
  const card = page.locator(`[data-work-id="${image.id}"]`)
  const bounds = (await card.boundingBox())!
  const point = { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height * 0.3 }
  await page.mouse.move(point.x, point.y)
  await expectWobble(card, -bounds.width / 48, -bounds.height / 60, 1.06)
  await page.mouse.click(point.x, point.y)
  await expect(page).toHaveURL(`/work/${image.id}`)
  await expect(page.getByRole('heading', { name: image.title, exact: true }).first()).toBeVisible()
  await expect(page.locator('.work-grid-preview')).toHaveCount(0)
  await page.mouse.move(4, 4)
  await page.goBack()
  await expect(card).toBeVisible()
  await page.mouse.move(4, 4)
  await page.mouse.move(point.x, point.y)
  await expectWobble(card, -bounds.width / 48, -bounds.height / 60, 1.06)
  await page.mouse.move(4, 4)
  await expectWobble(card)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})

test('changing reduced motion stops wobble and preserves navigation', async ({ page }) => {
  const errors = captureRuntimeErrors(page)
  await fixture(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/discover')
  const card = page.locator(`[data-work-id="${image.id}"]`)
  const bounds = (await card.boundingBox())!
  const point = { x: bounds.x + bounds.width * 0.75, y: bounds.y + bounds.height * 0.3 }
  await page.mouse.move(point.x, point.y)
  await expectWobble(card, bounds.width / 48, -bounds.height / 60, 1.06)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expectWobble(card)
  await page.mouse.move(point.x - 4, point.y + 4)
  await expectWobble(card)
  await openWork(page)
  await page.goBack()
  await expect(card).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(4, 4)
  await page.mouse.move(point.x, point.y)
  await expectWobble(card, bounds.width / 48, -bounds.height / 60, 1.06)
  await card.dispatchEvent('pointercancel', { pointerType: 'mouse' })
  await expectWobble(card)
  expect(errors).toEqual([])
})

test.describe('touch card interaction', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('touch cards stay still and navigate directly on tap', async ({ page }) => {
    const errors = captureRuntimeErrors(page)
    await fixture(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/discover')
    const card = page.locator(`[data-work-id="${image.id}"]`)
    const bounds = (await card.boundingBox())!
    const point = { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height * 0.3 }
    await page.mouse.move(point.x, point.y)
    await expectWobble(card)
    await page.touchscreen.tap(point.x, point.y)
    await expect(page).toHaveURL(`/work/${image.id}`)
    await expect(page.getByRole('heading', { name: image.title, exact: true }).first()).toBeVisible()
    await expect(page.locator('.work-grid-preview')).toHaveCount(0)
    await page.goBack()
    await expect(card).toBeVisible()
    await expectWobble(card)
    expect(errors).toEqual([])
  })
})
