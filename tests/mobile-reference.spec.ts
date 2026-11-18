import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount, accountUser, fillAccountLogin } from './helpers/account-fixture'

const cover = '/__mobile/cover.svg'
const works = Array.from({ length: 8 }, (_, index) => ({
  id: `mobile${index}`, authorId: accountUser.id, author: accountUser.name, avatar: '创',
  title: `海边的光影 ${index + 1}`, kind: 'image', status: 'published', version: 1,
  fileIds: ['cover'], files: [{ id: 'cover', name: 'cover.svg', type: 'image/svg+xml', url: cover }],
  cover, coverAspectRatio: index % 2 ? 4 / 5 : 3 / 4, tags: ['摄影'],
  prompt: '傍晚，海边，柔和的自然光。', body: '记录日常里的片刻。', model: '测试模型',
  likes: index + 3, date: '2026-11-18T00:00:00Z', owned: true, saved: false, liked: false, repliesCount: 1,
}))
async function fixture(page: Page, authenticated = true, empty = false) {
  const account = await mockUnifiedAccount(page, authenticated)
  const errors: string[] = [], queries: URL[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__mobile/cover.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#719b9e"/><circle cx="420" cy="210" r="100" fill="#f4dbc2"/><path d="M0 440Q180 350 360 460T600 430V800H0Z" fill="#355c62"/><path d="M0 540Q220 450 400 600T600 570V800H0Z" fill="#c0c7ae"/></svg>' }))
  await page.route('**/api/works**', route => {
    const url = new URL(route.request().url()); queries.push(url)
    const selected = works.find(work => url.pathname === `/api/works/${work.id}`)
    if (selected) return route.fulfill({ json: { work: selected } })
    if (url.pathname.endsWith('/comments')) return route.fulfill({ json: { items: [{ id: 'comment1', userId: 'reader', author: '读者', text: '光影真好看。', date: '2026-11-18T00:00:00Z', likesCount: 0, owned: false, removable: false }], nextCursor: null } })
    if (url.pathname.endsWith('/view')) return route.fulfill({ json: { viewsCount: 42 } })
    return route.fulfill({ json: { items: empty ? [] : works, nextCursor: null } })
  })
  await page.route('**/api/library**', route => route.fulfill({ json: { items: works, nextCursor: null } }))
  await page.route(`**/api/users/${accountUser.id}`, route => route.fulfill({ json: { user: { ...accountUser, count: 8, worksCount: 8, followersCount: 18, followingCount: 12, receivedLikesCount: 64, bio: '记录灵感，也分享创作过程。' } } }))
  await page.route('**/api/tags', route => route.fulfill({ json: { items: [{ id: 'photo', name: '摄影' }] } }))
  return { ...account, errors, queries }
}

for (const width of [320, 390, 768]) {
  test(`reference mobile shell, search overlay and accessible empty state at ${width}`, async ({ page }) => {
    const state = await fixture(page, true, true)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/discover')
    await expect(page.getByRole('heading', { name: '这里还没有作品' })).toBeVisible()
    await expect(page.locator('.app-header')).toHaveCSS('height', '52px')
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(23, 36, 38)')
    await expect(page.locator('.mobile-nav > a')).toHaveText(['首页', '创作', '消息', '我'])
    await expect(page.locator('.mobile-nav')).toHaveCSS('height', '58px')
    const top = (await page.locator('main').boundingBox())!.y
    await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
    const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
    await expect(input).toBeFocused()
    expect((await page.locator('main').boundingBox())!.y).toBe(top)
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    await page.getByRole('button', { name: '最新', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('latest')
    await page.getByRole('button', { name: '摄影', exact: true }).click()
    await expect.poll(() => state.queries.some(url => url.searchParams.get('tag') === '摄影' && url.searchParams.get('sort') === 'latest')).toBe(true)
    await input.fill('海边')
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('海边')
    await input.press('Escape')
    await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeFocused()
    await expect(page.locator('.mobile-search-panel')).toBeHidden()
    await expect(page.locator('.active-conditions')).toContainText('海边')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`search-${width}.png`) })
    expect(state.errors).toEqual([])
  })
}

