import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const editor = (page: Page) => page.getByRole('dialog', { name: '发布作品', exact: true })
async function fixture(page: Page, type = 'image/jpeg') {
  const account = await mockUnifiedAccount(page, true)
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const writes: Record<string, any>[] = []
  let uploads = 0
  await page.route('**/simple-preview.jpg', route => route.fulfill({ body: image, contentType: 'image/jpeg' }))
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: ['摄影', '插画', '角色', '海报'].map((name, index) => ({
    id: `tag${index}`, name, category: new URL(route.request().url()).searchParams.get('kind'),
  })) } }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: {
    id: `file${++uploads}`, name: `作品${uploads}`, type, url: '/simple-preview.jpg',
  } } }))
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ json: { work: { id: 'submitted', status: body.status, title: body.title } } })
  })
  return { ...account, image, writes }
}

for (const width of [320, 390, 800, 1440]) {
  test(`simple editor keeps upload, title and submission visible at ${width}px`, async ({ page }) => {
    const state = await fixture(page)
    await page.setViewportSize({ width, height: width === 800 ? 560 : 740 })
    if (width === 800) await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
    await page.goto('/discover?publish=1')
    const form = editor(page)
    await expect(form.getByRole('combobox')).toHaveCount(0)
    await expect(form.getByRole('textbox')).toHaveCount(1)
    await expect(form.getByRole('button', { name: '提交审核', exact: true })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`empty-editor-${width}.png`) })
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(form.locator('.attachment-preview img')).toBeVisible()
    const preview = await form.locator('.attachment-preview img').boundingBox()
    expect(preview!.width).toBeGreaterThan(150)
    expect(preview!.height).toBeGreaterThan(150)
    await form.getByLabel('作品标题', { exact: true }).fill('简单投稿')
    await form.getByText('补充信息（选填）', { exact: true }).click()
    for (const name of ['摄影', '插画', '角色']) await form.getByRole('checkbox', { name, exact: true }).check()
    await expect(form.getByRole('checkbox', { name: '海报', exact: true })).toBeDisabled()
    await expect(form.getByRole('button', { name: '提交审核', exact: true })).toBeInViewport()
    await form.getByText('补充信息（选填）', { exact: true }).click()
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`simple-editor-${width}.png`) })
    await form.getByRole('button', { name: '提交审核', exact: true }).click()
    expect(state.writes[0]).toMatchObject({ title: '简单投稿', kind: 'image', tags: ['摄影', '插画', '角色'], fileIds: ['file1'], status: 'pending' })
  })
}

test('media layout retains file ordering and public reference selection on mobile', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles([
    { name: 'first.jpg', mimeType: 'image/jpeg', buffer: state.image },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: state.image },
  ])
  await expect(form.locator('.featured > li')).toHaveCount(2)
  await form.locator('.featured > li').first().getByRole('button', { name: '向后移动' }).click()
  await expect(form.locator('.attachment-preview')).toHaveAttribute('aria-label', '查看 作品2')
  await form.locator('.featured > li').last().getByRole('button', { name: '移至参考图' }).click()
  await expect(form.locator('.editor-extras')).toHaveAttribute('open')
  await expect(form.getByRole('region', { name: '参考图', exact: true }).getByRole('button', { name: '移至作品文件' })).toBeVisible()
  await form.getByLabel('作品标题', { exact: true }).fill('保留作品与参考图')
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ fileIds: ['file2'], referenceFileIds: ['file1'] })
})

for (const [type, kind, name] of [['video/mp4', 'video', 'video.mp4'], ['application/pdf', 'resource', 'guide.pdf']]) {
  test(`upload detects ${kind} without a type selection`, async ({ page }) => {
    const state = await fixture(page, type)
    await page.goto('/discover?publish=1')
    const form = editor(page)
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name, mimeType: type, buffer: Buffer.from('fixture') })
    await expect(form.getByText(`${kind === 'video' ? '视频' : '资源'} · 1/16`, { exact: true })).toBeVisible()
    await form.getByLabel('作品标题', { exact: true }).fill('自动识别作品')
    await form.getByRole('button', { name: '提交审核', exact: true }).click()
    expect(state.writes[0]).toMatchObject({ kind, tags: [], status: 'pending' })
  })
}

