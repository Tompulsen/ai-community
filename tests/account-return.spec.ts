import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { chromium, expect, test, type Browser } from '@playwright/test'

let server: Server, browser: Browser, origin: string
const dist = resolve('dist')

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url || '/', origin).pathname
      if (path === '/api/account/connect') {
        request.resume()
        await new Promise(resolve => setTimeout(resolve, 150))
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ url: `${origin}/__account-authorization` }))
        return
      }
      if (path.startsWith('/api/')) {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(path === '/api/session' ? { user: null, csrfToken: 'return-fixture' } : { items: [] }))
        return
      }
      if (path === '/__account-authorization') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end('<!doctype html><title>Account authorization fixture</title><h1>Account authorization fixture</h1>')
        return
      }
      const file = path.startsWith('/assets/') ? resolve(dist, `.${path}`) : resolve(dist, 'index.html')
      const displacement = relative(dist, file)
      if (displacement.startsWith('..') || isAbsolute(displacement)) {
        response.writeHead(404).end()
        return
      }
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8'
      response.setHeader('Content-Type', type)
      response.end(await readFile(file))
    } catch {
      response.writeHead(500).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Account fixture did not start')
  origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    // The normal Playwright launch disables the cache that caused this regression.
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  })
})

test.afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

for (const width of [1440, 390]) {
  test(`account authorization back restores the cached form at ${width}px`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    try {
      await context.addInitScript(() => {
        const state = { id: crypto.randomUUID(), restores: 0 }
        Object.assign(window, { accountReturnFixture: state })
        addEventListener('pageshow', event => { if (event.persisted) state.restores++ })
      })
      const page = await context.newPage()
      await page.goto(origin + '/account')
      const username = page.getByRole('textbox', { name: '用户名或邮箱' })
      const connect = page.getByRole('button', { name: '使用章鱼账号登录', exact: true })
      await expect(connect).toBeEnabled()
      await username.fill('return-check')
      const documentId = await page.evaluate(() => (window as unknown as { accountReturnFixture: { id: string } }).accountReturnFixture.id)
      await connect.click()
      await expect(connect).toBeDisabled()
      await expect(page).toHaveURL(origin + '/__account-authorization')
      await page.goBack({ waitUntil: 'commit' })
      const restored = await page.evaluate(() => (window as unknown as { accountReturnFixture: { id: string; restores: number } }).accountReturnFixture)
      expect(restored.id).toBe(documentId)
      expect(restored.restores).toBe(1)
      await expect(connect).toBeEnabled()
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
      await expect(username).toHaveValue('return-check')
      await expect(username).toBeEnabled()
      await page.screenshot({ path: test.info().outputPath('restored-account.png') })
      await connect.click()
      await expect(page).toHaveURL(origin + '/__account-authorization')
    } finally {
      await context.close()
    }
  })
}

test('skip navigation keeps keyboard focus without outlining the whole page', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(origin + '/account')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: '跳至内容', exact: true })
    await expect(skip).toBeFocused()
    expect(await skip.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
    await skip.press('Enter')
    const main = page.locator('main')
    await expect(main).toBeFocused()
    expect(await main.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    await page.keyboard.press('Tab')
    const brand = page.getByRole('link', { name: '章鱼社区首页', exact: true }).first()
    await expect(brand).toBeFocused()
    expect(await brand.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
    const username = page.getByRole('textbox', { name: '用户名或邮箱' })
    await username.focus()
    await expect(username).toBeFocused()
    await expect.poll(() => username.evaluate(element => {
      const style = getComputedStyle(element)
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
    })).toBe(true)
  } finally {
    await page.close()
  }
})
