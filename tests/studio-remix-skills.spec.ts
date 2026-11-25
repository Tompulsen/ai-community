import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { mockPublicationTags, completePublicationFields } from './helpers/publication-fixture'

type Kind = 'image' | 'video' | 'text'
const body = '---\nname: composition\ndescription: 技能复用验证\n---\n先分析主体与光线，再组织创作内容。'
const sha256 = createHash('sha256').update(body).digest('hex')
const reference = { id: 'community-skillA', sha256 }
const privateReference = { id: 'work-privateSkill', sha256 }
const picker = (page: Page) => page.getByRole('button', { name: '技能与工具', exact: true })
const form = (page: Page) => page.getByRole('dialog', { name: '发布作品', exact: true })

async function fixture(page: Page, kind: Kind = 'image', model = { image: 'gpt-image-2', video: 'sora-2', text: 'gpt-5' }[kind]) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const state = { failCatalog: false, delayCatalog: 0, catalogReads: 0, skills: ['A', 'B'].map(letter => ({
    id: `community-skill${letter}`, name: `技能${letter}`, description: '测试生成技能', kind, sha256, body, status: 'published', authorId: undefined as string | undefined,
  })) }
  state.skills.push({ ...state.skills[0]!, ...privateReference, name: '私密技能' })
  const source: any = { id: 'skillsource', title: '原作技能测试', authorId: '26', author: '原作者', avatar: '原',
    kind: kind === 'text' ? 'resource' : kind, prompt: '海边日落', model, version: 1, tags: [], status: 'published', date: '2026-11-24',
    likes: 0, owned: false, saved: false, liked: false, fileIds: ['cover'], cover: '/legacy-files/cover',
    files: [{ id: 'cover', name: '原作品.jpg', type: 'image/jpeg', url: '/legacy-files/cover' }], referenceFiles: [],
    generation: { prompt: '海边日落', model, parameters: { version: 1, kind, group: 'auto', skills: [reference] } } }
  const generated: any[] = [], published: any[] = []
  await mockPublicationTags(page)
  await page.route('**/legacy-files/**', route => route.fulfill({ body: photo, contentType: kind === 'video' && route.request().url().endsWith('/result') ? 'video/mp4' : 'image/jpeg' }))
  await page.route('**/api/skills/*', route => {
    const skill = state.skills.find(item => item.id === 'community-' + new URL(route.request().url()).pathname.split('/').at(-1))
    return route.fulfill({ json: { skill } })
  })
  await page.route('**/api/works**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST' && path === '/api/works') {
      const data = route.request().postDataJSON(); published.push(data)
      return route.fulfill({ json: { work: { id: 'published1', title: data.title, status: 'pending' } } })
    }
    return route.fulfill({ json: path === '/api/works/privateSkill' ? { work: { skillReference: privateReference, generation: { skill: { kind } } } }
      : path === '/api/works/skillsource' ? { work: source } : { items: [], viewsCount: 1 } })
  })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { userId: 17, currency: '积分', autoGroups: ['auto'], rows: [{ model, group: 'auto', price: '130 积分', requestPrice: 130, billing: '每次请求' }] } } }))
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: model, kinds: [kind] }] } })
    if (path.endsWith('/skills/catalog')) {
      state.catalogReads++
      if (state.delayCatalog) await new Promise(resolve => setTimeout(resolve, state.delayCatalog))
      return state.failCatalog ? route.fulfill({ status: 503, json: { message: '技能目录暂时不可用，请重试。' } })
        : route.fulfill({ json: { items: state.skills.filter(skill => skill.status === 'published').map(skill => ({ ...skill, body: '' })) } })
    }
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/media')) return route.fulfill({ body: photo, contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg' })
    if (path.endsWith('/generate')) {
      generated.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [kind === 'text' ? { text: '技能生成完成' } : { url: '/legacy-files/result' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fallback()
  })
  let uploads = 0
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: `upload${++uploads}`, name: 'output', type: kind === 'video' ? 'video/mp4' : 'image/jpeg', url: `/legacy-files/upload${uploads}`, size: photo.length } } }))
  return { account, state, source, generated, published }
}

