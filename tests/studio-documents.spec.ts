import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const assetId = '71f2ceae-7385-4b15-858d-a71c3c905101'
const wordPlan = { schemaVersion: 1, kind: 'create_word', fileName: '项目计划.docx', blocks: [{ type: 'paragraph', text: '交付日期为周五。' }] }
const sheetPlan = { schemaVersion: 1, kind: 'create_workbook', fileName: '销售.xlsx', sheets: [{ name: '销售', cells: [{ address: 'A1', value: { type: 'text', value: '0012' } }, { address: 'B1', value: { type: 'number', value: 20 } }, { address: 'C1', value: { type: 'formula', value: '=B1*3' } }] }] }

async function fixture(page: Page, options: { busy?: boolean; unavailable?: boolean; interrupted?: boolean; failFile?: boolean } = {}) {
  const account = await mockUnifiedAccount(page, true); account.state.user.id = '17'
  const state = { paid: [] as any[], headers: [] as any[], plans: [] as any[], jobs: new Map<string, any>(), assets: [] as any[], formats: new Map<string, string>(), busy: !!options.busy, failFile: !!options.failFile, modelQueries: 0, uploads: 0, deleted: 0, lastPlan: wordPlan as any }
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image', kinds: ['image'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      const input = route.request().postDataJSON(); state.paid.push(input); state.headers.push(route.request().headers())
      const document = input.chatOptions.messages.some((message: any) => typeof message.content === 'string' && message.content.includes('schemaVersion'))
      state.lastPlan = input.chatOptions.messages.some((message: any) => typeof message.content === 'string' && /"format"\s*:\s*"xlsx"/.test(message.content)) ? sheetPlan : wordPlan
      const text = document ? JSON.stringify(state.lastPlan) : '这是普通聊天回答。'
      const events = [{ type: 'accepted', requestId: input.requestId, deadline: Date.now() + 180000 }, { type: 'delta', append: true, text: options.interrupted ? '{' : text }]
      if (!options.interrupted) events.push({ type: 'result', status: 'succeeded', outputs: [{ text }], usage: { outputTokens: 32 } } as any)
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
    }
    if (path.includes('/requests/')) { state.modelQueries++; return route.fulfill({ json: { requestId: path.split('/').at(-1), status: 'succeeded', outputs: [{ text: JSON.stringify(state.lastPlan) }] } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/documents/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/documents/', ''), method = route.request().method()
    expect(route.request().headers()['x-new-api-user']).toBe('17')
    if (path === 'capabilities') return route.fulfill({ json: { enabled: !options.unavailable, docx: !options.unavailable, xlsx: !options.unavailable } })
    if (path === 'assets') return route.fulfill({ json: { assets: state.assets } })
    if (path === 'jobs' && method === 'GET') return route.fulfill({ json: { jobs: [...state.jobs.values()].filter(job => !url.searchParams.get('sessionId') || job.sessionId === url.searchParams.get('sessionId')) } })
    if ((path === 'jobs' || path === 'upload') && method === 'POST') {
      const body = route.request().postDataJSON()
      if (state.busy) return route.fulfill({ status: 429, json: { error: { message: '文档服务繁忙，请重试制作。' } } })
      const format = path === 'upload' ? (body.fileName.endsWith('.xlsx') ? 'xlsx' : 'docx') : body.request.format
      const fileName = path === 'upload' ? body.fileName : body.plan.fileName || state.assets[0]?.fileName
      if (path === 'upload') state.uploads++; else state.plans.push(body)
      const version = body.plan?.baseVersion ? body.plan.baseVersion + 1 : 1
      const job = { id: body.key, status: state.failFile ? 'failed' : 'ready', canRecover: state.failFile, assetId: state.failFile ? null : assetId, version, fileName, sessionId: body.sessionId || body.request.sessionId, createdAt: new Date().toISOString(), error: state.failFile ? '文件制作失败，可重试。' : null }
      state.jobs.set(body.key, job); state.formats.set(assetId, format)
      if (!state.failFile) state.assets = [{ id: assetId, fileName, version, format, size: 2048, sessionId: job.sessionId, createdAt: job.createdAt, hasPreview: true }]
      return route.fulfill({ status: 202, json: job })
    }
    if (/^jobs\//.test(path)) {
      const id = path.split('/')[1]!, job = state.jobs.get(id)
      if (!job) return route.fulfill({ status: 404, json: { error: { message: '任务不存在' } } })
      if (path.endsWith('/retry')) { job.status = 'ready'; job.canRecover = false; job.assetId = assetId; job.error = null; state.assets = [{ id: assetId, fileName: job.fileName, version: 1, format: job.fileName.endsWith('.xlsx') ? 'xlsx' : 'docx', size: 2048, hasPreview: true, createdAt: job.createdAt }] }
      if (method === 'DELETE') job.status = 'cancelled'
      return route.fulfill({ json: job })
    }
    if (path.endsWith('/download')) return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers: { 'Content-Disposition': 'attachment; filename="download.docx"' }, body: Buffer.from([80, 75, 3, 4, 1]) })
    if (path.endsWith('/versions')) return route.fulfill({ json: { versions: Array.from({ length: state.assets[0]?.version || 1 }, (_, i) => ({ ...state.assets[0], version: (state.assets[0]?.version || 1) - i })) } })
    if (path.endsWith('/changes')) return route.fulfill({ json: path.includes('/2/') ? [{ paragraphId: 'paragraph-0', before: '交付日期为周五。', after: '交付日期为周六。' }] : [] })
    if (path.endsWith('/structure')) return route.fulfill({ json: state.formats.get(assetId) === 'xlsx' ? { format: 'xlsx', sheets: [{ id: 'sheet-0', name: '销售', cells: [{ address: 'A1', value: { type: 'text', value: '0012' } }, { address: 'B1', value: { type: 'number', value: 20 } }, { address: 'C1', value: { type: 'formula', value: '=B1*3' }, cachedValue: { type: 'number', value: 60 } }] }] } : { format: 'docx', paragraphs: [{ id: 'paragraph-0', text: path.includes('/2/') ? '交付日期为周六。' : '交付日期为周五。', editable: true }] } })
    if (path.startsWith('assets/') && method === 'DELETE') { state.deleted++; state.assets = []; state.jobs.clear(); return route.fulfill({ json: { ok: true } }) }
    throw new Error('Unexpected document API ' + method + ' ' + path)
  })
  await page.goto('/create/text')
  await expect(page.getByRole('button', { name: '文档工作区', exact: true })).toBeEnabled()
  return { state, account }
}
async function enable(page: Page) { await page.getByRole('button', { name: '文档工作区', exact: true }).click(); await expect(page.getByText('文档已开启', { exact: true })).toBeVisible() }
async function workspace(page: Page) { await enable(page); await page.getByRole('button', { name: '打开工作区', exact: true }).click(); await expect(page.getByRole('dialog', { name: '文档工作区' })).toBeVisible(); await expect(page.getByRole('button', { name: '上传已有文件', exact: true })).toBeEnabled() }
async function send(page: Page, text: string) { await page.getByRole('textbox', { name: '消息', exact: true }).fill(text); await page.getByRole('button', { name: '发送', exact: true }).click() }

