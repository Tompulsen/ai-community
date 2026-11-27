import { expect, test, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

const payload = { owner: '17', kind: 'image', prompt: '暂存诊断内容', references: [{ name: 'reference.png', url: 'data:image/png;base64,AAAA' }] }
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const calls: any[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/generate') { calls.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: '仅本地模拟，阻止真实生成' } }) }
    return route.fulfill({ json: { items: [] } })
  })
  return { account, calls }
}
async function storagePage(page: Page) {
  await page.route('**/__entry-storage-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Local storage test</body></html>' }))
  await page.goto('/__entry-storage-test')
}
async function entryCount(page: Page) {
  return page.evaluate(async () => {
    const { studioStore } = await import('/shared/studio/studio-keyval.ts')
    return studioStore('readonly', store => new Promise<number>((resolve, reject) => {
      const request = store.getAll(IDBKeyRange.bound('ai-community-next:studio-entry:', 'ai-community-next:studio-entry:\uffff'))
      request.onsuccess = () => resolve(request.result.filter(value => !value?.consumed).length); request.onerror = () => reject(request.error)
    }))
  })
}

test('two large homepage images reach one mocked submission and survive consumption without Web Storage payloads', async ({ page }, info) => {
  const { calls } = await fixture(page)
  const images = await Promise.all([0, 1].map(() => sharp(randomBytes(960 * 720 * 3), { raw: { width: 960, height: 720, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()))
  await page.goto('/discover')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (this === sessionStorage && key.startsWith('ai-community-next:studio-entry:')) throw new DOMException('Session storage unavailable', 'SecurityError')
      return set.call(this, key, value)
    }
  })
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保留两张大参考图')
  await composer.getByLabel('添加参考图', { exact: true }).setInputFiles(images.map((buffer, index) => ({ name: `reference-${index}.png`, mimeType: 'image/png', buffer })))
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].referenceUrls).toEqual(images.map(buffer => `data:image/png;base64,${buffer.toString('base64')}`))
  await expect(page.locator('.task-status')).toContainText('生成失败')
  await expect.poll(() => entryCount(page)).toBe(0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octopus:user-17:native-creation-draft:image') || '{}').referenceConversationId)).toBeTruthy()
  expect(await page.evaluate(() => localStorage.getItem('octopus:user-17:native-creation-draft:image')!.length)).toBeLessThan(10000)
  await expect(page.getByText('当前草稿无法保存到浏览器，请保留提示词。', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('two-large-references-transferred.png') })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留两张大参考图')
  await expect(page.getByRole('form', { name: '创作参数', exact: true }).getByRole('button', { name: /^预览参考图 / })).toHaveCount(2)
  const restored = await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    const { chats } = await import(resources.filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!)
    return chats.sessions.find(chat => chat.id === chats.activeId)?.mediaDrafts?.image?.references.map(file => file.url)
  })
  expect(restored).toEqual(images.map(buffer => `data:image/png;base64,${buffer.toString('base64')}`))
  expect(calls).toHaveLength(1)
})

for (const [name, message] of [['QuotaExceededError', '存储空间不足'], ['SecurityError', '禁止访问本地存储'], ['UnknownError', '创作输入暂存失败']]) {
  test(`homepage preserves inputs and differentiates ${name}`, async ({ page }) => {
    const { calls } = await fixture(page)
    await page.goto('/discover')
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
    await page.evaluate(name => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function(value, key) {
        if (String(key).startsWith('ai-community-next:studio-entry:') && value?.entry) throw new DOMException('Injected storage failure', name)
        return put.call(this, value, key)
      }
    }, name)
    const composer = page.getByRole('form', { name: '快捷创作', exact: true })
    await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('失败时保留我的输入')
    const buffer = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4466ff' } }).png().toBuffer()
    await composer.getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer })
    await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
    await expect(page.locator('.discovery-creation').getByRole('alert')).toContainText(message)
    await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('失败时保留我的输入')
    await expect(composer.getByRole('button', { name: '移除参考图 1', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/discover$/)
    expect(calls).toHaveLength(0)
  })
}