async function select(page: Page, names: string[], remove: string[] = []) {
  await picker(page).click()
  for (const name of remove) await page.getByLabel(name, { exact: true }).uncheck()
  for (const name of names) await page.getByLabel(name, { exact: true }).check()
  await expect(page.getByLabel([...names, ...remove].at(-1)!, { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '技能与工具', exact: true })).toBeHidden()
}
async function send(page: Page, kind: Kind) {
  await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill('海边日落')
  await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
}
async function publish(page: Page) {
  await page.getByRole('button', { name: '发布作品', exact: true }).first().click()
  await completePublicationFields(page)
  await form(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form(page).getByRole('status')).toHaveText('作品已提交审核。')
}
async function openRemix(page: Page, entry: 'workbench' | 'background' = 'workbench') {
  await page.goto('/work/skillsource')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: entry === 'background' ? /^后台生成(?:$|\s)/ : /^进入工作台生成(?:$|\s)/ }).click()
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  await expect(dialog.getByRole('button', { name: entry === 'background' ? '后台生成同款' : '仅导入提示词', exact: true })).toBeEnabled()
  return dialog
}
async function importRemix(page: Page) {
  const dialog = await openRemix(page)
  await dialog.getByRole('button', { name: '仅导入提示词', exact: true }).click()
  await expect(dialog).toBeHidden()
}

for (const width of [390, 1440]) test(`identical library and work skills share one searchable choice at ${width}px`, async ({ page }, info) => {
  const result = await fixture(page)
  result.state.skills[0]!.authorId = result.state.skills[2]!.authorId = '25'
  result.state.skills[1]!.authorId = '26'
  await page.setViewportSize({ width, height: 900 }); await page.goto('/create/image'); await picker(page).click()
  await expect(page.locator('.skill-list .skill-row')).toHaveCount(2)
  await page.getByRole('searchbox', { name: '搜索技能' }).fill('私密技能')
  await expect(page.locator('.skill-list .skill-row')).toHaveCount(1)
  await expect(page.getByLabel('技能A', { exact: true })).toBeVisible()
  await page.getByLabel('技能A', { exact: true }).check()
  await expect(picker(page)).toHaveText('技能 1')
  await page.getByRole('searchbox', { name: '搜索技能' }).fill('技能A')
  await expect(page.getByLabel('技能A', { exact: true })).toBeChecked()
  await page.screenshot({ path: info.outputPath(`skill-group-${width}.png`) })
  await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await send(page, 'image'); await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills).toEqual([reference])
})

test('historical duplicate selections stay intact until the grouped choice is explicitly cleared', async ({ page }) => {
  const result = await fixture(page)
  result.state.skills[0]!.authorId = result.state.skills[2]!.authorId = '25'
  result.source.generation.parameters.skills.push(privateReference)
  await importRemix(page); await page.reload(); await picker(page).click()
  await expect(picker(page)).toHaveText('技能 1')
  await expect(page.getByText('已保留 2 条历史选择，取消时一并移除。', { exact: true })).toBeVisible()
  await page.getByLabel('技能A', { exact: true }).uncheck()
  await expect(picker(page)).toHaveText('技能')
  await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await page.reload(); await send(page, 'image'); await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills || []).toEqual([])
})

