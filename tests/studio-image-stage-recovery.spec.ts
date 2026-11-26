import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, mode: 'stages' | 'save' | 'unknown') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const requests: { path: string; method: string }[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true })))
  let requestId = '', state: Record<string, unknown> = {}, submit: Route | undefined, submitted: (() => void) | undefined
  function stage(value: 'preparing' | 'queued' | 'generating' | 'saving') {
    state = { status: 'pending', requestId, tokenId: 41, protocol: 'sync', stage: value, stageStartedAt: Date.now(), outputs: [] }
  }
  function finish() { state = { status: 'succeeded', requestId, tokenId: 41, protocol: 'sync', outputs: [{ url: `/api/creation/media?requestId=${requestId}&index=0` }] } }
  await page.route('**/api/creation/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    requests.push({ path, method: request.method() })
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/generate') {
      requestId = String(request.postDataJSON().requestId)
      if (mode === 'stages') {
        stage('preparing'); submit = route
        return new Promise<void>(resolve => { submitted = resolve })
      }
      state = { status: mode === 'save' ? 'save_failed' : 'indeterminate', requestId, outputs: [],
        errorStage: mode === 'save' ? '结果保存' : '网关提交', error: mode === 'save' ? '原图保存暂时失败。' : '本次生成结果待确认。' }
      return route.fulfill({ status: 202, json: state })
    }
    if (path.endsWith('/save')) { stage('saving'); return route.fulfill({ status: 202, json: state }) }
    if (path === `/api/creation/requests/${requestId}`) return route.fulfill({ json: state })
    return route.fulfill({ status: 404, json: { message: `Unmocked path: ${path}` } })
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  return { requests, errors, stage, finish, id: () => requestId,
    async accept() { await submit!.fulfill({ status: 202, json: state }); submitted!() } }
}
async function generate(page: Page) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('安静的猫咪海报')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  const response = page.locator('.creation-response')
  await expect(response).toHaveCount(1)
  return response
}
async function verified(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  expect(state.requests.filter(request => request.path === '/api/creation/generate' && request.method === 'POST')).toHaveLength(1)
  expect(state.requests.some(request => request.path.endsWith('/events') || request.path.endsWith('/authorize'))).toBe(false)
  expect(state.errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
for (const width of [1440, 390]) {
  test(`shows preparation before acceptance and real stages through saving at ${width}px`, async ({ page }, info) => {
    test.setTimeout(45000)
    await page.setViewportSize({ width, height: 900 })
    const state = await fixture(page, 'stages'), response = await generate(page)
    await expect(response).toContainText('准备素材中')
    state.stage('queued')
    await expect(response).toContainText('等待提交', { timeout: 8000 })
    await page.screenshot({ path: info.outputPath(`queued-${width}.png`) })
    state.stage('generating'); await state.accept()
    await expect(response).toContainText('正在生成中')
    state.stage('saving')
    await expect(response).toContainText('正在保存图片', { timeout: 8000 })
    state.finish()
    await expect(response.getByRole('button', { name: /查看大图：预览生成图片 1/ })).toBeVisible({ timeout: 8000 })
    await page.screenshot({ path: info.outputPath(`complete-${width}.png`) })
    await verified(page, state)
  })
  test(`retries only saving the original result at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const state = await fixture(page, 'save'), response = await generate(page)
    await response.getByRole('button', { name: '重试保存', exact: true }).click()
    await expect(response).toContainText('正在保存图片')
    state.finish()
    await expect(response.getByRole('button', { name: /查看大图：预览生成图片 1/ })).toBeVisible({ timeout: 8000 })
    expect(state.requests.filter(request => request.path === `/api/creation/requests/${state.id()}/save`)).toEqual([{ path: `/api/creation/requests/${state.id()}/save`, method: 'POST' }])
    await verified(page, state)
  })
  test(`queries an unknown original result at ${width}px without generating again`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const state = await fixture(page, 'unknown'), response = await generate(page)
    await expect(response).toContainText('本次生成结果待确认。')
    state.finish()
    await response.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect(response.getByRole('button', { name: /查看大图：预览生成图片 1/ })).toBeVisible()
    expect(state.requests.some(request => request.path.endsWith('/save'))).toBe(false)
    await verified(page, state)
  })
}
