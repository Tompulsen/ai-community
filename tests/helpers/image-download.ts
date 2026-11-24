import { expect, type Page } from '@playwright/test'

export async function confirmImageDownload(page: Page, format = 'JPG / JPEG') {
  const dialog = page.getByRole('dialog', { name: '选择图片下载格式', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: format, exact: true }).check()
  await dialog.getByRole('button', { name: '确认下载', exact: true }).click()
}
