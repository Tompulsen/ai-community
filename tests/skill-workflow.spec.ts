import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, sourcePublic = false, authenticated = true, kind: 'text' | 'image' | 'video' = 'text') {
  const account = await mockUnifiedAccount(page, authenticated)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const reference = { id: 'work-skillwork1', sha256: 'a'.repeat(64) }
  const work = { id: 'skillwork1', title: '品牌文案技能', author: '技能作者', authorId: 'author1', avatar: '技', kind: 'resource', isSkill: true,
    status: 'published', originalStatus: 'approved', version: 1, date: '2026-11-24', tags: ['文案'], likes: 0, owned: false, model: { text: 'chat-vip', image: 'gpt-image-2', video: 'sora-2' }[kind],
    body: '输入产品与目标读者，生成适合使用场景的文案。', sourceUrl: '', cover: '/skill-cover.png', fileIds: ['cover1'],
    files: [{ id: 'cover1', name: 'cover.png', type: 'image/png', url: '/skill-cover.png' }],
    generation: { skill: { ...(kind === 'text' ? {} : { kind }), platform: 'chat-vip', group: 'vip', sourcePublic, coverFileId: 'cover1', sourceFileId: sourcePublic ? 'source1' : undefined } },
    skillReference: reference,
  }
  if (sourcePublic) { work.files.push({ id: 'source1', name: 'SKILL.md', type: 'text/plain', url: '/skill-source.md' }); work.fileIds.push('source1') }
  const state = { work, available: true, groupsDelay: 0, workDelay: 0, catalogueDelay: 0, groups: ['auto', 'vip'] }
  const generated: any[] = [], reads: string[] = []
  await page.route('**/skill-cover.png*', route => route.fulfill({ body: image, contentType: 'image/jpeg' }))
  await page.route('**/api/works/skillwork1', async route => {
    reads.push('work'); if (state.workDelay) await new Promise(resolve => setTimeout(resolve, state.workDelay))
    return route.fulfill({ json: { work: state.available ? work : { ...work, skillReference: undefined } } })
  })
  await page.route('**/api/new-api/model-groups', async route => {
    if (state.groupsDelay) await new Promise(resolve => setTimeout(resolve, state.groupsDelay))
    return route.fulfill({ json: { success: true, data: { selectedGroup: 'auto', selectedTokenId: 41, groups: state.groups.map(id => ({ id, name: id === 'vip' ? '高级文本' : '默认分组', ratio: 1 })) } } })
  })
  await page.route('**/api/creation/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: route.request().postDataJSON()?.group === 'vip' ? work.model : 'chat-base', kinds: [kind] }] } })
    if (path.endsWith('/skills/catalog')) {
      if (state.catalogueDelay) await new Promise(resolve => setTimeout(resolve, state.catalogueDelay))
      return route.fulfill({ json: { items: state.available ? [{ ...reference, name: work.title, description: work.body, kind, body: '', group: 'vip', model: work.model }] : [] } })
    }
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) generated.push(route.request().postDataJSON())
    return route.fulfill({ json: { status: 'succeeded', outputs: kind === 'text' ? [{ text: '技能调用完成' }] : [{ url: '/skill-cover.png' }], tokenId: 41, protocol: 'sync' } })
  })
  return { ...account, scenario: state, generated, reads, reference }
}

for (const width of [320, 390, 1440]) test(`skill detail exposes only permitted downloads and imports a ready draft at ${width}px`, async ({ page }, info) => {
  const f = await fixture(page, width === 1440)
  await page.setViewportSize({ width, height: 900 })
  if (width === 390) await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/work/skillwork1')
  const invoke = page.getByRole('link', { name: '调用技能' })
  await expect(invoke).toHaveAttribute('href', '/create/text?skill=skillwork1')
  await expect(page.getByRole('link', { name: '下载技能', exact: true })).toHaveCount(width === 1440 ? 1 : 0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.detail-skill-actions').analyze()).violations).toEqual([])
  await invoke.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`skill-detail-${width}.png`) })
  await invoke.click()
  await expect(page).toHaveURL(url => url.pathname === '/create/text' && !url.searchParams.has('skill'))
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('')
  expect(f.generated).toHaveLength(0)
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '品牌文案技能', exact: true })).toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('为产品写介绍')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => f.generated.length).toBe(1)
  expect(f.generated[0]).toMatchObject({ model: 'chat-vip', skills: [f.reference] })
  expect(f.generated[0].chatOptions.messages.some((message: any) => message.role === 'system' && message.content.includes('品牌文案技能'))).toBe(false)
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('技能调用完成')
  expect(errors).toEqual([])
})

