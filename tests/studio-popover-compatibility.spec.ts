import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function withoutPopover(page: Page) {
  await page.addInitScript(() => {
    for (const key of ['popover', 'showPopover', 'hidePopover', 'togglePopover']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
    // A modern engine still recognizes declarative invokers after deleting the JS API.
    new MutationObserver(() => document.querySelectorAll('[popovertarget]').forEach(button => button.removeAttribute('popovertarget')))
      .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['popovertarget'] })
  })
}

async function fixture(page: Page, fallback: boolean) {
  if (fallback) await withoutPopover(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mockUnifiedAccount(page, true)
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [
    { id: 'gpt-image-2', kinds: ['image'] }, { id: 'fixture-text', kinds: ['text'] },
  ] } }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: { rows: [], userId: 17, currency: '积分' } } }))
  return errors
}

for (const fallback of [false, true]) {
  for (const width of [1440, 390, 320]) {
    test(`${fallback ? 'fallback' : 'native'} parameters support keyboard, selection and dismissal at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const errors = await fixture(page, fallback)
      await page.goto('/create/image')
      const trigger = page.getByRole('button', { name: '高级参数', exact: true })
      const panel = page.getByRole('dialog', { name: '高级参数', exact: true, includeHidden: true })
      const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
      await expect(page.getByRole('combobox', { name: '模型', exact: true, includeHidden: true })).toHaveValue('gpt-image-2')
      await prompt.fill('保留参数和草稿')
      await expect(panel).toBeHidden()
      await trigger.focus(); await page.keyboard.press('Enter')
      await expect(panel).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      if (!fallback) await page.keyboard.press('Tab')
      await expect.poll(() => panel.evaluate(element => element.contains(document.activeElement))).toBe(true)
      const ratio = panel.getByRole('radiogroup', { name: '画面比例', exact: true }).getByRole('radio', { name: '16:9', exact: true })
      await ratio.check()
      await expect(ratio).toBeChecked()
      const box = (await panel.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(845)
      if (width < 600) {
        expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect((await panel.getByRole('button', { name: '关闭高级参数' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect((await ratio.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      expect((await new AxeBuilder({ page }).include('.studio-popover').analyze()).violations).toEqual([])
      if (fallback && width !== 390) await page.screenshot({ path: test.info().outputPath('fallback-open.png') })
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden(); await expect(trigger).toBeFocused()
      await trigger.click(); await expect(ratio).toBeChecked()
      if (width < 600) {
        await page.mouse.click(width / 2, 10)
        await expect(panel).toBeHidden()
      }
      await prompt.click()
      await expect(panel).toBeHidden(); await expect(prompt).toBeFocused()
      await trigger.click()
      await panel.getByRole('button', { name: '关闭高级参数' }).click()
      await expect(panel).toBeHidden(); await expect(trigger).toBeFocused()
      await expect(prompt).toHaveValue('保留参数和草稿')
      expect(errors).toEqual([])
    })
  }
}

test('fallback nested search stays above its parent sheet and Escape closes one level', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await fixture(page, true)
  await page.goto('/create/text')
  const settings = page.getByRole('dialog', { name: '对话参数', exact: true })
  const search = page.getByRole('dialog', { name: '联网搜索', exact: true })
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  await settings.getByRole('button', { name: '联网搜索：联网', exact: true }).click()
  await expect(search).toBeVisible(); await expect(settings).toBeVisible()
  await search.getByRole('button', { name: '快速搜索', exact: true }).click()
  await expect(search).toBeHidden(); await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '联网搜索：快速搜索', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(search).toBeHidden(); await expect(settings).toBeVisible()
  await expect(settings.getByRole('button', { name: '联网搜索：快速搜索', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 420 })
  await expect.poll(() => settings.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(420)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  expect(errors).toEqual([])
})

test('unsupported popover selectors do not break conversation keyboard handling', async ({ page }) => {
  const errors = await fixture(page, true)
  await page.goto('/create/image')
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await expect(prompt).toBeEnabled()
  const result = await prompt.evaluate(element => {
    const closest = Element.prototype.closest, failures: string[] = []
    const record = (event: ErrorEvent) => failures.push(event.message)
    window.addEventListener('error', record)
    Element.prototype.closest = function (selector: string) {
      if (selector.includes(':popover-open')) throw new DOMException('Unsupported pseudo-class', 'SyntaxError')
      return closest.call(this, selector)
    }
    let unsupported = false
    try {
      try { element.closest('dialog[open], [popover]:popover-open') } catch { unsupported = true }
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } finally {
      Element.prototype.closest = closest
      window.removeEventListener('error', record)
    }
    return { unsupported, failures }
  })
  expect(result).toEqual({ unsupported: true, failures: [] })
  expect(errors).toEqual([])
})

test('fallback repeated openings and unmount remove listeners and return focus without a trap', async ({ page }) => {
  await withoutPopover(page)
  await page.route('**/popover-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Popover fixture</title></head><body><main></main></body></html>' }))
  await page.goto('/popover-fixture')
  await page.evaluate(async () => {
    const componentPath = '/src/components/StudioPopover.vue'
    const source = await (await fetch(componentPath)).text()
    const vuePath = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1]!
    const { createApp, h, ref } = await import(vuePath), { default: Popover } = await import(componentPath)
    await import('/src/style.css'); await import('/src/studio-composer.css')
    const listeners: { target: EventTarget; type: string; callback: EventListenerOrEventListenerObject | null; capture: boolean }[] = []
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      if ([window, document, window.visualViewport].includes(this as Window)) {
        if (!listeners.some(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture)) listeners.push({ target: this, type, callback, capture })
      }
      return add.call(this, type, callback, options)
    }
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      const index = listeners.findIndex(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture)
      if (index >= 0) listeners.splice(index, 1)
      return remove.call(this, type, callback, options)
    }
    const mounted = ref(true), popover = ref()
    createApp({ render: () => [mounted.value ? h(Popover, { ref: popover, label: '独立参数' }, { trigger: () => '参数', default: () => h('button', { type: 'button' }, '选择') }) : null, h('button', { type: 'button' }, '后续操作')] }).mount('main')
    Object.assign(window, { popoverFixture: { listeners, unmount: () => mounted.value = false, open: () => popover.value.open(), close: () => popover.value.close() } })
  })
  const trigger = page.getByRole('button', { name: '独立参数', exact: true })
  const panel = page.getByRole('dialog', { name: '独立参数', exact: true })
  const listenerCount = () => page.evaluate(() => (window as any).popoverFixture.listeners.length as number)
  const baseline = await listenerCount()
  let openedCount = 0
  for (let cycle = 0; cycle < 4; cycle++) {
    await trigger.click(); await expect(panel).toBeVisible()
    if (!cycle) openedCount = await listenerCount()
    expect(await listenerCount()).toBe(openedCount)
    await panel.getByRole('button', { name: '选择' }).focus()
    await page.keyboard.press('Tab')
    await expect(panel).toBeHidden(); await expect(page.getByRole('button', { name: '后续操作' })).toBeFocused()
    expect(await listenerCount()).toBe(baseline)
  }
  await trigger.click()
  await page.keyboard.press('Shift+Tab')
  await expect(panel).toBeHidden(); await expect(trigger).toBeFocused()
  await page.evaluate(() => { const fixture = (window as any).popoverFixture; fixture.open(); fixture.close(); fixture.open(); fixture.unmount() })
  await expect(panel).toHaveCount(0)
  expect(await listenerCount()).toBe(baseline)
})

test('fallback context menu preserves editing, deletion and keyboard navigation inside a dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withoutPopover(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/popover-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Menu fixture</title></head><body><main></main></body></html>' }))
  await page.goto('/popover-fixture')
  await page.evaluate(async () => {
    const componentPath = '/src/components/studio-message/StudioContextMenu.vue'
    const source = await (await fetch(componentPath)).text()
    const vuePath = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1]!
    const { createApp, h, ref } = await import(vuePath), { default: Menu } = await import(componentPath)
    const { default: Actions } = await import('/src/components/studio-message/StudioMessageActions.vue')
    await import('/src/style.css')
    const menu = ref(), selected = ref(''), icon = { render: () => null }
    createApp({ render: () => h('dialog', { id: 'compat-dialog', 'aria-label': '兼容弹窗' }, [
      h('div', { style: 'transform: translateZ(0); overflow: hidden; height: 52px' }, h('button', { type: 'button', onClick: (event: MouseEvent) => menu.value.open(event) }, '打开消息菜单')),
      h(Menu, { ref: menu, label: '兼容消息菜单', items: [
        { label: '编辑', icon, run: () => selected.value = '已编辑' },
        { label: '不可用', icon, disabled: true, run: () => selected.value = '错误' },
        { label: '删除', icon, run: () => selected.value = '已删除' },
      ] }),
      h(Actions, { label: '消息按钮', actions: [{ icon: 'edit', label: '编辑消息', hint: '修改原提问', run: () => selected.value = '按钮已编辑' }] }),
      h('output', selected.value),
    ]) }).mount('main')
    document.querySelector<HTMLDialogElement>('#compat-dialog')!.showModal()
  })
  const trigger = page.getByRole('button', { name: '打开消息菜单' })
  const menu = page.getByRole('menu', { name: '兼容消息菜单' })
  const edit = menu.getByRole('menuitem', { name: '编辑', exact: true })
  const remove = menu.getByRole('menuitem', { name: '删除', exact: true })
  await trigger.click(); await expect(edit).toBeFocused()
  expect(await menu.evaluate(element => element.closest('dialog')?.id)).toBe('compat-dialog')
  await page.keyboard.press('ArrowDown'); await expect(remove).toBeFocused()
  await page.keyboard.press('Home'); await expect(edit).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('output')).toHaveText('已编辑'); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused()
  await trigger.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(page.locator('output')).toHaveText('已删除')
  await trigger.click(); await page.keyboard.press('Escape')
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused()
  await expect(page.getByRole('dialog', { name: '兼容弹窗' })).toBeVisible()
  const action = page.getByRole('button', { name: '编辑消息', exact: true })
  await action.hover(); await action.focus()
  await expect(action).toHaveAttribute('title', '修改原提问')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await action.click(); await expect(page.locator('output')).toHaveText('按钮已编辑')
  expect(errors).toEqual([])
})
