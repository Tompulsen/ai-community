import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const themes = [
  { mode: 'light', id: 'cloud' }, { mode: 'light', id: 'paper' }, { mode: 'light', id: 'mist' },
  { mode: 'dark', id: 'sage' }, { mode: 'dark', id: 'midnight' }, { mode: 'dark', id: 'jade' },
]

for (const theme of themes) {
  test(`privacy picker follows ${theme.id} theme and keeps native keyboard selection`, async ({ page }) => {
    const fixture = await mockUnifiedAccount(page, true)
    await page.setViewportSize({ width: 1440, height: 740 })
    await page.addInitScript(theme => localStorage.setItem('ai-community-next:appearance:v1',
      JSON.stringify({ mode: theme.mode, [theme.mode]: theme.id })), theme)
    await page.goto('/account?tab=privacy')
    const picker = page.getByRole('combobox', { name: '关注列表可见范围', exact: true })
    await expect(picker).toBeVisible()
    expect(await page.evaluate(() => CSS.supports('appearance', 'base-select'))).toBe(true)
    expect(await picker.evaluate(element => getComputedStyle(element).appearance)).toBe('base-select')
    const pickerStyle = await picker.evaluate(element => ({
      background: getComputedStyle(element, '::picker(select)').backgroundColor,
      trigger: getComputedStyle(element).backgroundColor,
      border: getComputedStyle(element, '::picker(select)').borderTopWidth,
      font: getComputedStyle(element, '::picker(select)').fontFamily,
      triggerFont: getComputedStyle(element).fontFamily,
    }))
    expect(pickerStyle.background).toBe(pickerStyle.trigger)
    expect(pickerStyle.border).toBe('0px')
    expect(pickerStyle.font).toBe(pickerStyle.triggerFont)
    expect((await picker.boundingBox())!.height).toBeLessThanOrEqual(36)
    expect((await page.locator('.privacy-fields').first().boundingBox())!.width).toBeLessThanOrEqual(720)
    await expect(page.getByRole('button', { name: '保存隐私设置', exact: true })).toBeInViewport()
    await picker.focus()
    await page.keyboard.press('Space')
    await expect(picker).toHaveJSProperty('value', 'public')
    await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`privacy-picker-${theme.id}.png`) })
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveValue('private')
    await expect(picker).toBeFocused()
    await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(false)
    const newcomer = page.getByRole('combobox', { name: '新账号关注审批', exact: true })
    await newcomer.selectOption('3600')
    const approval = page.getByRole('checkbox', { name: '关注请求需要批准', exact: true })
    await approval.check()
    await expect(newcomer).toBeDisabled()
    await expect(newcomer).toHaveValue('3600')
    await expect(newcomer).toHaveAccessibleDescription(/此项暂不生效/)
    await page.getByRole('button', { name: '保存隐私设置', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('隐私设置已保存')
    expect(fixture.mutations.find(item => item.path === '/api/account/privacy')?.body).toMatchObject({
      isLocked: true, autoAcceptFollowed: false, followApprovalLocalSeconds: 3600,
      followingVisibility: 'private', followersVisibility: 'public', version: 'fixture-version',
    })
    expect((await new AxeBuilder({ page }).include('.settings-page').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`privacy-compact-${theme.id}.png`) })
  })
}

test('privacy menus prefer the space below and remain reachable in a short viewport', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
  await page.setViewportSize({ width: 1440, height: 740 })
  await page.goto('/account?tab=privacy')
  for (const id of ['privacy-newcomers', 'privacy-following', 'privacy-followers']) {
    const control = page.locator('#' + id)
    const previousValue = await control.inputValue()
    await control.click()
    await expect.poll(() => control.evaluate(element => element.matches(':open'))).toBe(true)
    const trigger = (await control.boundingBox())!
    const first = (await control.locator('option').first().boundingBox())!
    const last = (await control.locator('option').last().boundingBox())!
    expect(first.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)
    expect(last.y + last.height).toBeLessThanOrEqual(740)
    await page.screenshot({ path: test.info().outputPath(`${id}-open.png`) })
    await page.keyboard.press('Escape')
    await expect(control).toHaveValue(previousValue)
  }
  await page.setViewportSize({ width: 1440, height: 580 })
  const followers = page.locator('#privacy-followers')
  await followers.click()
  const first = (await followers.locator('option').first().boundingBox())!
  const last = (await followers.locator('option').last().boundingBox())!
  expect(first.y).toBeGreaterThanOrEqual(0)
  expect(last.y + last.height).toBeLessThanOrEqual(580)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(followers).toHaveValue('private')
})

test.describe('privacy picker on touch screens', () => {
  test.use({ isMobile: true, hasTouch: true })
  for (const width of [320, 390]) {
    test(`keeps touch targets and dismisses the picker at ${width}px`, async ({ page }) => {
      await mockUnifiedAccount(page, true)
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/account?tab=privacy')
      const picker = page.getByRole('combobox', { name: '新账号关注审批', exact: true })
      await expect(picker).toBeVisible()
      const previousValue = await picker.inputValue()
      expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await picker.tap()
      await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`privacy-touch-picker-${width}.png`), fullPage: true })
      const menu = await picker.evaluate(element => ({
        width: parseFloat(getComputedStyle(element, '::picker(select)').width),
        maxHeight: parseFloat(getComputedStyle(element, '::picker(select)').maxHeight),
      }))
      expect(menu.width).toBeLessThanOrEqual(width)
      expect(menu.maxHeight).toBeLessThanOrEqual(320)
      await page.keyboard.press('Escape')
      await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(false)
      await expect(picker).toHaveValue(previousValue)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).include('.settings-page').analyze()).violations).toEqual([])
    })
  }
})
