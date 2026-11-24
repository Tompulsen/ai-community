import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { buildCreationPayload, validateCreationInput } from '../server/creation-contract'
import type { CreationModel } from '../src/native-studio'

async function fixture(page: Page) {
  await mockUnifiedAccount(page, true)
  const aspectRatios = ['1:1', '3:4', '4:3', '16:9', '9:16', '21:9']
  const models: CreationModel[] = [
    { id: 'sd2.0-fast-480p', kinds: ['video'], video: { resolutions: ['480p'], durations: [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30], aspectRatios } },
    { id: 'sd2.0-fast-720p', kinds: ['video'], video: { resolutions: ['720p'], durations: [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30], aspectRatios } },
    { id: 'grok-imagine-video-1.5', kinds: ['video'], video: { resolutions: ['480p', '720p', '1080p'], durations: Array.from({ length: 15 }, (_, index) => index + 1), aspectRatios, modes: { 'reference-to-video': { resolutions: ['480p', '720p'] } } } },
    { id: 'sora-2', kinds: ['video'], video: { resolutions: ['720p'], durations: [4, 8, 12], aspectRatios } },
    { id: 'configured-video', kinds: ['video'], video: { resolutions: ['540p', '1080p'], autoResolution: '1080p' } },
    { id: 'gpt-image-2', kinds: ['image'] },
    { id: 'H3-custom-video', kinds: ['video'], video: { resolutions: ['720p'], durations: [5, 10], autoDuration: 10,
      aspectRatios: ['16:9', '9:16'], sizes: { '720p': { '16:9': '1360x720', '9:16': '720x1360' } }, unsupportedParameters: ['frame_rate'] } },
  ]
  const calls: any[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: models } })
    if (path.endsWith('/generate')) {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/video.mp4' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('https://media.example/**', route => route.fulfill({ status: 204 }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { userId: 17, currency: '积分', autoGroups: ['视频'], rows: models.map(model => ({
    model: model.id, group: '视频', billing: '视频任务 · 每秒', price: '积分/秒',
    videoRates: [{ providerKey: '0', provider: '视频', perSecond: model.id.endsWith('720p') ? 3250 : 1600, perRequest: 0 }],
  })) } } }))
  return { models, calls }
}

async function choose(page: Page, model: string) {
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: model, exact: true }).click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(model)
}
const resolution = (page: Page, value: string) => page.getByRole('radiogroup', { name: '视频分辨率', exact: true }).getByRole('radio', { name: value, exact: true })
const parameters = (page: Page) => page.getByRole('button', { name: '高级参数', exact: true }).click()

test('video model switches replace incompatible resolution and submit the matching size and price', async ({ page }, info) => {
  const { calls } = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/video')
  await choose(page, 'sd2.0-fast-480p')
  await parameters(page)
  await resolution(page, '480P').check()
  await page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '16:9', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留视频提示词')
  await choose(page, 'sd2.0-fast-720p')
  await expect(page.getByText('原作时长或分辨率不受当前模型支持，请在高级参数中调整。', { exact: true })).toHaveCount(0)
  await parameters(page)
  await expect(resolution(page, '720P')).toBeChecked()
  for (const [width, mode] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    const panel = page.getByRole('dialog', { name: '高级参数', exact: true })
    await expect(panel).not.toContainText('不在可选列表中')
    expect((await new AxeBuilder({ page }).include('.media-parameters').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`video-model-${width}-${mode}.png`) })
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.locator('.billing-cost-value')).toHaveText('26,000 积分')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留视频提示词')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ model: 'sd2.0-fast-720p', size: '1280x720', duration: 8, videoOptions: { resolution: '720p' } })
  expect(() => buildCreationPayload(validateCreationInput(calls[0]), [], [], { resolutions: ['720p'], durations: [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30] })).not.toThrow()
  await choose(page, 'sd2.0-fast-480p')
  await parameters(page)
  await expect(resolution(page, '480P')).toBeChecked()
  expect(errors).toEqual([])
  expect(calls).toHaveLength(1)
})

test('video switching preserves supported and automatic choices and fixes only unsupported duration', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/create/video')
  await choose(page, 'grok-imagine-video-1.5')
  await parameters(page)
  await resolution(page, '720P').check()
  await page.getByRole('slider', { name: '视频时长', exact: true }).fill('6')
  await page.keyboard.press('Escape')
  await choose(page, 'sora-2')
  await parameters(page)
  await expect(resolution(page, '720P')).toBeChecked()
  await expect(page.getByRole('slider', { name: '视频时长', exact: true })).toHaveAttribute('aria-valuetext', '8 秒')
  await resolution(page, '自动').check()
  await page.keyboard.press('Escape')
  await choose(page, 'sd2.0-fast-480p')
  await parameters(page)
  await expect(resolution(page, '自动')).toBeChecked()
  await expect(page.getByRole('slider', { name: '视频时长', exact: true })).toHaveAttribute('aria-valuetext', '8 秒')
  expect(calls).toHaveLength(0)
})

