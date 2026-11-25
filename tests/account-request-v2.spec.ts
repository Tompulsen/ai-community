import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`an account without model keys can configure models and send an explicit group at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const account = await mockUnifiedAccount(page, true)
    const catalogues: string[] = [], submissions: Record<string, unknown>[] = []
    await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: {
      contractVersion: 2, selectedGroup: null, groups: [{ id: 'auto', name: 'Auto' }, { id: 'images', name: 'Images' }],
    } } }))
    await page.route('**/api/creation/models*', route => {
      expect(route.request().method()).toBe('GET')
      const group = new URL(route.request().url()).searchParams.get('group')!
      catalogues.push(group)
      return route.fulfill({ json: { group, contractVersion: 2, configRevision: 'fixture', fetchedAt: Date.now(),
        items: [{ id: 'test-image', kinds: ['image'], apiFormat: 'images' }, { id: 'test-chat', kinds: ['text'] }] } })
    })
    await page.route('**/api/creation/generate', route => {
      const headers = route.request().headers(), body = route.request().postDataJSON()
      expect(headers['x-new-api-token']).toBeUndefined(); expect(headers['x-new-api-group']).toBeUndefined()
      expect(body).toMatchObject({ contractVersion: 2, group: 'auto', model: 'test-image' })
      submissions.push(body)
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLVkAAAAASUVORK5CYII=' }], tokenId: 71, protocol: 'sync' } })
    })
    await page.goto('/create/image')
    const model = page.getByRole('combobox', { name: '模型', exact: true })
    await expect(model).toHaveValue('test-image')
    await model.click()
    const dialog = page.getByRole('dialog', { name: '选择模型', exact: true })
    await dialog.getByRole('button', { name: '收藏: test-image', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '取消收藏: test-image', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: '调整模型类型: test-chat', exact: true }).click()
    await dialog.getByRole('combobox', { name: '接口格式', exact: true }).selectOption('responses')
    await expect(dialog.getByRole('combobox', { name: '接口格式', exact: true })).toHaveValue('responses')
    await page.screenshot({ path: `test-results/account-request-v2-${viewport.width}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: '关闭选择模型', exact: true }).click()
    await page.getByRole('textbox', { name: '提示词', exact: true }).fill('没有密钥也可以发送首次请求')
    await page.getByRole('button', { name: /生成图片|开始生成/ }).click()
    await expect.poll(() => submissions.length).toBe(1)
    expect(catalogues.every(group => group === 'auto')).toBe(true)
    expect(account.mutations.filter(call => /model-groups\/select|\/tokens|creation\/models/.test(call.path))).toEqual([])
  })
}