test('IndexedDB entries recover after reload, isolate owners, expire narrowly and claim starts atomically', async ({ page }) => {
  await storagePage(page)
  const id = await page.evaluate(async value => (await import('/src/studio-entry.ts')).saveStudioEntry(value), payload)
  await page.reload()
  const restored = await page.evaluate(async ({ id, value }) => {
    const entries = await import('/src/studio-entry.ts'), store = await import('/shared/studio/studio-keyval.ts')
    const restored = await entries.readStudioEntry(id, '17')
    let foreignError = ''
    try { await entries.readStudioEntry(id, '18') } catch (error) { foreignError = error.message }
    const expired = { version: 1, owner: '17', expiresAt: Date.now() - 1, entry: value }
    await store.set('ai-community-next:studio-entry:expired-own', expired)
    await store.set('ai-community-next:studio-entry:expired-other', { ...expired, owner: '18' })
    await store.set('entry-test-unrelated', 'keep')
    const next = await entries.saveStudioEntry(value)
    await entries.armStudioEntryStart('once', '17', next)
    const wrongOwner = await entries.claimStudioEntryStart('once', '18')
    const claims = await Promise.all([entries.claimStudioEntryStart('once', '17'), entries.claimStudioEntryStart('once', '17')])
    await entries.clearStudioEntry(id, '17'); await entries.clearStudioEntry(next, '17')
    return { restored, foreignError, expiredOwn: await store.get('ai-community-next:studio-entry:expired-own'), expiredOther: !!await store.get('ai-community-next:studio-entry:expired-other'), unrelated: await store.get('entry-test-unrelated'), wrongOwner, claims }
  }, { id, value: payload })
  expect(restored).toMatchObject({ restored: payload, foreignError: '账号已切换，请返回首页重新提交创作。', expiredOther: true, unrelated: 'keep', wrongOwner: false })
  expect(restored.expiredOwn).toBeUndefined()
  expect(restored.claims.sort()).toEqual([false, true])
})

test('legacy entries and one-time markers migrate without losing the old account input', async ({ page }) => {
  await storagePage(page)
  const result = await page.evaluate(async value => {
    const entries = await import('/src/studio-entry.ts'), store = await import('/shared/studio/studio-keyval.ts')
    const key = 'ai-community-next:studio-entry:legacy'
    sessionStorage.setItem(key, JSON.stringify(value))
    let wrongOwner = false
    try { await entries.readStudioEntry('legacy', '18') } catch { wrongOwner = true }
    const retained = sessionStorage.getItem(key) !== null
    const migrated = await entries.readStudioEntry('legacy', '17')
    const durable = await store.get(key)
    sessionStorage.setItem('ai-community-next:studio-entry:start:legacy-chat', '17')
    const first = await entries.claimStudioEntryStart('legacy-chat', '17'), second = await entries.claimStudioEntryStart('legacy-chat', '17')
    await entries.clearStudioEntry('legacy', '17')
    return { wrongOwner, retained, migrated, durable: !!durable, legacyRemoved: sessionStorage.getItem(key) === null, first, second }
  }, payload)
  expect(result).toEqual({ wrongOwner: true, retained: true, migrated: payload, durable: true, legacyRemoved: true, first: true, second: false })
})

test('two tabs can arm only one submission for the same entry and a failed handoff retains input', async ({ page, context }) => {
  await storagePage(page)
  const other = await context.newPage()
  await storagePage(other)
  const id = await page.evaluate(async value => (await import('/src/studio-entry.ts')).saveStudioEntry(value), payload)
  const armed = await Promise.all([page, other].map((tab, index) => tab.evaluate(async ({ id, index }) => (await import('/src/studio-entry.ts')).armStudioEntryStart('tab-' + index, '17', id), { id, index })))
  expect(armed.sort()).toEqual([false, true])
  const claims = await Promise.all([page, other].map((tab, index) => tab.evaluate(async index => (await import('/src/studio-entry.ts')).claimStudioEntryStart('tab-' + index, '17'), index)))
  expect(claims.sort()).toEqual([false, true])
  const failed = await page.evaluate(async value => {
    const entries = await import('/src/studio-entry.ts'), store = await import('/shared/studio/studio-keyval.ts')
    const id = await entries.saveStudioEntry(value), put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (String(key).startsWith('ai-community-next:studio-entry:start:')) throw new DOMException('No storage', 'QuotaExceededError')
      return put.call(this, value, key)
    }
    let message = ''
    try { await entries.armStudioEntryStart('failed', '17', id) } catch (cause) { message = cause.message }
    finally { IDBObjectStore.prototype.put = put }
    return { message, retained: (await entries.readStudioEntry(id, '17')).prompt, start: await store.get('ai-community-next:studio-entry:start:failed') }
  }, payload)
  expect(failed.message).toContain('存储空间不足')
  expect(failed.retained).toBe(payload.prompt)
  expect(failed.start).toBeUndefined()
})

