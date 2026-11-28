import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const originalPrompt = '原会话里的白猫'
const copiedPrompt = '副本里的黑猫'

async function fixture(page: Page) {
  const external: string[] = [], generated: any[] = []
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(String(test.info().project.use.baseURL)).origin) return route.continue()
    external.push(url.href)
    return route.abort()
  })
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'gpt-5', kinds: ['text'] },
    ] } })
    if (path.endsWith('/media')) return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      generated.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: `https://media.example/output-${generated.length}.png` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.addInitScript(({ originalPrompt }) => {
    if (sessionStorage.getItem('cloned-media-seeded')) return
    sessionStorage.setItem('cloned-media-seeded', '1')
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'original-image', mediaConversationsMigrated: true,
      sessions: [{ id: 'original-image', mediaConversationId: 'original-image', creationKind: 'image', topic: '图片原会话',
        model: 'gpt-image-2', settings: {}, skillIds: [], messages: [] }],
    } }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'original-image-task', conversationId: 'original-image', owner: '17', kind: 'image', phase: 'complete',
      protocol: 'sync', model: 'gpt-image-2', group: 'auto', prompt: originalPrompt, text: '',
      urls: ['https://media.example/original.png'], references: [], createdAt: Date.now(), settledAt: Date.now(),
      request: { size: 'auto', aspect_ratio: 'auto', n: 1, duration: 8 },
    }]))
  }, { originalPrompt })
  await page.goto('/create/image')
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  return { generated, external }
}

test('a copied image conversation appends edited results independently from the original', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: 800, height: viewport.height })
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '复制对话', exact: true }).click()
  await page.setViewportSize(viewport)
  const sidebar = page.locator('.studio-sidebar')
  const original = sidebar.getByRole('button', { name: '图片原会话', exact: true })
  const copied = sidebar.getByRole('button', { name: '图片原会话 副本', exact: true })
  await expect(copied).toHaveAttribute('aria-current', 'page')
  await original.click()
  await page.getByRole('button', { name: '继续创作', exact: true }).click()
  expect(state.generated).toHaveLength(0)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(1)
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveCount(0)
  await expect(page.locator('.creation-image-preview img').last()).toHaveAttribute('src', /^blob:/)
  expect(state.generated[0]).toMatchObject({ kind: 'image', model: 'gpt-image-2', prompt: originalPrompt })

  await copied.click()
  await expect(page.locator('.creation-request')).toContainText(originalPrompt)
  await expect(page.locator('.creation-image-preview img')).toHaveAttribute('src', /^blob:/)
  await page.getByRole('button', { name: '继续创作', exact: true }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(copiedPrompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(2)
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await expect(page.locator('.creation-request').first()).toContainText(originalPrompt)
  await expect(page.locator('.creation-request').last()).toContainText(copiedPrompt)
  await expect(page.locator('.creation-image-preview img').last()).toHaveAttribute('src', /^blob:/)
  expect(state.generated[1]).toMatchObject({ kind: 'image', model: 'gpt-image-2', prompt: copiedPrompt })

  await original.click()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await expect(page.locator('.creation-request').first()).toContainText(originalPrompt)
  await expect(page.locator('.creation-request').last()).not.toContainText(copiedPrompt)
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveCount(0)
  await expect(page.locator('.creation-image-preview img').last()).toHaveAttribute('src', /^blob:/)
  await copied.click()
  await expect(page.locator('.creation-request').last()).toContainText(copiedPrompt)
  await expect(page.locator('.creation-image-preview img').last()).toHaveAttribute('src', /^blob:/)
  await expect(page.getByRole('alert').filter({ hasText: '原生成记录不属于当前会话' })).toHaveCount(0)
  expect(state.generated).toHaveLength(2)
  expect(state.external).toEqual([])
  expect(errors).toEqual([])
})
