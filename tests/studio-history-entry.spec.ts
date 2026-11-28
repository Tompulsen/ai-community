import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const entry of ['/account?tab=storage', '/discover']) {
  test(`signed-in users read their saved studio history on entering the studio from ${entry}`, async ({ page }) => {
    const { state, reads: apiReads, mutations } = await mockUnifiedAccount(page, true)
    await page.route('**/studio-history-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
    await page.goto('/studio-history-fixture')
    await page.evaluate(async owner => {
      localStorage.setItem(`octopus:user-${owner}:native-chat`, JSON.stringify({ version: 1, state: {
        _hasHydrated: true, activeId: 'retained-chat', sessions: [{
          id: 'retained-chat', topic: 'Archived conversation', settings: {}, messages: [
            { id: 'retained-message', role: 'user', content: 'Archived message from before login', createdAt: Date.now() },
          ],
        }],
      } }))
      const path = '/src/studio-task-store.ts'
      const { saveTaskSnapshot } = await import(/* @vite-ignore */ path)
      await saveTaskSnapshot(owner, [{
        id: 'retained-task', owner, kind: 'text', prompt: 'Archived task', model: 'example', createdAt: Date.now(),
        phase: 'complete', protocol: 'sync', urls: [], text: 'Archived answer', references: [], request: {},
      }, {
        id: 'unfinished-task', owner, kind: 'video', prompt: 'Unfinished video', model: 'example-video', createdAt: Date.now(),
        phase: 'running', upstreamId: 'upstream-video', tokenId: 41, protocol: 'async', urls: [], text: '', references: [], request: {},
      }])
    }, state.user.id)

    await page.addInitScript(() => {
      const reads = { chat: 0, completed: 0, unfinished: 0 }
      Object.assign(window, { savedHistoryReads: reads })
      const getItem = Storage.prototype.getItem
      Storage.prototype.getItem = function (key) {
        if (key.endsWith(':native-chat')) reads.chat++
        return getItem.call(this, key)
      }
      const value = Object.getOwnPropertyDescriptor(IDBCursorWithValue.prototype, 'value')!
      Object.defineProperty(IDBCursorWithValue.prototype, 'value', {
        ...value, get() {
          const row = value.get!.call(this)
          if (row?.value?.id === 'retained-task') reads.completed++
          if (row?.value?.id === 'unfinished-task') reads.unfinished++
          return row
        },
      })
    })
    await page.clock.install()
    await page.goto(entry)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.clock.fastForward(4000)
    await page.waitForLoadState('networkidle')
    const readCounts = () => page.evaluate(() => (window as Window & { savedHistoryReads: { chat: number; completed: number; unfinished: number } }).savedHistoryReads)
    expect(await readCounts()).toEqual({ chat: 0, completed: 0, unfinished: 0 })
    const taskRequests = () => [
      ...apiReads.filter(path => /^\/api\/creation\/(requests|tasks)\//.test(path)),
      ...mutations.map(({ path }) => path).filter(path => path === '/api/creation/generate' || path.startsWith('/api/creation/requests/')),
    ]
    expect(taskRequests()).toEqual([])

    if (entry === '/discover') {
      await page.getByRole('button', { name: '文本对话', exact: true }).click()
      await expect(page.getByPlaceholder('发消息，描述你的想法…')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await readCounts()).toEqual({ chat: 0, completed: 0, unfinished: 0 })
      expect(taskRequests()).toEqual([])
    }

    await page.goto('/create/text')
    await expect(page.getByText('Archived message from before login', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const restored = await readCounts()
    expect(restored.chat).toBeGreaterThan(0)
    expect(restored.completed).toBeGreaterThan(0)
    expect(restored.unfinished).toBeGreaterThan(0)
    expect(taskRequests()).toEqual([])
  })
}
