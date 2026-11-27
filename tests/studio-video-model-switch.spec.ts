import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { buildCreationPayload, validateCreationInput } from '../server/creation-contract'
import type { CreationModel } from '../src/native-studio'
import { readFile } from 'node:fs/promises'

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
    videoRates: [{ providerKey: '0', provider: '视频', perSecond: model.id.endsWith('720p') ? 3250 : 1600, perRequest: 0,
      ...(model.id === 'c-reference-video' ? { billReferenceVideo: true } : {}) }],
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

test('official video tiers are selectable while size fields stay disabled by backend configuration', async ({ page }) => {
  const { models, calls } = await fixture(page)
  models.unshift({ id: '火山2.5官转', kinds: ['video'], video: { parameterFormat: 'openai', sendSize: false,
    resolutions: ['720p', '1080p', '2k'], autoResolution: '720p', durations: [4, 10, 30], autoDuration: 10,
    aspectRatios: ['16:9', '9:16'], resolutionValues: { '720p': 'tier_720p', '1080p': 'tier_1080p', '2k': 'tier_2k' } } })
  await page.addInitScript(() => localStorage.setItem('octopus:user-17:native-creation-draft:video', JSON.stringify({
    model: '火山2.5官转', prompt: '保存的官转草稿', manualSize: '1920x1080', ratio: '16:9', duration: 10,
    videoOptions: { mode: 'text-to-video', resolution: '720p' }, references: [],
  })))
  await page.goto('/create/video')
  await parameters(page)
  await resolution(page, '2K').check()
  await page.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '9:16', exact: true }).check()
  await page.getByText('自定义参数', { exact: true }).click()
  await expect(page.getByLabel('尺寸', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('官转视频')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ model: '火山2.5官转', size: 'auto', aspect_ratio: '9:16', duration: 10, videoOptions: { resolution: '2k' } })
})

