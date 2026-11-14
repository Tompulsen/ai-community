import { test, expect, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
const catalog = [
  { id: 'gpt-image-2', kinds: ['image'] }, { id: 'gpt-5', kinds: ['text'] },
  { id: 'claude-opus', kinds: ['text'], description: '长文推理与分析' },
  { id: 'sora-2', kinds: ['video'] }, { id: 'image-alias', kinds: ['text'] },
  { id: 'gemini-long-model-name-with-custom-configuration-20261114', kinds: ['text'] },
]
const groups = [
  { id: 'other', name: '其他分组', ratio: 0.6 }, { id: 'auto', name: 'Auto' },
  ...Array.from({ length: 12 }, (_, index) => ({ id: `group-${index}`, name: `可用分组 ${index + 1}`, ratio: index === 0 ? 0 : 1.5 })),
]
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const state = { group: 'auto', tokenId: 41 }
  const requests: any[] = []
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { groups, selectedGroup: state.group } } }))
  await page.route('**/api/new-api/model-groups/select', route => {
    state.group = route.request().postDataJSON().group; state.tokenId = state.group === 'auto' ? 41 : 52
    return route.fulfill({ json: { success: true, data: { group: state.group, selectedTokenId: state.tokenId } } })
  })
  await page.route('**/api/creation/models', route => route.fulfill({ json: { tokenId: state.tokenId, items: catalog } }))
  await page.route('**/api/creation/generate', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { status: 'succeeded', tokenId: state.tokenId, protocol: 'sync', outputs: [{ text: '模拟回答' }] } })
  })
  return { ...account, state, requests }
}
async function open(page: Page) {
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  return page.getByRole('dialog', { name: '选择模型', exact: true })
}
test('search, vendor filters and favorites work, persist and remain isolated by group token', async ({ page }) => {
  await fixture(page); await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  let dialog = await open(page)
  await dialog.getByRole('button', { name: 'Anthropic 1' }).click()
  await expect(dialog.locator('.model-option')).toHaveCount(1)
  await dialog.getByRole('button', { name: '收藏: claude-opus', exact: true }).click()
  await dialog.getByRole('button', { name: '收藏 1', exact: true }).click()
  await expect(dialog.locator('.model-option')).toHaveCount(1)
  await dialog.getByRole('searchbox', { name: '搜索模型' }).fill('不存在的模型')
  await expect(dialog.getByText('暂无匹配模型')).toBeVisible()
  await page.keyboard.press('Escape'); await page.reload()
  dialog = await open(page)
  await expect(dialog.getByRole('button', { name: '取消收藏: claude-opus', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '选择分组', exact: true }).click()
  await dialog.getByRole('button', { name: '其他分组 · 0.6×', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '收藏: claude-opus', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await dialog.getByRole('button', { name: '选择分组', exact: true }).click()
  await dialog.getByRole('button', { name: 'Auto 系统', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '取消收藏: claude-opus', exact: true })).toBeVisible()
})
test('full group selector shows every group and ratio, scrolls on phones and closes accessibly', async ({ page }) => {
  await fixture(page); await page.goto('/create/image')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  for (const [width, mode] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), mode)
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    const dialog = await open(page), trigger = dialog.getByRole('button', { name: '选择分组', exact: true })
    await expect(dialog.getByRole('combobox', { name: '模型分组', exact: true })).toHaveCount(0)
    await trigger.click()
    const options = dialog.getByRole('group', { name: '可选分组', exact: true })
    await expect(options.getByRole('button')).toHaveCount(14)
    await expect(options.getByRole('button').first()).toHaveAccessibleName('Auto 系统')
    await expect(options.getByRole('button', { name: '可用分组 1 · 0×', exact: true })).toBeVisible()
    await expect(options.getByRole('button', { name: 'Auto 系统', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(options.getByRole('button').last()).toBeFocused()
    expect(await options.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Home')
    await expect(options.getByRole('button').first()).toBeFocused()
    await page.screenshot({ path: `.taste-skill/group-source-20261114/${width}-${mode}.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await expect(options).not.toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByRole('heading', { name: '选择模型', exact: true }).click()
    await expect(options).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  }
  expect(errors).toEqual([])
})
test('failed group selection reconciles state once and keeps the picker usable', async ({ page }) => {
  const state = await fixture(page); await page.goto('/create/image')
  let attempts = 0
  await page.route('**/api/new-api/model-groups/select', async route => {
    attempts++
    return route.fulfill({ status: 409, json: { success: false, message: '分组暂时不可用。' } })
  })
  const dialog = await open(page), trigger = dialog.getByRole('button', { name: '选择分组', exact: true })
  await trigger.click()
  await dialog.getByRole('button', { name: '其他分组 · 0.6×', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('分组暂时不可用')
  await expect(trigger).toBeEnabled()
  await expect(trigger).toContainText('Auto')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  expect(attempts).toBe(1)
  expect(state.requests).toEqual([])
})
test('cross-mode selection preserves the chosen non-default model and existing image draft', async ({ page }) => {
  await fixture(page); await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留图片草稿')
  let dialog = await open(page)
  await dialog.getByRole('button', { name: 'claude-opus', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/text$/)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('claude-opus')
  dialog = await open(page)
  await dialog.getByRole('button', { name: 'gpt-image-2', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image$/)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留图片草稿')
})
test('manual type and text API format are saved and used by the actual generation request', async ({ page }) => {
  const state = await fixture(page); await page.goto('/create/image')
  let dialog = await open(page)
  await dialog.getByRole('button', { name: '调整模型类型: image-alias', exact: true }).click()
  await dialog.getByRole('combobox', { name: '模型类型', exact: true }).selectOption('image')
  await dialog.getByRole('button', { name: 'image-alias', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('image-alias')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('image-alias')
  dialog = await open(page)
  await dialog.getByRole('button', { name: '调整模型类型: claude-opus', exact: true }).click()
  await dialog.getByRole('combobox', { name: '接口格式', exact: true }).selectOption('claude')
  await dialog.getByRole('button', { name: 'claude-opus', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('claude-opus')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('格式测试')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(1)
  expect(state.requests[0].chatOptions.format).toBe('claude')
  expect(state.requests[0].model).toBe('claude-opus')
  dialog = await open(page)
  await dialog.getByRole('button', { name: 'gpt-5', exact: true }).click()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('默认格式测试')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  expect(state.requests[1].chatOptions.format).toBe('chat-completions')
})
test('picker fits desktop and small phones, keeps keyboard focus and shows all vendor assets', async ({ page }) => {
  await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  for (const [width, mode] of [[1440, 'dark'], [390, 'dark'], [320, 'dark'], [1440, 'light'], [320, 'light']] as const) {
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), mode)
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    const dialog = await open(page)
    await expect(dialog.getByRole('searchbox', { name: '搜索模型' })).toBeFocused()
    await expect.poll(() => dialog.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/model-picker-20261114/${width}-${mode}.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeFocused()
  }
  expect(errors).toEqual([])
})