test('documents are opt-in per chat and visible only in the text workspace', async ({ page }) => {
  await fixture(page); await enable(page); await page.reload()
  await expect(page.getByText('文档已开启', { exact: true })).toBeVisible()
  await page.goto('/create/image'); await expect(page.getByRole('button', { name: '文档工作区', exact: true })).toHaveCount(0)
  await page.goto('/create/video'); await expect(page.getByRole('button', { name: '文档工作区', exact: true })).toHaveCount(0)
})
test('ordinary questions and Markdown remain normal chat with documents enabled', async ({ page }) => {
  const { state } = await fixture(page); await enable(page); await send(page, '请用 Markdown 解释如何制作 Excel 表格，不用生成文件')
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('这是普通聊天回答。')
  expect(state.plans).toHaveLength(0); expect(state.paid).toHaveLength(1)
})
for (const format of ['docx', 'xlsx']) test(`${format} uses the selected community model and group, downloads and survives reload`, async ({ page }) => {
  const { state } = await fixture(page); await enable(page); await send(page, format === 'docx' ? '制作一份 Word 项目计划文档' : '制作一份 Excel 销售表格')
  const card = page.getByRole('region', { name: '文档任务' })
  const download = page.getByRole('button', { name: `下载 ${format.toUpperCase()}`, exact: true })
  await expect(download).toBeVisible(); expect(state.paid).toHaveLength(1); expect(state.paid[0].model).toBe('gpt-5'); expect(state.paid[0].kind).toBe('text')
  expect(state.headers[0]['x-new-api-group']).toBe('auto'); expect(state.headers[0]['x-new-api-token']).toBe('41'); expect(state.plans[0].request.format).toBe(format)
  const downloaded = page.waitForEvent('download'); await download.click(); expect((await downloaded).suggestedFilename()).toMatch(new RegExp(`\\.${format}$`))
  await page.reload(); await expect(download).toBeVisible(); expect(state.paid).toHaveLength(1)
  await page.getByRole('button', { name: '预览 / 继续修改', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(format === 'xlsx' ? '0012' : '交付日期为周五。')
  await page.getByRole('button', { name: '关闭文档工作区', exact: true }).click(); await expect(card).not.toContainText('schemaVersion')
})
test('busy file service preserves the model plan and retry after reload never makes a second paid request', async ({ page }) => {
  const { state } = await fixture(page, { busy: true }); await enable(page); await send(page, '制作一份 Word 文档')
  await expect(page.getByRole('button', { name: '重试制作文件', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(1)
  state.busy = false; await page.reload(); await page.getByRole('button', { name: '重试制作文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(1)
})
test('failed file job retries its original key without another model call', async ({ page }) => {
  const { state } = await fixture(page, { failFile: true }); await enable(page); await send(page, '制作一份 Word 文档')
  await expect(page.getByRole('button', { name: '重试制作文件', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重试制作文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(1)
})
test('unavailable document engine prevents paid generation', async ({ page }) => {
  const { state } = await fixture(page, { unavailable: true }); await enable(page); await send(page, '制作一份 Word 文档')
  await expect(page.getByRole('region', { name: '文档任务' })).toContainText('不可用'); expect(state.paid).toHaveLength(0)
})
test('uploaded Word can be edited manually with version history and no model call', async ({ page }) => {
  const { state } = await fixture(page); await workspace(page)
  await page.getByLabel('上传 Word 或 Excel').setInputFiles({ name: '原件.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from([80,75,3,4,1]) })
  await expect(page.locator('.document-inspector')).toContainText('交付日期为周五。')
  await page.getByText('手工修改段落或单元格', { exact: true }).click(); await page.getByLabel('选择位置').selectOption('paragraph-0'); await page.getByLabel('修改后的内容').fill('交付日期为周六。'); await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.locator('.document-inspector')).toContainText('交付日期为周六。'); expect(state.paid).toHaveLength(0); expect(state.uploads).toBe(1); expect(state.plans[0].plan.operations[0].expectedText).toBe('交付日期为周五。')
  await page.getByRole('button', { name: '历史版本', exact: true }).click(); await page.getByRole('button', { name: 'v1', exact: true }).click(); await expect(page.locator('.document-inspector')).toContainText('交付日期为周五。')
  await page.getByRole('button', { name: '关闭文档工作区', exact: true }).click(); await page.reload(); await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible()
})
test('workbench create button produces the selected Excel format', async ({ page }) => {
  const { state } = await fixture(page); await workspace(page)
  await page.getByRole('button', { name: 'Excel XLSX 表格', exact: true }).click(); await page.getByLabel('文件要求', { exact: true }).fill('整理销售明细与汇总')
  await page.getByRole('button', { name: '创建文件', exact: true }).click(); await expect(page.locator('.document-inspector')).toContainText('0012')
  expect(state.paid).toHaveLength(1); expect(state.plans[0].request.format).toBe('xlsx')
})
test('cleared history is not reintroduced into the document model prompt', async ({ page }) => {
  const { state } = await fixture(page); await send(page, '私密预算 987654321')
  await expect(page.locator('.chat-message.assistant')).toContainText('这是普通聊天回答。')
  await page.getByRole('button', { name: '清除上下文', exact: true }).click(); await enable(page); await send(page, '制作一份 Word 项目计划文档')
  await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(2)
  expect(JSON.stringify(state.paid[1].chatOptions.messages)).not.toContain('987654321')
})
test('interrupted model content is recovered by GET without a duplicate paid request', async ({ page }) => {
  const { state } = await fixture(page, { interrupted: true }); await enable(page); await send(page, '制作一份 Word 项目计划文档')
  await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(1); expect(state.modelQueries).toBeGreaterThan(0)
})
test('deleting a file requires confirmation and removes its versions from the workspace', async ({ page }) => {
  const { state } = await fixture(page); await enable(page); await send(page, '制作一份 Word 项目计划文档')
  await page.getByRole('button', { name: '预览 / 继续修改', exact: true }).click(); await page.getByRole('button', { name: '删除文件', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click(); expect(state.deleted).toBe(0)
  await page.getByRole('button', { name: '删除文件', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.document-file-list article')).toHaveCount(0); expect(state.deleted).toBe(1)
})
for (const width of [320, 390, 1440]) test(`document workspace fits ${width}px and supports keyboard and accessible labels`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page); await workspace(page)
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.document-workspace').analyze(); expect(accessibility.violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`documents-${width}.png`) })
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: '文档工作区', exact: true })).toBeFocused()
})
test('dark document workspace retains readable controls', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await fixture(page); await workspace(page)
  expect((await new AxeBuilder({ page }).include('.document-workspace').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath('documents-dark.png') })
})

test.describe('local internal boundary checks', () => {
  test.skip(process.env.DOCUMENT_INTERNAL_TESTS !== '1', 'Requires the local Vite source modules')
  test('document model task is excluded from ordinary task publication and downloads', async ({ page }) => {
    const { state } = await fixture(page); await enable(page); await send(page, '制作一份 Word 文档')
    await expect(page.getByRole('button', { name: '下载 DOCX', exact: true })).toBeVisible()
    const result = await page.evaluate(async () => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const studio = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-studio\.ts(?:\?|$)/.test(path))!)
      const store = await import(/* @vite-ignore */ paths.find(path => /\/src\/studio-task-store\.ts(?:\?|$)/.test(path))!)
      const task = studio.creation.tasks[0]
      return { purpose: task.purpose, visible: (await store.getTaskPage('17')).tasks.length,
        download: await studio.downloadCreation(task).then(() => 'allowed', (error: Error) => error.message),
        publish: await studio.publishCreation(task, 'bad').then(() => 'allowed', (error: Error) => error.message) }
    })
    expect(result.purpose).toBe('document'); expect(result.visible).toBe(0); expect(result.download).not.toBe('allowed'); expect(result.publish).not.toBe('allowed'); expect(state.paid).toHaveLength(1)
  })
  test('initial document request association must persist before any paid request', async ({ page }) => {
    const { state } = await fixture(page); await enable(page)
    await page.evaluate(async () => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const { indexedDBStorage } = await import(/* @vite-ignore */ paths.find(path => /\/shared\/studio\/indexedDB-storage\.ts(?:\?|$)/.test(path))!)
      const write = indexedDBStorage.setItemWithAssets
      indexedDBStorage.setItemWithAssets = async (...args: any[]) => { if (JSON.stringify(args).includes('modelTaskId')) throw new Error('Fixture association write failed'); return write.apply(indexedDBStorage, args) }
    })
    await send(page, '制作一份 Word 文档'); await expect(page.getByRole('region', { name: '文档任务' })).toContainText('未提交生成')
    expect(state.paid).toHaveLength(0); expect(state.plans).toHaveLength(0)
  })
  for (const change of ['mode', 'account']) test(`changing ${change} during document preflight prevents a late paid call`, async ({ page }) => {
    const { state } = await fixture(page); await enable(page)
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    let started = false
    await page.route('**/api/documents/capabilities', async route => { started = true; await gate; await route.fulfill({ json: { enabled: true, docx: true, xlsx: true } }) })
    await send(page, '制作一份 Word 文档'); await expect.poll(() => started).toBe(true)
    await page.evaluate(async change => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const { chats } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-chat\.ts(?:\?|$)/.test(path))!)
      if (change === 'mode') chats.sessions.find((chat: any) => chat.id === chats.activeId).composerKind = 'image'
      else { const { session } = await import(/* @vite-ignore */ paths.find(path => /\/src\/state\.ts(?:\?|$)/.test(path))!); session.user = { ...session.user, id: '18', accountId: '18' } }
    }, change)
    finish(); await expect.poll(async () => page.evaluate(async () => { const path = performance.getEntriesByType('resource').map(entry => entry.name).find(path => /\/src\/native-chat\.ts(?:\?|$)/.test(path))!; const { chats } = await import(/* @vite-ignore */ path); return Object.values(chats.busy).some(Boolean) })).toBe(false)
    expect(state.paid).toHaveLength(0); expect(state.plans).toHaveLength(0)
  })
})