test('mobile bottom publish keeps login return, dirty draft guard and trigger focus', async ({ page }) => {
  await fixture(page, false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/discover?kind=image')
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe('/discover?kind=image&publish=1')
  await expect(page.locator('.account-entry')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-login.png') })
  await fillAccountLogin(page)
  const editor = page.getByRole('dialog', { name: '发布作品', exact: true })
  await expect(editor).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-publish.png') })
  await editor.getByLabel('作品标题', { exact: true }).fill('未保存的创作')
  await page.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
  const guard = page.getByRole('dialog', { name: '保留作品修改？', exact: true })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(editor.getByLabel('作品标题', { exact: true })).toHaveValue('未保存的创作')
  await page.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
  await guard.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeFocused()
})

test('mobile personal page uses own profile, shortcuts, three columns and keyboard/swipe tabs', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/discover')
  await page.locator('.mobile-nav').getByRole('link', { name: '我', exact: true }).click()
  await expect(page.locator('.profile-hero h1')).toHaveText(accountUser.name)
  await expect(page.locator('.mobile-discovery-nav')).toHaveCount(0)
  await expect(page.locator('.profile-works .work-card')).toHaveCount(8)
  expect(await page.locator('.profile-works').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3)
  await page.screenshot({ path: test.info().outputPath('mobile-profile.png') })
  const worksTab = page.getByRole('tab', { name: '作品', exact: true })
  await worksTab.focus(); await worksTab.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '收藏', exact: true })).toBeFocused()
  await expect(page.getByRole('tab', { name: '收藏', exact: true })).toHaveAttribute('aria-selected', 'true')
  const panel = page.getByRole('tabpanel')
  await panel.evaluate(element => {
    const touch = (x: number, y: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY: y })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(280, 300)] }))
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch(100, 310)] }))
  })
  await expect(page.getByRole('tab', { name: '喜欢', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '我的收藏', exact: true }).click()
  await expect(page.getByRole('tab', { name: '收藏', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(state.errors).toEqual([])
})

test('immersive mobile details keep preview, prompt, comments and related navigation usable', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work/mobile0')
  await expect(page.locator('.detail-media > img')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mobile-detail.png') })
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByText('提示词与作品信息', { exact: true }).click()
  await expect(page.getByRole('button', { name: '复制提示词', exact: true })).toBeVisible()
  await page.getByText('提示词与作品信息', { exact: true }).click()
  await page.getByRole('button', { name: '跳转评论', exact: true }).click()
  const comments = page.getByRole('dialog', { name: '评论 · 1', exact: true })
  await expect(comments).toBeVisible()
  await comments.getByRole('textbox', { name: '发表评论', exact: true }).fill('保留评论草稿')
  await page.screenshot({ path: test.info().outputPath('mobile-comments.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '跳转评论', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '跳转评论', exact: true }).click()
  await expect(comments.getByRole('textbox', { name: '发表评论', exact: true })).toHaveValue('保留评论草稿')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '更多作品', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '更多作品', exact: true })).toBeVisible()
  await page.locator('.related-works [data-work-id="mobile1"] .work-cover').click()
  await expect(page).toHaveURL('/work/mobile1')
  await expect(page.getByRole('dialog', { name: '更多作品', exact: true })).toBeHidden()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.detail-info .comment-input-row')).toBeVisible()
  expect(state.errors).toEqual([])
})

test('mobile reference palette, feed and menu remain accessible in both themes', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/discover')
  for (const mode of ['dark', 'light'] as const) {
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    await expect(page.locator('.mobile-discovery-nav').getByRole('link', { name: '视频', exact: true }))
      .toHaveCSS('color', mode === 'dark' ? 'rgb(165, 182, 184)' : 'rgb(86, 98, 89)')
    await expect(page.locator('.work-card')).toHaveCount(8)
    expect((await new AxeBuilder({ page }).include('.community-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`mobile-feed-${mode}.png`) })
    await page.getByTitle('社区工具', { exact: true }).click()
    const menu = page.getByRole('dialog', { name: '社区工具', exact: true })
    await expect(menu).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`mobile-menu-${mode}.png`) })
    expect((await new AxeBuilder({ page }).include('.tools-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: '关闭社区工具', exact: true }).click()
    await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
    await page.getByTitle('社区工具', { exact: true }).click()
    await expect(page.locator('.mobile-search-panel')).toBeHidden()
    await expect(menu).toBeVisible()
    await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
  }
})

test('mobile video controls remain unobstructed and drawers pause playback', async ({ page }) => {
  await fixture(page)
  const clip = await readFile('tests/fixtures/poster-black-intro.mp4')
  await page.route('**/__mobile/clip.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }))
  await page.route('**/api/works/mobile0', route => route.fulfill({ json: { work: { ...works[0], kind: 'video', files: [{ id: 'clip', name: 'clip.mp4', type: 'video/mp4', url: '/__mobile/clip.mp4' }] } } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work/mobile0')
  const video = page.locator('.detail-media > video')
  await expect(video).toBeVisible()
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    expect(await video.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return document.elementFromPoint(bounds.right - 18, bounds.bottom - 20) === element
    })).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; element.loop = true; await element.play() })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await page.getByRole('button', { name: '跳转评论', exact: true }).click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '作品文件预览', exact: true }).locator('video')).toBeVisible()
})
