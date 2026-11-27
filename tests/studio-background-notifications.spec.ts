import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'

const dock = (page: Page) => page.getByRole('complementary', { name: '后台生成任务', exact: true })

for (const width of [320, 390, 1440]) test(`remix choices stay on the work and restore keyboard focus at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  const state = await fixture(page, '/work/backgroundsource')
  const entry = page.getByRole('button', { name: '制作同款', exact: true })
  await entry.click()
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  await expect(dialog.getByRole('button', { name: '进入工作台生成' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^后台生成(?:$|\s)/ })).toBeVisible()
  await expect(page).toHaveURL(/\/work\/backgroundsource$/)
  expect(state.submissions()).toBe(0)
  expect((await new AxeBuilder({ page }).include('.remix-choice-dialog').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`remix-choices-${width}.png`) })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(entry).toBeFocused()
  await expect(page).toHaveURL(/\/work\/backgroundsource$/)
  state.finish()
})

test('canceling background preparation preserves the original workbench draft', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留我的原有草稿')
  await page.goto('/work/backgroundsource')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await expect(page.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/create/image')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留我的原有草稿')
  expect(state.submissions()).toBe(0)
  state.finish()
})

test('canceling background preparation preserves an existing Gemini remix draft unchanged', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  const draft = { prompt: '不要修改我的同款草稿', model: 'gemini-3-pro-image', sourceWorkId: 'oldsource', manualSize: '1200x900', count: 3, protocol: 'async', imageOptions: { seed: '42' }, references: [] }
  await page.evaluate(value => {
    const key = 'octopus:user-17:native-chat', stored = JSON.parse(localStorage.getItem(key)!)
    const chat = stored.state.sessions.find((item: any) => item.id === 'current-session')
    chat.sourceWorkId = value.sourceWorkId; chat.mediaDrafts = { image: value }
    localStorage.setItem(key, JSON.stringify(stored))
  }, draft)
  await page.reload()
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await expect(page.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/shared\/studio\/chat-persistence\.ts(?:\?|$)/.test(name)).at(-1)!
    const { readChatSnapshot } = await import(/* @vite-ignore */ path)
    const stored = await readChatSnapshot('octopus:user-17:native-chat')
    return stored.state.sessions.find((item: any) => item.id === 'current-session').mediaDrafts.image
  })).toEqual(draft)
  expect(state.submissions()).toBe(0)
  state.finish()
})

test('switching accounts closes an unsubmitted background dialog without creating a task', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await expect(page.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
  state.account.state.user.id = '18'; state.account.state.user.accountId = '18'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.submissions()).toBe(0)
  state.finish()
})

test('guest background choice requests login on the work page without submitting', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  state.account.state.authenticated = false; state.account.state.accountAuthenticated = false
  await page.reload()
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await expect(page.getByRole('dialog')).toContainText('请先登录后使用后台生成')
  await expect(page.getByRole('link', { name: '去登录', exact: true })).toHaveAttribute('href', '/account?returnTo=/work/backgroundsource')
  await expect(page).toHaveURL(/\/work\/backgroundsource$/)
  expect(state.submissions()).toBe(0)
  state.finish()
})

async function fixture(page: Page, initialPath = '/create/image', kind: 'image' | 'video' = 'image',
  history: { phase?: 'complete' | 'error' | 'attention' | 'running'; recovery?: 'succeeded' | 'missing' | 'pending' } = {}) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { userId: 17, rows: [] } } }))
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  let finish!: () => void, submissions = 0
  const requests: any[] = [], controls = { unavailable: false, reject: false, disconnect: false, recoveries: 0,
    recoveryMissing: history.recovery === 'missing', recoveryPending: history.recovery === 'pending', modelsWait: null as Promise<void> | null }
  const source = { id: 'backgroundsource', title: '后台同款示例', authorId: '26', author: '原作者', avatar: '原', kind, prompt: '海底城市与发光的水母', model: kind === 'image' ? 'gpt-image-2' : 'sora-2', version: 1, tags: [], status: 'published', date: '2026-11-19', likes: 0, owned: false, saved: false, liked: false,
    fileIds: ['cover'], cover: '/legacy-files/cover', files: [{ id: 'cover', name: '封面.jpg', type: 'image/jpeg', url: '/legacy-files/cover' }],
    referenceFiles: [{ id: 'reference', name: '作者参考图.jpg', type: 'image/jpeg', url: '/legacy-files/reference' }],
    generation: { model: kind === 'image' ? 'gpt-image-2' : 'sora-2', prompt: '海底城市与发光的水母', parameters: { version: 1, kind, group: 'auto', n: kind === 'image' ? 2 : 1, duration: 8, aspect_ratio: kind === 'image' ? '1:1' : '16:9' } } }
  await page.route('**/legacy-files/**', route => route.fulfill({ contentType: 'image/jpeg', body: photo }))
  await page.route('**/api/works**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/works/backgroundsource' ? { work: source } : { items: [], nextCursor: null } }))
  const waiting = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') {
      if (controls.modelsWait) await controls.modelsWait
      return route.fulfill({ json: { tokenId: 41, items: controls.unavailable ? [] : [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }] } })
    }
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (path === '/api/creation/generate') {
      submissions++
      requests.push(route.request().postDataJSON())
      await waiting
      if (controls.disconnect) return route.abort('failed')
      if (controls.reject) return route.fulfill({ status: 400, json: { error: '参考图不符合模型要求' } })
      return route.fulfill({ json: { status: 'succeeded', tokenId: 41, protocol: 'sync', outputs: [{ url: 'https://media.example/background-result.jpg' }] } })
    }
    if (path.startsWith('/api/creation/requests/')) {
      controls.recoveries++
      if (controls.recoveryMissing) return route.fulfill({ status: 404, json: { error: '原请求未找到，请核对原任务。' } })
      if (controls.recoveryPending) return route.fulfill({ json: { requestId: path.split('/').at(-1), status: 'pending', tokenId: 41, outputs: [] } })
      return route.fulfill({ json: { status: 'succeeded', tokenId: 41, outputs: [{ url: 'https://media.example/recovered.jpg' }] } })
    }
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(history => {
    if (sessionStorage.getItem('background-notification-fixture')) return
    sessionStorage.setItem('background-notification-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'already-completed', owner: '17', kind: 'image', conversationId: 'old-session', model: 'gpt-image-2',
      prompt: '以前已经看过的图片', createdAt: now - 60000, settledAt: history.phase === 'running' ? undefined : now - 50000, phase: history.phase || 'complete',
      error: history.phase === 'error' || history.phase === 'attention' ? '以前已确认的生成异常' : undefined,
      protocol: 'sync', urls: history.phase && history.phase !== 'complete' ? [] : ['https://media.example/old.jpg'], text: '', references: [],
      request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    }]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'current-session', sessions: [{
        id: 'current-session', topic: '当前图片对话', creationKind: 'image', composerKind: 'image',
        mediaConversationId: 'current-session', model: 'gpt-image-2', settings: {}, skillIds: [], search: 'off',
        messages: [], lastUpdate: now,
      }],
    } }))
  }, history)
  await page.goto(initialPath)
  await expect.poll(() => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)
    if (!path) return false
    const studio = await import(/* @vite-ignore */ path)
    return studio.creation.loaded && studio.creation.tasks.some(task => task.id === 'already-completed')
  })).toBe(true)
  return { finish, submissions: () => submissions, requests, controls, source, account }
}

async function startImage(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(prompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toBeVisible()
}

async function leaveWorkbench(page: Page) {
  const link = page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true })
  if (!await link.isVisible()) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await link.click()
  await expect(page).toHaveURL(/\/discover$/)
}

async function completeImage(page: Page, prompt: string) {
  await expect.poll(() => page.evaluate(async prompt => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    return studio.creation.tasks.find(task => task.prompt === prompt)?.phase
  }, prompt), { timeout: 10000 }).toBe('complete')
}

test('previously completed history stays quiet in the community and after reload', async ({ page }) => {
  const state = await fixture(page, '/discover')
  await expect(dock(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(dock(page)).toHaveCount(0)
  expect(state.submissions()).toBe(0)
})

for (const phase of ['error', 'attention'] as const) test(`historical ${phase} stays quiet after reload and signing back in`, async ({ page }) => {
  const state = await fixture(page, '/discover', 'image', { phase, recovery: 'missing' })
  const settled = () => page.evaluate(async () => {
    const { creation } = await import('/src/native-studio.ts')
    return creation.loaded && ['error', 'attention'].includes(creation.tasks.find(task => task.id === 'already-completed')?.phase || '')
  })
  await expect.poll(settled).toBe(true)
  await expect(dock(page)).toHaveCount(0)
  await page.reload()
  await expect.poll(settled).toBe(true)
  await expect(dock(page)).toHaveCount(0)
  state.account.state.authenticated = false; state.account.state.accountAuthenticated = false
  await page.reload()
  await expect(dock(page)).toHaveCount(0)
  state.account.state.authenticated = true; state.account.state.accountAuthenticated = true
  await page.reload()
  await expect.poll(settled).toBe(true)
  await expect(dock(page)).toHaveCount(0)
  expect(state.submissions()).toBe(0)
})

for (const disconnect of [false, true]) test(`closing a new ${disconnect ? 'connection error' : 'failed task'} reminder survives reload and sign-in`, async ({ page }, info) => {
  if (disconnect) await page.setViewportSize({ width: 390, height: 900 })
  const state = await fixture(page, '/work/backgroundsource')
  state.controls.reject = !disconnect; state.controls.disconnect = disconnect; state.controls.recoveryMissing = true
  try {
    await page.getByRole('button', { name: '制作同款', exact: true }).click()
    await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
    await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect.poll(state.submissions).toBe(1)
    state.finish()
    await expect(dock(page)).toContainText(disconnect ? '结果待确认' : '生成失败')
    const close = dock(page).getByRole('button', { name: '关闭此提醒', exact: true })
    if (disconnect) {
      const bounds = await close.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
      expect(await dock(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await close.focus()
      await expect(close).toBeFocused()
      await page.screenshot({ path: info.outputPath('close-reminder-keyboard-390.png') })
      await page.keyboard.press('Enter')
    } else await close.click()
    await expect(dock(page)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
    state.account.state.authenticated = false; state.account.state.accountAuthenticated = false
    await page.reload()
    state.account.state.authenticated = true; state.account.state.accountAuthenticated = true
    await page.reload()
    await expect.poll(() => page.evaluate(async () => (await import('/src/native-studio.ts')).creation.loaded)).toBe(true)
    await expect(dock(page)).toHaveCount(0)
    expect(state.submissions()).toBe(1)
    const stored = await page.evaluate(async () => (await (await import('/src/studio-task-store.ts')).readTaskSnapshot('17')) || [])
    expect(stored.some(task => task.id === state.requests[0].requestId)).toBe(true)
  } finally { state.finish() }
})

for (const pending of [false, true]) test(`recovering an in-flight history task ${pending ? 'keeps server-confirmed pending progress and then' : 'immediately'} reports completion once`, async ({ page }) => {
  const state = await fixture(page, '/discover', 'image', { phase: 'running', recovery: pending ? 'pending' : 'succeeded' })
  if (pending) {
    await expect(dock(page)).toContainText('正在生成')
    state.controls.recoveryPending = false
  }
  await completeImage(page, '以前已经看过的图片')
  await expect(dock(page)).toContainText('生成完成')
  await dock(page).getByRole('button', { name: '查看结果', exact: true }).click()
  await expect(page).toHaveURL(/\/create\/image/)
  await leaveWorkbench(page)
  await page.reload()
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(dock(page)).toHaveCount(0)
  expect(state.controls.recoveries).toBeGreaterThanOrEqual(pending ? 2 : 1)
  expect(state.submissions()).toBe(0)
})

for (const action of ['message', 'conversation', 'failed records'] as const) test(`deleting ${action} keeps the failed task absent after reload without a background reminder`, async ({ page }) => {
  const state = await fixture(page), prompt = `删除后不再恢复：${action}`
  state.controls.reject = true
  try {
    await startImage(page, prompt)
    await expect.poll(state.submissions).toBe(1)
    state.finish()
    await expect(page.locator('.task-status')).toContainText('生成失败')
    if (action === 'message') {
      await page.setViewportSize({ width: 800, height: 900 })
      await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
      await page.getByRole('button', { name: '多选消息', exact: true }).click()
      await page.getByRole('checkbox', { name: `选择消息：${prompt}`, exact: true }).check()
      await page.getByRole('button', { name: '删除所选消息', exact: true }).click()
    } else if (action === 'conversation') {
      const sidebar = page.locator('.studio-sidebar')
      await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
      await sidebar.getByRole('checkbox', { name: '选择对话：当前图片对话', exact: true }).check()
      await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
    } else {
      await page.locator('.studio-sidebar').getByRole('button', { name: '作品库', exact: true }).click()
      const library = page.getByRole('dialog', { name: '作品库', exact: true })
      await library.getByRole('button', { name: '作品库设置', exact: true }).click()
      await page.getByRole('button', { name: '清理失败记录', exact: true }).click()
    }
    await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
    if (action === 'failed records') await expect.poll(() => page.evaluate(async id =>
      (await (await import('/src/studio-task-store.ts')).readTaskSnapshot('17'))?.some(task => task.id === id), state.requests[0].requestId)).toBe(false)
    else await expect(page.locator('.creation-request').filter({ hasText: prompt })).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.task-status').filter({ hasText: '生成失败' })).toHaveCount(0)
    if (action !== 'failed records') await expect(page.locator('.creation-request').filter({ hasText: prompt })).toHaveCount(0)
    const stored = await page.evaluate(async () => (await (await import('/src/studio-task-store.ts')).readTaskSnapshot('17')) || [])
    expect(stored.some(task => task.id === state.requests[0].requestId)).toBe(action !== 'failed records')
    expect(stored.some(task => task.id === 'already-completed')).toBe(true)
    await leaveWorkbench(page)
    await page.reload()
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

test('deleting an in-flight conversation does not restore it or its failed reminder when the request settles', async ({ page }) => {
  const state = await fixture(page), prompt = '删除对话后上游才结束'
  state.controls.reject = true
  try {
    await startImage(page, prompt)
    const sidebar = page.locator('.studio-sidebar')
    await sidebar.getByRole('button', { name: '多选对话', exact: true }).click()
    await sidebar.getByRole('checkbox', { name: '选择对话：当前图片对话', exact: true }).check()
    await sidebar.getByRole('button', { name: '删除所选', exact: true }).click()
    await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
    await leaveWorkbench(page)
    await expect(dock(page)).toHaveCount(0)
    state.finish()
    await expect.poll(() => page.evaluate(async prompt => (await import('/src/native-studio.ts')).creation.tasks.find(task => task.prompt === prompt)?.phase, prompt)).toBe('error')
    await expect(dock(page)).toHaveCount(0)
    await page.goto('/create/image')
    await expect(page.locator('.creation-request').filter({ hasText: prompt })).toHaveCount(0)
    await page.reload()
    await expect(sidebar.getByRole('button', { name: '当前图片对话', exact: true })).toHaveCount(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

for (const width of [390, 1440]) test(`viewing a failed task acknowledges its reminder without a query at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page, '/work/backgroundsource')
  state.controls.reject = true
  try {
    await page.getByRole('button', { name: '制作同款', exact: true }).click()
    await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
    await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect.poll(state.submissions).toBe(1)
    state.finish()
    await expect(dock(page)).toContainText('生成失败')
    await expect(dock(page).getByRole('alert')).toBeVisible()
    await expect(dock(page).getByRole('button', { name: '查询结果', exact: true })).toHaveCount(0)
    await dock(page).getByRole('button', { name: '查看任务', exact: true }).click()
    await expect(page).toHaveURL(/\/create\/image/)
    await expect(page.locator('.task-status')).toContainText('生成失败')
    await leaveWorkbench(page)
    await expect(dock(page)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`acknowledged-task-${width}.png`) })
    expect(state.controls.recoveries).toBe(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

test('a stopped task viewed in the workbench stays in history without a persistent community reminder', async ({ page }) => {
  const state = await fixture(page)
  let queries = 0
  await page.route('**/api/creation/generate', route => route.fulfill({ json: { status: 'pending', upstreamId: 'paused-image', tokenId: 41, protocol: 'async', outputs: [] } }))
  await page.route('**/api/creation/requests/**', route => { queries++; return route.fulfill({ json: { status: 'pending', outputs: [] } }) })
  try {
    await startImage(page, '保留停止等待的任务')
    await expect.poll(() => queries).toBeGreaterThan(0)
    await page.getByRole('button', { name: '停止等待', exact: true }).click()
    await expect(page.locator('.task-status')).toContainText('已停止等待')
    await leaveWorkbench(page)
    await expect(dock(page)).toHaveCount(0)
  } finally { state.finish() }
})

test('an image completed after leaving the workbench appears once and viewing acknowledges it', async ({ page }) => {
  const state = await fixture(page), prompt = '离开后完成的图片'
  try {
    await startImage(page, prompt)
    await leaveWorkbench(page)
    await expect(dock(page)).toContainText('正在提交')
    state.finish()
    await completeImage(page, prompt)
    await expect(dock(page)).toContainText('生成完成')
    await expect(dock(page)).toContainText(prompt)
    await expect(dock(page)).not.toContainText('以前已经看过的图片')
    await page.screenshot({ path: '.taste-skill/background-notifications-20261116/background-completed-desktop.png' })
    await dock(page).getByRole('button', { name: '查看结果', exact: true }).click()
    await expect(page).toHaveURL(/\/create\/image/)
    await expect(page.locator('.creation-request').filter({ hasText: prompt })).toHaveCount(1)
    await expect(dock(page)).toHaveCount(0)
    await leaveWorkbench(page)
    await expect(dock(page)).toHaveCount(0)
    await page.screenshot({ path: '.taste-skill/background-notifications-20261116/background-acknowledged-desktop.png' })
    await page.reload()
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

for (const revisit of [false, true]) {
  test(`an image completed inside the workbench stays quiet on exit${revisit ? ' after returning before completion' : ''}`, async ({ page }) => {
    const state = await fixture(page), prompt = revisit ? '回到工作台后完成' : '工作台内已完成'
    try {
      await startImage(page, prompt)
      if (revisit) {
        await leaveWorkbench(page)
        await expect(dock(page)).toContainText('正在提交')
        await page.locator('.desktop-nav').getByRole('link', { name: '创作台', exact: true }).click()
        await expect(page).toHaveURL(/\/create(?:\/image)?$/)
        await expect(page.getByRole('button', { name: '停止等待', exact: true })).toBeVisible()
      }
      state.finish()
      await completeImage(page, prompt)
      await expect(page.locator('.creation-request').filter({ hasText: prompt })).toHaveCount(1)
      await leaveWorkbench(page)
      await expect(dock(page)).toHaveCount(0)
      expect(state.submissions()).toBe(1)
    } finally { state.finish() }
  })
}

for (const kind of ['image', 'video'] as const) for (const [width, scheme] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
  test(`background ${kind} remix submits once, drags and hides at ${width}px ${scheme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), scheme)
    const state = await fixture(page, '/work/backgroundsource', kind)
    const navigated: string[] = []
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigated.push(new URL(frame.url()).pathname) })
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    try {
      await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
      const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
      await dialog.getByRole('checkbox', { name: '作者参考图.jpg', exact: true }).check()
      await expect(dialog.getByRole('button', { name: '后台生成同款', exact: true })).toBeEnabled()
      await dialog.screenshot({ path: info.outputPath(`confirm-${kind}-${width}.png`) })
      await dialog.getByRole('button', { name: '后台生成同款', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await expect(page).toHaveURL(/\/work\/backgroundsource$/)
      await expect(dock(page)).toContainText('正在提交')
      await expect.poll(state.submissions).toBe(1)
      expect(state.requests[0]).toMatchObject({ kind, model: state.source.model, sourceWorkId: state.source.id, prompt: state.source.prompt, n: kind === 'image' ? 2 : 1 })
      expect(state.requests[0].referenceUrls).toHaveLength(1)
      const before = (await dock(page).boundingBox())!
      const grip = dock(page).getByRole('button', { name: '拖动生成小窗' }), box = (await grip.boundingBox())!
      if (width === 1440) {
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down()
        await page.mouse.move(box.x - 120, box.y - 120, { steps: 5 }); await page.mouse.up()
      } else {
        const cdp = await context.newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 20 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 20, y: box.y - 120 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await cdp.detach()
      }
      await expect.poll(async () => (await dock(page).boundingBox())!.y).toBeLessThan(before.y - 50)
      await grip.focus(); await page.keyboard.press('ArrowUp')
      await dock(page).getByRole('button', { name: '收起生成任务' }).click()
      await expect(dock(page)).toHaveClass(/minimized/)
      state.finish()
      await expect(dock(page)).toContainText('生成完成')
      await expect(dock(page)).toHaveClass(/minimized/)
      await dock(page).getByRole('button', { name: '展开生成任务' }).click()
      await expect(dock(page)).not.toHaveClass(/minimized/)
      await page.setViewportSize({ width, height: width === 1440 ? 720 : 568 })
      await expect.poll(async () => { const bounds = (await dock(page).boundingBox())!; return bounds.y + bounds.height }).toBeLessThanOrEqual(width === 1440 ? 720 : 488)
      const after = (await dock(page).boundingBox())!
      expect(after.x).toBeGreaterThanOrEqual(0); expect(after.x + after.width).toBeLessThanOrEqual(width)
      expect(after.y).toBeGreaterThanOrEqual(0); expect(after.y + after.height).toBeLessThanOrEqual(width === 1440 ? 720 : 488)
      await page.screenshot({ path: info.outputPath(`dock-${kind}-${width}.png`) })
      expect((await new AxeBuilder({ page }).include('.background-dock').analyze()).violations).toEqual([])
      expect(navigated.some(path => path.startsWith('/create/'))).toBe(false)
      await dock(page).getByRole('button', { name: '查看结果', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/create/${kind}`))
      await expect(page.locator('.creation-request').filter({ hasText: state.source.prompt })).toHaveCount(1)
      expect(state.submissions()).toBe(1)
      expect(errors).toEqual([])
    } finally { state.finish() }
  })
}

