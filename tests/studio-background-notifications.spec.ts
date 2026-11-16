import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const dock = (page: Page) => page.getByRole('complementary', { name: '后台生成任务', exact: true })

async function fixture(page: Page, initialPath = '/create/image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  let finish!: () => void, submissions = 0
  const waiting = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (path === '/api/creation/generate') {
      submissions++
      await waiting
      return route.fulfill({ json: { status: 'succeeded', tokenId: 41, protocol: 'sync', outputs: [{ url: 'https://media.example/background-result.jpg' }] } })
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
  return { finish, submissions: () => submissions }
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
    await expect(dock(page)).toHaveCount(0)
    state.finish()
    await completeImage(page, prompt)
    await expect(dock(page)).toContainText('生成完成')
    await expect(dock(page)).toContainText(prompt)
    await expect(dock(page)).not.toContainText('以前已经看过的图片')
    await page.screenshot({ path: '.taste-skill/background-notifications-20261116/background-completed-desktop.png' })
    await dock(page).getByRole('button', { name: '查看任务', exact: true }).click()
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
        await expect(dock(page)).toHaveCount(0)
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