test('cleanup racing with handoff never removes a committed consumption marker or another owner input', async ({ page }) => {
  await storagePage(page)
  const result = await page.evaluate(async value => {
    const entries = await import('/src/studio-entry.ts'), store = await import('/shared/studio/studio-keyval.ts')
    const id = await entries.saveStudioEntry(value)
    const [, armed] = await Promise.all([entries.clearStudioEntry(id, '17'), entries.armStudioEntryStart('cleanup-race', '17', id)])
    const afterRace = await store.get('ai-community-next:studio-entry:' + id)
    const retainedId = await entries.saveStudioEntry(value)
    await entries.armStudioEntryStart('retained-marker', '17', retainedId)
    await entries.clearStudioEntry(retainedId, '17')
    const marker = await store.get('ai-community-next:studio-entry:' + retainedId)
    const foreignId = await entries.saveStudioEntry(value)
    let denied = ''
    try { await entries.clearStudioEntry(foreignId, '18') } catch (cause) { denied = cause.message }
    return { armed, afterRace, marker, denied, foreign: (await entries.readStudioEntry(foreignId, '17')).prompt }
  }, payload)
  if (result.armed) expect(result.afterRace?.consumed).toBe(true)
  else expect(result.afterRace).toBeUndefined()
  expect(result.marker?.consumed).toBe(true)
  expect(result.denied).toContain('账号已切换')
  expect(result.foreign).toBe(payload.prompt)
})

test('a late legacy migration cannot revive a consumed entry and copied legacy starts run once', async ({ page, context }) => {
  await storagePage(page)
  const other = await context.newPage()
  await storagePage(other)
  for (const tab of [page, other]) await tab.evaluate(value => {
    sessionStorage.setItem('ai-community-next:studio-entry:copied', JSON.stringify(value))
    sessionStorage.setItem('ai-community-next:studio-entry:start:copied', '17')
  }, payload)
  await other.evaluate(() => {
    const get = IDBObjectStore.prototype.get, descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!
    IDBObjectStore.prototype.get = function(key) {
      const request = get.call(this, key)
      if (key !== 'ai-community-next:studio-entry:copied') return request
      IDBObjectStore.prototype.get = get
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(callback) {
        descriptor.set!.call(request, (event: Event) => {
          window.releaseLegacyRead = () => callback.call(request, event)
          window.legacyReadHeld = true
        })
      } })
      return request
    }
  })
  const pending = other.evaluate(async () => {
    try { await (await import('/src/studio-entry.ts')).readStudioEntry('copied', '17'); return '' }
    catch (cause) { return cause.message }
  })
  await expect.poll(() => other.evaluate(() => window.legacyReadHeld === true)).toBe(true)
  expect(await page.evaluate(async () => {
    const entries = await import('/src/studio-entry.ts')
    await entries.readStudioEntry('copied', '17')
    return entries.armStudioEntryStart('new-chat', '17', 'copied')
  })).toBe(true)
  await other.evaluate(() => window.releaseLegacyRead())
  expect(await pending).toContain('已处理或已失效')
  const starts = await Promise.all([page, other].map(tab => tab.evaluate(async () => (await import('/src/studio-entry.ts')).claimStudioEntryStart('copied', '17'))))
  expect(starts.sort()).toEqual([false, true])
  expect(await other.evaluate(async () => (await import('/src/studio-entry.ts')).armStudioEntryStart('late-chat', '17', 'copied'))).toBe(false)
})

