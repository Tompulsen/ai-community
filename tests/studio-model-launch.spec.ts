import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { CreationModel } from '../src/native-studio'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const models: CreationModel[] = [
    { id: 'default-text', kinds: ['text'], groups: ['auto'] },
    { id: 'gpt-5', kinds: ['text'], groups: ['auto', 'vip'] },
    { id: 'default-image', kinds: ['image'], groups: ['auto'] },
    { id: 'gpt-image-2', kinds: ['image'], groups: ['auto', 'vip'] },
    { id: 'default-video', kinds: ['video'], groups: ['auto'], video: { resolutions: ['480p'], durations: [5] } },
    { id: 'configured-video', configuredKind: 'video', kinds: ['text'], groups: ['auto', 'vip'], video: {
      resolutions: ['720p'], autoResolution: '720p', durations: [5, 10], autoDuration: 10,
      aspectRatios: ['16:9', '9:16'], sizes: { '720p': { '16:9': '1280x720', '9:16': '720x1280' } },
    } },
  ]
  const state = { revoked: '', fail: false, catalogueFail: false, calls: [] as any[], modelReads: [] as string[], models }
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: {
    selectedGroup: 'auto', selectedTokenId: 41, groups: ['auto', 'vip'].map(id => ({ id, name: id, ratio: 1 })),
  } } }))
  await page.route('**/api/creation/**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/models')) {
      if (url.searchParams.get('scope') === 'all') return route.fulfill(state.catalogueFail
        ? { status: 503, json: { error: { message: '分类读取失败' } } } : { json: { items: models } })
      const group = request.method() === 'POST' ? request.postDataJSON().group : 'auto'
      state.modelReads.push(group)
      return route.fulfill(state.fail ? { status: 503, json: { error: { message: '模型服务暂不可用' } } } : { json: {
        tokenId: group === 'vip' ? 42 : 41, items: models.filter(item => item.id !== state.revoked && item.groups?.includes(group)),
      } })
    }
    if (url.pathname.endsWith('/generate') || url.pathname.includes('/chat')) {
      state.calls.push({ ...request.postDataJSON(), headers: request.headers() })
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/result.mp4' }], tokenId: 42, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('https://media.example/**', route => route.fulfill({ status: 204 }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: {
    userId: Number(account.state.user.accountId), currency: '积分', rows: models.flatMap(item => item.groups!.map(group => ({
      model: item.id, group, billing: '每次请求', price: '积分 100', details: { unit: 'request', tiers: [{ perRequest: '积分 100' }] },
    }))),
  } } }))
  return { ...account, launch: state }
}

async function savedChats(page: Page) {
  return page.evaluate(() => new Promise<any>((resolve, reject) => {
    const opened = indexedDB.open('community-studio')
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const request = opened.result.transaction('keyval').objectStore('keyval').get('octopus:user-17:native-chat')
      request.onsuccess = () => { opened.result.close(); resolve(JSON.parse(request.result || '{"state":{"sessions":[]}}').state) }
      request.onerror = () => { opened.result.close(); reject(request.error) }
    }
  }))
}
async function openEmbedded(page: Page) {
  await page.locator('.studio-sidebar').getByRole('button', { name: '模型广场', exact: true }).click()
  await expect(plaza(page)).toBeVisible()
}
async function holdVip(page: Page) {
  let finish!: () => void, started = false
  const pending = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/creation/models', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().group === 'vip') {
      started = true; await pending
    }
    await route.fallback()
  })
  return { finish, started: () => started }
}

