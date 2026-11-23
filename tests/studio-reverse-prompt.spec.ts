import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { Work } from '../src/data'

const inferred = '柔和侧光下的一只蓝色章鱼，近景居中构图，白色背景，细腻的黏土材质。'
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const source: Work = { id: 'reversework', title: '没有提示词的作品', authorId: '26', author: '作者', avatar: '原', kind: 'image', prompt: '', body: '这是作品介绍，不是生成提示词。', model: 'gpt-image-2', version: 1, tags: [], status: 'published', date: '2026-11-22', likes: 0, owned: false, saved: false, liked: false,
    fileIds: ['finished'], cover: '/legacy-files/finished', files: [{ id: 'finished', name: '原作品.jpg', type: 'image/jpeg', url: '/legacy-files/finished' }],
    referenceFiles: [{ id: 'reference', name: '原参考图.jpg', type: 'image/jpeg', url: '/legacy-files/reference' }],
    generation: { parameters: { version: 1, kind: 'image', size: '1200x900', n: 2 } } }
  const state = { catalogueFails: false, noModels: false, invalidToken: false, rejected: false, uncertain: false, group: '生图' }
  const selections: string[] = [], resolutions: any[] = [], requests: { body: any; token: string; account: string }[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/legacy-files/**', route => route.fulfill({ body: photo, contentType: 'image/jpeg' }))
  await page.route('**/api/works**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/works/reversework' ? { work: source } : { items: [], viewsCount: 1 } }))
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: state.group, groups: [{ id: '生图', name: '生图' }, { id: '文本A', name: '文本A' }, { id: '文本B', name: '文本B' }] } } }))
  await page.route('**/api/new-api/model-groups/select', route => { state.group = route.request().postDataJSON().group; selections.push(state.group); return route.fulfill({ json: { success: true, data: { group: state.group } } }) })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { userId: 17, currency: '积分', rows: [
    { model: 'gpt-image-2', group: '生图', requestPrice: 130, price: '130 积分', billing: '每次请求', imageCountMultiplier: true },
    { model: 'gpt-5', group: '文本A', requestPrice: 3, price: '3 积分', billing: '每次请求' },
    { model: 'claude-test', group: '文本B', requestPrice: 7, price: '7 积分', billing: '每次请求' },
  ] } } }))
  await page.route('**/api/creation/models*', route => {
    const req = route.request()
    if (req.method() === 'POST') {
      if (req.postDataJSON().group === '生图') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-test', kinds: ['video'] }] } })
      resolutions.push(req.postDataJSON())
      return route.fulfill({ json: { tokenId: state.invalidToken ? null : req.postDataJSON().group === '文本B' ? 84 : 83, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'claude-test', configuredKind: 'text', kinds: ['text'] }] } })
    }
    if (req.url().includes('scope=all')) return state.catalogueFails ? route.fulfill({ status: 503, json: { message: '文本目录暂不可用' } }) : route.fulfill({ json: { groups: ['生图', '文本A', '文本B'].map(id => ({ id, name: id })), items: state.noModels ? [] : [
      { id: 'gpt-image-2', groups: ['生图'], kinds: ['image'] },
      { id: 'gpt-5', groups: ['文本A'], kinds: ['text'] },
      { id: 'claude-test', groups: ['文本B'], kinds: ['text'], apiFormat: 'claude' },
    ] } })
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-test', kinds: ['video'] }] } })
  })
  await page.route('**/api/creation/generate', route => {
    const req = route.request(), body = req.postDataJSON()
    requests.push({ body, token: req.headers()['x-new-api-token'] || '', account: req.headers()['x-new-api-user'] || '' })
    if (body.kind === 'text') {
      if (state.rejected) return route.fulfill({ status: 400, json: { message: '此模型不支持图片输入，请选择支持图片理解的文本模型。' } })
      if (state.uncertain) return route.fulfill({ status: 502, json: { message: '连接中断' } })
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: inferred }], tokenId: 83 } })
    }
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: '/legacy-files/result' }], tokenId: 41 } })
  })
  await page.route('**/api/creation/requests/*', route => route.fulfill({ json: state.uncertain ? { status: 'indeterminate', outputs: [], error: '结果待确认', tokenId: 83 } : { status: 'succeeded', outputs: [{ text: inferred }], tokenId: 83 } }))
  return { account, source, state, selections, resolutions, requests, errors }
}
async function open(page: Page, entry = 'detail', recovering = false) {
  await page.goto(entry === 'detail' ? '/work/reversework' : '/create/image?remix=reversework&prepare=1')
  if (entry === 'detail') await page.getByRole('button', { name: '制作同款', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  if (recovering) await expect(dialog.getByRole('button', { name: '查询反推结果', exact: true })).toBeEnabled()
  else {
    await expect(dialog.getByLabel('反推文本模型')).toBeEnabled()
    await expect(dialog.getByRole('button', { name: '开始反推提示词', exact: true })).toBeEnabled()
  }
  return dialog
}

for (const entry of ['detail', 'workbench']) test(`${entry}: infers in the modal and imports edited text with the original model and parameters`, async ({ page }, info) => {
  await page.setViewportSize({ width: entry === 'detail' ? 390 : 1440, height: 900 })
  const state = await fixture(page), dialog = await open(page, entry)
  await expect(dialog.getByRole('button', { name: '导入提示词', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('heading', { name: '反推作品提示词' })).toBeVisible()
  await expect(dialog.getByLabel('反推文本分组').locator('option')).toHaveCount(2)
  await dialog.getByLabel('反推文本分组').selectOption('文本B')
  await expect(dialog.getByLabel('反推文本模型')).toHaveValue('claude-test')
  await dialog.locator('.reverse-prompt').getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(dialog.locator('.studio-popover:popover-open .billing-group')).toContainText('文本B')
  await expect(dialog.locator('.studio-popover:popover-open .billing-cost')).toContainText('7')
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  expect(state.requests).toHaveLength(1)
  expect(state.requests[0]).toMatchObject({ token: '84', account: '17', body: { kind: 'text', model: 'claude-test', apiFormat: 'auto', sourceWorkId: 'reversework', referenceUrls: [] } })
  const messages = state.requests[0]!.body.chatOptions.messages
  expect(messages[1].content[0].image_url.url).toMatch(/^data:image\//)
  expect(JSON.stringify(messages)).not.toContain('/legacy-files/reference')
  expect(state.selections).toEqual([])
  await dialog.getByLabel('反推提示词（可编辑）').fill(inferred + ' 淡紫色背景。')
  expect((await new AxeBuilder({ page }).include('.studio-remix-dialog').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`${entry}-reverse.png`) })
  await dialog.getByRole('button', { name: '导入提示词', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  expect(state.requests[1]).toMatchObject({ token: '41', body: { model: 'gpt-image-2', prompt: inferred + ' 淡紫色背景。', size: '1200x900', n: 2, sourceWorkId: 'reversework', referenceUrls: [] } })
  expect(state.selections).toEqual([]); expect(state.errors).toEqual([])
})

test('background generation only uses explicitly selected references after inference', async ({ page }) => {
  const state = await fixture(page), dialog = await open(page)
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  await dialog.getByRole('checkbox', { name: '原参考图.jpg', exact: true }).check()
  await dialog.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  expect(state.requests[1]).toMatchObject({ token: '41', body: { model: 'gpt-image-2', prompt: inferred, referenceUrls: ['/legacy-files/reference'], size: '1200x900', n: 2 } })
  await expect(dialog).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('an uncertain request is recovered after closing and reopening without a second paid POST', async ({ page }) => {
  const state = await fixture(page); state.state.uncertain = true
  let dialog = await open(page)
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '查询反推结果', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '导入提示词', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  dialog = await open(page, 'detail', true)
  state.state.uncertain = false
  await dialog.getByRole('button', { name: '查询反推结果', exact: true }).click()
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  expect(state.requests).toHaveLength(1); expect(state.selections).toEqual([])
})

test('incompatible models report an actionable error without automatically retrying', async ({ page }) => {
  const state = await fixture(page); state.state.rejected = true
  const dialog = await open(page)
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('不支持图片')
  await expect(dialog.getByRole('button', { name: '开始反推提示词', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '导入提示词', exact: true })).toBeDisabled()
  expect(state.requests).toHaveLength(1)
})

for (const action of ['cancel', 'account']) test(`late media reads after ${action} cannot submit inference`, async ({ page }) => {
  const state = await fixture(page), dialog = await open(page)
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/legacy-files/finished', async route => { started = true; await gate; await route.fallback() })
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  if (action === 'cancel') await dialog.getByRole('button', { name: '取消', exact: true }).click()
  else { state.account.state.user.id = 'other-user'; state.account.state.user.accountId = '18'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))) }
  await expect(dialog).toHaveCount(0)
  release()
  await page.waitForLoadState('networkidle')
  expect(state.requests).toHaveLength(0); expect(state.resolutions).toHaveLength(0)
})

test('invalid group credentials and unavailable files never use the generation token', async ({ page }) => {
  const state = await fixture(page); state.state.invalidToken = true
  const dialog = await open(page)
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('文本分组未就绪')
  expect(state.requests).toHaveLength(0)
  state.state.invalidToken = false
  await page.route('**/legacy-files/finished', route => route.fulfill({ status: 404 }))
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('读取失败')
  expect(state.requests).toHaveLength(0)
})

test('catalog failure is retryable and empty text groups never enable a paid request', async ({ page }) => {
  const state = await fixture(page); state.state.catalogueFails = true
  await page.goto('/create/image?remix=reversework&prepare=1')
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('文本目录暂不可用')
  state.state.catalogueFails = false; state.state.noModels = true
  await dialog.getByRole('button', { name: '重新读取模型', exact: true }).click()
  await expect(dialog.getByLabel('反推文本分组')).toContainText('暂无可用文本分组')
  await expect(dialog.getByRole('button', { name: '开始反推提示词', exact: true })).toBeDisabled()
  expect(state.requests).toHaveLength(0)
})

test('public prompts retain the existing remix flow with no reverse prompt option', async ({ page }) => {
  const state = await fixture(page); state.source.prompt = '公开提示词'
  await page.goto('/work/reversework')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  await expect(dialog.getByText('公开提示词', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('反推文本分组')).toHaveCount(0)
  expect(state.requests).toHaveLength(0)
})

test('video reconstruction sends sampled frames and keeps the source video model', async ({ page }) => {
  const state = await fixture(page)
  state.source.kind = 'video'; state.source.model = 'sora-test'
  state.source.files = [{ id: 'video', name: '原视频.mp4', type: 'video/mp4', url: '/legacy-files/video' }]
  state.source.generation = { parameters: { version: 1, kind: 'video', duration: 8, size: '1280x720', n: 1 } }
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  await page.route('**/legacy-files/video', route => route.fulfill({ body: video, contentType: 'video/mp4' }))
  const dialog = await open(page)
  await expect(dialog.getByText(/不分析音轨/)).toBeVisible()
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  const parts = state.requests[0]!.body.chatOptions.messages[1].content
  expect(parts.filter((part: any) => part.type === 'image_url').length).toBeGreaterThan(1)
  expect(parts.filter((part: any) => part.type === 'image_url').length).toBeLessThanOrEqual(8)
  expect(parts.some((part: any) => part.type === 'video_url')).toBe(false)
  await dialog.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  expect(state.requests[1]).toMatchObject({ token: '41', body: { kind: 'video', model: 'sora-test', prompt: inferred, duration: 8, referenceUrls: [] } })
  expect(state.errors).toEqual([])
})


test('stopping an accepted inference queries the existing request instead of posting again', async ({ page }) => {
  await fixture(page)
  let accepted = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/generate', async route => { accepted++; await gate; await route.fulfill({ json: { status: 'succeeded', outputs: [{ text: inferred }], tokenId: 83 } }) })
  const dialog = await open(page)
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect.poll(() => accepted).toBe(1)
  await dialog.getByRole('button', { name: '停止等待', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '查询反推结果', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '查询反推结果', exact: true }).click()
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  release()
  expect(accepted).toBe(1)
})

test('cancelled media preparation cannot unlock a newer preparation', async ({ page }) => {
  const state = await fixture(page), dialog = await open(page)
  let reads = 0, releaseFirst!: () => void, releaseSecond!: () => void
  const first = new Promise<void>(resolve => { releaseFirst = resolve })
  const second = new Promise<void>(resolve => { releaseSecond = resolve })
  await page.route('**/legacy-files/finished', async route => { reads++; await (reads === 1 ? first : second); await route.fallback() })
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect.poll(() => reads).toBe(1)
  await dialog.getByRole('button', { name: '停止等待', exact: true }).click()
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  releaseFirst()
  await expect(dialog.getByRole('button', { name: '停止等待', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '开始反推提示词', exact: true })).toHaveCount(0)
  releaseSecond()
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  expect(state.requests).toHaveLength(1)
})

test('320px layout supports selecting a finished work file and makes a missing source model explicit', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const state = await fixture(page)
  state.source.model = ''
  state.source.files!.push({ id: 'second', name: '第二张作品.jpg', type: 'image/jpeg', url: '/legacy-files/second' })
  const dialog = await open(page)
  await expect(dialog.getByText('原作品未提供生成模型，导入提示词后请在工作台选择模型。')).toBeVisible()
  await dialog.getByLabel('反推作品文件').selectOption('second')
  const read = page.waitForRequest('**/legacy-files/second')
  await dialog.getByRole('button', { name: '开始反推提示词', exact: true }).click()
  await read
  await expect(dialog.getByLabel('反推提示词（可编辑）')).toHaveValue(inferred)
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '导入提示词', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.studio-remix-dialog').analyze()).violations).toEqual([])
  const targets = await dialog.locator('.reverse-prompt button, .reverse-prompt select, .remix-footer button').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).every(node => node.getBoundingClientRect().height >= 44))
  expect(targets).toBe(true)
  await page.screenshot({ path: info.outputPath('reverse-320.png') })
  expect(state.requests).toHaveLength(1); expect(state.errors).toEqual([])
})
