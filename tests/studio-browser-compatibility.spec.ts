import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, unavailable = false) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const posts: Record<string, unknown>[] = [], reads: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined })
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
  })
  let id = ''
  const failed = () => ({ status: 'failed', requestId: id, outputs: [], errorCode: 'MODEL_UNAVAILABLE', errorStatus: 404,
    errorStage: '网关提交', error: '网关提交失败（HTTP 404）：当前模型渠道暂不可用，请选择其他模型，或联系管理员核对供应商配置。' })
  await page.route('**/api/creation/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/generate') {
      const body = request.postDataJSON(); posts.push(body); id = body.requestId
      return route.fulfill({ status: unavailable ? 200 : 202, json: unavailable ? failed()
        : { status: 'pending', requestId: id, tokenId: 41, protocol: 'sync', stage: 'generating', outputs: [] } })
    }
    if (path === `/api/creation/requests/${id}`) {
      reads.push(path)
      return route.fulfill({ json: unavailable ? failed()
        : { status: 'succeeded', requestId: id, tokenId: 41, protocol: 'sync', outputs: [{ url: `/api/creation/media?requestId=${id}&index=0` }] } })
    }
    return route.fulfill({ status: 404, json: { message: 'Unmocked diagnostic route' } })
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  return { posts, reads, errors }
}

for (const width of [1440, 390]) {
  test(`missing AbortSignal.any still submits, polls and restores once at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const state = await fixture(page)
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('兼容浏览器的海报')
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    const response = page.locator('.creation-response')
    await expect(response.getByRole('button', { name: /查看大图：预览生成图片 1/ })).toBeVisible()
    expect(state.posts).toHaveLength(1)
    expect(state.reads.length).toBeGreaterThan(0)
    await page.reload()
    await expect(response.getByRole('button', { name: /查看大图：预览生成图片 1/ })).toBeVisible()
    expect(state.posts).toHaveLength(1)
    expect(state.errors).toEqual([])
    await page.screenshot({ path: info.outputPath(`compatible-generation-${width}.png`) })
  })
}

test('a known unavailable model shows a settled error without resubmitting after reload', async ({ page }) => {
  const state = await fixture(page, true)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留输入以便更换模型')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-response')).toContainText('当前模型渠道暂不可用')
  expect(state.posts).toHaveLength(1)
  expect(state.reads).toHaveLength(0)
  await page.reload()
  await expect(page.locator('.creation-response')).toContainText('当前模型渠道暂不可用')
  expect(state.posts).toHaveLength(1)
  expect(state.reads).toHaveLength(0)
  expect(state.errors).toEqual([])
})
