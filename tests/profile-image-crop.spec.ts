import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const width of [1440, 390]) {
  test(`profile media crop supports cancel, bounds, resize and saved pixels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await mockUnifiedAccount(page, true)
    const image = await readFile('public/assets/brand/octopus-community.jpg')
    const user = { ...fixture.state.user, avatarUrl: '/legacy-files/preview-avatar?variant=thumbnail', bannerUrl: '/legacy-files/preview-banner?variant=web' }
    await page.route('**/legacy-files/preview-*', route => route.fulfill({ contentType: 'image/jpeg', body: image }))
    const uploads: Buffer[] = [], writes: Record<string, unknown>[] = []
    await page.route('**/api/users/fixtureAccountUser', route => route.fulfill({ json: { user } }))
    await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 20, filesMb: 20 } }))
    await page.route('**/api/uploads', async route => {
      const request = route.request()
      const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { 'content-type': request.headers()['content-type']! } }).formData()
      uploads.push(Buffer.from(await (form.get('file') as File).arrayBuffer()))
      return route.fulfill({ json: { file: { id: `cropped${uploads.length}`, type: 'image/webp', url: '/assets/brand/octopus-community.jpg' } } })
    })
    await page.route('**/api/profile', route => {
      const body = route.request().postDataJSON(); writes.push(body)
      Object.assign(user, body)
      return route.fulfill({ json: { user } })
    })
    await page.goto('/community?creator=fixtureAccountUser')
    await expect(page.getByRole('button', { name: '查看背景', exact: true })).toBeVisible()
    const cover = page.locator('.profile-cover-region')
    const expectedRatio = await cover.evaluate(element => element.clientWidth / element.clientHeight)
    let pickerCount = 0
    page.on('filechooser', () => pickerCount++)
    await page.getByRole('button', { name: '查看背景', exact: true }).click({ position: { x: 8, y: 8 } })
    const preview = page.getByRole('dialog', { name: '当前背景', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('img')).toHaveAttribute('src', '/legacy-files/preview-banner')
    expect(pickerCount).toBe(0); expect(uploads).toHaveLength(0); expect(writes).toHaveLength(0)
    const chooser = page.waitForEvent('filechooser')
    await preview.getByRole('button', { name: '更换背景', exact: true }).click()
    await (await chooser).setFiles({ name: 'cover.jpg', mimeType: 'image/jpeg', buffer: image })
    const confirm = page.getByRole('button', { name: '确认裁切', exact: true })
    await expect(confirm).toBeEnabled()
    const selection = page.locator('cropper-selection')
    const box = await selection.boundingBox()
    expect(box!.width / box!.height).toBeCloseTo(expectedRatio, 1)
    await page.getByRole('button', { name: '取消裁切', exact: true }).click()
    await expect(page.locator('.profile-crop-dialog')).not.toBeVisible()
    expect(uploads).toHaveLength(0); expect(writes).toHaveLength(0)

    for (const kind of ['avatar', 'banner'] as const) {
      await page.getByRole('button', { name: kind === 'avatar' ? '查看头像' : '查看背景', exact: true }).click(kind === 'banner' ? { position: { x: 8, y: 8 } } : {})
      const preview = page.getByRole('dialog', { name: kind === 'avatar' ? '当前头像' : '当前背景', exact: true })
      await expect(preview).toBeVisible()
      if (kind === 'avatar') await expect(preview.getByRole('img')).toHaveAttribute('src', '/legacy-files/preview-avatar')
      const downloadEvent = page.waitForEvent('download')
      await preview.getByRole('button', { name: '下载图片', exact: true }).click()
      const download = await downloadEvent
      expect(await readFile((await download.path())!)).toEqual(image)
      const chooser = page.waitForEvent('filechooser')
      await preview.getByRole('button', { name: kind === 'avatar' ? '更换头像' : '更换背景', exact: true }).click()
      await (await chooser).setFiles({ name: `${kind}.jpg`, mimeType: 'image/jpeg', buffer: image })
      await expect(confirm).toBeEnabled()
      const before = await page.locator('cropper-image').evaluate((element: any) => element.$getTransform())
      await page.getByRole('button', { name: '放大图片', exact: true }).click()
      expect(await page.locator('cropper-image').evaluate((element: any) => element.$getTransform())).not.toEqual(before)
      const imageBox = await selection.boundingBox()
      await page.mouse.move(imageBox!.x + imageBox!.width / 2, imageBox!.y + imageBox!.height / 2)
      await page.mouse.down(); await page.mouse.move(imageBox!.x + imageBox!.width / 2 + 10, imageBox!.y + imageBox!.height / 2 + 8); await page.mouse.up()
      await page.locator('.crop-stage').focus(); await page.keyboard.press('ArrowRight')
      await page.getByRole('button', { name: '重置裁切', exact: true }).click()
      for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '缩小图片', exact: true }).click()
      if (kind === 'avatar') {
        await page.setViewportSize({ width: width === 1440 ? 860 : 732, height: 640 })
        await expect(confirm).toBeEnabled()
      }
      const bounds = await page.locator('.crop-stage').evaluate(host => {
        const image = host.querySelector('cropper-image')!.getBoundingClientRect(), selection = host.querySelector('cropper-selection')!.getBoundingClientRect(), stage = host.getBoundingClientRect()
        return { filled: image.left <= selection.left + 1 && image.right >= selection.right - 1 && image.top <= selection.top + 1 && image.bottom >= selection.bottom - 1,
          contained: selection.left >= stage.left && selection.right <= stage.right && selection.top >= stage.top && selection.bottom <= stage.bottom }
      })
      expect(bounds).toEqual({ filled: true, contained: true })
      await page.screenshot({ path: test.info().outputPath(`crop-${kind}.png`) })
      await confirm.click()
      await expect(page.locator('.profile-crop-dialog')).not.toBeVisible()
      await expect.poll(() => writes.length).toBe(kind === 'avatar' ? 1 : 2)
      expect(Object.keys(writes.at(-1)!)).toEqual([`${kind}Id`])
      const metadata = await sharp(uploads.at(-1)!).metadata()
      expect(metadata.format).toBe('webp')
      if (kind === 'avatar') {
        expect(metadata.width).toBe(512); expect(metadata.height).toBe(512)
        const { data } = await sharp(uploads.at(-1)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        expect(data[3]).toBe(0)
      } else expect(metadata.width).toBe(1920)
      await page.setViewportSize({ width, height: 1000 })
    }
  })
}

for (const width of [1440, 390]) {
  test(`zooming out after panning reaches the crop short edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mockUnifiedAccount(page, true)
    await page.goto('/community?creator=fixtureAccountUser')
    const source = await readFile('public/assets/brand/octopus-community.jpg')
    for (const [imageWidth, imageHeight] of [[960, 640], [640, 960]]) {
      const buffer = await sharp(source).resize(imageWidth, imageHeight, { fit: 'fill' }).jpeg().toBuffer()
      for (const label of ['头像', '主页封面']) {
        await page.getByLabel(label, { exact: true }).setInputFiles({ name: 'crop.jpg', mimeType: 'image/jpeg', buffer })
        await expect(page.getByRole('button', { name: '确认裁切', exact: true })).toBeEnabled()
        for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大图片', exact: true }).click()
        await page.locator('.crop-stage').focus()
        for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
        for (let i = 0; i < 15; i++) await page.getByRole('button', { name: '缩小图片', exact: true }).click()
        const bounds = () => page.locator('.crop-stage').evaluate(host => {
          const image = host.querySelector('cropper-image')!.getBoundingClientRect(), crop = host.querySelector('cropper-selection')!.getBoundingClientRect()
          return { ratio: Math.min(image.width / crop.width, image.height / crop.height), filled: image.left <= crop.left + 1 && image.right >= crop.right - 1 && image.top <= crop.top + 1 && image.bottom >= crop.bottom - 1 }
        })
        expect((await bounds()).ratio).toBeCloseTo(1, 3)
        expect((await bounds()).filled).toBe(true)
        await page.getByRole('button', { name: '放大图片', exact: true }).click()
        const crop = await page.locator('cropper-selection').boundingBox()
        await page.mouse.move(crop!.x + crop!.width * .9, crop!.y + crop!.height * .1)
        await page.mouse.wheel(0, 4000)
        await expect.poll(async () => (await bounds()).ratio).toBeCloseTo(1, 3)
        expect((await bounds()).filled).toBe(true)
        await page.getByRole('button', { name: '取消裁切', exact: true }).click()
      }
    }
  })
}