for (const operation of ['upscale', 'remove-subtitles', 'remove-watermark'] as const) test(`source video operation ${operation} requires one owned MP4 and submits without a prompt`, async ({ page }, info) => {
  const { models, calls } = await fixture(page)
  const sourceModel = `source-video-${operation}`
  const action = operation === 'upscale' ? '开始超分' : operation === 'remove-subtitles' ? '开始去字幕' : '开始去水印'
  models.unshift({ id: sourceModel, kinds: ['video'], video: { operation, parameterFormat: 'openai', sendSize: false,
    ...(operation === 'upscale' ? { resolutions: ['720p', '1080p', '2k', '4k'], autoResolution: '1080p' } : {}) } })
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  let uploads = 0, processingReads = 0
  let ready!: () => void
  const processing = new Promise<void>(resolve => { ready = resolve })
  const uploaded = { id: 'ownedupscalevideo', name: 'source.mp4', type: 'video/mp4', size: video.length, url: '/legacy-files/ownedupscalevideo' }
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 64, imagesMb: 20, videosMb: 64, filesMb: 20 } }))
  await page.route('**/api/uploads', route => {
    uploads++
    return route.fulfill({ json: { file: { ...uploaded, processing: 'pending' } } })
  })
  await page.route('**/api/uploads/ownedupscalevideo', async route => {
    processingReads++
    if (processingReads > 1) await processing
    return route.fulfill({ json: { file: { ...uploaded, processing: processingReads === 1 ? 'processing' : 'ready' } } })
  })
  await page.route('**/legacy-files/ownedupscalevideo', route => route.fulfill({ body: video, contentType: 'video/mp4' }))
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/video')
  await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).not.toHaveAttribute('required')
  await parameters(page)
  await expect(page.getByRole('radiogroup', { name: '生成方式', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: '画面比例', exact: true })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: '视频时长', exact: true })).toHaveCount(0)
  if (operation === 'upscale') {
    await expect(resolution(page, '1080P')).toBeChecked()
    await resolution(page, '2K').check()
  } else await expect(page.getByRole('radiogroup', { name: '视频分辨率', exact: true })).toHaveCount(0)
  await page.getByText('自定义参数', { exact: true }).click()
  await expect(page.getByLabel('尺寸', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('参考图来源', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const picker = page.getByLabel('添加源视频', { exact: true })
  await expect(picker).toHaveAttribute('accept', 'video/mp4,.mp4')
  await picker.setInputFiles({ name: 'source.webm', mimeType: 'video/webm', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('alert').filter({ hasText: '请选择 MP4 视频' })).toBeVisible()
  expect(uploads).toBe(0)
  await page.getByRole('button', { name: '移除附件 source.webm', exact: true }).click()
  await picker.setInputFiles({ name: 'source.mp4', mimeType: 'video/mp4', buffer: video })
  await expect.poll(() => uploads).toBe(1)
  await expect.poll(() => processingReads).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled()
  expect(calls).toHaveLength(0)
  ready()
  await page.getByRole('button', { name: '预览源视频', exact: true }).click()
  const source = page.getByRole('dialog', { name: '参考素材预览', exact: true }).locator('video')
  await expect(source).toHaveAttribute('controls', '')
  await expect.poll(() => source.evaluate((element: HTMLVideoElement) => element.duration)).toBe(2.5)
  await page.getByRole('button', { name: '关闭参考素材预览', exact: true }).click()
  await expect(page.getByRole('button', { name: action, exact: true })).toBeEnabled()
  expect(calls).toHaveLength(0)
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.locator('.billing-cost')).toContainText('本次 3 秒视频')
  await page.keyboard.press('Escape')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`video-${operation}-${width}.png`) })
  }
  await page.getByRole('button', { name: action, exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ model: sourceModel, prompt: '', size: 'auto', referenceUrls: ['/legacy-files/ownedupscalevideo'], videoOptions: { resolution: operation === 'upscale' ? '2k' : 'auto' } })
  await expect(page.locator('.sent-references video')).toHaveCount(1)
  await expect(page.locator('.sent-references img')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('mixed video and audio references share one compact upload strip and include reference seconds in the quote', async ({ page }, info) => {
  const { models, calls } = await fixture(page)
  models.unshift({ id: 'c-reference-video', kinds: ['video'], video: { parameterFormat: 'openai', sendSize: false,
    resolutions: ['720p'], autoResolution: '720p', durations: [6, 10], autoDuration: 6, aspectRatios: ['16:9'],
    maxReferenceImages: 2, maxReferenceVideos: 1, maxReferenceAudios: 1 } })
  models.push({ id: 'restricted-reference-video', kinds: ['video'], video: {
    resolutions: ['720p'], durations: [6, 10], autoDuration: 6, aspectRatios: ['16:9'],
    maxReferenceImages: 1, maxReferenceVideos: 0, maxReferenceAudios: 0,
  } })
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  const audio = Buffer.alloc(44 + 16000)
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(16000, 40)
  const media = [
    { id: 'ownedreferencevideo', name: '镜头参考.mp4', type: 'video/mp4', bytes: video, durationSeconds: 2.5 },
    { id: 'ownedreferenceaudio', name: '环境声音与节奏参考.wav', type: 'audio/wav', bytes: audio, durationSeconds: 1 },
  ]
  let uploads = 0
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 64, imagesMb: 20, videosMb: 64, filesMb: 64 } }))
  await page.route('**/api/uploads', route => {
    const index = route.request().postDataBuffer()?.includes(Buffer.from('video/mp4')) ? 0 : 1
    const item = media[index]!
    uploads++
    return route.fulfill({ json: { file: { id: item.id, name: item.name, type: item.type, size: item.bytes.length,
      url: `/legacy-files/${item.id}`, processing: 'pending' } } })
  })
  for (const item of media) {
    await page.route(`**/api/uploads/${item.id}`, route => route.fulfill({ json: { file: {
      id: item.id, name: item.name, type: item.type, size: item.bytes.length, url: `/legacy-files/${item.id}`,
      processing: 'ready', durationSeconds: item.durationSeconds,
    } } }))
    await page.route(`**/legacy-files/${item.id}**`, route => route.fulfill({ body: item.bytes, contentType: item.type }))
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/video')
  const picker = page.getByLabel('添加参考素材', { exact: true })
  await expect(picker).toHaveAttribute('accept', /video\/mp4/)
  await expect(picker).toHaveAttribute('accept', /audio/)
  await picker.setInputFiles(media.map(item => ({ name: item.name, mimeType: item.type, buffer: item.bytes })))
  await expect.poll(() => uploads).toBe(2)
  const strip = page.getByRole('list', { name: '参考素材', exact: true })
  await expect(strip.locator('li')).toHaveCount(2)
  await expect(strip.getByRole('button', { name: '预览参考视频 1', exact: true })).toHaveAttribute('title', /镜头参考\.mp4/)
  await expect(strip).toContainText('环境声音与节奏参考.wav')
  await picker.setInputFiles({ name: '额外音频.wav', mimeType: 'audio/wav', buffer: audio })
  await expect(page.getByRole('alert')).toContainText('当前模型最多支持 1 个参考音频，已选 2 个。')
  expect(uploads).toBe(2)
  await expect(strip.locator('li')).toHaveCount(2)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留镜头运动，参考音频节奏')
  await choose(page, 'restricted-reference-video')
  await expect(strip.locator('li')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留镜头运动，参考音频节奏')
  await expect(page.getByRole('alert')).toContainText('当前模型不支持参考视频，已选 1 个。')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled()
  await expect(picker).not.toHaveAttribute('accept', /video|audio/)
  expect(calls).toHaveLength(0)
  await choose(page, 'c-reference-video')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
  await strip.getByRole('button', { name: '预览附件 环境声音与节奏参考.wav', exact: true }).click()
  const soundDetails = page.getByRole('dialog', { name: '附件详情', exact: true })
  const sound = soundDetails.locator('audio[controls]')
  await expect.poll(() => sound.evaluate((element: HTMLAudioElement) => element.duration)).toBe(1)
  await sound.evaluate(async (element: HTMLAudioElement) => { element.muted = true; await element.play() })
  await expect.poll(() => sound.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0)
  await sound.evaluate((element: HTMLAudioElement) => element.pause())
  await soundDetails.getByRole('button', { name: '关闭附件详情', exact: true }).click()
  await page.getByRole('button', { name: '预览参考视频 1', exact: true }).click()
  const videoPreview = page.getByRole('dialog', { name: '参考素材预览', exact: true }).locator('video[controls]')
  await expect.poll(() => videoPreview.evaluate((element: HTMLVideoElement) => element.duration)).toBe(2.5)
  await videoPreview.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
  await expect.poll(() => videoPreview.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '关闭参考素材预览', exact: true }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留镜头运动，参考音频节奏')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.locator('.billing-cost-value')).toHaveText('13,600 积分')
  await page.keyboard.press('Escape')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await strip.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(100)
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeEditable()
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`mixed-references-${width}.png`) })
    await page.locator('.studio-composer').screenshot({ path: info.outputPath(`mixed-composer-${width}.png`) })
  }
  expect((await new AxeBuilder({ page }).include('.reference-list').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
  await page.reload()
  await expect(strip.locator('li')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留镜头运动，参考音频节奏')
  await strip.getByRole('button', { name: '移除参考音频 2', exact: true }).click()
  await expect(strip.locator('li')).toHaveCount(1)
  await picker.setInputFiles({ name: media[1]!.name, mimeType: 'audio/wav', buffer: audio })
  await expect(strip.locator('li')).toHaveCount(2)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ model: 'c-reference-video', duration: 6,
    referenceUrls: ['/legacy-files/ownedreferencevideo', '/legacy-files/ownedreferenceaudio'] })
  await expect(page.locator('.sent-references video')).toHaveCount(1)
  await expect(page.locator('.sent-references audio')).toHaveCount(1)
  await expect(page.locator('.sent-references img')).toHaveCount(0)
  expect(errors).toEqual([])
})