test('video mode and administrator capability updates select a supported resolution without changing custom input', async ({ page }) => {
  const { models, calls } = await fixture(page)
  await page.goto('/create/video')
  await choose(page, 'grok-imagine-video-1.5')
  await parameters(page)
  await resolution(page, '1080P').check()
  await page.getByRole('radiogroup', { name: '生成方式', exact: true }).getByRole('radio', { name: '多图参考', exact: true }).check()
  await expect(resolution(page, '720P')).toBeChecked()
  await page.getByText('自定义参数', { exact: true }).click()
  await page.getByLabel('自定义参数 JSON', { exact: true }).fill('{"seed":123}')
  await page.keyboard.press('Escape')
  await choose(page, 'configured-video')
  await parameters(page)
  await expect(resolution(page, '1080P')).toBeChecked()
  await expect(page.getByLabel('时长（秒）', { exact: true })).toHaveValue('8')
  await page.keyboard.press('Escape')
  models[4]!.video = { resolutions: ['540p'], autoResolution: '540p' }
  await page.reload()
  await parameters(page)
  await expect(resolution(page, '540P')).toBeChecked()
  await page.getByText('自定义参数', { exact: true }).click()
  await expect(page.getByLabel('自定义参数 JSON', { exact: true })).toHaveValue('{"seed":123}')
  expect(calls).toHaveLength(0)
})

test('unknown video models use backend ratios, durations and exact sizes without submitting on changes', async ({ page }, info) => {
  const { models, calls } = await fixture(page)
  const configured = models.pop()!
  configured.video!.durations = [5, 8, 10]
  models.unshift(configured)
  const request = { size: '1920x1080', aspect_ratio: '1:1', n: 1, duration: 12, videoOptions: { mode: 'text-to-video', resolution: '1080p' } }
  await page.addInitScript(request => {
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'unchanged-video-history', conversationId: 'unchanged-video-history', owner: '17', kind: 'video', model: 'H3-custom-video', prompt: '历史视频',
      createdAt: now, settledAt: now, phase: 'complete', protocol: 'sync', references: [], urls: [], text: '', request,
    }]))
  }, request)
  await page.goto('/create/video')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('H3-custom-video')
  await parameters(page)
  await expect(page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio')).toHaveCount(3)
  await expect(page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '1:1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: '视频时长', exact: true })).toHaveAttribute('aria-valuetext', '10 秒')
  await resolution(page, '720P').check()
  await page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '16:9', exact: true }).check()
  await page.getByText('自定义参数', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: '尺寸', exact: true })).toHaveValue('1360x720')
  await page.getByRole('combobox', { name: '尺寸', exact: true }).selectOption('720x1360')
  await expect(page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '9:16', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: '尺寸', exact: true })).toHaveValue('720x1360')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const panel = page.getByRole('dialog', { name: '高级参数', exact: true })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`backend-h3-parameters-${width}.png`) })
  }
  expect(calls).toHaveLength(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('octopus:user-17:native-creation-history:fallback') || '[]').find((item: { id: string }) => item.id === 'unchanged-video-history')?.request)).toEqual(request)
})

test('choosing a video model from image mode adapts the restored video draft', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/create/video')
  await choose(page, 'sd2.0-fast-480p')
  await parameters(page)
  await resolution(page, '480P').check()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留跨模式草稿')
  await choose(page, 'gpt-image-2')
  await expect(page).toHaveURL(/\/create\/image/)
  await choose(page, 'sd2.0-fast-720p')
  await expect(page).toHaveURL(/\/create\/video/)
  await parameters(page)
  await expect(resolution(page, '720P')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留跨模式草稿')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
  expect(calls).toHaveLength(0)
})

test('homepage video switches use supported settings and retain the adjusted draft after navigation', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  await page.getByRole('button', { name: '视频生成', exact: true }).click()
  await choose(page, 'sd2.0-fast-480p')
  await parameters(page)
  await resolution(page, '480P').check()
  await page.keyboard.press('Escape')
  await choose(page, 'sd2.0-fast-720p')
  await parameters(page)
  await expect(resolution(page, '720P')).toBeChecked()
  await page.keyboard.press('Escape')
  expect(calls).toHaveLength(0)
  await page.getByRole('textbox', { name: '创作描述', exact: true }).fill('首页视频草稿')
  await page.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].videoOptions.resolution).toBe('720p')
  await page.reload()
  await parameters(page)
  await expect(resolution(page, '720P')).toBeChecked()
})
