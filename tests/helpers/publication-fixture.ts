import { expect, type Page } from '@playwright/test'

export async function mockPublicationTags(page: Page) {
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'tagFixture', name: '创作', category: new URL(route.request().url()).searchParams.get('kind') || 'image' }] } }))
}

export async function completePublicationFields(page: Page) {
  const form = page.getByRole('dialog', { name: '发布作品', exact: true })
  if (await form.getByRole('textbox', { name: '作品标题', exact: true }).isDisabled()) return
  if (await form.locator('.publish-extras').getAttribute('open') === null) await form.getByText('补充信息（选填）', { exact: true }).click()
  const tag = form.getByRole('button', { name: '# 创作', exact: true })
  await expect(tag).toBeVisible()
  if (await tag.getAttribute('aria-pressed') !== 'true') await tag.click()
  await form.getByRole('checkbox', { name: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。', exact: true }).check()
}
