import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'

const dock = (page: Page) => page.getByRole('complementary', { name: '后台生成任务', exact: true })

async function fixture(page: Page, initialPath = '/create/image', kind: 'image' | 'video' = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  let finish!: () => void, submissions = 0
  const requests: any[] = [], controls = { unavailable: false, reject: false, disconnect: false, recoveries: 0, modelsWait: null as Promise<void> | null }
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
      return route.fulfill({ json: { status: 'succeeded', tokenId: 41, outputs: [{ url: 'https://media.example/recovered.jpg' }] } })
    }
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('background-notification-fixture')) return
    sessionStorage.setItem('background-notification-fixture', '1')
    const now = Date.now()
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'already-completed', owner: '17', kind: 'image', conversationId: 'old-session', model: 'gpt-image-2',
      prompt: '以前已经看过的图片', createdAt: now - 60000, settledAt: now - 50000, phase: 'complete',
      protocol: 'sync', urls: ['https://media.example/old.jpg'], text: '', references: [],
      request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
    }]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'current-session', sessions: [{
        id: 'current-session', topic: '当前图片对话', creationKind: 'image', composerKind: 'image',
        mediaConversationId: 'current-session', model: 'gpt-image-2', settings: {}, skillIds: [], search: 'off',
        messages: [], lastUpdate: now,
      }],
    } }))
  })
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
  await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
  await expect(page).toHaveURL(/\/discover$/)
}

async function completeImage(page: Page, prompt: string) {
  await expect.poll(() => page.evaluate(async prompt => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
    const studio = await import(/* @vite-ignore */ path)
    return studio.creation.tasks.find(task => task.prompt === prompt)?.phase
  }, prompt)).toBe('complete')
}

test('previously completed history stays quiet in the community and after reload', async ({ page }) => {
  const state = await fixture(page, '/discover')
  await expect(dock(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(dock(page)).toHaveCount(0)
  expect(state.submissions()).toBe(0)
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
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    try {
      await page.getByRole('link', { name: '制作同款', exact: true }).click()
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
  await page.getByRole('link', { name: '制作同款', exact: true }).click()
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
    await page.getByRole('link', { name: '制作同款', exact: true }).click()
    const submit = page.getByRole('button', { name: '后台生成同款', exact: true })
    await expect(submit).toBeEnabled()
    state.controls.modelsWait = new Promise<void>(resolve => { release = resolve })
    await page.evaluate(async () => {
      const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-studio\.ts(?:\?|$)/.test(name)).at(-1)!
      const studio = await import(/* @vite-ignore */ path)
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
  await page.getByRole('link', { name: '制作同款', exact: true }).click()
  await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
  await expect(page.getByRole('region', { name: '创作工作台', exact: true }).getByRole('alert')).toHaveText('原作时长或分辨率不受当前模型支持，请在高级参数中调整。')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled()
  expect(state.submissions()).toBe(0)
  state.finish()
})

for (const disconnect of [false, true]) test(`background failure is visible and ${disconnect ? 'uncertain request is recovered without POST' : 'rejection does not auto retry'}`, async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  state.controls.reject = !disconnect; state.controls.disconnect = disconnect
  try {
    await page.getByRole('link', { name: '制作同款', exact: true }).click()
    await page.getByRole('button', { name: '后台生成同款', exact: true }).click()
    await expect(page).toHaveURL(/\/work\/backgroundsource$/)
    await expect.poll(state.submissions).toBe(1)
    state.finish()
    await expect(dock(page)).toContainText(disconnect ? '结果待核对' : '生成失败')
    if (disconnect) {
      await dock(page).getByRole('button', { name: '核对任务', exact: true }).click()
      await expect(dock(page)).toContainText('生成完成')
      expect(state.controls.recoveries).toBe(1)
    }
    expect(state.submissions()).toBe(1)
  } finally { state.finish() }
})

test('switching accounts clears background task details', async ({ page }) => {
  const state = await fixture(page, '/work/backgroundsource')
  try {
    await page.getByRole('link', { name: '制作同款', exact: true }).click()
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
