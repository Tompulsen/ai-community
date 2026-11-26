import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const assetId = '71f2ceae-7385-4b15-858d-a71c3c905101'
const wordPlan = { schemaVersion: 1, kind: 'create_word', fileName: '项目计划.docx', blocks: [{ type: 'paragraph', text: '交付日期为周五。' }] }
const sheetPlan = { schemaVersion: 1, kind: 'create_workbook', fileName: '销售.xlsx', sheets: [{ name: '销售', cells: [{ address: 'A1', value: { type: 'text', value: '0012' } }, { address: 'B1', value: { type: 'number', value: 20 } }, { address: 'C1', value: { type: 'formula', value: '=B1*3' } }] }] }
const expressionResponse = JSON.stringify({ ...sheetPlan, help: { type: 'text', value: '' } }).replace('"value":20}', '"value":21-1}')

async function fixture(page: Page, options: { busy?: boolean; unavailable?: boolean; interrupted?: boolean; failFile?: boolean; responseText?: string; modelResult?: Record<string, unknown>; pendingReads?: number } = {}) {
  const account = await mockUnifiedAccount(page, true); account.state.user.id = '17'
  const state = { paid: [] as any[], headers: [] as any[], plans: [] as any[], jobs: new Map<string, any>(), assets: [] as any[], formats: new Map<string, string>(), busy: !!options.busy, failFile: !!options.failFile, responseText: options.responseText, missingSource: false, modelQueries: 0, uploads: 0, deleted: 0, lastPlan: wordPlan as any }
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image', kinds: ['image'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      const input = route.request().postDataJSON(); state.paid.push(input); state.headers.push(route.request().headers())
      const document = input.chatOptions.messages.some((message: any) => typeof message.content === 'string' && message.content.includes('schemaVersion'))
      state.lastPlan = input.chatOptions.messages.some((message: any) => typeof message.content === 'string' && /"format"\s*:\s*"xlsx"/.test(message.content)) ? sheetPlan : wordPlan
      const text = document ? state.responseText ?? JSON.stringify(state.lastPlan) : '这是普通聊天回答。'
      const events = [{ type: 'accepted', requestId: input.requestId, deadline: Date.now() + 180000 }, { type: 'delta', append: true, text: options.modelResult ? '' : options.interrupted ? '{' : text }]
      if (!options.interrupted) events.push({ type: 'result', ...options.modelResult || { status: 'succeeded', outputs: [{ text }], usage: { outputTokens: state.responseText ? 4096 : 32 } } } as any)
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
    }
    if (path.includes('/requests/')) { state.modelQueries++; return route.fulfill({ json: { requestId: path.split('/').at(-1),
      ...(state.modelQueries <= (options.pendingReads || 0) ? { status: 'pending', outputs: [] } : options.modelResult || { status: 'succeeded', outputs: [{ text: state.responseText ?? JSON.stringify(state.lastPlan) }] }) } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/documents/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/documents/', ''), method = route.request().method()
    expect(route.request().headers()['x-new-api-user']).toBe('17')
    if (path === 'capabilities') return route.fulfill({ json: { enabled: !options.unavailable, docx: !options.unavailable, xlsx: !options.unavailable } })
    if (path === 'assets') return route.fulfill({ json: { assets: state.assets } })
    if (state.missingSource && path.startsWith('assets/')) return route.fulfill({ status: 404, json: { error: { message: '原文件不存在，请重新选择文件。' } } })
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

test('pending document requests continue GET recovery until completion without another POST', async ({ page }) => {
  const { state } = await fixture(page, { interrupted: true, pendingReads: 1 }); await enable(page); await send(page, '生成劳动合同excel')
  await expect(page.getByRole('button', { name: '下载 XLSX', exact: true })).toBeVisible({ timeout: 15000 })
  expect(state.modelQueries).toBe(2); expect(state.paid).toHaveLength(1)
})

for (const width of [390, 1440]) test(`queue rejection at ${width}px gives a useful notice and no automatic paid retry`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const { state } = await fixture(page, { modelResult: { status: 'failed', outputs: [], errorCode: 'MODEL_BUSY', errorStatus: 429,
    error: '模型服务繁忙，请稍后重试，或手动选择其他模型。原请求不会自动重新提交。' } })
  await enable(page); await send(page, '生成劳动合同excel')
  const card = page.getByRole('region', { name: '文档任务' })
  await expect(card).toContainText('模型服务繁忙')
  await expect(card.getByRole('button', { name: '恢复原模型请求', exact: true })).toHaveCount(0)
  await page.reload(); await expect(card.getByRole('button', { name: '重新准备生成', exact: true })).toBeVisible()
  await card.getByRole('button', { name: '重新准备生成', exact: true }).click()
  await expect(page.getByLabel('文件要求', { exact: true })).toHaveValue('生成劳动合同excel')
  await expect(page.getByRole('button', { name: 'Excel XLSX 表格', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(state.paid).toHaveLength(1); expect(state.modelQueries).toBe(0); expect(state.plans).toHaveLength(0)
  await page.getByRole('button', { name: '关闭文档工作区', exact: true }).click()
  await page.screenshot({ path: info.outputPath(`model-busy-${width}.png`), fullPage: true })
})

for (const text of ['', '{"schemaVersion":1,']) test(`terminal interrupted document with ${text ? 'partial' : 'no'} content stops repeated recovery after reload`, async ({ page }) => {
  const { state } = await fixture(page, { modelResult: { status: 'indeterminate', outputs: text ? [{ text }] : [], errorCode: 'GENERATION_ERROR',
    error: '流式回答中断，未收到完整回答，请先核对消费记录。' } })
  await enable(page); await send(page, '生成劳动合同excel')
  const retry = page.getByRole('button', { name: '调整要求后重新生成', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复原模型请求', exact: true })).toHaveCount(0)
  await page.reload(); await expect(retry).toBeVisible()
  expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(0); expect(state.modelQueries).toBe(0)
})

test('a direct HTTP 429 rejection has the same notice and does not query or resubmit a rejected request', async ({ page }) => {
  const { state } = await fixture(page)
  await page.route('**/api/creation/generate', route => {
    state.paid.push(route.request().postDataJSON())
    return route.fulfill({ status: 429, json: { error: { code: 'gateway_queue_full', message: 'Too many pending requests, please retry later' } } })
  })
  await enable(page); await send(page, '生成劳动合同excel')
  const card = page.getByRole('region', { name: '文档任务' })
  await expect(card).toContainText('模型服务繁忙')
  await page.reload(); await expect(card.getByRole('button', { name: '重新准备生成', exact: true })).toBeVisible()
  expect(state.paid).toHaveLength(1); expect(state.modelQueries).toBe(0)
})

test('a queue failure after partial generation retains the check-consumption warning across reload', async ({ page }) => {
  const { state } = await fixture(page, { modelResult: { status: 'indeterminate', outputs: [{ text: '{"schemaVersion":1,' }],
    errorCode: 'MODEL_BUSY', errorStatus: 429, error: '模型服务繁忙' } })
  await enable(page); await send(page, '生成劳动合同excel')
  const card = page.getByRole('region', { name: '文档任务' })
  await expect(card).toContainText('本次未完整生成，请先核对消费记录')
  await page.reload(); await expect(card.getByRole('button', { name: '重新准备生成', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '恢复原模型请求', exact: true })).toHaveCount(0)
  expect(state.paid).toHaveLength(1); expect(state.modelQueries).toBe(0); expect(state.plans).toHaveLength(0)
})

for (const width of [390, 1440]) test(`complete numeric expression response at ${width}px creates an Excel file without regenerating`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const { state } = await fixture(page, { responseText: expressionResponse }); await enable(page); await send(page, '生成练手excel')
  const download = page.getByRole('button', { name: '下载 XLSX', exact: true })
  await expect(download).toBeVisible(); expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(1)
  expect(state.plans[0].plan).toEqual(sheetPlan); expect(state.modelQueries).toBe(0)
  await page.reload(); await expect(download).toBeVisible(); expect(state.paid).toHaveLength(1)
  const card = page.getByRole('region', { name: '文档任务' })
  await expect(card.locator('[role="alert"]')).toHaveCount(0)
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`numeric-document-${width}.png`), fullPage: true })
})

for (const width of [390, 1440]) test(`truncated completed document at ${width}px offers explicit regeneration and preserves data`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const { state } = await fixture(page, { responseText: '{"schemaVersion":1,"kind":"create_workbook","fileName":"练习' })
  await send(page, '已清除私密预算987654321')
  await expect(page.locator('.chat-message.assistant')).toContainText('这是普通聊天回答。')
  await enable(page)
  await page.getByLabel('添加附件', { exact: true }).setInputFiles({ name: '销售.csv', mimeType: 'text/csv', buffer: Buffer.from('编号,价格\n0012,35.5') })
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await send(page, '生成一个可练手的excel表格')
  const card = page.getByRole('region', { name: '文档任务' }).last()
  await expect(card).toContainText('内容不完整或格式有误')
  expect(state.paid).toHaveLength(2); expect(state.paid[1].chatOptions.max_tokens).toBe(16384)
  expect(state.plans).toHaveLength(0)
  await expect(page.getByRole('button', { name: '恢复原模型请求', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Unterminated')
  await expect(page.locator('.chat-message.assistant .message-heading strong').last()).toHaveText('gpt-5')
  await page.reload(); await expect(card).toContainText('内容不完整或格式有误')
  if (width < 640) await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await page.getByRole('button', { name: '调整要求后重新生成', exact: true }).click()
  await expect(page.getByLabel('文件要求', { exact: true })).toHaveValue('生成一个可练手的excel表格')
  await expect(page.getByRole('dialog')).toContainText('销售.csv')
  await expect(page.getByRole('button', { name: 'Excel XLSX 表格', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '创建文件', exact: true })).toBeEnabled()
  expect(state.paid).toHaveLength(2); expect(state.modelQueries).toBe(0)
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByRole('dialog').evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished)) })
  expect((await new AxeBuilder({ page }).include('.document-workspace').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`document-retry-${width}.png`) })
  state.responseText = undefined
  await page.getByLabel('文件要求', { exact: true }).fill('生成5行练习数据的Excel表格')
  await page.getByRole('button', { name: '创建文件', exact: true }).click()
  await expect(page.locator('.document-inspector')).toContainText('0012')
  expect(state.paid).toHaveLength(3)
  expect(JSON.stringify(state.paid[2].chatOptions.messages)).toContain('0012,35.5')
  expect(JSON.stringify(state.paid[2].chatOptions.messages)).not.toContain('987654321')
  expect(state.plans).toHaveLength(1)
  await page.getByRole('button', { name: '关闭文档工作区', exact: true }).click()
  await send(page, '你好')
  await expect(page.locator('.chat-message.assistant').last()).toContainText('这是普通聊天回答。')
  expect(state.paid[3].chatOptions.max_tokens).toBe(4096)
})

