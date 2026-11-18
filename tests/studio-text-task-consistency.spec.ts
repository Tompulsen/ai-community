import { mockPublicationTags, completePublicationFields } from './helpers/publication-fixture'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const originalAnswer = '原始回答 A：尚未修订。'
const editedAnswer = '修订回答 B：这是应当下载和发布的内容。'
const prompt = '请写一段用于发布的文字'

async function fixture(page: Page, reuseGroup?: 'available' | 'missing') {
  const external: string[] = [], generated: { body: any; token: string | undefined }[] = []
  const uploads: { name: string; type: string; text: string }[] = [], submitted: any[] = [], selections: string[] = []
  let selectedGroup = 'auto', loseResponse = false
  const groupGate = { enabled: false, entered: 0, release: () => {} }
  const groupResponse = new Promise<void>(resolve => { groupGate.release = resolve })
  const records = new Map<string, { id: string; title: string; status: string }>()
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://localhost:18775') return route.continue()
    external.push(url.href)
    return route.abort()
  })
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await mockPublicationTags(page)
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: {
    selectedGroup, selectedTokenId: selectedGroup === 'G' ? 52 : 41,
    groups: [{ id: 'auto', name: 'Auto', ratio: 1 }, ...(reuseGroup === 'missing' ? [] : [{ id: 'G', name: '原任务分组', ratio: 0.5 }])],
  } } }))
  await page.route('**/api/new-api/model-groups/select', async route => {
    const group = route.request().postDataJSON().group
    selections.push(group)
    if (groupGate.enabled) { groupGate.entered++; await groupResponse }
    selectedGroup = group
    return route.fulfill({ json: { success: true, data: { group, selectedTokenId: group === 'G' ? 52 : 41 } } })
  })
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: {
      tokenId: selectedGroup === 'G' ? 52 : 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }],
    } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      generated.push({ body: route.request().postDataJSON(), token: route.request().headers()['x-new-api-token'] })
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: originalAnswer }], tokenId: selectedGroup === 'G' ? 52 : 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: {
    maxFileSizeMb: 20, imagesMb: 20, videosMb: 20, filesMb: 20,
  } }))
  await page.route('**/api/uploads', async route => {
    const request = route.request()
    const form = await new Request(request.url(), {
      method: 'POST', headers: request.headers(), body: request.postDataBuffer(),
    }).formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new Error('Expected the published Markdown file')
    uploads.push({ name: file.name, type: file.type, text: await file.text() })
    return route.fulfill({ json: { file: { id: `document-${uploads.length}`, name: file.name, type: file.type, size: file.size, url: `/legacy-files/document-${uploads.length}` } } })
  })
  await page.route('**/api/works**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path === '/api/works') {
      const body = request.postDataJSON()
      submitted.push(body)
      const key = `${body.destination}:${body.resultId}`
      const work = records.get(key) || { id: `published-${records.size + 1}`, title: body.title, status: 'published' }
      records.set(key, work)
      if (loseResponse) {
        loseResponse = false
        return route.fulfill({ status: 503, json: { message: '提交响应丢失，请重试。' } })
      }
      return route.fulfill({ json: { work } })
    }
    if (path.startsWith('/api/works/published-')) {
      return route.fulfill({ json: { work: [...records.values()].find(work => path === `/api/works/${work.id}`) } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  if (reuseGroup) await page.addInitScript(({ prompt, originalAnswer }) => {
    if (sessionStorage.getItem('text-task-consistency-seeded')) return
    sessionStorage.setItem('text-task-consistency-seeded', '1')
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, mediaConversationsMigrated: true, activeId: 'reuse-text-thread',
      sessions: [{ id: 'reuse-text-thread', creationKind: 'text', topic: '原任务', model: 'gpt-5', settings: {}, skillIds: [], messages: [] }],
    } }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'reused-text-task', owner: '17', kind: 'text', phase: 'complete', protocol: 'sync', model: 'gpt-5', group: 'G',
      prompt, text: originalAnswer, urls: [], references: [], createdAt: Date.now(), settledAt: Date.now(),
      request: { size: 'auto', aspect_ratio: 'auto', n: 1, duration: 8,
        chatOptions: { format: 'responses', temperature: 0.2, max_tokens: 1234, stream: false,
          messages: [{ role: 'user', content: prompt }] } },
    }]))
  }, { prompt, originalAnswer })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  return { generated, uploads, submitted, selections, external, records, groupGate,
    loseNextResponse() { loseResponse = true }, currentGroup: () => selectedGroup }
}

async function generate(page: Page) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText(originalAnswer)
  await expect(page.getByRole('button', { name: '下载文本', exact: true })).toBeVisible()
}

async function editAnswer(page: Page) {
  await page.locator('.chat-message.assistant').hover()
  await page.getByRole('button', { name: '编辑回答', exact: true }).click()
  const editor = page.getByRole('form', { name: '编辑消息', exact: true })
  await editor.getByRole('textbox', { name: '消息内容', exact: true }).fill(editedAnswer)
  await editor.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText(editedAnswer)
}

async function reuseTextTask(page: Page) {
  await page.locator('.studio-sidebar').getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library).toBeVisible()
  await library.getByRole('tab', { name: '任务', exact: true }).click()
  await library.getByRole('button', { name: '复用参数', exact: true }).click()
  await expect(library).not.toBeVisible()
}

