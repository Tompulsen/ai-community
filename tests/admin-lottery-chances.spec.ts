import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const people = [
  { id: '18', accountId: '18', name: '木白', username: 'mubai', host: null },
  { id: '19', accountId: '29', name: '很长的用户名称用于验证手机窄屏完整布局', username: 'longaccountwithoutspaces', host: null },
]
async function fixture(page: Page) {
  const auth = await mockUnifiedAccount(page, true); auth.state.user.isAdmin = true
  const balances: Record<string, number> = { '18': 5, '19': 0 }
  const writes: any[] = [], reads: URL[] = [], receipts = new Set<string>()
  const controls = { failList: false, failAccount: false, loseResponse: false, conflict: false }
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'GET') reads.push(url)
    if (path === '/api/admin/users') {
      if (controls.failList) return route.fulfill({ status: 503, json: { message: '用户列表暂不可用' } })
      const query = url.searchParams.get('query') || ''
      return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [{ ...people[0], id: '20', name: '下一页用户' }] : query === 'missing' ? [] : people, nextCursor: url.searchParams.has('cursor') ? null : 'next-page' } })
    }
    if (path.startsWith('/api/admin/users/')) return route.fulfill({ json: { user: people.find(person => path.endsWith('/' + person.id)) } })
    if (path.endsWith('/lottery/account')) {
      if (controls.failAccount) return route.fulfill({ status: 503, json: { message: '次数暂不可用' } })
      const id = url.searchParams.get('userId')!; return route.fulfill({ json: { userId: id, balance: balances[id] ?? 0 } })
    }
    if (path.endsWith('/lottery/chances')) {
      const body = request.postDataJSON(); writes.push(body)
      if (controls.conflict) { controls.conflict = false; balances[body.userId] = 8; return route.fulfill({ status: 409, json: { message: 'LOTTERY_CONFLICT' } }) }
      if (!receipts.has(body.requestId)) { balances[body.userId] = body.mode === 'add' ? balances[body.userId]! + body.amount : body.amount; receipts.add(body.requestId) }
      if (controls.loseResponse) { controls.loseResponse = false; return route.abort('failed') }
      return route.fulfill({ json: { userId: body.userId, balance: balances[body.userId] } })
    }
    if (path.endsWith('/lottery/config')) return route.fulfill({ json: { version: 1, settings: { enabled: false, likes: { enabled: false, threshold: 100, tickets: 1 }, followers: { enabled: false, threshold: 100, tickets: 1 }, invites: { enabled: false, threshold: 1, tickets: 1 }, likesMode: 'work', prizes: [], wheel: { title: '', subtitle: '', buttonText: 'GO', rulesText: '', theme: 'teal' } } } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { auth, balances, writes, reads, receipts, controls }
}
async function open(page: Page) { await page.goto('/admin?tab=lottery-chances'); await expect(page.getByRole('heading', { name: '用户抽奖次数', exact: true })).toBeVisible() }
async function choose(page: Page, name = '木白') { await page.getByRole('button', { name: new RegExp(name) }).click(); await expect(page.getByLabel('调整方式')).toBeVisible() }

test('dedicated navigation, applied search pagination, empty and zero balances', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/admin?tab=lottery')
  await expect(page.getByRole('heading', { name: '用户抽奖次数', exact: true })).toHaveCount(0)
  await page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '抽奖次数', exact: true }).click()
  await expect(page).toHaveURL(/tab=lottery-chances/)
  await expect(page.locator('.chance-user')).toHaveCount(2)
  await page.getByLabel('名称、用户名或账号 ID').fill('18'); await page.getByRole('button', { name: '查找', exact: true }).click()
  await expect.poll(() => f.reads.filter(url => url.pathname === '/api/admin/users').at(-1)?.searchParams.get('query')).toBe('18')
  await page.getByLabel('名称、用户名或账号 ID').fill('unsubmitted')
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.chance-user')).toHaveCount(3)
  const params = f.reads.filter(url => url.pathname === '/api/admin/users').at(-1)!.searchParams
  expect(Object.fromEntries(params)).toMatchObject({ query: '18', cursor: 'next-page', origin: 'local', status: 'active' })
  await choose(page, people[1]!.name); await expect(page.locator('.chance-balance dd')).toHaveText('0次')
  expect(f.writes).toEqual([])
  await page.getByLabel('名称、用户名或账号 ID').fill('missing'); await page.getByRole('button', { name: '查找', exact: true }).click()
  await expect(page.getByRole('heading', { name: '未找到用户', exact: true })).toBeVisible()
})