for (const kind of ['image', 'video'] as const) test(`background ${kind} refuses missing model`, async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource', kind)
  state.controls.unavailable = true
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  const dialog = page.getByRole('dialog', { name: '制作同款', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('不可用')
  await expect(dialog.getByRole('button', { name: '后台生成同款' })).toBeDisabled()
  expect(state.submissions()).toBe(0)
  state.finish()
})

test('background remix waits for a model refresh before allowing submission', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  let release!: () => void
  try {
    await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
    const submit = page.getByRole('button', { name: '后台生成同款', exact: true })
    await expect(submit).toBeEnabled()
    state.controls.modelsWait = new Promise<void>(resolve => { release = resolve })
    await page.evaluate(async () => {
      const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
      const studio = await import(/* @vite-ignore */ path)
      studio.invalidateCreationModels()
      void studio.loadCreationModels()
    })
    await expect(submit).toBeDisabled()
    expect(state.submissions()).toBe(0)
    release()
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page).toHaveURL(/\/work\/backgroundsource$/)
    await expect.poll(state.submissions).toBe(1)
  } finally { release?.(); state.finish() }
})

test('background remix preserves invalid video duration for editing and sends no generation', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource', 'video')
  state.source.generation.parameters.duration = 999
  await page.route('**/api/creation/models', route => route.fulfill({ json: {
    tokenId: 41, items: [{ id: 'sora-2', kinds: ['video'], video: { durations: [4, 8, 12] } }],
  } }))
  await page.reload()
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect(page).toHaveURL(/\/work\/backgroundsource$/)
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('原作时长或分辨率不受当前模型支持')
  await expect(page.getByRole('button', { name: '后台生成同款', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '进入工作台调整', exact: true })).toBeVisible()
  expect(state.submissions()).toBe(0)
  state.finish()
})

