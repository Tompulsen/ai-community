import { test, expect } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

test('legacy media stays in its canonical conversation across mode switches', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let generations = 0
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (path === '/api/creation/generate') generations++
    return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
    ] } })
  })
  await page.addInitScript(() => {
    const now = Date.now()
    const task = (id: string, kind: string, prompt: string, createdAt: number, conversationId = id) => ({
      id, conversationId, owner: '17', kind, model: kind === 'video' ? 'sora-2' : 'gpt-image-2', prompt,
      createdAt, settledAt: createdAt, phase: 'complete', protocol: 'sync', references: [],
      urls: ['https://media.example/result.png'], text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    })
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([
      task('video-history', 'video', '视频会话', now - 2000),
      task('image-next', 'image', '图片继续生成', now - 3000, 'image-history'),
      task('image-history', 'image', '图片会话', now - 4000),
      task('raw-chat-task', 'text', '内部对话生成任务', now),
    ]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'image-history',
      sessions: [
        { id: 'image-history', topic: '较早的对话', messages: [{ id: 'question-a', role: 'user', content: '较早的对话内容' }], draft: '较早的草稿', lastUpdate: now - 5000 },
        { id: 'chat-latest', topic: '最新的对话', messages: [{ id: 'question-b', role: 'user', content: '最新的对话内容' }], draft: '最新的草稿', lastUpdate: now - 1000 },
      ],
    } }))
  })
  await page.goto('/create/image')
  const sidebar = page.locator('.studio-sidebar')
  const records = sidebar.locator('.studio-record')
  for (const mode of ['图片生成', '视频生成', '对话', '图片生成']) {
    await page.getByRole('button', { name: /^创作模式：/ }).click()
    await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: mode, exact: true }).click()
    await expect(records.locator('> span')).toHaveText(['最新的对话', '视频会话', '较早的对话'])
    await expect(records.locator('img')).toHaveCount(0)
    await expect(sidebar.getByRole('button', { name: '较早的对话', exact: true }).locator('svg')).toHaveCount(1)
    await expect(sidebar.getByRole('searchbox')).toHaveCount(0)
  }
  await sidebar.getByRole('button', { name: '视频会话', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/video/)
  await expect(page.locator('.creation-request')).toContainText('视频会话')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeEmpty()
  await sidebar.getByRole('button', { name: '较早的对话', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image/)
  await expect(page.locator('.creation-request')).toHaveCount(2)
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: '对话', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/text/)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('较早的草稿')
  await expect(page.locator('.chat-message.user')).toContainText('较早的对话内容')
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: '图片生成', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image/)
  await expect(page.locator('.creation-request')).toHaveCount(2)
  await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1)
  await expect(sidebar.getByRole('button', { name: '较早的对话', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: '.taste-skill/studio-unified-history-20261115/desktop.png' })
  await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
  await sidebar.getByRole('checkbox', { name: '选择对话：最新的对话', exact: true }).check()
  await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(records).toHaveCount(2)
  await expect(page).toHaveURL(/\/create\/image/)
  await expect(page.locator('.creation-request')).toHaveCount(2)
  account.state.user.id = '18'; account.state.user.accountId = '18'
  await page.reload()
  await expect(records.locator('> span')).toHaveText(['新对话'])
  expect(generations).toBe(0)
})