test('an empty image preview stays open when file selection is cancelled and Esc restores focus', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  await page.goto('/community?creator=fixtureAccountUser')
  for (const kind of ['头像', '背景']) {
    const trigger = page.getByRole('button', { name: `查看${kind}`, exact: true })
    await trigger.click(kind === '背景' ? { position: { x: 8, y: 8 } } : {})
    const preview = page.getByRole('dialog', { name: `当前${kind}`, exact: true })
    await expect(preview.getByRole('status')).toHaveText(`尚未设置${kind}`)
    await expect(preview.getByRole('button', { name: '下载图片', exact: true })).toHaveCount(0)
    const chooser = page.waitForEvent('filechooser')
    await preview.getByRole('button', { name: `更换${kind}`, exact: true }).click()
    await (await chooser).setFiles([])
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  expect(fixture.mutations).toHaveLength(0)
})

test('profile text editor omits media controls and leaves existing images unchanged', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  Object.assign(fixture.state.user, { avatarId: 'avatar', bannerId: 'banner', avatarUrl: '/assets/brand/octopus-community.jpg', bannerUrl: '/assets/brand/octopus-community.jpg' })
  await page.goto('/community?creator=fixtureAccountUser&edit=profile')
  await expect(page.locator('.profile-editor .profile-media')).toHaveCount(0)
  await expect(page.locator('.profile-editor input[type=file]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /更换头像|更换封面|查看头像|查看背景/ })).toHaveCount(0)
  await page.getByLabel('社区昵称', { exact: true }).fill('仅修改文字')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  expect(fixture.mutations.find(item => item.path === '/api/profile')?.body).toEqual({ name: '仅修改文字', bio: '' })
  expect(fixture.state.user).toMatchObject({ avatarId: 'avatar', bannerId: 'banner' })
})

test('original image download reports failures and retries without changing the profile', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  const original = await readFile('public/assets/brand/octopus-community.jpg')
  Object.assign(fixture.state.user, { avatarUrl: '/legacy-files/download-avatar?variant=thumbnail' })
  let attempts = 0
  await page.route('**/legacy-files/download-avatar*', route => {
    if (route.request().resourceType() !== 'fetch') return route.fulfill({ contentType: 'image/jpeg', body: original })
    expect(new URL(route.request().url()).searchParams.has('variant')).toBe(false)
    return ++attempts === 1 ? route.fulfill({ status: 503, body: 'unavailable' }) : route.fulfill({ contentType: 'image/jpeg', body: original })
  })
  await page.goto('/community?creator=fixtureAccountUser')
  await page.getByRole('button', { name: '查看头像', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '当前头像', exact: true })
  await preview.getByRole('button', { name: '下载图片', exact: true }).click()
  await expect(preview.getByRole('alert')).toHaveText('图片下载失败，请重试。')
  const downloadEvent = page.waitForEvent('download')
  await preview.getByRole('button', { name: '下载图片', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('avatar.jpg')
  expect(await readFile((await download.path())!)).toEqual(original)
  await expect(preview.getByRole('alert')).toHaveCount(0)
  expect(fixture.mutations).toHaveLength(0)
})

test('invalid images remain cancellable without uploading', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/community?creator=fixtureAccountUser')
  await page.getByLabel('头像', { exact: true }).setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toContainText('图片无法裁切')
  await expect(page.getByRole('button', { name: '确认裁切', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.profile-crop-dialog')).not.toBeVisible()
})

test('a refused direct media save can retry without changing text or the other picture', async ({ page }) => {
  const fixture = await mockUnifiedAccount(page, true)
  let attempts = 0
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, videosMb: 20, filesMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'cropped1', type: 'image/webp', url: '/assets/brand/octopus-community.jpg' } } }))
  await page.route('**/api/profile', route => {
    expect(route.request().postDataJSON()).toEqual({ avatarId: 'cropped1' })
    return ++attempts === 1 ? route.fulfill({ status: 503, json: { message: '保存暂时失败' } })
      : route.fulfill({ json: { user: { ...fixture.state.user, avatarId: 'cropped1', avatarUrl: '/assets/brand/octopus-community.jpg' } } })
  })
  await page.goto('/community?creator=fixtureAccountUser')
  await page.getByLabel('头像', { exact: true }).setInputFiles({ name: 'avatar.jpg', mimeType: 'image/jpeg', buffer: await readFile('public/assets/brand/octopus-community.jpg') })
  await page.getByRole('button', { name: '确认裁切', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存暂时失败')
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看头像', exact: true })).toBeEnabled()
  expect(attempts).toBe(2)
})
