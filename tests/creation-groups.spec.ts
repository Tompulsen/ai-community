import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  await mockUnifiedAccount(page, true)
  const groups = [
    { id: 'auto', name: 'Auto', ratio: 1 },
    { id: '生图', name: '生图', ratio: 0.8, description: '图片创作分组' },
    { id: '视频', name: '视频', ratio: 1.5, description: '视频创作分组' },
  ]
  const state = { group: 'auto', tokenId: 41, fail: false }
  const selections: string[] = [], generationTokens: string[] = [], taskTokens: string[] = []
  const models = () => state.group === 'auto'
    ? [{ id: 'gpt-image-2', kinds: ['image'] }]
    : [{ id: state.group === '生图' ? 'image-alias' : 'video-alias', kinds: ['text'] }]
  await page.route('**/api/new-api/model-groups', route => {
    expect(route.request().headers()['x-new-api-user']).toBe('17')
    return route.fulfill({ json: { success: true, data: { groups, selectedGroup: state.group, selectedTokenId: state.tokenId } } })
  })
  await page.route('**/api/new-api/model-groups/select', route => {
    expect(route.request().headers()['x-new-api-user']).toBe('17')
    const group = route.request().postDataJSON().group
    selections.push(group)
    if (state.fail) return route.fulfill({ status: 409, json: { success: false, message: '分组密钥暂时不可用。' } })
    state.group = group; state.tokenId = group === '生图' ? 52 : group === '视频' ? 63 : 41
    return route.fulfill({ json: { success: true, data: { group, selectedTokenId: state.tokenId } } })
  })
  await page.route('**/api/creation/models', route => route.fulfill({ json: { tokenId: state.tokenId, items: models() } }))
  await page.route('**/api/creation/generate', route => {
    generationTokens.push(route.request().headers()['x-new-api-token'] || '')
    return route.fulfill({ json: { status: 'pending', upstreamId: 'job-1', tokenId: 63, protocol: 'openai', outputs: [] } })
  })
  await page.route('**/api/creation/tasks/**', route => {
    taskTokens.push(new URL(route.request().url()).searchParams.get('tokenId') || '')
    return route.fulfill({ json: { status: 'pending', upstreamId: 'job-1', tokenId: 63, protocol: 'openai', outputs: [] } })
  })
  return { state, selections, generationTokens, taskTokens }
}

test('group selection refreshes its models, preserves drafts and survives reload without another login', async ({ page }) => {
  const fixtureState = await fixture(page)
  await page.goto('/create/image')
  const group = page.getByRole('combobox', { name: '模型分组', exact: true })
  const model = page.getByRole('combobox', { name: '模型', exact: true })
  await expect(group).toHaveValue('auto')
  await expect(model).toHaveValue('gpt-image-2')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这段提示词')
  await group.selectOption('生图')
  await expect(model).toHaveValue('image-alias')
  await expect(page.getByText('图片创作分组', { exact: true })).toBeVisible()
  await expect(group.locator('option:checked')).toHaveText('生图 · 0.8×')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这段提示词')
  await page.reload()
  await expect(group).toHaveValue('生图')
  await expect(model).toHaveValue('image-alias')
  await expect(page.locator('iframe, .auth-login-form')).toHaveCount(0)
  expect(fixtureState.selections).toEqual(['生图'])
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/creation-groups/${width}.png`, fullPage: true })
  }
})

test('switching groups blocks generation and a failed selection restores authoritative state without retrying POST', async ({ page }) => {
  const fixtureState = await fixture(page)
  await page.goto('/create/image')
  const group = page.getByRole('combobox', { name: '模型分组', exact: true })
  await expect(group).toHaveValue('auto')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('测试')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/model-groups/select', async route => {
    await gate
    await route.fallback()
  })
  fixtureState.state.fail = true
  await group.selectOption('生图')
  await expect(group).toBeDisabled()
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('alert')).toContainText('分组密钥暂时不可用')
  await expect(group).toHaveValue('auto')
  await expect(group).toBeEnabled()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  expect(fixtureState.selections).toEqual(['生图'])
  expect(fixtureState.generationTokens).toEqual([])
})

test('video group aliases work and existing task polling retains its original token after switching', async ({ page }) => {
  const fixtureState = await fixture(page)
  await page.goto('/create/video')
  const group = page.getByRole('combobox', { name: '模型分组', exact: true })
  await expect(group).toHaveValue('auto')
  await group.selectOption('视频')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('video-alias')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('视频测试')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => fixtureState.taskTokens.length).toBeGreaterThan(0)
  await group.selectOption('auto')
  await expect(group).toHaveValue('auto')
  await expect.poll(() => fixtureState.taskTokens.length, { timeout: 10000 }).toBeGreaterThan(1)
  expect(fixtureState.generationTokens).toEqual(['63'])
  expect(fixtureState.taskTokens.every(token => token === '63')).toBe(true)
  await page.getByRole('button', { name: '停止等待', exact: true }).click()
})

test('an older model refresh cannot replace the selected group catalog', async ({ page }) => {
  await fixture(page)
  let release!: () => void
  let delayed = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/models', async route => {
    if (!delayed) {
      delayed = true
      await gate
      return route.fulfill({ json: { tokenId: 41, items: [{ id: 'stale-model', kinds: ['image'] }] } })
    }
    return route.fallback()
  })
  await page.goto('/create/image')
  const model = page.getByRole('combobox', { name: '模型', exact: true })
  await expect.poll(() => delayed).toBe(true)
  await page.getByRole('combobox', { name: '模型分组', exact: true }).selectOption('生图')
  await expect(model).toHaveValue('image-alias')
  release()
  await expect(page.getByRole('combobox', { name: '模型分组', exact: true })).toHaveValue('生图')
  await expect(model).toHaveValue('image-alias')
  await model.click()
  await expect(page.getByRole('dialog', { name: '选择模型' }).getByRole('button', { name: 'stale-model', exact: true })).toHaveCount(0)
})