test('editing an answer downloads the visible text rather than the original task output', async ({ page }) => {
  const state = await fixture(page)
  await generate(page)
  await editAnswer(page)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载文本', exact: true }).click()
  const download = await downloading
  expect(await readFile((await download.path())!, 'utf8')).toBe(editedAnswer)
  expect(state.generated).toHaveLength(1)
  expect(state.external).toEqual([])
})

test('an edited answer reopens as a fresh publication draft and uploads its visible Markdown', async ({ page }) => {
  const state = await fixture(page)
  await generate(page)
  await editAnswer(page)
  const dialog = page.getByRole('dialog', { name: '发布作品', exact: true })
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue(editedAnswer)
  await dialog.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue(editedAnswer)
  await completePublicationFields(page)
  await dialog.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '查看提交', exact: true })).toBeVisible()
  expect(state.uploads).toEqual([{ name: 'creation.md', type: 'text/markdown', text: editedAnswer }])
  expect(state.submitted[0]).toMatchObject({ body: editedAnswer, kind: 'resource', fileIds: ['document-1'] })
  expect(state.generated).toHaveLength(1)
  expect(state.external).toEqual([])
})

test('a submitted text publication retains its original retry snapshot after a later answer edit', async ({ page }) => {
  const state = await fixture(page)
  await generate(page)
  state.loseNextResponse()
  const dialog = page.getByRole('dialog', { name: '发布作品', exact: true })
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await completePublicationFields(page)
  await dialog.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('提交响应丢失')
  await dialog.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  await editAnswer(page)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue(originalAnswer)
  await expect(dialog.getByRole('textbox', { name: '作品简介', exact: true })).toBeDisabled()
  await completePublicationFields(page)
  await dialog.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog.getByRole('link', { name: '查看提交', exact: true })).toBeVisible()
  expect(state.submitted).toHaveLength(2)
  expect(state.submitted[1]).toEqual(state.submitted[0])
  expect(state.uploads).toEqual([{ name: 'creation.md', type: 'text/markdown', text: originalAnswer }])
  expect(state.records.size).toBe(1)
  expect(state.generated).toHaveLength(1)
  expect(state.external).toEqual([])
})

test('reusing a text task restores its API format, generation settings and original group before sending', async ({ page }) => {
  const state = await fixture(page, 'available')
  await reuseTextTask(page)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(1)
  expect(state.generated[0]).toMatchObject({
    token: '52', body: { kind: 'text', model: 'gpt-5',
      chatOptions: { format: 'responses', temperature: 0.2, max_tokens: 1234, stream: false } },
  })
  expect(state.selections).toEqual(['G'])
  expect(state.external).toEqual([])
})

test('an unavailable original text group preserves the previous conversation, draft and group', async ({ page }) => {
  const state = await fixture(page, 'missing')
  const previousDraft = '原会话仍需保留的草稿'
  const composer = page.getByRole('textbox', { name: '消息', exact: true })
  await composer.fill(previousDraft)
  const conversations = page.locator('.studio-sidebar .conversation-row')
  const active = conversations.filter({ has: page.locator('.conversation-record.active') })
  const previousId = await active.getAttribute('data-conversation-id')
  const previousCount = await conversations.count()
  await reuseTextTask(page)
  await expect(page.getByRole('alert').filter({ hasText: /分组.*不可用|无法使用.*分组|分组.*无法/ }).first()).toBeVisible()
  await expect(conversations).toHaveCount(previousCount)
  await expect(active).toHaveAttribute('data-conversation-id', previousId!)
  await expect(composer).toHaveValue(previousDraft)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(state.currentGroup()).toBe('auto')
  expect(state.selections).toEqual([])
  expect(state.generated).toEqual([])
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(1)
  expect(state.generated[0]).toMatchObject({ token: '41', body: { prompt: previousDraft } })
  expect(state.external).toEqual([])
})

test('switching to image mode cancels a delayed text task restore without changing its conversation or drafts', async ({ page }) => {
  const state = await fixture(page, 'available')
  const textDraft = '切换前的文字草稿', imageDraft = '当前图片模式的草稿'
  const textComposer = page.getByRole('textbox', { name: '消息', exact: true })
  await textComposer.fill(textDraft)
  const conversations = page.locator('.studio-sidebar .conversation-row')
  const active = conversations.filter({ has: page.locator('.conversation-record.active') })
  const previousId = await active.getAttribute('data-conversation-id')
  const previousCount = await conversations.count()
  state.groupGate.enabled = true
  await reuseTextTask(page)
  await expect.poll(() => state.groupGate.entered).toBe(1)
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: '图片生成', exact: true }).click()
  const imageComposer = page.getByRole('textbox', { name: '提示词', exact: true })
  await expect(imageComposer).toBeVisible()
  await imageComposer.fill(imageDraft)
  state.groupGate.release()
  await expect(page).toHaveURL(/\/create\/image(?:\?.*)?$/)
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
  await expect(imageComposer).toHaveValue(imageDraft)
  await expect(conversations).toHaveCount(previousCount)
  await expect(active).toHaveAttribute('data-conversation-id', previousId!)
  expect(state.generated).toEqual([])
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('dialog', { name: '创作模式', exact: true }).getByRole('button', { name: '对话', exact: true }).click()
  await expect(textComposer).toHaveValue(textDraft)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(conversations).toHaveCount(previousCount)
  await expect(active).toHaveAttribute('data-conversation-id', previousId!)
  expect(state.generated).toEqual([])
  expect(state.external).toEqual([])
})