for (const kind of ['text', 'image', 'video'] as const) test(`cold ${kind} skill import preserves the original conversation draft and model`, async ({ page }) => {
  const f = await fixture(page, false, true, kind)
  f.scenario.groupsDelay = 1000
  await page.goto('/community')
  await page.evaluate(kind => localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
    _hasHydrated: true, mediaConversationsMigrated: true, activeId: 'old-chat', sessions: [{ id: 'old-chat', creationKind: kind, mediaDrafts: kind === 'text' ? undefined : { [kind]: { model: 'old-model', prompt: '原媒体草稿', references: [] } }, topic: '原对话', messages: [], settings: {}, skillIds: [], textModel: 'chat-base', draft: '原有未发送内容', lastUpdate: Date.now() }],
  } })), kind)
  await page.goto(`/create/${kind}?skill=skillwork1`)
  await expect(page).toHaveURL(url => url.pathname === `/create/${kind}` && !url.searchParams.has('skill'))
  expect(f.generated).toHaveLength(0)
  const saved = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const opened = indexedDB.open('community-studio')
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const request = opened.result.transaction('keyval').objectStore('keyval').get('octopus:user-17:native-chat')
      request.onsuccess = () => { opened.result.close(); resolve(request.result) }
      request.onerror = () => { opened.result.close(); reject(request.error) }
    }
  }))
  const old = JSON.parse(saved).state.sessions.find((chat: any) => chat.id === 'old-chat')
  expect(old).toMatchObject({ textModel: 'chat-base', draft: '原有未发送内容' })
  if (kind !== 'text') expect(old.mediaDrafts[kind]).toMatchObject({ model: 'old-model', prompt: '原媒体草稿', references: [] })

})

test('missing group permission preserves the skill entry and retry succeeds without generating', async ({ page }) => {
  const f = await fixture(page); f.scenario.groups = ['auto']
  await page.goto('/create/text?skill=skillwork1')
  await expect(page.getByRole('alert').filter({ hasText: '没有该技能模型分组的权限' })).toBeVisible()
  await expect(page).toHaveURL(/skill=skillwork1/)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  expect(f.generated).toHaveLength(0)
  f.scenario.groups = ['auto', 'vip']
  await page.getByRole('button', { name: '重新读取技能', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/create/text' && !url.searchParams.has('skill'))
  expect(f.generated).toHaveLength(0)
})

test('account changes cancel a delayed skill import', async ({ page }) => {
  const f = await fixture(page); f.scenario.workDelay = 900
  await page.goto('/create/text?skill=skillwork1')
  await expect.poll(() => f.reads.length).toBeGreaterThan(0)
  f.state.user = { ...f.state.user, id: 'other-user', accountId: '18' }
  f.scenario.groups = ['auto']
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert').filter({ hasText: '没有该技能模型分组的权限' })).toBeVisible()
  await expect(page).toHaveURL(/skill=skillwork1/)
  expect(f.generated).toHaveLength(0)
})

test('revoking an imported skill blocks a new send and keeps the conversation', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/create/text?skill=skillwork1')
  await expect(page).toHaveURL(url => url.pathname === '/create/text' && !url.searchParams.has('skill'))
  f.scenario.available = false
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续使用技能')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant').last()).toContainText('部分技能已下架或不可用')
  expect(f.generated).toHaveLength(0)
})

test('guests retain the skill target when opening login', async ({ page }) => {
  await fixture(page, false, false)
  await page.goto('/work/skillwork1')
  await page.getByRole('link', { name: '调用技能' }).click()
  await expect(page).toHaveURL(url => url.pathname === '/account' && url.searchParams.get('returnTo') === '/create/text?skill=skillwork1')
})


