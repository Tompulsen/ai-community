import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
import AxeBuilder from '@axe-core/playwright'
import { mockPublicationTags } from './helpers/publication-fixture'

for (const width of [390, 1440]) for (const target of ['work'] as const) {
  test(`${target} previews a slow upload immediately and queues one save at ${width}px`, async ({ page }) => {
    const account = await mockUnifiedAccount(page, true)
    await mockPublicationTags(page)
    const image = await readFile('public/assets/brand/octopus-community.jpg')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 100, filesMb: 20 } }))
    await page.route('**/api/uploads', async route => {
      await gate
      await route.fulfill({ json: { file: { id: 'uploaded1', name: 'photo.jpg', type: 'image/jpeg', size: image.length,
        url: '/assets/brand/octopus-community.jpg', processing: 'pending' } } })
    })
    await page.route(target === 'work' ? '**/api/works' : '**/api/profile', route => {
      if (!['POST', 'PATCH'].includes(route.request().method())) return route.fallback()
      const body = route.request().postDataJSON(); writes++
      if (target === 'work') {
        expect(body.fileIds).toEqual(['uploaded1'])
        return route.fulfill({ json: { work: { id: 'saved1', status: 'pending', title: body.title } } })
      }
      expect(body.bannerId).toBe('uploaded1')
      return route.fulfill({ json: { user: { ...account.state.user, ...body, bannerUrl: '/assets/brand/octopus-community.jpg' } } })
    })
    try {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(target === 'work' ? '/discover?publish=1' : '/community?creator=fixtureAccountUser&edit=profile')
      const scope = page.locator(target === 'work' ? '.editor-dialog[open]' : '.profile-editor')
      await scope.getByLabel(target === 'work' ? '添加作品文件' : '主页封面', { exact: true })
        .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image })
      if (target === 'profile') await page.getByRole('button', { name: '确认裁切', exact: true }).click()
      const preview = target === 'work' ? scope.locator('.attachment-preview img') : scope.getByAltText('当前主页封面')
      await expect(preview).toBeVisible({ timeout: 1500 })
      await expect(preview).toHaveAttribute('src', /^blob:/)
      await expect(scope.getByRole('progressbar')).toBeVisible()
      await scope.getByLabel(target === 'work' ? '作品标题' : '社区昵称', { exact: true }).fill('上传时继续编辑')
      await scope.getByRole('checkbox', { name: '创作', exact: true }).check()
      const save = scope.getByRole('button', { name: target === 'work' ? '提交审核' : '保存资料', exact: true })
      await expect(save).toBeEnabled()
      await save.click()
      await expect(scope.getByText(/上传完成后自动/)).toBeVisible()
      expect(writes).toBe(0)
      expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).include(target === 'work' ? '.editor-dialog[open]' : '.profile-editor').analyze()).violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`${target}-upload-${width}.png`) })
      release()
      await expect.poll(() => writes).toBe(1)
      if (target === 'work') await expect(scope).not.toBeVisible()
      else await expect(scope.getByText('资料已保存', { exact: true })).toBeVisible()
    } finally { release() }
  })
}

for (const target of ['work'] as const) {
  test(`${target} keeps a failed upload preview and retries before saving`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await mockPublicationTags(page)
    const image = await readFile('public/assets/brand/octopus-community.jpg')
    let attempts = 0, writes = 0
    await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 100, filesMb: 20 } }))
    await page.route('**/api/uploads', route => ++attempts === 1
      ? route.fulfill({ status: 503, json: { message: '上传服务暂不可用' } })
      : route.fulfill({ json: { file: { id: 'retried1', name: 'photo.jpg', type: 'image/jpeg', url: '/assets/brand/octopus-community.jpg' } } }))
    await page.route(target === 'work' ? '**/api/works' : '**/api/profile', route => {
      if (!['POST', 'PATCH'].includes(route.request().method())) return route.fallback()
      writes++; return route.fulfill({ status: 503, json: { message: '保存服务暂不可用' } })
    })
    await page.goto(target === 'work' ? '/discover?publish=1' : '/community?creator=fixtureAccountUser&edit=profile')
    const scope = page.locator(target === 'work' ? '.editor-dialog[open]' : '.profile-editor')
    await scope.getByLabel(target === 'work' ? '添加作品文件' : '主页封面', { exact: true })
      .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image })
    if (target === 'profile') await page.getByRole('button', { name: '确认裁切', exact: true }).click()
    await expect(scope.getByText('上传服务暂不可用', { exact: true })).toBeVisible()
    await scope.getByLabel(target === 'work' ? '作品标题' : '社区昵称', { exact: true }).fill('失败后保留')
    await scope.getByRole('checkbox', { name: '创作', exact: true }).check()
    const save = scope.getByRole('button', { name: target === 'work' ? '提交审核' : '保存资料', exact: true })
    await save.click()
    await expect(scope.getByRole('alert')).toContainText('上传服务暂不可用')
    expect(writes).toBe(0)
    await scope.getByRole('button', { name: '重试上传' }).click()
    await expect(scope.getByText('上传成功', { exact: true })).toBeVisible()
    await save.click()
    await expect(scope.getByRole('alert')).toContainText('保存服务暂不可用')
    await expect(scope.getByLabel(target === 'work' ? '作品标题' : '社区昵称', { exact: true })).toHaveValue('失败后保留')
    expect(attempts).toBe(2); expect(writes).toBe(1)
  })
}