for (const change of ['account', 'route']) test(`a late homepage save after ${change} changes cannot navigate or submit`, async ({ page }) => {
  const { calls, account } = await fixture(page)
  await page.goto('/discover')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put, descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!
    IDBObjectStore.prototype.put = function(value, key) {
      if (String(key).startsWith('ai-community-next:studio-entry:') && value?.entry) {
        IDBObjectStore.prototype.put = put
        const transaction = this.transaction
        Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(callback) {
          descriptor.set!.call(transaction, (event: Event) => { window.releaseEntrySave = () => callback.call(transaction, event); window.entrySaveHeld = true })
        } })
      }
      return put.call(this, value, key)
    }
  })
  await page.getByRole('textbox', { name: '创作描述', exact: true }).fill('旧账号或旧路由不能迟到提交')
  await page.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.entrySaveHeld === true)).toBe(true)
  if (change === 'account') { account.state.user.id = '18'; account.state.user.accountId = '18' }
  await page.evaluate(async change => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    if (change === 'account') {
      const { session } = await import(resources.filter(name => /\/src\/state\.ts(?:\?|$)/.test(name)).at(-1)!)
      session.user = { ...session.user, id: '18', accountId: '18' }
    } else {
      const { router } = await import(resources.filter(name => /\/src\/router\.ts(?:\?|$)/.test(name)).at(-1)!)
      await router.push('/community')
    }
  }, change)
  await page.evaluate(() => window.releaseEntrySave())
  await expect.poll(() => entryCount(page)).toBe(0)
  await expect(page).toHaveURL(change === 'account' ? /\/discover$/ : /\/community$/)
  expect(calls).toHaveLength(0)
})

for (const stage of ['read', 'claim']) for (const change of ['account', 'route']) {
  test(`a late workbench ${stage} after ${change} changes cannot submit`, async ({ page }) => {
    const { calls, account } = await fixture(page)
    await storagePage(page)
    const id = await page.evaluate(async value => (await import('/src/studio-entry.ts')).saveStudioEntry(value), payload)
    await page.addInitScript(({ stage, id }) => {
      const get = IDBObjectStore.prototype.get
      IDBObjectStore.prototype.get = function(key) {
        const matches = stage === 'read' ? key === 'ai-community-next:studio-entry:' + id : String(key).startsWith('ai-community-next:studio-entry:start:')
        const request = get.call(this, key)
        if (!matches) return request
        IDBObjectStore.prototype.get = get
        const target = stage === 'read' ? request : this.transaction
        const property = stage === 'read' ? 'onsuccess' : 'oncomplete'
        const prototype = stage === 'read' ? IDBRequest.prototype : IDBTransaction.prototype
        const descriptor = Object.getOwnPropertyDescriptor(prototype, property)!
        Object.defineProperty(target, property, { configurable: true, set(callback) {
          descriptor.set!.call(target, (event: Event) => {
            window.releaseEntryRead = () => callback.call(target, event)
            window.entryReadHeld = true
          })
        } })
        return request
      }
    }, { stage, id })
    await page.goto('/create/image?entry=' + id)
    await expect.poll(() => page.evaluate(() => window.entryReadHeld === true)).toBe(true)
    if (change === 'account') { account.state.user.id = '18'; account.state.user.accountId = '18' }
    await page.evaluate(async change => {
      const resources = performance.getEntriesByType('resource').map(entry => entry.name)
      if (change === 'account') {
        const { session } = await import(resources.filter(name => /\/src\/state\.ts(?:\?|$)/.test(name)).at(-1)!)
        session.user = { ...session.user, id: '18', accountId: '18' }
      } else {
        const { router } = await import(resources.filter(name => /\/src\/router\.ts(?:\?|$)/.test(name)).at(-1)!)
        await router.push('/community')
      }
    }, change)
    const retainedUrl = page.url()
    await page.evaluate(async () => {
      window.releaseEntryRead()
      await new Promise(resolve => setTimeout(resolve, 100))
    })
    expect(page.url()).toBe(retainedUrl)
    expect(calls).toHaveLength(0)
    if (stage === 'read') {
      expect(await page.evaluate(async id => (await (await import('/src/studio-entry.ts')).readStudioEntry(id, '17')).prompt, id)).toBe(payload.prompt)
    }
  })
}
