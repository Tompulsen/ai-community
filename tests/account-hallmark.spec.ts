import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const mode of ['light', 'dark']) {
  test(`compact settings keep their controls visible in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), mode)
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 740 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport)
      for (const tab of ['privacy', 'security', 'theme']) {
        await page.goto('/account?tab=' + tab)
        await expect(page.locator('.settings-main')).toBeVisible()
        const heading = (await page.locator('.settings-sidebar .page-heading').boundingBox())!
        const navigation = (await page.locator('.account-tabs').boundingBox())!
        const content = (await page.locator('.settings-main').boundingBox())!
        expect(heading.y + heading.height).toBeLessThanOrEqual(navigation.y)
        expect(navigation.y + navigation.height).toBeLessThanOrEqual(content.y)
        const tabs = await page.locator('.account-tabs .settings-nav-item').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y))
        expect(Math.max(...tabs) - Math.min(...tabs)).toBeLessThan(1)
        if (tab !== 'security') {
          const panel = (await page.locator('.settings-main > section').boundingBox())!
          expect(panel.x).toBeCloseTo(navigation.x, 0)
          for (const group of await page.locator('.settings-preference-group').all()) {
            const label = (await group.locator(':scope > h3').boundingBox())!
            const controls = (await group.locator('fieldset').boundingBox())!
            expect(controls.x).toBeGreaterThan(label.x + label.width)
          }
        }
        if (tab === 'privacy') {
          await expect(page.getByRole('button', { name: '保存隐私设置', exact: true })).toBeInViewport()
          const rows = page.locator('.privacy-fields > .field')
          for (const row of await rows.all()) {
            const label = (await row.locator(':scope > span').boundingBox())!
            const select = (await row.locator('select').boundingBox())!
            expect(select.x).toBeGreaterThan(label.x + label.width)
          }
          const controls = await page.locator('.privacy-settings select').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
          expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(1)
        } else if (tab === 'security') {
          await expect(page.getByRole('button', { name: '退出当前设备', exact: true })).toBeInViewport()
          const identity = (await page.locator('.security-identity').boundingBox())!
          const devices = (await page.locator('.security-sessions').boundingBox())!
          expect(devices.x).toBeGreaterThan(identity.x)
          expect(devices.y).toBeCloseTo(identity.y, 0)
        } else {
          await expect(page.locator('.palette-option')).toHaveCount(6)
          await expect(page.locator('.theme-footnote')).toBeInViewport()
          const modeControls = (await page.locator('.theme-modes').boundingBox())!
          for (const palettes of await page.locator('.theme-palettes').all()) {
            expect((await palettes.boundingBox())!.x).toBeCloseTo(modeControls.x, 0)
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (viewport.width === 1440) {
          const result = await new AxeBuilder({ page }).include('.settings-page').analyze()
          expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
          await page.screenshot({ path: test.info().outputPath(`hallmark-${tab}-${mode}.png`) })
        }
      }
    }
  })

  test(`phone settings preserve labels and keyboard focus in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), mode)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/account?tab=privacy')
      await expect(page.locator('.privacy-settings select')).toHaveCount(3)
      const save = page.getByRole('button', { name: '保存隐私设置', exact: true })
      await expect(save).toBeInViewport({ ratio: 1 })
      const saveBox = (await save.boundingBox())!
      const navigation = (await page.locator('.mobile-nav').boundingBox())!
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(navigation.y)
      expect(await page.evaluate(() => scrollY)).toBe(0)
      const following = (await page.locator('#privacy-following').boundingBox())!
      const followers = (await page.locator('#privacy-followers').boundingBox())!
      expect(Math.abs(following.y - followers.y)).toBeLessThan(1)
      expect(followers.x).toBeGreaterThan(following.x)
      const visibility = page.locator('.privacy-settings select').nth(1)
      const label = (await visibility.locator('..').locator(':scope > span').boundingBox())!
      const input = (await visibility.boundingBox())!
      expect(input.y).toBeGreaterThanOrEqual(label.y + label.height)
      await visibility.focus()
      await expect(visibility).toBeFocused()
      expect(await visibility.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 390) {
        expect((await new AxeBuilder({ page }).include('.settings-page').analyze()).violations).toEqual([])
        await page.screenshot({ path: test.info().outputPath(`hallmark-phone-${mode}.png`), fullPage: true })
      }
      await page.goto('/account?tab=theme')
      await expect(page.locator('.palette-option')).toHaveCount(6)
      const group = page.locator('.settings-preference-group').first()
      const title = (await group.locator(':scope > h3').boundingBox())!
      const choices = (await group.locator('fieldset').boundingBox())!
      expect(choices.y).toBeGreaterThanOrEqual(title.y + title.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 390) await page.screenshot({ path: test.info().outputPath(`hallmark-theme-phone-${mode}.png`), fullPage: true })
    }
  })
}