for (const kind of ['image', 'video'] as const) for (const width of [390, 1440]) {
  test(`${kind} skill opens its model and private reference without auto generation at ${width}px`, async ({ page }, info) => {
    const f = await fixture(page, width === 1440, true, kind)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/work/skillwork1')
    await expect(page.getByRole('link', { name: '调用技能' })).toHaveAttribute('href', `/create/${kind}?skill=skillwork1`)
    await page.getByRole('link', { name: '调用技能' }).click()
    await expect(page).toHaveURL(url => url.pathname === `/create/${kind}` && !url.searchParams.has('skill'))
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
    expect(f.generated).toHaveLength(0)
    await page.getByRole('button', { name: '技能与工具', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: '品牌文案技能', exact: true })).toBeChecked()
    await page.screenshot({ path: info.outputPath(`skill-call-${kind}-${width}.png`) })
    await page.getByRole('button', { name: '关闭技能与工具', exact: true }).click()
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('海边的晚霞')
    await page.reload()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('海边的晚霞')
    expect(f.generated).toHaveLength(0)
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await expect.poll(() => f.generated.length).toBe(1)
    expect(f.generated[0]).toMatchObject({ kind, model: f.scenario.work.model, skills: [f.reference], prompt: '海边的晚霞' })
    expect(f.generated[0].referenceUrls || []).toEqual([])
    expect(JSON.stringify(f.generated[0])).not.toContain('sourceFileId')
  })
}

for (const kind of ['image', 'video'] as const) test(`${kind} legacy skill link redirects and unavailable skills stop before generation`, async ({ page }) => {
  const f = await fixture(page, false, true, kind)
  f.scenario.groups = ['auto']
  await page.goto('/create/text?skill=skillwork1')
  await expect(page).toHaveURL(new RegExp(`/create/${kind}\\?skill=skillwork1`))
  await expect(page.getByRole('alert').filter({ hasText: '没有该技能模型分组的权限' })).toBeVisible()
  f.scenario.groups = ['auto', 'vip']
  await page.getByRole('button', { name: '重新读取技能', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === `/create/${kind}` && !url.searchParams.has('skill'))
  f.scenario.available = false
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('不应发出')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '技能已下架或不可用' })).toBeVisible()
  expect(f.generated).toHaveLength(0)
})

for (const [kind, button] of [['text', '新对话'], ['text', '新建创作'], ['image', '新对话'], ['video', '新对话']] as const) test(`${button} cancels slow ${kind} skill import`, async ({ page }) => {
  const f = await fixture(page, false, true, kind)
  f.scenario.catalogueDelay = 1500
  if (button === '新建创作') await page.setViewportSize({ width: 800, height: 900 })
  await page.goto(`/create/${kind}?skill=skillwork1`)
  await expect.poll(() => f.reads.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: button, exact: true }).first().click()
  await expect(page).not.toHaveURL(/skill=/)
  await page.waitForTimeout(1800)
  await expect(page.getByRole('button', { name: '技能与工具', exact: true })).toHaveText('技能')
  expect(f.generated).toHaveLength(0)
})


test('opening a video conversation cancels a slow text skill import without changing its destination', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/community')
  await page.evaluate(() => localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
    _hasHydrated: true, mediaConversationsMigrated: true, activeId: 'video-chat', sessions: [{ id: 'video-chat', creationKind: 'video', topic: '已有视频对话', messages: [], settings: {}, skillIds: [], mediaDrafts: { video: { prompt: '已有视频草稿', model: 'sora-2', references: [] } }, lastUpdate: Date.now() }],
  } })))
  f.scenario.catalogueDelay = 1500
  await page.goto('/create/text?skill=skillwork1')
  await expect.poll(() => f.reads.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: '已有视频对话', exact: true }).first().click()
  await expect(page).toHaveURL(url => url.pathname === '/create/video' && !url.searchParams.has('skill'))
  await page.waitForTimeout(1800)
  await expect(page).toHaveURL(url => url.pathname === '/create/video' && !url.searchParams.has('skill'))
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('已有视频草稿')
  expect(f.generated).toHaveLength(0)
})


test('copying a conversation cancels a slow skill import on mobile', async ({ page }) => {
  const f = await fixture(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留我的草稿')
  f.scenario.catalogueDelay = 1500
  await page.evaluate(() => { history.pushState({}, '', '/create/text?skill=skillwork1'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect.poll(() => f.reads.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '复制对话', exact: true }).click()
  await expect(page).not.toHaveURL(/skill=/)
  await page.waitForTimeout(1800)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留我的草稿')
  await expect(page.getByRole('button', { name: '技能与工具', exact: true })).toHaveText('技能')
  expect(f.generated).toHaveLength(0)
})
