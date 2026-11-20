import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount, fillAccountLogin } from './helpers/account-fixture'

async function fixture(page: Page, authenticated = true, delayed = false) {
  const account = await mockUnifiedAccount(page, authenticated)
  account.state.user.id = '17'
  const calls: any[] = []
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') {
      if (delayed) await new Promise(resolve => setTimeout(resolve, 900))
      return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] }] } })
    }
    if (path === '/api/creation/generate') {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/entry.png' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  return { ...account, calls }
}

for (const kind of ['image', 'video'] as const) {
  test('homepage hands ' + kind + ' prompt and reference to Studio once', async ({ page }) => {
    const { calls } = await fixture(page, true, true)
    await page.goto('/create/image')
    const oldPrompt = page.getByRole('textbox', { name: '提示词', exact: true })
    await expect(oldPrompt).toBeEnabled()
    await oldPrompt.fill('保留原会话的草稿')
    await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
    const composer = page.getByRole('form', { name: '快捷创作', exact: true })
    if (kind === 'video') await page.getByRole('button', { name: '视频生成', exact: true }).click()
    await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('海边日落下的一座灯塔')
    await composer.getByLabel('添加参考图', { exact: true }).setInputFiles('public/assets/brand/octopus-community.jpg')
    await expect(composer.getByRole('button', { name: '预览参考图 1', exact: true })).toBeVisible()
    await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/create/' + kind))
    await expect.poll(() => calls.length).toBe(1)
    expect(calls[0]).toMatchObject({ kind, prompt: '海边日落下的一座灯塔' })
    expect(calls[0].referenceUrls).toHaveLength(1)
    expect(new URL(page.url()).searchParams.has('start')).toBe(false)
    await page.reload()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
    expect(calls).toHaveLength(1)
    const drafts = await page.evaluate(async () => {
      const modulePath = '/src/native-chat.ts'
      const { chats, loadChats } = await import(modulePath)
      await loadChats()
      return chats.sessions.map((chat: any) => chat.mediaDrafts?.image?.prompt)
    })
    expect(drafts).toContain('保留原会话的草稿')
  })
}

test('guest input survives login and starts in Studio', async ({ page }) => {
  const { calls } = await fixture(page, false)
  await page.goto('/discover')
  await page.getByRole('textbox', { name: '创作描述', exact: true }).fill('访客输入的完整描述')
  await page.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await page.getByRole('main').getByRole('link', { name: '登录', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  await fillAccountLogin(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].prompt).toBe('访客输入的完整描述')
})

test('composition does not send, and lower search remains independent', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  const prompt = page.getByRole('textbox', { name: '创作描述', exact: true })
  await prompt.fill('尚未发送的创作')
  await prompt.dispatchEvent('compositionstart')
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  await prompt.dispatchEvent('compositionend')
  await expect(page).toHaveURL('http://localhost:18775/discover')
  expect(calls).toHaveLength(0)
  await page.getByRole('searchbox', { name: '搜索作品', exact: true }).fill('灯塔')
  await expect(page).toHaveURL(/q=/)
  await expect(prompt).toHaveValue('尚未发送的创作')
})

test('composer and lower filters fit desktop and phones in both themes', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    for (const width of [1440, 1000, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('form', { name: '快捷创作', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width >= 1000) {
        const creation = (await page.locator('.discovery-creation').boundingBox())!
        const search = (await page.locator('.discovery-search').boundingBox())!
        expect(search.y).toBeGreaterThanOrEqual(creation.y + creation.height)
        await expect(page.locator('.app-header [role="search"]')).toHaveCount(0)
      }
      await page.screenshot({ path: test.info().outputPath('composer-' + mode + '-' + width + '.png'), animations: 'disabled' })
    }
    expect((await new AxeBuilder({ page }).include('.discovery-creation').analyze()).violations).toEqual([])
  }
})