for (const kind of ['text', 'image'] as const) test(`${kind} grouped work selection retains its reference and cannot fall back after removal`, async ({ page }) => {
  const result = await fixture(page, kind)
  result.state.skills[0]!.authorId = result.state.skills[2]!.authorId = '25'
  result.source.generation.parameters.skills = [privateReference]
  await importRemix(page); await page.reload(); await picker(page).click()
  await expect(page.getByLabel('私密技能', { exact: true })).toBeChecked()
  await expect(page.getByLabel('技能A', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await send(page, kind); await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills).toEqual([privateReference])
  result.state.skills[2]!.status = 'removed'
  await picker(page).click(); await page.getByRole('button', { name: '刷新技能', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除失效技能', exact: true })).toBeVisible()
  await expect(page.getByLabel('技能A', { exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
  await send(page, kind)
  await expect(page.getByText(/技能已(?:更新或下架|下架或不可用)/).last()).toBeVisible()
  expect(result.generated).toHaveLength(1)
})

for (const [kind, model, width] of [['image', 'gpt-image-2', 390], ['image', 'gemini-3-pro-image-preview', 1440], ['video', 'sora-2', 1440]] as const) {
  test(`${model} publishes the generated skill snapshot after the selection changes at ${width}px`, async ({ page }) => {
    const result = await fixture(page, kind, model)
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/create/${kind}`)
    await select(page, ['技能A']); await send(page, kind)
    await expect(page.getByRole('button', { name: '发布作品', exact: true }).first()).toBeEnabled()
    expect(result.generated[0].skills).toEqual([reference])
    await select(page, ['技能B'], ['技能A']); await publish(page)
    expect(result.published[0].generation.parameters.skills).toEqual([reference])
    expect(JSON.stringify(result.published[0])).not.toContain('先分析主体')
  })
}

test('text publication records public and private skills without duplicating injected instructions', async ({ page }) => {
  const result = await fixture(page, 'text')
  await page.goto('/create/text'); await select(page, ['技能A', '私密技能']); await send(page, 'text')
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('技能生成完成')
  expect(result.generated[0].skills).toEqual([privateReference])
  expect(result.generated[0].chatOptions.messages.filter((message: any) => message.role === 'system' && message.content.includes('先分析主体'))).toHaveLength(1)
  await select(page, ['技能B'], ['技能A', '私密技能']); await publish(page)
  expect(result.published[0].generation.parameters.skills).toEqual([reference, privateReference])
  expect(JSON.stringify(result.published[0])).not.toContain('先分析主体')
})

for (const kind of ['image', 'video'] as const) for (const entry of ['workbench', 'background'] as const) {
  test(`${entry} ${kind} remix invokes the source skill without adding its generated picture`, async ({ page }, info) => {
    const result = await fixture(page, kind)
    await page.setViewportSize({ width: entry === 'background' ? 390 : 1440, height: 900 })
    const dialog = await openRemix(page, entry)
    if (entry === 'workbench') {
      await dialog.getByRole('button', { name: '仅导入提示词', exact: true }).click()
      await expect(dialog).toBeHidden(); await expect(picker(page)).toContainText('技能 1')
      await page.screenshot({ path: info.outputPath(`${kind}-${entry}.png`) }); await send(page, kind)
    } else await dialog.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect.poll(() => result.generated.length).toBe(1)
    expect(result.generated[0]).toMatchObject({ sourceWorkId: 'skillsource', skills: [reference] })
    expect(result.generated[0].referenceUrls || []).toEqual([])
  })
}

for (const mode of ['missing', 'empty', 'partial', 'changed', 'wrong-kind'] as const) {
  test(`remix ${mode} skills never inherit another conversation selection`, async ({ page }) => {
    const result = await fixture(page)
    if (mode === 'missing') delete result.source.generation.parameters.skills
    if (mode === 'empty') result.source.generation.parameters.skills = []
    if (mode === 'partial') result.source.generation.parameters.skills.push({ id: 'community-removed', sha256 })
    if (mode === 'changed') result.source.generation.parameters.skills[0] = { ...reference, sha256: 'b'.repeat(64) }
    if (mode === 'wrong-kind') result.state.skills[0]!.kind = 'video'
    await page.goto('/create/image'); await select(page, ['技能B']); await importRemix(page)
    await expect(picker(page)).toHaveText(mode === 'partial' ? '技能 1' : '技能')
    if (['partial', 'changed', 'wrong-kind'].includes(mode)) await expect(page.getByText('原作部分技能已下架、更新或不可用，本次已跳过。', { exact: true })).toBeVisible()
    await send(page, 'image'); await expect.poll(() => result.generated.length).toBe(1)
    expect(result.generated[0].skills || []).toEqual(mode === 'partial' ? [reference] : [])
    await publish(page)
    expect(result.published[0].generation.parameters.skills).toEqual(mode === 'partial' ? [reference] : [])
  })
}

test('catalog errors keep the remix unsubmitted and allow a deliberate retry', async ({ page }) => {
  const result = await fixture(page)
  const dialog = await openRemix(page, 'background')
  result.state.failCatalog = true
  await dialog.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('技能目录暂时不可用')
  expect(result.generated).toHaveLength(0)
  result.state.failCatalog = false
  await dialog.getByRole('button', { name: '重新读取原作', exact: true }).click()
  await dialog.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills).toEqual([reference])
})

test('text remixes preserve skill versions on refresh and allow explicit reselection after an update', async ({ page }) => {
  const result = await fixture(page, 'text')
  result.source.generation.parameters.skills.push(privateReference)
  await importRemix(page); await page.reload()
  await expect(picker(page)).toContainText('技能 2'); await send(page, 'text')
  await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills).toEqual([privateReference])
  expect(result.generated[0].chatOptions.messages.filter((message: any) => message.role === 'system' && message.content.includes('先分析主体'))).toHaveLength(1)
  const updated = result.state.skills[0]!
  updated.body += '\n新版技能规则'; updated.sha256 = createHash('sha256').update(updated.body).digest('hex')
  await send(page, 'text')
  await expect(page.locator('.chat-message.assistant').last()).toContainText('原作技能已更新或下架')
  expect(result.generated).toHaveLength(1)
  await picker(page).click(); await page.getByRole('button', { name: '移除失效技能', exact: true }).click()
  await page.getByLabel('技能A', { exact: true }).check(); await page.keyboard.press('Escape')
  await send(page, 'text'); await expect.poll(() => result.generated.length).toBe(2)
  expect(result.generated[1].chatOptions.messages.filter((message: any) => message.role === 'system' && message.content.includes('新版技能规则'))).toHaveLength(1)
})

test('late skill loading cannot import a cancelled remix into the next conversation', async ({ page }) => {
  const result = await fixture(page)
  await page.goto('/create/image?remix=skillsource')
  await expect(picker(page)).toContainText('技能 1')
  await page.getByRole('button', { name: '新对话', exact: true }).first().click()
  result.state.delayCatalog = 1800
  await page.goto('/create/image?remix=skillsource')
  await expect.poll(() => result.state.catalogReads).toBeGreaterThan(1)
  await page.getByRole('button', { name: '新对话', exact: true }).first().click()
  await expect(picker(page)).toHaveText('技能')
  await page.waitForTimeout(2100)
  await expect(picker(page)).toHaveText('技能')
  expect(result.generated).toHaveLength(0)
})

for (const kind of ['image', 'text'] as const) {
  for (const recovery of ['retry', 'fallback'] as const) test(`${kind} direct remix blocks the old draft during skill loading and supports ${recovery}`, async ({ page }) => {
    const result = await fixture(page, kind)
    await page.goto(`/create/${kind}`); await select(page, ['技能B'])
    await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill('不能发送的旧草稿')
    const reads = result.state.catalogReads
    result.state.delayCatalog = 1200; result.state.failCatalog = true
    await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')) }, `/create/${kind}?remix=skillsource`)
    await expect.poll(() => result.state.catalogReads).toBeGreaterThan(reads)
    await expect(page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true })).toBeDisabled()
    await expect(page.getByRole('alert').filter({ hasText: '技能目录暂时不可用' })).toBeVisible()
    expect(result.generated).toHaveLength(0)
    result.state.failCatalog = false; result.state.delayCatalog = 0
    await page.getByRole('button', { name: recovery === 'retry' ? '重新读取原作' : '使用当前配置', exact: true }).click()
    await expect(picker(page)).toHaveText(recovery === 'retry' ? '技能 1' : '技能'); await send(page, kind)
    await expect.poll(() => result.generated.length).toBe(1)
    expect(result.generated[0].prompt).toBe('海边日落')
    if (recovery === 'fallback') expect(result.generated[0].skills || []).toEqual([])
  })

  test(`${kind} prepared remix discards late skills after its source changes`, async ({ page }) => {
    const result = await fixture(page, kind)
    const dialog = await openRemix(page)
    const reads = result.state.catalogReads
    result.state.delayCatalog = 1600
    await dialog.getByRole('button', { name: '仅导入提示词', exact: true }).click()
    await expect.poll(() => result.state.catalogReads).toBeGreaterThan(reads)
    await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')) }, `/create/${kind}`)
    await expect(dialog).toBeHidden()
    await page.waitForTimeout(1900)
    await expect(picker(page)).toHaveText('技能')
    await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toHaveValue('')
    expect(result.generated).toHaveLength(0)
  })
}


for (const kind of ['image', 'video'] as const) test(`${kind} private and community skills persist through publication and remix`, async ({ page }) => {
  const result = await fixture(page, kind)
  await page.goto(`/create/${kind}`); await select(page, ['技能A', '私密技能']); await send(page, kind)
  await expect.poll(() => result.generated.length).toBe(1)
  expect(result.generated[0].skills).toEqual([reference, privateReference])
  expect(result.generated[0].prompt).toBe('海边日落')
  await expect(page.getByRole('button', { name: '发布作品', exact: true }).first()).toBeEnabled()
  await publish(page)
  expect(result.published[0].generation.parameters.skills).toEqual([reference, privateReference])
  result.source.generation.parameters.skills = result.published[0].generation.parameters.skills
  await importRemix(page); await send(page, kind)
  await expect.poll(() => result.generated.length).toBe(2)
  expect(result.generated[1].skills).toEqual([reference, privateReference])
})