for (const kind of ['text', 'image', 'video'] as const) test(`embedded plaza preserves the previous ${kind} draft and opens a fresh model conversation`, async ({ page }) => {
  const { launch } = await fixture(page)
  await page.goto(`/create/${kind}`)
  await expect(selected(page)).toHaveValue(`default-${kind}`)
  await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill('保留原有创作草稿')
  await expect.poll(async () => (await savedChats(page)).sessions[0]?.[kind === 'text' ? 'draft' : 'mediaDrafts'] !== undefined).toBe(true)
  const old = (await savedChats(page)).sessions[0]
  await openEmbedded(page)
  await call(page, kind === 'text' ? 'gpt-5' : kind === 'image' ? 'gpt-image-2' : 'configured-video')
  await expect(plaza(page)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toHaveValue('')
  await expect.poll(async () => (await savedChats(page)).sessions.length).toBe(2)
  const before = (await savedChats(page)).sessions.find((item: any) => item.id === old.id)
  if (kind === 'text') expect(before).toMatchObject({ draft: '保留原有创作草稿', textModel: 'default-text' })
  else expect(before.mediaDrafts[kind]).toMatchObject({ prompt: '保留原有创作草稿', model: `default-${kind}` })
  expect(launch.calls).toHaveLength(0)
  if (kind !== 'text') {
    const url = page.url()
    await page.getByRole('navigation', { name: '工作台导航', exact: true }).getByRole('button', { name: '新对话', exact: true }).click()
    await expect(page).not.toHaveURL(url)
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('新建后保留的内容')
    await page.reload()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('新建后保留的内容')
  }
})

test('Discovery modal launches across kinds and browser history restores the selected conversation', async ({ page }) => {
  const { launch } = await fixture(page)
  await page.goto('/discover')
  await expect(selected(page)).toHaveValue('default-image')
  await page.getByRole('button', { name: /^预计积分消耗：/ }).click()
  const plazaButton = page.getByRole('button', { name: '查看全部定价', exact: true })
  // The compact price popover exposes the full plaza entry.
  await plazaButton.click()
  await expect(plaza(page)).toBeVisible()
  await call(page, 'gpt-5')
  await expect(selected(page)).toHaveValue('gpt-5')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const url = page.url()
  await page.goBack()
  await expect(page).toHaveURL(/\/discover$/)
  await page.goForward()
  await expect(page).toHaveURL(url)
  await expect(selected(page)).toHaveValue('gpt-5')
  expect(launch.calls).toHaveLength(0)
})

test('revoked model access preserves the old draft and retries without a duplicate conversation', async ({ page }) => {
  const { launch } = await fixture(page)
  await page.goto('/create/video')
  await expect(selected(page)).toHaveValue('default-video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('失败后应保留的草稿')
  await openEmbedded(page)
  launch.revoked = 'configured-video'
  await call(page, 'configured-video')
  await expect(plaza(page).getByRole('alert')).toContainText('此分组下的模型暂不可用')
  expect((await savedChats(page)).sessions).toHaveLength(1)
  expect((await savedChats(page)).sessions[0].mediaDrafts.video).toMatchObject({ model: 'default-video', prompt: '失败后应保留的草稿' })
  launch.revoked = ''
  await call(page, 'configured-video')
  await expect(selected(page)).toHaveValue('configured-video')
  await expect.poll(async () => (await savedChats(page)).sessions.length).toBe(2)
  expect(launch.calls).toHaveLength(0)
})

test('a pending launch prevents double clicks and cancelling navigation keeps the original video draft', async ({ page }) => {
  const { launch } = await fixture(page)
  await page.goto('/create/video')
  await expect(selected(page)).toHaveValue('default-video')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('取消调用时保留')
  await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
  await page.getByTitle('社区工具', { exact: true }).click()
  await page.getByRole('dialog', { name: '社区工具', exact: true }).getByRole('link', { name: '模型广场', exact: true }).click()
  const held = await holdVip(page)
  try {
    await call(page, 'configured-video')
    await expect.poll(held.started).toBe(true)
    await expect(card(page, 'configured-video').getByRole('button', { name: '调用 configured-video', exact: true })).toBeDisabled()
    await expect(card(page, 'gpt-5').getByRole('button', { name: '调用 gpt-5', exact: true })).toBeDisabled()
    await page.goBack(); await page.goBack()
    await expect(page).toHaveURL(/\/create\/video$/)
    await expect(page.locator('form.creation-controls')).toHaveAttribute('inert', '')
    await expect(page.getByRole('status').filter({ hasText: '正在准备所选模型' })).toBeVisible()
  } finally { held.finish() }
  await expect(selected(page)).toHaveValue('default-video')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('取消调用时保留')
  await expect.poll(async () => (await savedChats(page)).sessions[0]?.mediaDrafts.video.model).toBe('default-video')
  expect((await savedChats(page)).sessions).toHaveLength(1)
  expect(launch.calls).toHaveLength(0)
})

test('account changes discard a pending launch without opening the old account model', async ({ page }) => {
  const { state, launch } = await fixture(page)
  await page.goto('/models')
  const held = await holdVip(page)
  try {
    await call(page, 'gpt-5')
    await expect.poll(held.started).toBe(true)
    state.user = { ...state.user, id: '18', accountId: '18' }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => launch.modelReads.length).toBeGreaterThan(0)
    await expect(card(page, 'gpt-5').getByRole('button', { name: '调用 gpt-5', exact: true })).toHaveText('调用')
  } finally { held.finish() }
  await expect(page).toHaveURL(/\/models$/)
  expect(launch.calls).toHaveLength(0)
})

test('cancelling a cold launch restores the group loaded during preparation and keeps the editor paused', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
    mediaConversationsMigrated: true, activeId: 'original-chat', sessions: [{ id: 'original-chat', creationKind: 'image',
      mediaDrafts: { image: { model: 'default-image', prompt: '冷启动前保存的草稿', references: [] } },
      topic: '原对话', messages: [], settings: {}, skillIds: [], lastUpdate: Date.now() }],
  } })))
  let releaseGroups!: () => void, groupsRequested = false
  const groups = new Promise<void>(resolve => { releaseGroups = resolve })
  await page.route('**/api/new-api/model-groups', async route => { groupsRequested = true; await groups; await route.fallback() })
  const held = await holdVip(page)
  try {
    await page.goto('/models')
    await call(page, 'gpt-image-2')
    await expect.poll(() => groupsRequested).toBe(true)
    releaseGroups()
    await expect.poll(held.started).toBe(true)
    await page.getByTitle('社区工具', { exact: true }).click()
    await page.getByRole('dialog', { name: '社区工具', exact: true }).getByRole('link', { name: '创作台', exact: true }).click()
    await expect(page).toHaveURL(/\/create(?:\/image)?$/)
    await expect(page.locator('form.creation-controls')).toHaveAttribute('inert', '')
  } finally { releaseGroups(); held.finish() }
  await expect(selected(page)).toHaveValue('default-image')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('冷启动前保存的草稿')
  expect((await savedChats(page)).sessions).toHaveLength(1)
  expect((await savedChats(page)).sessions[0].mediaDrafts.image.model).toBe('default-image')
})

