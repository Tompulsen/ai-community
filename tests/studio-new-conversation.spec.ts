import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, kind: 'text' | 'image' | 'video') {
  const account = await mockUnifiedAccount(page, true)
  const generations: string[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/generate')) generations.push(path)
    return route.fulfill({ json: { tokenId: 41, items: path.endsWith('/models') ? [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] : [] } })
  })
  await page.addInitScript(({ owner, kind }) => {
    if (sessionStorage.getItem('new-conversation-fixture')) return
    sessionStorage.setItem('new-conversation-fixture', '1')
    localStorage.setItem(`octopus:user-${owner}:native-chat`, JSON.stringify({ version: 1, state: {
      _hasHydrated: true, mediaConversationsMigrated: true, activeId: 'old-thread', sessions: [{
        id: 'old-thread', creationKind: kind, composerKind: kind, topic: '电商海报', renamed: true,
        settings: {}, skillIds: [], draft: kind === 'text' ? '保留旧对话草稿' : '',
        mediaDrafts: { [kind]: { prompt: '保留旧对话草稿', references: kind === 'image' ? [{ name: '保留的参考图.png',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5l8AAAAASUVORK5CYII=',
        }] : [] } },
        messages: [{ id: 'old-question', role: 'user', content: '旧对话里的问题' },
          { id: 'old-answer', role: 'assistant', content: '旧对话里的回答' }],
      }, { id: 'text-thread', creationKind: 'text', composerKind: 'text', topic: '文字笔记', renamed: true,
        settings: {}, skillIds: [], draft: '文字笔记草稿', messages: [{ id: 'text-answer', role: 'assistant', content: '文字笔记里的回答' }],
      }],
    } }))
  }, { owner: account.state.user.id, kind })
  await page.goto(`/create/${kind}?conversation=old-thread`)
  await expect(page.locator('.chat-transcript')).toContainText('旧对话里的回答')
  const prompt = page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })
  await expect(prompt).toHaveValue('保留旧对话草稿')
  return { prompt, generations, account }
}

for (const kind of ['image', 'video', 'text'] as const) {
  test(`new ${kind} conversation replaces the old transcript and preserves both chats after reload`, async ({ page }) => {
    const { prompt, generations } = await fixture(page, kind)
    const sidebar = page.locator('.studio-sidebar')
    await sidebar.getByRole('button', { name: '新对话', exact: true }).click()
    await expect(page.getByText('旧对话里的回答', { exact: true })).toHaveCount(0)
    await expect(sidebar.locator('button[aria-current="page"]')).toHaveAttribute('aria-label', '新对话')
    await expect(prompt).toHaveValue('')
    await expect(page.getByRole('button', { name: '移除参考图 1', exact: true })).toHaveCount(0)
    await prompt.fill('新对话独立草稿')
    await page.reload()
    await expect(prompt).toHaveValue('新对话独立草稿')
    await expect(page.getByText('旧对话里的回答', { exact: true })).toHaveCount(0)
    await sidebar.getByRole('button', { name: '电商海报', exact: true }).click()
    await expect(page.locator('.chat-transcript')).toContainText('旧对话里的回答')
    await expect(prompt).toHaveValue('保留旧对话草稿')
    if (kind === 'image') await expect(page.getByRole('button', { name: '移除参考图 1', exact: true })).toBeVisible()
    await sidebar.getByRole('navigation', { name: '全部会话', exact: true }).getByRole('button', { name: '新对话', exact: true }).click()
    await expect(prompt).toHaveValue('新对话独立草稿')
    await expect(page.getByText('旧对话里的回答', { exact: true })).toHaveCount(0)
    expect(generations).toEqual([])
  })
}

test('selecting a saved media conversation from text keeps its own mode before creating a new chat', async ({ page }) => {
  const { prompt, generations } = await fixture(page, 'image')
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '文字笔记', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/text$/)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('文字笔记草稿')
  await sidebar.getByRole('button', { name: '电商海报', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image\?conversation=old-thread$/)
  await expect(prompt).toHaveValue('保留旧对话草稿')
  await expect(page.getByRole('button', { name: '移除参考图 1', exact: true })).toBeVisible()
  await page.locator('.studio-sidebar-create').click()
  await expect(prompt).toHaveValue('')
  await expect(page.getByText('旧对话里的回答', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '移除参考图 1', exact: true })).toHaveCount(0)
  expect(generations).toEqual([])
})

for (const entry of ['desktop', 'mobile', 'account-tools'] as const) {
  test(`${entry} new conversation entry stays empty across repeated creation and old-chat selection`, async ({ page }) => {
    const { prompt, generations } = await fixture(page, 'image')
    if (entry === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
    for (let index = 0; index < 2; index++) {
      if (entry === 'mobile') await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
      if (entry === 'account-tools') {
        await page.getByRole('button', { name: '创作台菜单：设置', exact: true }).click()
        await page.getByRole('button', { name: '消费记录', exact: true }).click()
      }
      await page.locator('.studio-sidebar-create:visible').click()
      await expect(page.getByText('旧对话里的回答', { exact: true })).toHaveCount(0)
      await expect(prompt).toBeVisible()
      await expect(prompt).toHaveValue('')
      await expect(page.getByRole('dialog', { name: '工作台侧边栏', exact: true })).not.toBeVisible()
      if (entry === 'mobile') await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
      await page.locator('.studio-sidebar:visible').getByRole('button', { name: '电商海报', exact: true }).click()
      await expect(page.locator('.chat-transcript')).toContainText('旧对话里的回答')
      await expect(prompt).toHaveValue('保留旧对话草稿')
    }
    expect(generations).toEqual([])
  })
}
