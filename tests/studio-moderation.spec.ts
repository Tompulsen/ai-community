import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { mockPublicationTags, completePublicationFields } from './helpers/publication-fixture'

async function fixture(page: Page, initial: 'passed' | 'rejected' | 'unavailable' = 'passed', seed = true) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await mockPublicationTags(page)
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const state = { result: initial, checks: 0, uploads: 0, works: 0, hold: undefined as Promise<void> | undefined }
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'fixture-image', kinds: ['image'] }] } })
    if (path.endsWith('/media')) return route.fulfill({ body: image, contentType: 'image/jpeg' })
    if (path.endsWith('/generate')) return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/result.jpg' }] } })
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/works/precheck', async route => {
    state.checks++
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    expect(route.request().headers()['x-new-api-user']).toBe('17')
    await state.hold
    await route.fulfill({ json: { state: state.result, checkedAt: Date.now(),
      ...(state.result === 'rejected' ? { reason: '检测到疑似违规内容，请修改后重试。' } : state.result === 'unavailable' ? { reason: '审核服务暂不可用，请重试。' } : {}) } })
  })
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => { state.uploads++; return route.fulfill({ json: { file: { id: 'upload1', name: 'image.jpg', type: 'image/jpeg', url: '/files/upload1', size: image.length } } }) })
  await page.route('**/api/works', route => {
    if (route.request().method() === 'POST') { state.works++; return route.fulfill({ json: { work: { id: 'published1', status: 'approved', title: '测试作品' } } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.addInitScript(seed => {
    if (sessionStorage.getItem('moderation-seeded')) return
    sessionStorage.setItem('moderation-seeded', '1')
    const task = { id: 'moderation-result', conversationId: 'moderation-chat', owner: '17', kind: 'image', phase: 'complete', model: 'fixture-image', protocol: 'sync', prompt: '海边的一只小猫', text: '', urls: ['https://media.example/result.jpg'], references: [], sourceWorkId: 'original-work', createdAt: Date.now(), request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } }
    if (seed) localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([task]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: { _hasHydrated: true, activeId: 'moderation-chat', mediaConversationsMigrated: true, sessions: [{ id: 'moderation-chat', mediaConversationId: 'moderation-chat', creationKind: 'image', topic: '初审测试', model: 'fixture-image', settings: {}, skillIds: [], messages: [] }] } }))
  }, seed)
  return state
}

for (const width of [390, 1440]) test(`opening publication starts the check and allows immediate publication at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page)
  await page.goto('/create/image')
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeEnabled()
  await expect(page.locator('.creation-moderation')).toHaveCount(0)
  expect(state.checks).toBe(0)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByText('初审通过，发布后立即公开', { exact: true })).toBeVisible()
  expect(state.checks).toBe(1); expect(state.uploads).toBe(0); expect(state.works).toBe(0)
  await completePublicationFields(page)
  const dialog = page.getByRole('dialog', { name: '发布作品', exact: true })
  await dialog.getByRole('button', { name: '立即公开作品', exact: true }).click()
  await expect(dialog.getByText('作品已公开。', { exact: true })).toBeVisible()
  expect(state.checks).toBe(1); expect(state.works).toBe(1)
})

test('generation, viewing history and reloading do not check content before a publication click', async ({ page }) => {
  const state = await fixture(page, 'rejected', false)
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('海边的一只小猫')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await expect(page.getByRole('button', { name: '下载图片', exact: true })).toBeEnabled()
  await expect(page.locator('.creation-moderation')).toHaveCount(0)
  expect(state.checks).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeEnabled()
  await expect(page.locator('.creation-moderation')).toHaveCount(0)
  expect(state.checks).toBe(0)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByText('初审未通过，暂不能发布', { exact: true })).toBeVisible()
  expect(state.checks).toBe(1); expect(state.uploads).toBe(0); expect(state.works).toBe(0)
})

test('rejected initial check preserves the generated image and disables public actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await fixture(page, 'rejected')
  await page.goto('/create/image')
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByText('初审未通过，暂不能发布', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即公开作品', exact: true })).toBeDisabled()
  await expect(page.locator('.publish-preview img')).toBeVisible()
  expect(state.uploads).toBe(0); expect(state.works).toBe(0)
  expect((await new AxeBuilder({ page }).include('.creation-moderation').analyze()).violations).toEqual([])
  await page.screenshot({ path: test.info().outputPath('rejected-mobile.png') })
  await page.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载图片', exact: true })).toBeEnabled()
  await expect(page.locator('.creation-moderation')).toHaveCount(0)
})

test('temporarily unavailable initial check can retry without regenerating or creating a work', async ({ page }) => {
  const state = await fixture(page, 'unavailable')
  await page.goto('/create/image')
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByText('检查暂未完成，暂不能发布', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即公开作品', exact: true })).toBeDisabled()
  state.result = 'passed'
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(page.getByRole('button', { name: '立即公开作品', exact: true })).toBeEnabled()
  expect(state.checks).toBe(2); expect(state.uploads).toBe(0); expect(state.works).toBe(0)
})

test('checking blocks submission and refresh does not restart a requested check', async ({ page }) => {
  const state = await fixture(page)
  let release!: () => void
  state.hold = new Promise<void>(resolve => { release = resolve })
  await page.goto('/create/image')
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByText('正在检查作品内容…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即公开作品', exact: true })).toBeDisabled()
  release(); await expect(page.getByText('初审通过，发布后立即公开', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeEnabled()
  await expect(page.locator('.creation-moderation')).toHaveCount(0)
  expect(state.checks).toBe(1)
  expect(state.works).toBe(0)
})

test('source comments only start checking when the user prepares to send', async ({ page }) => {
  const state = await fixture(page, 'rejected')
  await page.goto('/create/image')
  await expect(page.getByRole('button', { name: '发送到源作品评论区', exact: true })).toBeEnabled()
  expect(state.checks).toBe(0)
  await page.getByRole('button', { name: '发送到源作品评论区', exact: true }).click()
  await expect(page.getByText('初审未通过，暂不能发布', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发布评论', exact: true })).toBeDisabled()
  expect(state.checks).toBe(1); expect(state.uploads).toBe(0); expect(state.works).toBe(0)
})

test('text changes and account switches discard late initial checks', async ({ page }) => {
  await fixture(page)
  await page.goto('/create/image')
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeEnabled()
  const result = await page.evaluate(async () => {
    const studio = await import('/src/native-studio.ts'), { session } = await import('/src/state.ts')
    await studio.initializeCreation()
    const oldFetch = window.fetch, responses: ((value: Response) => void)[] = []
    window.fetch = ((...args: Parameters<typeof fetch>) => String(args[0]).includes('/api/works/precheck')
      ? new Promise<Response>(resolve => responses.push(resolve)) : oldFetch(...args)) as typeof fetch
    const task = { ...studio.creation.tasks[0], id: 'race-text', kind: 'text', text: 'first text', urls: [], moderation: undefined, moderationContent: undefined }
    const waitForResponse = async (count: number) => {
      const deadline = Date.now() + 3000
      while (responses.length < count) {
        if (Date.now() > deadline) throw new Error(`Expected ${count} checks, got ${responses.length}; owner=${task.owner}; active=${session.user?.id}; phase=${task.phase}`)
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
    const first = studio.moderateCreation(task)
    await waitForResponse(1)
    const second = studio.moderateCreation(task, false, 'edited text')
    await waitForResponse(2)
    responses[1](Response.json({ state: 'rejected', reason: 'edited content blocked' })); await second
    responses[0](Response.json({ state: 'passed' })); await first
    const edited = task.moderation?.state
    const third = studio.moderateCreation(task, true, 'third text')
    await waitForResponse(3)
    session.user = { ...session.user!, id: '18' }
    await new Promise(resolve => setTimeout(resolve, 0))
    responses[2](Response.json({ state: 'passed' })); await third
    window.fetch = oldFetch
    return { edited, oldTaskState: task.moderation?.state, count: studio.creation.tasks.length }
  })
  expect(result.edited).toBe('rejected'); expect(result.oldTaskState).not.toBe('passed'); expect(result.count).toBe(0)
})