for (const disconnect of [false, true]) test(`background ${disconnect ? 'connection error' : 'rejection'} is visible without a manual query or resubmission`, async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  state.controls.reject = !disconnect; state.controls.disconnect = disconnect
  state.controls.recoveryMissing = true
  try {
    await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
    await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect(page).toHaveURL(/\/work\/backgroundsource$/)
    await expect.poll(state.submissions).toBe(1)
    state.finish()
    await expect(dock(page)).toContainText(disconnect ? '结果待确认' : '生成失败')
    await expect(dock(page).getByRole('alert')).toBeVisible()
    await expect(dock(page).getByRole('button', { name: '查询结果', exact: true })).toHaveCount(0)
    await expect(dock(page).locator('details')).toHaveCount(0)
    if (disconnect) await expect.poll(() => state.controls.recoveries).toBeGreaterThanOrEqual(1)
    else expect(state.controls.recoveries).toBe(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

test('switching accounts clears background task details', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  try {
    await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
    await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect(dock(page)).toBeVisible()
    state.account.state.user.id = '18'; state.account.state.user.accountId = '18'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dock(page)).toHaveCount(0)
    state.finish()
    await expect(dock(page)).toHaveCount(0)
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

for (const outcome of ['succeeded', 'failed'] as const) test(`the browser reads the unified ${outcome} result without a second gateway route`, async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource', 'video')
  let localQueries = 0, gatewayQueries = 0
  await page.route('**/api/creation/generate', route => {
    const body = route.request().postDataJSON()
    state.requests.push(body)
    return route.fulfill({ json: { status: 'pending', requestId: body.requestId, upstreamId: 'gateway-original', tokenId: 41, protocol: 'openai', outputs: [] } })
  })
  await page.route('**/api/creation/requests/**', route => {
    localQueries++
    const query = new URL(route.request().url()).searchParams
    expect(query.get('upstreamId')).toBe('gateway-original')
    expect(query.get('tokenId')).toBe('41')
    return route.fulfill({ json: { status: outcome, outputs: outcome === 'succeeded' ? [{ url: 'https://media.example/gateway.mp4' }] : [],
      ...(outcome === 'failed' ? { error: '网关原始失败原因' } : {}) } })
  })
  await page.route('**/api/creation/tasks/**', route => { gatewayQueries++; return route.abort() })
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect(dock(page)).toContainText(outcome === 'succeeded' ? '生成完成' : '生成失败')
  if (outcome === 'failed') await expect(dock(page)).toContainText('网关原始失败原因')
  expect({ localQueries, gatewayQueries, submissions: state.requests.length }).toEqual({ localQueries: 1, gatewayQueries: 0, submissions: 1 })
})

for (const width of [390, 1440]) for (const outcome of ['succeeded', 'failed'] as const) test(`a missing video reminder closes and recovers the upstream ${outcome} result at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page, '/work/backgroundsource', 'video')
  let queries = 0, finished = false
  await page.route('**/api/creation/generate', async route => {
    state.requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { status: 'pending', upstreamId: 'missing-video', tokenId: 41, protocol: 'openai', outputs: [] } })
  })
  await page.route('**/api/creation/requests/**', route => {
    queries++
    if (finished) return route.fulfill({ json: { status: outcome, outputs: outcome === 'succeeded' ? [{ url: 'https://media.example/recovered.mp4' }] : [],
      ...(outcome === 'failed' ? { error: '上游审核未通过：参考图不符合要求。' } : {}) } })
    return route.fulfill({ status: 404, json: { message: '没有找到此请求记录。' } })
  })
  await page.clock.install()
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: /^后台生成(?:$|\s)/ }).click()
  await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect(dock(page)).toContainText('结果待确认')
  await expect(dock(page)).not.toContainText('生成失败')
  await expect(dock(page)).toContainText('1 项待查看')
  await expect(dock(page)).not.toContainText('1/1')
  await expect(dock(page).getByRole('button', { name: '关闭此提醒' })).toBeVisible()
  await page.screenshot({ path: info.outputPath(`missing-task-${width}.png`) })
  expect((await new AxeBuilder({ page }).include('.background-dock').analyze()).violations).toEqual([])
  if (width === 390) {
    await dock(page).getByRole('button', { name: '收起生成任务' }).click()
    await expect(dock(page)).toHaveClass(/minimized/)
  }
  await page.clock.fastForward(8000)
  await expect(dock(page)).toHaveCount(0)
  expect(queries).toBe(1)
  expect(state.requests).toHaveLength(1)
  finished = true
  await page.reload()
  await expect(page.locator('.app-header')).toBeVisible()
  if (outcome === 'succeeded') {
    await expect(dock(page)).toContainText('生成完成')
    await dock(page).getByRole('button', { name: '查看结果', exact: true }).click()
  } else {
    await expect(dock(page)).toHaveCount(0)
    await page.goto(`/create/video?reuse=${state.requests[0].requestId}`)
  }
  expect(queries).toBe(2)
  await expect(page.locator('.task-status')).toContainText(outcome === 'succeeded' ? '生成完成' : '生成失败')
  if (outcome === 'failed') await expect(page.locator('.task-message')).toContainText('上游审核未通过：参考图不符合要求。')
  expect(state.requests).toHaveLength(1)
})

test('closing a failed reminder leaves the running task and keeps the selected task stable', async ({ page }) => {
  const state = await fixture(page, '/discover')
  const path = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!)
  await page.clock.install()
  const update = async (action: 'seed' | 'fail' | 'insert') => page.evaluate(async ({ action, path }) => {
    const { creation } = await import(/* @vite-ignore */ path)
    const source = creation.tasks.find(task => task.id === 'already-completed')!
    if (action === 'seed') creation.tasks.unshift(...['first', 'second'].map(id => ({ ...source, id, phase: 'running', prompt: id })))
    if (action === 'fail') creation.tasks.find(task => task.id === 'second')!.phase = 'error'
    if (action === 'insert') creation.tasks.unshift({ ...source, id: 'newest', phase: 'running', prompt: 'newest' })
  }, { action, path })
  await update('seed')
  await expect(dock(page)).toContainText('2 项进行中')
  await expect(dock(page).getByRole('button', { name: '关闭此提醒' })).toHaveCount(0)
  await dock(page).getByRole('button', { name: '下一个任务' }).click()
  await expect(dock(page).locator('.dock-content p')).toHaveText('second')
  await update('insert')
  await update('fail')
  await expect(dock(page).locator('.dock-content p')).toHaveText('second')
  await dock(page).getByRole('button', { name: '关闭此提醒' }).click()
  await expect(dock(page)).toContainText('2 项进行中')
  await page.clock.fastForward(16000)
  await expect(dock(page)).toBeVisible()
  expect(state.submissions()).toBe(0)
})
