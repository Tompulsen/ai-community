import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const source = { id: 'remixgroups', title: '恐龙', authorId: '26', author: '原作者', avatar: '原', kind: 'image', prompt: '恐龙', model: 'gpt-image-2', version: 1, tags: [], status: 'published', date: '2026-11-19', likes: 0, owned: false, saved: false, liked: false,
    fileIds: ['cover'], cover: '/legacy-files/cover', files: [{ id: 'cover', name: '封面.jpg', type: 'image/jpeg', url: '/legacy-files/cover' }],
    referenceFiles: [{ id: 'reference', name: '作者参考图.jpg', type: 'image/jpeg', url: '/legacy-files/reference' }],
    generation: { parameters: { version: 1, kind: 'image', group: '作者专属组', size: '1200x900', n: 2 } } }
  const state = { group: 'auto', models: { auto: ['gpt-image-2'], default: ['gpt-image-2'], 生图: ['other-image'] } as Record<string, string[]>, failModels: false, failPricing: false }
  const selections: string[] = [], requests: { body: any; token: string }[] = []
  const token = () => state.group === 'auto' ? 41 : 52
  await page.route('**/legacy-files/**', route => route.fulfill({ body: photo, contentType: 'image/jpeg' }))
  await page.route('**/api/works**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/works/remixgroups' ? { work: source } : { items: [], viewsCount: 1 } }))
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: state.group, groups: Object.keys(state.models).map(id => ({ id, name: id })) } } }))
  await page.route('**/api/new-api/model-groups/select', route => { state.group = route.request().postDataJSON().group; selections.push(state.group); return route.fulfill({ json: { success: true, data: { group: state.group, selectedTokenId: token() } } }) })
  await page.route('**/api/new-api/model-pricing', route => state.failPricing ? route.fulfill({ status: 503, json: { success: false, message: '目录读取失败，请重试。' } }) : route.fulfill({ json: { success: true, data: { userId: 17, currency: '积分', autoGroups: ['default'], rows: ['default', '生图'].map(group => ({ model: 'gpt-image-2', group, price: `${group === 'default' ? 130 : 500} 积分`, requestPrice: group === 'default' ? 130 : 500, billing: '每次请求', imageCountMultiplier: true })) } } }))
  await page.route('**/api/creation/models', route => {
    const group = route.request().postDataJSON()?.group || state.group
    if (group !== state.group) { state.group = group; selections.push(group) }
    return state.failModels ? route.fulfill({ status: 503, json: { message: '模型目录读取失败，请重试。' } }) : route.fulfill({ json: { tokenId: token(), items: (state.models[state.group] || []).map(id => ({ id, kinds: ['image'] })) } })
  })
  await page.route('**/api/creation/generate', route => { requests.push({ body: route.request().postDataJSON(), token: route.request().headers()['x-new-api-token'] || '' }); return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: '/legacy-files/result' }] } }) })
  return { account, source, state, selections, requests }
}

async function open(page: Page, entry: 'workbench' | 'background') {
  await page.goto('/work/remixgroups')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: entry === 'background' ? /^后台生成(?:$|\s)/ : /^进入工作台生成(?:$|\s)/ }).click()
  return page.getByRole('dialog', { name: '制作同款', exact: true })
}