test('add and clear have explicit previews, cancel and single target confirmation', async ({ page }) => {
  const f = await fixture(page); await open(page); await choose(page)
  await page.getByRole('spinbutton', { name: '增加次数', exact: true }).fill('3')
  await page.getByLabel('操作原因').fill('活动补发')
  await expect(page.locator('.chance-preview')).toContainText('8 次')
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('5 次'); await expect(page.getByRole('dialog')).toContainText('8 次')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); expect(f.writes).toHaveLength(0)
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click(); await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await expect(page.locator('.chance-balance dd')).toHaveText('8次'); expect(f.writes).toHaveLength(1)
  expect(f.writes[0]).toMatchObject({ userId: '18', mode: 'add', amount: 3, expectedBalance: 5, reason: '活动补发' })
  await page.getByLabel('调整方式').selectOption('set'); await page.getByLabel('目标次数').fill('0')
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('减少用户的可用次数')
  await page.getByRole('button', { name: '确认提交', exact: true }).click(); await expect(page.locator('.chance-balance dd')).toHaveText('0次')
})

test('lost response survives reload and retries only the original receipt', async ({ page }) => {
  const f = await fixture(page); f.controls.loseResponse = true
  await open(page); await choose(page)
  await page.getByRole('spinbutton', { name: '增加次数', exact: true }).fill('4')
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click(); await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对上次调整', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(people[1]!.name) })).toBeDisabled()
  await page.reload(); await expect(page.locator('.chance-balance dd')).toHaveText('待核对')
  await page.getByRole('button', { name: '核对上次调整', exact: true }).click()
  await expect(page.locator('.chance-balance dd')).toHaveText('9次')
  expect(f.writes).toHaveLength(2); expect(f.writes[0]).toEqual(f.writes[1]); expect(f.receipts.size).toBe(1)
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.includes('admin-adjustment:')))).toEqual([])
})

test('balance conflict reloads and keeps draft for a newly confirmed request', async ({ page }) => {
  const f = await fixture(page); f.controls.conflict = true
  await open(page); await choose(page)
  await page.getByRole('spinbutton', { name: '增加次数', exact: true }).fill('2')
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click(); await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('次数已变化')
  await expect(page.locator('.chance-balance dd')).toHaveText('8次'); await expect(page.locator('.chance-preview')).toContainText('10 次')
  await page.getByRole('button', { name: '确认调整次数', exact: true }).click(); await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await expect(page.locator('.chance-balance dd')).toHaveText('10次')
  expect(f.writes[1].expectedBalance).toBe(8); expect(f.writes[1].requestId).not.toBe(f.writes[0].requestId)
})

test('draft navigation, validation and failed reads remain recoverable', async ({ page }) => {
  const f = await fixture(page); f.controls.failList = true
  await open(page); await expect(page.getByRole('alert')).toContainText('用户列表暂不可用')
  f.controls.failList = false; await page.getByRole('button', { name: '重试', exact: true }).click(); f.controls.failAccount = true
  await page.getByRole('button', { name: /木白 @mubai/ }).click(); await expect(page.getByRole('alert')).toContainText('次数暂不可用')
  f.controls.failAccount = false; await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.getByRole('spinbutton', { name: '增加次数', exact: true }).fill('2147483647')
  await expect(page.getByRole('button', { name: '确认调整次数', exact: true })).toBeDisabled()
  await page.getByRole('spinbutton', { name: '增加次数', exact: true }).fill('2')
  await page.getByRole('button', { name: new RegExp(people[1]!.name) }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(page.locator('.chance-identity')).toContainText('木白')
  await page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '活动抽奖', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click(); await expect(page).toHaveURL(/tab=lottery$/)
  expect(f.writes).toEqual([])
})

test('late reads and permission changes cannot expose another selected account', async ({ page }) => {
  const f = await fixture(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/lottery/account?userId=18', async route => { await held; await route.fulfill({ json: { userId: '18', balance: 999 } }).catch(() => {}) })
  await open(page); await page.getByRole('button', { name: /木白 @mubai/ }).click()
  await choose(page, people[1]!.name); release(); await expect(page.locator('.chance-balance dd')).toHaveText('0次')
  f.auth.state.user.isAdmin = false; f.auth.state.user.isModerator = true
  await page.evaluate(async () => { const { loadSession } = await import('/src/state.ts'); await loadSession(true) })
  await expect(page.locator('.lottery-chances-page')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '抽奖次数', exact: true })).toHaveCount(0)
  expect(f.writes).toEqual([])
})

for (const theme of ['light', 'dark'] as const) test(`chances list, detail and confirmation fit phones and desktop in ${theme}`, async ({ page }) => {
  await fixture(page)
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'cloud', dark: 'sage' })), theme)
  await mkdir('.impeccable/review/lottery-chances', { recursive: true })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await open(page)
    await expect(page.locator('.chance-user')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await choose(page)
    await page.screenshot({ path: `.impeccable/review/lottery-chances/${theme}-${width}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.lottery-chances-page').analyze()).violations).toEqual([])
    await page.getByRole('button', { name: '确认调整次数', exact: true }).click()
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([])
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    if (width < 1001) { await page.getByRole('button', { name: '更换用户', exact: true }).click(); await expect(page.getByLabel('名称、用户名或账号 ID')).toBeFocused() }
  }
  expect(errors).toEqual([])
})
