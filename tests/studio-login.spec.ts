import { expect, test } from '@playwright/test'

const user = { id: 'studioUser', username: 'creator', name: '测试创作者' }

async function fixture(page: import('@playwright/test').Page, signedIn: boolean, failure?: string) {
  const calls: string[] = []
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    if (path === '/api/session') return route.fulfill({ json: { user: signedIn ? user : null, csrfToken: 'studio-fixture' } })
    if (path === '/api/newapi/studio/start') return route.fulfill({ json: { code: 'a'.repeat(43), userId: user.id, subject: '17', origin: new URL(route.request().url()).origin } })
    if (path === '/api/newapi/studio/context') return route.fulfill({ json: { valid: true } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  await page.route('**/studio/community-embed?**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Isolated Studio fixture</title><script>
      const query = new URLSearchParams(location.search);
      const base = { type: 'community-studio', context: query.get('context'), attempt: query.get('attempt') };
      addEventListener('message', event => {
        if (event.source !== parent || event.origin !== location.origin || event.data.type !== 'community-launch') return;
        parent.postMessage({ ...base, status: ${JSON.stringify(failure ? 'error' : 'ready')}, code: ${JSON.stringify(failure || '')}, subject: '17', userId: 'studioUser' }, location.origin);
      });
      parent.postMessage({ ...base, status: 'hello' }, location.origin);
    </script>`,
  }))
  return calls
}

test('guest creation preserves the original page through login', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/create/video?remix=sourceWork')
  const link = page.getByRole('link', { name: '登录', exact: true }).filter({ visible: true }).last()
  await expect(link).toBeVisible()
  const target = new URL((await link.getAttribute('href'))!, page.url())
  expect(target.pathname).toBe('/account')
  expect(target.searchParams.get('returnTo')).toBe('/create/video?remix=sourceWork')
})

test('expired Studio login returns to the matching creation page without another authorization', async ({ page }) => {
  const calls = await fixture(page, true, 'NEW_API_LOGIN_REQUIRED')
  await page.goto('/create/image')
  await expect(page.getByRole('heading', { name: '请登录章鱼账号', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '登录后继续创作', exact: true })).toHaveAttribute('href', '/account?returnTo=/create/image')
  await expect(page.getByRole('button', { name: '确认授权', exact: true })).toHaveCount(0)
  expect(calls.some(path => path === '/api/account/connect' || path.includes('/embedded/authorize'))).toBe(false)
})

test('the existing login opens Studio with one launch and no authorization window', async ({ page }) => {
  const calls = await fixture(page, true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  await expect(page.locator('.studio-stage')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('iframe[title="创作工作台"]')).toBeVisible()
  expect(calls.filter(path => path === '/api/newapi/studio/start')).toHaveLength(1)
  expect(calls.some(path => path === '/api/account/connect' || path.includes('/embedded/authorize'))).toBe(false)
  expect(errors).toEqual([])
})

test('returning to a page after logout removes the previous Studio and task identity', async ({ page }) => {
  await fixture(page, true)
  await page.goto('/create/image')
  await expect(page.locator('.studio-stage')).toHaveAttribute('data-state', 'ready')
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, csrfToken: 'studio-fixture' } }))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '登录后开始创作', exact: true })).toBeVisible()
  await expect(page.locator('.studio-host, .background-dock')).toHaveCount(0)
})