for (const entry of ['workbench', 'background'] as const) {
  for (const currentAvailable of [true, false]) test(`${entry} reuses the same model across groups with ${currentAvailable ? 'current' : 'catalog'} availability`, async ({ page }, info) => {
    await page.setViewportSize({ width: entry === 'background' ? 390 : 1440, height: 900 })
    const state = await fixture(page)
    if (!currentAvailable) state.state.group = '生图'
    const dialog = await open(page, entry)
    await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
    await expect(dialog.getByText(/正在读取(?:作品和可用模型|提示词和参考图)/)).toHaveCount(0)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    expect(state.selections).toEqual(currentAvailable ? [] : ['default'])
    await dialog.getByRole('button', { name: '模型价格', exact: true }).click()
    await expect(dialog.locator('.billing-cost')).toContainText('260')
    await page.keyboard.press('Escape')
    await dialog.getByRole('checkbox', { name: /作者参考图/ }).check()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${entry}-${currentAvailable}.png`) })
    if (entry === 'workbench') {
      await dialog.getByRole('button', { name: '导入提示词和参考图（1）', exact: true }).click()
      await page.getByRole('button', { name: '开始生成', exact: true }).click()
    } else await dialog.getByRole('button', { name: '后台生成同款', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect.poll(() => state.requests.length).toBe(1)
    expect(state.requests[0]).toMatchObject({ token: currentAvailable ? '41' : '52', body: { model: 'gpt-image-2', n: 2, size: '1200x900', sourceWorkId: 'remixgroups', referenceUrls: ['/legacy-files/reference'] } })
    if (entry === 'background') await expect(page).toHaveURL(/\/work\/remixgroups$/)
  })

  test(`${entry} reports missing model without a stuck loading message and retains references on retry`, async ({ page }) => {
    const state = await fixture(page)
    state.state.models.auto = []; state.state.models.default = []
    const dialog = await open(page, entry)
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByText(/正在读取(?:作品和可用模型|提示词和参考图)/)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /作者参考图/ }).check()
    state.state.models.default = ['gpt-image-2']
    await dialog.getByRole('button', { name: '重新读取原作', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('checkbox', { name: /作者参考图/ })).toBeChecked()
    expect(state.requests).toHaveLength(0)
  })

  test(`${entry} ends failed model loading and retries without changing groups`, async ({ page }) => {
    const state = await fixture(page)
    state.state.failModels = true
    const dialog = await open(page, entry)
    await expect(dialog.getByRole('alert')).toContainText('读取失败')
    await expect(dialog.getByText('正在读取作品和可用模型…', { exact: true })).toHaveCount(0)
    expect(state.selections).toEqual([])
    state.state.failModels = false
    await dialog.getByRole('button', { name: '重新读取原作', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
    expect(state.requests).toHaveLength(0)
  })

  test(`${entry} cancel restores the previous group after finding a usable same-name model`, async ({ page }) => {
    const state = await fixture(page)
    state.state.models.auto = ['other-image']
    const dialog = await open(page, entry)
    await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.selections).toEqual(['default'])
    expect(state.requests).toHaveLength(0)
  })
}

test('catalog failure is retryable and does not report a model as unavailable', async ({ page }) => {
  const state = await fixture(page)
  state.state.models.auto = []; state.state.failPricing = true
  const dialog = await open(page, 'background')
  await expect(dialog.getByRole('alert')).toContainText('读取失败')
  await expect(dialog.getByRole('alert')).not.toContainText('模型“gpt-image-2”暂不可用')
  await expect(dialog.getByText('正在读取作品和可用模型…', { exact: true })).toHaveCount(0)
  expect(state.selections).toEqual([])
})

for (const action of ['cancel', 'account'] as const) test(`a late catalog response cannot switch groups after ${action}`, async ({ page }) => {
  const state = await fixture(page)
  state.state.models.auto = []
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/model-pricing', async route => { started = true; await gate; await route.fallback() })
  const dialog = await open(page, 'background')
  await expect.poll(() => started).toBe(true)
  if (action === 'cancel') await dialog.getByRole('button', { name: '取消', exact: true }).click()
  else {
    state.account.state.user.id = '18'; state.account.state.user.accountId = '18'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }
  await expect(dialog).toHaveCount(0)
  const response = page.waitForResponse('**/api/new-api/model-pricing')
  release()
  await (await response).finished()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  await expect(page.getByRole('button', { name: '制作同款', exact: true })).toBeVisible()
  expect(state.selections).toEqual([]); expect(state.requests).toHaveLength(0)
})

test('a recognized image model remains usable when its account group is named video', async ({ page }) => {
  const state = await fixture(page)
  state.state.group = '视频'; state.state.models['视频'] = ['gpt-image-2']
  const dialog = await open(page, 'background')
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  expect(state.selections).toEqual([])
})

test('legacy source without a group uses the current same-name model instead of guessing an image group', async ({ page }) => {
  const state = await fixture(page)
  delete (state.source.generation.parameters as { group?: string }).group
  const dialog = await open(page, 'background')
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  expect(state.selections).toEqual([])
})

test('first model initialization refreshes the actual automatic group for pricing', async ({ page }) => {
  const state = await fixture(page)
  let initialized = false
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: initialized ? 'auto' : null, groups: [{ id: 'auto', name: 'auto' }] } } }))
  await page.route('**/api/creation/models', async route => { initialized = true; await route.fallback() })
  const dialog = await open(page, 'background')
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(dialog.locator('.billing-group')).toContainText('自动分组')
  await expect(dialog.locator('.billing-cost')).toContainText('260')
  expect(state.selections).toEqual([])
})

for (const entry of ['workbench', 'background'] as const) test(`${entry} cancels back to the initialized automatic group after fallback`, async ({ page }) => {
  const state = await fixture(page)
  state.state.models.auto = ['other-image']
  let initialized = false
  await page.route('**/api/new-api/model-groups', async route => {
    if (!initialized) return route.fulfill({ json: { success: true, data: { selectedGroup: null, groups: Object.keys(state.state.models).map(id => ({ id, name: id })) } } })
    await route.fallback()
  })
  await page.route('**/api/creation/models', async route => { initialized = true; await route.fallback() })
  const dialog = await open(page, entry)
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.selections).toEqual(['default'])
})

test('cancel waits for an in-flight group selection before restoring the previous group', async ({ page }) => {
  const state = await fixture(page)
  state.state.models.auto = []
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/models', async route => {
    if (route.request().postDataJSON().group === 'default') { started = true; await gate }
    await route.fallback()
  })
  const dialog = await open(page, 'background')
  await expect.poll(() => started).toBe(true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  release()
  await expect(dialog).toHaveCount(0)
  expect(state.selections).toEqual(['default']); expect(state.requests).toHaveLength(0)
})

test('a stalled model request ends with a retryable error', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    AbortSignal.timeout = ms => timeout(ms === 20000 ? 3000 : ms)
  })
  await page.route('**/api/creation/models', async () => {})
  const dialog = await open(page, 'background')
  await expect(dialog.getByText('正在读取作品和可用模型…', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 10000 })
  await expect(dialog.getByText('正在读取作品和可用模型…', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeDisabled()
})