test('switching creation mode after a plaza launch persists the explicitly selected conversation mode', async ({ page }) => {
  await fixture(page)
  await page.goto('/models')
  await call(page, 'configured-video')
  await expect(selected(page)).toHaveValue('configured-video')
  const id = new URL(page.url()).searchParams.get('conversation')
  await page.getByRole('button', { name: '创作模式：视频生成', exact: true }).click()
  await page.getByRole('group', { name: '创作类型', exact: true }).getByRole('button', { name: '图片生成', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/create/image\\?conversation=${id}`))
  await expect.poll(async () => (await savedChats(page)).sessions.find((item: any) => item.id === id)?.composerKind).toBe('image')
  await page.reload()
  await expect(selected(page)).toHaveValue('gpt-image-2')
})

test('catalogue failures disable launching until the catalogue is reloaded', async ({ page }) => {
  const { launch } = await fixture(page)
  launch.catalogueFail = true
  await page.goto('/models')
  await expect(card(page, 'gpt-5').getByRole('button', { name: '调用 gpt-5', exact: true })).toBeDisabled()
  await expect(card(page, 'gpt-5')).toContainText('暂不支持工作台调用')
  launch.catalogueFail = false
  await plaza(page).getByRole('button', { name: '重试分类', exact: true }).click()
  await expect(card(page, 'gpt-5').getByRole('button', { name: '调用 gpt-5', exact: true })).toBeEnabled()
})

for (const [width, mode] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) test(`model call controls fit ${width}px and support keyboard and accessible labels`, async ({ page }, info) => {
  await fixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/models')
  await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
  const button = card(page, 'gpt-image-2').getByRole('button', { name: '调用 gpt-image-2', exact: true })
  await expect(button).toBeEnabled()
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.model-prices').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`model-call-${width}-${mode}.png`), fullPage: true })
  await button.focus(); await page.keyboard.press('Enter')
  await expect(selected(page)).toHaveValue('gpt-image-2')
})
const plaza = (page: Page) => page.getByRole('region', { name: '模型广场', exact: true })
const card = (page: Page, model: string) => plaza(page).getByRole('article', { name: `${model} 模型价格`, exact: true })
async function call(page: Page, model: string, group = 'vip') {
  await card(page, model).getByRole('combobox').selectOption(group)
  await card(page, model).getByRole('button', { name: `调用 ${model}`, exact: true }).click()
}
const selected = (page: Page) => page.getByRole('combobox', { name: '模型', exact: true })

for (const [kind, model] of [['text', 'gpt-5'], ['image', 'gpt-image-2'], ['video', 'configured-video']] as const) {
  test(`plaza launches ${kind} with the chosen model and billing group without generating`, async ({ page }) => {
    const { launch } = await fixture(page)
    await page.goto('/models')
    await call(page, model)
    await expect(page).toHaveURL(new RegExp(`/create/${kind}\\?conversation=`))
    await expect(selected(page)).toHaveValue(model)
    await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toHaveValue('')
    expect(launch.modelReads).toContain('vip')
    expect(launch.calls).toHaveLength(0)
    if (kind === 'video') {
      await page.getByRole('button', { name: '高级参数', exact: true }).click()
      await expect(page.getByRole('radiogroup', { name: '视频分辨率', exact: true }).getByRole('radio', { name: '720P', exact: true })).toBeVisible()
      expect(await page.getByRole('radiogroup', { name: '视频分辨率', exact: true }).locator('input:checked').inputValue()).toMatch(/^(auto|720p)$/)
      await page.keyboard.press('Escape')
      await page.getByRole('textbox', { name: '提示词', exact: true }).fill('用户主动提交的视频任务')
      await page.getByRole('button', { name: '开始生成', exact: true }).click()
      await expect.poll(() => launch.calls.length).toBe(1)
      expect(launch.calls[0]).toMatchObject({ model, headers: { 'x-new-api-group': 'vip', 'x-new-api-token': '42' } })
    }
    await page.reload()
    await expect(selected(page)).toHaveValue(model)
  })
}