for (const shape of ['portrait', 'square', 'landscape', 'multiple'] as const) {
  test(`generated ${shape} images keep their intrinsic proportions and matching preview frames`, async ({ page }) => {
    const account = await mockUnifiedAccount(page, true)
    account.state.user.id = '17'
    const sizes = { portrait: [768, 1536], square: [1024, 1024], landscape: [1536, 512] } as const
    const shapes = shape === 'multiple' ? ['portrait', 'square', 'landscape'] as const : [shape]
    const photo = await readFile('public/assets/brand/octopus-community.jpg')
    const images = await Promise.all(shapes.map(name => sharp(photo).resize(...sizes[name]).png().toBuffer()))
    const urls = images.map((_, index) => `https://media.example/fit-${index}.png`)
    await page.route('**/api/creation/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/creation/media') return route.fulfill({ contentType: 'image/png', body: images[urls.indexOf(url.searchParams.get('url')!)]! })
      return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    })
    await page.addInitScript(urls => {
      localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
        id: 'image-fit', owner: '17', kind: 'image', model: 'gpt-image-2', prompt: '图片比例预览',
        createdAt: Date.now(), settledAt: Date.now(), phase: 'complete', protocol: 'sync', references: [],
        urls, text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: urls.length, duration: 8 },
      }]))
    }, urls)
    await page.goto('/create/image')
    const previews = page.locator('.creation-image-preview')
    await expect(previews).toHaveCount(images.length)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (let index = 0; index < images.length; index++) {
        const preview = previews.nth(index)
        const image = preview.locator('img')
        await expect(image).toHaveJSProperty('complete', true)
        const dimensions = await image.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return { width: bounds.width, height: bounds.height, naturalRatio: element.naturalWidth / element.naturalHeight }
        })
        expect(dimensions.width).toBeGreaterThan(0)
        expect(dimensions.height).toBeGreaterThan(0)
        expect(dimensions.width / dimensions.height).toBeCloseTo(dimensions.naturalRatio, 2)
        const bounds = (await preview.boundingBox())!
        expect(bounds.width).toBeCloseTo(dimensions.width, 0)
        expect(bounds.height).toBeCloseTo(dimensions.height, 0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      }
      const actions = page.getByRole('group', { name: '生成结果操作', exact: true })
      for (const name of ['发布作品', '固定到上下文']) await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
      await expect(actions.getByRole('button', { name: '新的创作', exact: true })).toHaveCount(0)
      await expect(actions.getByRole('button')).toHaveCount(9)
      await expect(page.getByRole('button', { name: '编辑提示词', exact: true })).toHaveCount(0)
      await expect(actions.getByRole('button', { name: /^下载/ })).toHaveCount(1)
      const mediaBounds = (await page.locator('.creation-media').boundingBox())!
      const actionBounds = (await actions.boundingBox())!
      expect(actionBounds.y).toBeGreaterThanOrEqual(mediaBounds.y + mediaBounds.height)
      await expect(page.locator('.creation-output-toolbar')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (shape === 'portrait' && width !== 320) {
        await actions.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `.taste-skill/studio-result-actions-20261115/${shape}-${width}.png` })
      }
    }
    await previews.first().click()
    await expect(page.getByRole('dialog', { name: '原始媒体预览' })).toBeVisible()
  })
}

