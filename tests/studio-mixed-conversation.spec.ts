import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  const calls: any[] = []
  let wait: Promise<void> | undefined, release: (() => void) | undefined
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/media')) {
      const isVideo = new URL(route.request().url()).searchParams.get('url')?.includes('.mp4')
      return route.fulfill({ contentType: isVideo ? 'video/mp4' : 'image/jpeg', body: isVideo ? video : image })
    }
    if (path.endsWith('/generate')) {
      const input = route.request().postDataJSON()
      calls.push(input)
      if (wait) await wait
      return route.fulfill({ json: { status: 'succeeded', outputs: input.kind === 'text' ? [{ text: '保留在当前对话中的回答。' }] : [{ url: `https://media.example/${calls.length}.${input.kind === 'video' ? 'mp4' : 'jpg'}` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mixed-fixture')) return
    sessionStorage.setItem('mixed-fixture', '1')
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, mediaConversationsMigrated: true, activeId: 'same-thread', sessions: [
        { id: 'same-thread', creationKind: 'text', topic: '同一条对话', renamed: true, settings: {}, skillIds: [], messages: [
          { id: 'q', role: 'user', content: '原有消息' }, { id: 'a', role: 'assistant', content: '原有回答' },
        ] },
      ],
    } }))
  })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  return { calls, hold() { wait = new Promise<void>(resolve => { release = resolve }) }, release() { release?.(); wait = undefined } }
}
async function mode(page: Page, value: 'text' | 'image' | 'video') {
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: value === 'text' ? '对话' : value === 'image' ? '图片生成' : '视频生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: value === 'text' ? '消息' : '提示词', exact: true })).toBeVisible()
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves the existing application module.
    const { readChatSnapshot } = await import('/shared/studio/chat-persistence.ts')
    const { state } = await readChatSnapshot('octopus:user-17:native-chat')
    const chat = state.sessions.find((chat: any) => chat.id === state.activeId)
    return { id: state.activeId, count: state.sessions.length, title: chat?.topic, messages: chat?.messages.length }
  })
}
async function send(page: Page, kind: 'text' | 'image' | 'video', prompt: string) {
  await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill(prompt)
  await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
}

test('mode switches preserve conversation, transcript and independent drafts without sending requests', async ({ page }) => {
  const { calls } = await fixture(page), before = await snapshot(page)
  const transcript = await page.locator('.chat-messages').elementHandle()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('文字草稿')
  await mode(page, 'image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('图片草稿')
  await mode(page, 'video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('视频草稿')
  for (const [kind, draft] of [['text', '文字草稿'], ['image', '图片草稿'], ['video', '视频草稿']] as const) {
    await mode(page, kind)
    await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toHaveValue(draft)
    expect(await snapshot(page)).toEqual(before)
    expect(await transcript!.evaluate(element => element.isConnected && element === document.querySelector('.chat-messages'))).toBe(true)
    await expect(page.locator('.chat-transcript')).toContainText('原有回答')
  }
  expect(calls).toHaveLength(0)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('视频草稿')
  expect(await snapshot(page)).toEqual(before)
  await mode(page, 'text')
  await expect(page.locator('.generation-speed')).toHaveCount(0)
  await expect(page.getByText(/tok\/s/)).toHaveCount(0)
})

test('text, images and video append in order to one conversation and survive reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { calls } = await fixture(page)
  await send(page, 'text', '先讨论构图')
  await mode(page, 'image'); await send(page, 'image', '生成一张图片')
  await mode(page, 'video'); await send(page, 'video', '生成一段视频')
  await mode(page, 'text'); await send(page, 'text', '继续聊这个作品')
  expect(await snapshot(page)).toEqual({ id: 'same-thread', count: 1, title: '同一条对话', messages: 10 })
  await expect(page.locator('.studio-message.user')).toHaveCount(5)
  await expect(page.locator('.studio-message.assistant')).toHaveCount(5)
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await expect(page.locator('.creation-image-preview img')).toHaveCount(1)
  await expect(page.locator('.creation-response video')).toHaveCount(1)
  const history = calls.at(-1).chatOptions.messages
  expect(history.some((message: any) => message.role === 'assistant' && message.content === '')).toBe(false)
  expect(JSON.stringify(history)).not.toContain('studio-asset:')
  expect(calls.map(call => call.kind)).toEqual(['text', 'image', 'video', 'text'])
  await page.reload()
  await expect(page.locator('.studio-message.assistant')).toHaveCount(5)
  expect((await snapshot(page)).id).toBe('same-thread')
  await mkdir('.taste-skill/mixed-conversation-20261115', { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/mixed-conversation-20261115/mixed-${width}.png` })
  }
  expect(errors).toEqual([])
})

test('switching during image generation keeps its result and prevents a competing submission', async ({ page }) => {
  const state = await fixture(page)
  await mode(page, 'image'); state.hold()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('生成中切换')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await mode(page, 'video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('稍后生成视频')
  try {
    await expect(page.locator('.creation-response .ai-status')).toBeVisible()
    expect((await snapshot(page)).id).toBe('same-thread')
    expect(state.calls).toHaveLength(1)
  } finally { state.release() }
  await expect(page.locator('.creation-image-preview img')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('稍后生成视频')
  await mode(page, 'image')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  expect(await snapshot(page)).toEqual({ id: 'same-thread', count: 1, title: '同一条对话', messages: 4 })
})

test('reused image parameters remain intact after changing modes', async ({ page }) => {
  await fixture(page)
  await mode(page, 'image')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('spinbutton', { name: '图片数量', exact: true }).fill('2')
  await page.locator('.parameter-advanced > summary').click()
  await page.getByRole('textbox', { name: '随机种子', exact: true }).fill('42')
  await page.keyboard.press('Escape')
  await send(page, 'image', '复用完整参数')
  await mode(page, 'text')
  await page.locator('.creation-response').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: '复用参数', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('复用完整参数')
  await mode(page, 'video'); await mode(page, 'image')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '图片数量', exact: true })).toHaveValue('2')
  await page.locator('.parameter-advanced > summary').click()
  await expect(page.getByRole('textbox', { name: '随机种子', exact: true })).toHaveValue('42')
  expect((await snapshot(page)).id).toBe('same-thread')
})