test('text content submits without files or tags and title-only drafts stay available', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover?publish=1')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('待补充的草稿')
  await editor(page).getByRole('button', { name: '存为草稿', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ status: 'draft', fileIds: [] })
  await page.goto('/discover?publish=1')
  await editor(page).getByRole('button', { name: '填写内容', exact: true }).click()
  await editor(page).getByLabel('资源内容', { exact: true }).fill('可以独立发布的资源正文')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('纯文字资源')
  await editor(page).getByRole('button', { name: '提交审核', exact: true }).click()
  expect(state.writes[1]).toMatchObject({ kind: 'resource', body: '可以独立发布的资源正文', tags: [], fileIds: [], status: 'pending' })
})

test('invalid optional URL reopens its section and preserves entered information', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('作品标题').fill('保留标题')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByLabel('来源链接').fill('invalid-url')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(form.getByLabel('来源链接')).toBeVisible()
  await expect(form.getByLabel('来源链接')).toBeFocused()
  await expect(form.getByLabel('作品标题')).toHaveValue('保留标题')
})

test('a saved empty draft reloads tag choices and accepts a video or text content', async ({ page }) => {
  const state = await fixture(page, 'video/mp4')
  const work = { id: 'emptydraft', title: '待补充的草稿', authorId: state.state.user.id, author: '测试创作者', avatar: '测', version: 4,
    kind: 'image', status: 'draft', files: [], fileIds: [], tags: [], body: '', prompt: '', model: '', owned: true, likes: 0, date: '2026-11-19', cover: '' }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/emptydraft', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library?tab=draft')
  await page.getByRole('button', { name: '编辑作品：待补充的草稿', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('作品标题')).toBeEnabled()
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await expect(form.getByRole('checkbox', { name: '摄影', exact: true })).toBeVisible()
  await form.getByRole('button', { name: '填写内容', exact: true }).click()
  await form.getByLabel('资源内容').fill('保留的文字')
  await form.getByRole('button', { name: '使用文件投稿', exact: true }).click()
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'result.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') })
  await expect(form.getByText('视频 · 1/16', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'video', body: '保留的文字', version: 4, status: 'pending', fileIds: ['file1'] })
})

test('adding a document to an existing image preserves its type and collapsed metadata', async ({ page }) => {
  const state = await fixture(page, 'application/pdf')
  const work = { id: 'publishedimage', title: '已有图片', authorId: state.state.user.id, author: '测试创作者', avatar: '测', version: 4,
    kind: 'image', status: 'published', files: [{ id: 'original', name: 'original.jpg', type: 'image/jpeg', url: '/simple-preview.jpg' }],
    fileIds: ['original'], referenceFiles: [{ id: 'reference', name: 'ref.jpg', type: 'image/jpeg', url: '/simple-preview.jpg' }],
    tags: ['摄影'], body: '原简介', prompt: '原提示词', model: '原模型', sourceUrl: 'https://example.com/source', license: 'CC0',
    owned: true, likes: 0, date: '2026-11-19', cover: '/simple-preview.jpg', generation: { parameters: { kind: 'image' } } }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/publishedimage', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library')
  await page.getByRole('button', { name: '编辑作品：已有图片', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('作品标题')).toBeEnabled()
  await expect(form.locator('.editor-extras')).not.toHaveAttribute('open')
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') })
  await expect(form.getByText('图片 · 2/16', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'image', body: '原简介', prompt: '原提示词', model: '原模型', tags: ['摄影'],
    sourceUrl: 'https://example.com/source', license: 'CC0', version: 4, fileIds: ['original', 'file1'], referenceFileIds: ['reference'] })
  expect(state.writes[0]).not.toHaveProperty('generation')
})
