import { mkdir, readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const screenshots = '.impeccable/review/studio-mobile'
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let submissions = 0
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { currency: 'USD', rows: [{ model: 'fixture-image', group: 'auto', billing: '每次请求', price: 'USD 0.15' }] } } }))
  await page.route('**/api/new-api/session', route => route.fulfill({ json: { success: true, data: { selectedTokenId: 41 } } }))
  await page.route('**/api/new-api/groups', route => route.fulfill({ json: { success: true, data: [{ id: 'auto', name: 'Auto' }] } }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { items: [{ id: 'fixture-image', name: '图片模型', kinds: ['image'] }, { id: 'fixture-video', name: '视频模型', kinds: ['video'] }, { id: 'fixture-text', name: '对话模型', kinds: ['text'] }] } })
    if (path === '/api/creation/media') return route.fulfill({ body: photo, contentType: 'image/jpeg' })
    if (path === '/api/creation/generate') {
      submissions++
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/mobile.jpg' }] } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  return { ...account, submissions: () => submissions }
}

test('compact image workspace keeps input and actions usable at phone and keyboard heights', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('一只躺在窗边的小猫')
  await expect(page.locator('.studio-billing')).toContainText('USD 0.15')
  await expect(page.locator('.studio-billing')).toContainText('USD 12.5')
  await mkdir(screenshots, { recursive: true })
  for (const [width, height] of [[390, 844], [320, 568], [390, 420]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const input = box('.composer-input'), send = box('.composer-submit'), composer = box('.studio-composer'), toolbar = box('.studio-page-toolbar')
      return { sameRow: Math.abs(input.y - send.y) <= 3, compact: composer.height <= 152, visible: composer.bottom <= innerHeight, toolbar: toolbar.height <= 61 }
    })).toEqual({ sameRow: true, compact: true, visible: true, toolbar: true })
    await expect(page.locator('.app-header')).not.toBeVisible()
    await expect(page.getByRole('button', { name: '作品库', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '模型定价', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '高级参数', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '画面比例', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveValue('一只躺在窗边的小猫')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    await page.screenshot({ path: `${screenshots}/image-${width}-${height}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await prompt.press('Enter')
  expect(state.submissions()).toBe(0)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library.locator('.gallery-item')).toHaveCount(1)
  await library.getByRole('searchbox', { name: '搜索生成记录', exact: true }).fill('小猫')
  await library.locator('.gallery-cover').click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭媒体预览', exact: true }).click()
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await expect(library.getByRole('searchbox', { name: '搜索生成记录', exact: true })).toHaveValue('小猫')
  await library.getByRole('button', { name: '复用参数', exact: true }).click()
  await expect(library).not.toBeVisible()
  await expect(prompt).toHaveValue('一只躺在窗边的小猫')
  await page.getByRole('button', { name: '新建创作', exact: true }).click()
  await expect(prompt).toHaveValue('')
  await page.getByRole('button', { name: '创作导航', exact: true }).click()
  await page.getByRole('button', { name: '视频', exact: true }).click()
  await expect(page).toHaveURL(/create\/video/)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-video')
  expect((await new AxeBuilder({ page }).include('.create-page').analyze()).violations).toEqual([])
  expect(state.submissions()).toBe(1)
})

test('mobile chat retains tools and navigation and pricing uses the actual account service', async ({ page }) => {
  const state = await fixture(page)
  let skillReads = 0
  await page.route('**/api/creation/skills/catalog', route => { skillReads++; return route.fulfill({ json: { items: [] } }) })
  await page.goto('/create/text')
  const message = page.getByRole('textbox', { name: '消息', exact: true })
  await message.fill('想写一个海底故事')
  expect(skillReads).toBe(0)
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  await page.getByRole('button', { name: '联网搜索', exact: true }).click()
  await page.getByRole('dialog', { name: '联网搜索', exact: true }).getByRole('button', { name: '快速搜索', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对话参数', exact: true })).toBeVisible()
  const skills = page.getByRole('dialog', { name: '对话参数', exact: true }).locator('.mobile-chat-tools > details > summary')
  await skills.click()
  await expect.poll(() => skillReads).toBe(1)
  await skills.click()
  await skills.click()
  expect(skillReads).toBe(1)
  await page.keyboard.press('Escape')
  await expect(message).toHaveValue('想写一个海底故事')
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: `${screenshots}/chat-390.png`, fullPage: true })
  await page.getByRole('button', { name: '模型定价', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'USD 0.15', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回创作', exact: true }).click()
  await expect(message).toHaveValue('想写一个海底故事')
  await page.getByRole('button', { name: '模型定价', exact: true }).click()
  await page.getByRole('button', { name: '新建创作', exact: true }).click()
  await expect(message).toHaveValue('')
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await expect(page.getByRole('link', { name: '账号设置', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(state.submissions()).toBe(0)
})

test('mobile library restores parameters across image and video routes without resubmitting', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('竖幅小猫图片')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('combobox', { name: '画面比例', exact: true }).selectOption('9:16')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await page.getByRole('button', { name: '创作导航', exact: true }).click()
  await page.getByRole('button', { name: '视频', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-video')
  await prompt.fill('横幅小猫视频')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  for (const [kind, text, ratio] of [['image', '竖幅小猫图片', '9:16'], ['video', '横幅小猫视频', '16:9']]) {
    await page.getByRole('button', { name: '作品库', exact: true }).click()
    await page.getByRole('dialog', { name: '作品库', exact: true }).locator('.gallery-item').filter({ hasText: text }).getByRole('button', { name: '复用参数', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/create/${kind}$`))
    await expect(prompt).toHaveValue(text!)
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(`fixture-${kind}`)
    await page.getByRole('button', { name: '高级参数', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '画面比例', exact: true })).toHaveValue(ratio!)
    await page.keyboard.press('Escape')
    await prompt.fill(`${text}后续草稿`)
    await page.getByRole('button', { name: '模型定价', exact: true }).click()
    await page.getByRole('button', { name: '返回创作', exact: true }).click()
    await expect(prompt).toHaveValue(`${text}后续草稿`)
  }
  expect(state.submissions()).toBe(2)
})

test('missing pricing and balance are shown as unavailable, never as free', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/account', route => route.fulfill({ status: 503, json: { message: '稍后重试' } }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ status: 503, json: { success: false, message: '稍后重试' } }))
  await page.goto('/create/image')
  await expect(page.locator('.studio-billing')).toContainText('查看定价')
  await expect(page.locator('.billing-balance')).toHaveText('可用 —')
  await page.route('**/api/account', route => route.fulfill({ json: { balance: 0, currencySymbol: 'USD' } }))
  await page.getByRole('button', { name: '刷新费用和额度', exact: true }).click()
  await expect(page.locator('.billing-balance')).toHaveText('可用 USD 0')
})