for (const tab of ['privacy', 'theme']) {
  test(`${tab} groups reflow when the community sidebar expands`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto('/account?tab=' + tab)
    const group = page.locator('.settings-preference-group').first()
    const label = (await group.locator(':scope > h3').boundingBox())!
    expect((await group.locator('fieldset').boundingBox())!.x).toBeGreaterThan(label.x + label.width)
    if (tab === 'privacy') await page.getByRole('checkbox', { name: '关注请求需要批准', exact: true }).check()
    else await page.getByRole('radio', { name: '定时切换', exact: true }).check()
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveClass(/rail-expanded/)
    const stackedTitle = (await group.locator(':scope > h3').boundingBox())!
    const stackedControls = (await group.locator('fieldset').boundingBox())!
    expect(stackedControls.x).toBeCloseTo(stackedTitle.x, 0)
    expect(stackedControls.y).toBeGreaterThanOrEqual(stackedTitle.y + stackedTitle.height)
    if (tab === 'privacy') await expect(page.getByRole('checkbox', { name: '关注请求需要批准', exact: true })).toBeChecked()
    else await expect(page.locator('.schedule-times input')).toHaveCount(2)
    expect(await page.locator('.settings-main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`${tab}-expanded-sidebar.png`), fullPage: true })
  })
}

test('security reflows when the community sidebar reduces its available width', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  const email = `${'long-address.'.repeat(5)}creator@example.com`
  await page.route('**/api/new-api/login-identifiers', route => route.fulfill({ json: {
    success: true, data: { username: 'octopusfixture', email, login_identifiers: ['octopusfixture', email] },
  } }))
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto('/account?tab=security')
  await expect(page.locator('.login-identifiers')).toContainText(email)
  const identity = page.locator('.security-identity'), devices = page.locator('.security-sessions')
  expect((await devices.boundingBox())!.x).toBeGreaterThan((await identity.boundingBox())!.x)
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/rail-expanded/)
  const identityBox = (await identity.boundingBox())!, devicesBox = (await devices.boundingBox())!
  expect(devicesBox.x).toBeCloseTo(identityBox.x, 0)
  expect(devicesBox.y).toBeGreaterThanOrEqual(identityBox.y + identityBox.height)
  expect(await page.locator('.settings-main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('security-expanded-sidebar.png'), fullPage: true })
})

test('settings navigation does not move when the selection or privacy draft changes', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/account?tab=privacy')
  const buttons = page.locator('.account-tabs .settings-nav-item')
  await expect(buttons).toHaveCount(4)
  const positions = () => buttons.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return [rect.x, rect.y, rect.width, rect.height]
  }))
  const baseline = await positions()
  await page.getByRole('checkbox', { name: '关注请求需要批准', exact: true }).check()
  expect(await positions()).toEqual(baseline)
  await page.getByRole('button', { name: '主题与外观', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page).toHaveURL(/tab=theme$/)
  expect(await positions()).toEqual(baseline)
  const search = page.getByRole('searchbox', { name: '搜索设置', exact: true })
  await search.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '章鱼账户中心', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.settings-sidebar').getByRole('button', { name: '退出登录', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(buttons.first()).toBeFocused()
})