test('desktop sidebar restores media history without submitting and keeps account-tool drafts', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let submissions = 0
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/creation/**', route => {
    if (new URL(route.request().url()).pathname === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (new URL(route.request().url()).pathname === '/api/creation/generate' && route.request().method() === 'POST') submissions++
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
  })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { userId: 17, rows: [], currency: '¥' } } }))
  await page.addInitScript(() => {
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'layout-test', owner: '17', kind: 'image', model: 'gpt-image-2', prompt: '海边的灯塔',
      createdAt: Date.now(), settledAt: Date.now(), phase: 'complete', protocol: 'sync', references: [],
      urls: ['https://media.example/result.png'], text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    }]))
  })
  await page.goto('/create/image')
  await expect(page.locator('.creation-output-toolbar').getByRole('button', { name: '刷新模型', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '生成历史', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '图库与任务管理', exact: true })).toHaveCount(0)
  const sidebar = page.getByRole('complementary', { name: '创作导航与历史' })
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: '创作记录', exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole('searchbox')).toHaveCount(0)
  await sidebar.getByRole('button', { name: '海边的灯塔', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '图片创作', exact: true })).toHaveCount(0)
  await expect(page.locator('.studio-page-toolbar')).toBeHidden()
  await expect(page.locator('.app-header .publish-button')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '生成结果操作', exact: true }).getByRole('button', { name: '发布作品', exact: true })).toBeVisible()
  await page.screenshot({ path: '.taste-skill/studio-remove-titles-20261115/desktop.png' })
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeEmpty()
  await expect(page.locator('.creation-request')).toContainText('海边的灯塔')
  await page.getByRole('button', { name: '继续创作', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('海边的灯塔')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这个创作草稿')
  await sidebar.getByRole('button', { name: '模型广场', exact: true }).click()
  await expect(page.locator('.studio-account-view')).toBeVisible()
  await sidebar.getByRole('button', { name: '海边的灯塔', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这个创作草稿')
  await sidebar.getByRole('navigation', { name: '工作台导航', exact: true }).getByRole('button', { name: '新对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeEmpty()
  expect(submissions).toBe(0)
  expect(errors).toEqual([])
})

test('sidebar adapts at desktop breakpoint and message/composer edges stay aligned', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.goto('/create/image')
  await expect(page.locator('.studio-composer')).toBeVisible()
  for (const width of [2867, 1440, 1024, 999, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: '今天', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '图片创作', exact: true })).toHaveCount(0)
    await expect(page.locator('.creation-output-toolbar')).toHaveCount(0)
    const sidebar = page.locator('.studio-sidebar')
    if (width >= 1000) await expect(sidebar).toBeVisible()
    else await expect(sidebar).toBeHidden()
    const composer = await page.locator('.studio-composer').boundingBox()
    const output = await page.getByLabel('对话消息', { exact: true }).boundingBox()
    expect(composer!.x).toBeCloseTo(output!.x, 0)
    expect(composer!.width).toBeCloseTo(output!.width, 0)
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(901)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const width of [1440, 390, 320]) {
  test(`composer menu switches exactly three modes and preserves drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await mockUnifiedAccount(page, true)
    let paidRequests = 0
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/creation/**', route => {
      if (route.request().method() === 'POST') paidRequests++
      const path = new URL(route.request().url()).pathname
      return route.fulfill({ json: path.endsWith('/models') ? { tokenId: 41, items: [
        { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
      ] } : { items: [], enabled: false } })
    })
    await page.goto('/create/image')
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留图片草稿')
    if (width >= 1000) {
      const sidebar = page.locator('.studio-sidebar')
      await expect(sidebar.getByRole('navigation', { name: '工作台导航', exact: true }).getByRole('button', { name: '新对话', exact: true })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: '图片', exact: true })).toHaveCount(0)
    }
    const trigger = page.getByRole('button', { name: /^创作模式：/ })
    const modeBounds = await trigger.boundingBox()
    const priceBounds = await page.getByRole('button', { name: '模型价格', exact: true }).boundingBox()
    const inputBounds = await page.locator('.studio-composer').boundingBox()
    expect(priceBounds!.y).toBeGreaterThanOrEqual(inputBounds!.y)
    expect(modeBounds!.y + modeBounds!.height).toBeLessThanOrEqual(inputBounds!.y)
    expect(await page.locator('.studio-composer .studio-mode-control').count()).toBe(0)
    await page.screenshot({ path: `.taste-skill/mode-toolbar-20261114/toolbar-${width}.png` })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: '创作模式', exact: true })
    await expect(panel.getByRole('group', { name: '创作类型' }).getByRole('button')).toHaveCount(3)
    await expect(panel.getByRole('button', { name: '图片生成', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const box = await panel.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await panel.getByRole('button', { name: '视频生成', exact: true }).click()
    await expect(page).toHaveURL(/\/create\/video/)
    await expect(trigger).toContainText('视频生成')
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留视频草稿')
    await trigger.click()
    await panel.getByRole('button', { name: '对话', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
    await expect(trigger).toContainText('对话')
    await trigger.click()
    await panel.getByRole('button', { name: '图片生成', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留图片草稿')
    await trigger.click()
    await panel.getByRole('button', { name: '视频生成', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留视频草稿')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(paidRequests).toBe(0)
    expect(errors).toEqual([])
  })
}

test('studio menu moves between the sidebar and compact header while keeping its actions', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.goto('/create/image')
  const input = page.getByRole('textbox', { name: '提示词', exact: true })
  await input.fill('菜单移动后保留草稿')
  const trigger = page.getByRole('button', { name: /^创作台菜单/ })
  const panel = page.getByRole('dialog', { name: '创作台菜单', exact: true })
  for (const width of [1440, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const container = page.locator(width >= 1000 ? '#studio-sidebar-menu' : '.studio-page-toolbar')
    await expect(container.getByRole('button', { name: /^创作台菜单/ })).toBeVisible()
    if (width >= 1000) await expect(trigger).toHaveText('设置')
    await expect(trigger).toHaveCount(1)
    await trigger.click()
    await expect(panel).toBeVisible()
    for (const name of ['模型价格', '消费记录', '密钥']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(panel.locator('.studio-command')).toHaveText(width >= 1000
      ? ['模型价格', '消费记录', '密钥']
      : ['作品库', '模型价格', '消费记录', '密钥', '清除上下文', '复制对话', '删除对话'])
    await expect(panel.getByRole('link')).toHaveCount(0)
    const bounds = await panel.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
    if (width === 1440 || width === 390) await page.screenshot({ path: `.taste-skill/sidebar-menu-20261114/menu-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await expect(input).toHaveValue('菜单移动后保留草稿')
  }
  await trigger.click()
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(panel).toBeHidden()
  await trigger.click()
  await panel.getByRole('button', { name: '消费记录', exact: true }).click()
  await expect(page.locator('.studio-account-view')).toBeVisible()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: '返回创作', exact: true }).click()
  await expect(input).toHaveValue('菜单移动后保留草稿')
  expect(errors).toEqual([])
})