test('retry preserves an uploaded read-only source without turning creation into an edit', async ({ page }) => {
  const { state } = await fixture(page, { responseText: '{"schemaVersion":1,"fileName":"' }); await enable(page)
  await page.getByLabel('添加附件', { exact: true }).setInputFiles({ name: '参考.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from([80,75,3,4,1]) })
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await send(page, '参考附件新建一份Word文档')
  await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '调整要求后重新生成', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('参考.docx')
  await expect(page.getByRole('button', { name: '创建文件', exact: true })).toBeEnabled()
  expect(state.paid).toHaveLength(1); state.responseText = undefined
  await page.getByRole('button', { name: '创建文件', exact: true }).click()
  await expect(page.locator('.document-inspector')).toBeVisible()
  expect(state.paid).toHaveLength(2); expect(state.uploads).toBe(1)
  expect(state.plans[0].request.sourceArtifactId).toBeUndefined()
  expect(JSON.stringify(state.paid[1].chatOptions.messages)).toContain('交付日期为周五')
})

test('a missing retry source cannot silently become a newly charged empty document', async ({ page }) => {
  const { state } = await fixture(page, { responseText: '{"schemaVersion":1,"fileName":"' }); await enable(page)
  await page.getByLabel('添加附件', { exact: true }).setInputFiles({ name: '原件.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from([80,75,3,4,1]) })
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await send(page, '修改附件Word文档的付款日期')
  await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
  state.missingSource = true
  await page.getByRole('button', { name: '调整要求后重新生成', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('原文件不存在')
  await expect(page.getByRole('button', { name: '创建文件', exact: true })).toBeDisabled()
  expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(0)
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
  test('legacy unknown status is queried once on reload, then the terminal result is retained', async ({ page }) => {
    const { state } = await fixture(page, { modelResult: { status: 'indeterminate', outputs: [], error: '流式回答中断' } })
    await enable(page); await send(page, '生成劳动合同excel')
    await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const { creation } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-studio\.ts(?:\?|$)/.test(path))!)
      const { saveTaskSnapshot } = await import(/* @vite-ignore */ paths.find(path => /\/src\/studio-task-store\.ts(?:\?|$)/.test(path))!)
      delete creation.tasks[0].resultStatus
      await saveTaskSnapshot('17', [...creation.tasks])
    })
    await page.reload(); await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    expect(state.modelQueries).toBe(1)
    await page.reload(); await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    expect(state.modelQueries).toBe(1); expect(state.paid).toHaveLength(1)
  })
  test('a completed legacy response with a stale parse error recovers under its original key without another model request', async ({ page }) => {
    const { state } = await fixture(page, { responseText: '{"schemaVersion":1,"fileName":"' }); await enable(page); await send(page, '生成练手excel')
    await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    const originalKey = await page.evaluate(async responseText => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const { chats, saveChats } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-chat\.ts(?:\?|$)/.test(path))!)
      const { creation } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-studio\.ts(?:\?|$)/.test(path))!)
      const { saveTaskSnapshot } = await import(/* @vite-ignore */ paths.find(path => /\/src\/studio-task-store\.ts(?:\?|$)/.test(path))!)
      const chat = chats.sessions.find((item: any) => item.id === chats.activeId), task = chat.messages.at(-1).documentTask
      const model = creation.tasks.find((item: any) => item.id === task.modelTaskId)
      model.text = responseText
      await saveTaskSnapshot('17', [model]); await saveChats(true)
      return task.key
    }, expressionResponse)
    await page.reload()
    const card = page.getByRole('region', { name: '文档任务' })
    await expect(card).toContainText('已修复原内容的格式兼容问题')
    await expect(card.locator('[role="alert"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '继续制作文件', exact: true }).click()
    await expect(page.getByRole('button', { name: '下载 XLSX', exact: true })).toBeVisible()
    expect(state.paid).toHaveLength(1); expect(state.modelQueries).toBe(0); expect(state.plans).toHaveLength(1)
    expect(state.plans[0].key).toBe(originalKey); expect(state.plans[0].plan).toEqual(sheetPlan)
    await expect(page.locator('.chat-message.assistant').last()).not.toContainText('生成失败')
    await page.reload(); await expect(page.getByRole('button', { name: '下载 XLSX', exact: true })).toBeVisible(); expect(state.paid).toHaveLength(1)
  })
  test('old saved parse failures and stale chat model names render correctly after reload', async ({ page }) => {
    const { state } = await fixture(page, { responseText: '{"schemaVersion":1,"fileName":"' }); await enable(page); await send(page, '制作Excel练习表格')
    await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const paths = performance.getEntriesByType('resource').map(entry => entry.name)
      const { chats, saveChats } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-chat\.ts(?:\?|$)/.test(path))!)
      const chat = chats.sessions.find((item: any) => item.id === chats.activeId), message = chat.messages.at(-1)
      chat.model = 'gpt-image'; delete message.documentTask.modelContentError
      message.error = message.documentTask.error = 'Unterminated string in JSON at position 5037 (line 1 column 5038)'
      await saveChats(true)
      const { creation } = await import(/* @vite-ignore */ paths.find(path => /\/src\/native-studio\.ts(?:\?|$)/.test(path))!)
      creation.tasks = []
    })
    await expect(page.locator('.chat-message.assistant .message-heading strong').last()).toHaveText('gpt-5')
    await expect(page.getByRole('region', { name: '文档任务' })).toContainText('内容不完整或格式有误')
    await expect(page.getByRole('button', { name: '恢复原模型请求', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '调整要求后重新生成', exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Unterminated')
    await expect(page.locator('.chat-message.assistant .message-heading strong').last()).toHaveText('gpt-5')
    expect(state.paid).toHaveLength(1); expect(state.plans).toHaveLength(0)
  })
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
