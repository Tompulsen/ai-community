import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const answer = '**Answer preserved after a failed module load.**'
const reasoning = '**Reasoning preserved after a failed module load.**'

async function fixture(page: Page, module: 'StudioMarkdown' | 'StudioReasoningPanel') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/creation/**', route => route.fulfill({ json: {
    tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }],
  } }))
  const state = { blocked: true, failures: 0 }
  const path = `/src/components/studio-message/${module}.vue`
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === path) state.failures++
  })
  await page.route(url => url.pathname === path && url.searchParams.get('type') !== 'style', route => {
    return state.blocked ? route.abort('failed') : route.continue()
  })
  await page.addInitScript(({ answer, reasoning }) => {
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'lazy-fallback', sessions: [{
        id: 'lazy-fallback', topic: 'Lazy fallback', model: 'gpt-5', settings: {},
        skillIds: [], search: 'off', messages: [{ id: 'answer', role: 'assistant', content: answer,
          reasoning, createdAt: Date.now() }],
      }],
    } }))
  }, { answer, reasoning })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await expect.poll(() => state.failures).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  return state
}

test('failed Markdown loading keeps the original answer and offers a working retry', async ({ page }) => {
  const state = await fixture(page, 'StudioMarkdown')
  const message = page.locator('.chat-message.assistant')
  await expect(message.locator('.markdown-loading')).toContainText(answer)
  await expect(message.locator('.reasoning-loading')).toContainText(reasoning)
  state.blocked = false
  await message.getByRole('button', { name: '重新加载正文', exact: true }).click()
  await expect(message.locator('.message-content .studio-markdown-body strong'))
    .toHaveText('Answer preserved after a failed module load.', { timeout: 5000 })
})

test('failed reasoning loading keeps its original text and offers a working retry', async ({ page }) => {
  const state = await fixture(page, 'StudioReasoningPanel')
  const message = page.locator('.chat-message.assistant')
  await expect(message.locator('.reasoning-loading')).toContainText(reasoning)
  await expect(message.locator('.message-content .studio-markdown-body strong'))
    .toHaveText('Answer preserved after a failed module load.')
  state.blocked = false
  await message.getByRole('button', { name: '重新加载思考过程', exact: true }).click()
  await expect(message.locator('.reasoning-trigger')).toBeVisible({ timeout: 5000 })
  await message.locator('.reasoning-trigger').click()
  await expect(message.locator('.reasoning-content strong'))
    .toHaveText('Reasoning preserved after a failed module load.')
})
