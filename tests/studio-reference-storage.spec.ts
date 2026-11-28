import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const requests: any[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/generate') {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', protocol: 'sync', outputs: [{ url: 'data:image/jpeg;base64,' + image.toString('base64') }] } })
    }
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.route('**/__storage-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local storage regression</title>' }))
  await page.goto('/__storage-test')
  await page.evaluate(async base64 => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot('17', [])
    ;(window as any).reference = 'data:image/jpeg;base64,' + base64
    ;(window as any).task = (id: string) => ({ id, owner: '17', kind: 'image', model: 'gpt-image-2', prompt: id, createdAt: Date.now(),
      phase: 'complete', protocol: 'sync', urls: [], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 } })
    ;(window as any).db = () => new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('community-studio-media', 2)
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
    })
    ;(window as any).seed = async (tasks: any[]) => {
      const db = await (window as any).db(), tx = db.transaction('tasks', 'readwrite')
      for (const task of tasks) tx.objectStore('tasks').put({ owner: task.owner, id: task.id, createdAt: task.createdAt, value: task, mediaIdentity: '' })
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
      db.close()
    }
  }, image.toString('base64'))
  return { image, requests }
}

test('legacy inline outputs, previews and repeated references migrate atomically without changing original bytes', async ({ page }) => {
  const { image } = await fixture(page)
  const result = await page.evaluate(async () => {
    const w = window as any, store = await import('/src/studio-task-store.ts')
    const tasks = Array.from({ length: 24 }, (_, i) => ({ ...w.task(`legacy-${i}`), urls: [w.reference], preview: w.reference,
      references: [{ name: 'original.jpg', url: w.reference }] }))
    delete tasks[0]!.references
    await w.seed(tasks)
    const migrated = (await store.readTaskSnapshot('17'))!
    const original = (await store.readTaskAsset('17', migrated[1]!.references[0]!.url))!
    const db = await w.db(), tx = db.transaction('contents'), count = tx.objectStore('contents').count()
    const contents = await new Promise<number>(resolve => { count.onsuccess = () => resolve(count.result) })
    db.close()
    return { tasks: migrated.length, inline: JSON.stringify(migrated).includes('data:image/'),
      references: new Set(migrated.flatMap(task => task.references || []).map(file => file.url)).size, contents,
      bytes: Array.from(new Uint8Array(await original.arrayBuffer())) }
  })
  expect(result).toMatchObject({ tasks: 24, inline: false, references: 1, contents: 1 })
  expect(Buffer.from(result.bytes)).toEqual(image)
})

test('interrupted migration retains raw history and retries successfully', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const w = window as any, store = await import('/src/studio-task-store.ts')
    const task = { ...w.task('quota-history'), urls: [w.reference], references: [{ name: 'original', url: w.reference }] }
    await w.seed([task])
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(put, this, args)
      if (this.name === 'contents') this.transaction.abort()
      return request
    }
    let failed = false
    try { await store.readTaskSnapshot('17') } catch { failed = true } finally { IDBObjectStore.prototype.put = put }
    const db = await w.db(), request = db.transaction('tasks').objectStore('tasks').get(['17', task.id])
    const retained = await new Promise<any>(resolve => { request.onsuccess = () => resolve(request.result.value) })
    db.close()
    const retried = (await store.readTaskSnapshot('17'))![0]!
    return { failed, intact: JSON.stringify(retained) === JSON.stringify(task), retried: !JSON.stringify(retried).includes('data:image/') }
  })
  expect(result).toEqual({ failed: true, intact: true, retried: true })
})

for (const action of ['replace', 'delete']) test(`migration respects a concurrent ${action} from another tab`, async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async action => {
    const w = window as any, store = await import('/src/studio-task-store.ts')
    const original = { ...w.task('concurrent'), references: [{ name: 'old', url: w.reference }] }
    await w.seed([original])
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let once = true
    crypto.subtle.digest = async (...args) => {
      if (once) {
        once = false
        if (action === 'replace') await w.seed([{ ...original, prompt: 'newer tab', references: [{ name: 'new', url: '/files/new-reference' }] }])
        else {
          const db = await w.db(), tx = db.transaction('tasks', 'readwrite')
          tx.objectStore('tasks').delete(['17', original.id])
          await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
        }
      }
      return digest(...args)
    }
    try { return await store.readTaskSnapshot('17') } finally { crypto.subtle.digest = digest }
  }, action)
  if (action === 'replace') expect(result).toMatchObject([{ prompt: 'newer tab', references: [{ url: '/files/new-reference' }] }])
  else expect(result).toEqual([])
})

test('partial updates preserve unloaded tasks, other-tab edits, deletions and shared references', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const w = window as any, store = await import('/src/studio-task-store.ts')
    const a = { ...w.task('a'), references: [{ name: 'shared', url: w.reference }] }, b = w.task('b')
    await store.saveTaskSnapshot('17', [a, b])
    const baseline = (await store.readTaskSnapshot('17'))!, first = baseline.find(task => task.id === 'a')!
    const other = await import(/* @vite-ignore */ '/src/studio-task-store.ts?other-tab-storage-test')
    const theirs = (await other.readTaskSnapshot('17'))!.find((task: any) => task.id === 'a')!
    theirs.galleryHidden = true
    await other.saveTaskChanges('17', other.captureTaskSnapshot('17', [theirs]))
    first.prompt = 'local edit'
    await store.saveTaskChanges('17', store.captureTaskSnapshot('17', [first]))
    const merged = await store.readTaskSnapshot('17')
    await other.deleteTaskRecords('17', ['a'])
    first.prompt = 'late edit'
    await store.saveTaskChanges('17', store.captureTaskSnapshot('17', [first]))
    const final = await store.readTaskSnapshot('17')
    return { merged, finalIds: final!.map(task => task.id), sharedBytes: (await store.readTaskAsset('17', first.references[0]!.url))?.size }
  })
  expect(result.merged).toHaveLength(2)
  expect(result.merged!.find(task => task.id === 'a')).toMatchObject({ prompt: 'local edit', galleryHidden: true })
  expect(result.finalIds).toEqual(['b'])
  expect(result.sharedBytes).toBeGreaterThan(0)
})

async function lobby(page: Page) {
  await page.goto('/discover')
  await expect.poll(() => page.evaluate(async () => (await import('/src/native-studio.ts')).creation.loaded)).toBe(true)
}

test('actual submission stores references once, sends original bytes, and reloads without Base64 history', async ({ page }) => {
  const { image, requests } = await fixture(page)
  await lobby(page)
  const result = await page.evaluate(async base64 => {
    const studio = await import('/src/native-studio.ts'), store = await import('/src/studio-task-store.ts')
    await studio.loadCreationModels()
    const blob = new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/jpeg' })
    const reference = await store.saveReferenceImage('17', blob)
    const url = URL.createObjectURL(blob)
    try {
      const task = await studio.submitCreation({ kind: 'image', model: 'gpt-image-2', prompt: 'original bytes', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8,
        references: [{ name: 'existing', url: reference }, { name: 'upload.jpg', url, type: 'image/jpeg' }] })
      await studio.prepareCreationHistory()
      return { id: task.id, phase: task.phase, references: task.references }
    } finally { URL.revokeObjectURL(url) }
  }, image.toString('base64'))
  expect(result.phase).toBe('complete')
  expect(result.references).toHaveLength(1)
  expect(result.references[0]!.url).toMatch(/^studio-asset:reference-/)
  expect(requests).toHaveLength(1)
  expect(requests[0].referenceUrls).toEqual(['data:image/jpeg;base64,' + image.toString('base64')])
  await page.reload()
  await expect.poll(() => page.evaluate(async () => (await import('/src/native-studio.ts')).creation.loaded)).toBe(true)
  expect(await page.evaluate(async id => {
    const task = (await import('/src/native-studio.ts')).creation.tasks.find(task => task.id === id)!
    return { phase: task.phase, references: task.references, inline: JSON.stringify(task).includes('data:image/') }
  }, result.id)).toEqual({ phase: 'complete', references: result.references, inline: false })
})

test('reference storage failure prevents a generation POST', async ({ page }) => {
  const { image, requests } = await fixture(page)
  await lobby(page)
  const error = await page.evaluate(async base64 => {
    const studio = await import('/src/native-studio.ts')
    await studio.loadCreationModels()
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(put, this, args)
      if (this.name === 'contents') this.transaction.abort()
      return request
    }
    try {
      await studio.submitCreation({ kind: 'image', model: 'gpt-image-2', prompt: 'must not send', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8,
        references: [{ name: 'reference.jpg', url: 'data:image/jpeg;base64,' + base64 }] })
      return ''
    } catch (cause) { return String(cause) } finally { IDBObjectStore.prototype.put = put }
  }, image.toString('base64'))
  expect(error).not.toBe('')
  expect(requests).toHaveLength(0)
})

test('required task storage failure prevents a generation without references', async ({ page }) => {
  const { requests } = await fixture(page)
  await lobby(page)
  const error = await page.evaluate(async () => {
    const studio = await import('/src/native-studio.ts')
    await studio.loadCreationModels()
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(put, this, args)
      if (this.name === 'tasks') this.transaction.abort()
      return request
    }
    try {
      await studio.submitCreation({ kind: 'image', model: 'gpt-image-2', prompt: 'must not send', size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8, references: [] })
      return ''
    } catch (cause) { return String(cause) } finally { IDBObjectStore.prototype.put = put }
  })
  expect(error).toContain('无法可靠保存任务')
  expect(requests).toHaveLength(0)
})

test('simultaneous changes persist both tasks without rewriting untouched history', async ({ page }) => {
  await fixture(page)
  await page.evaluate(async () => {
    const w = window as any, store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot('17', ['a', 'b', 'untouched'].map(id => ({ ...w.task(id), urls: ['/files/' + id] })))
  })
  await lobby(page)
  const result = await page.evaluate(async () => {
    const studio = await import('/src/native-studio.ts'), store = await import('/src/studio-task-store.ts')
    const put = IDBObjectStore.prototype.put, written: string[] = []
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'tasks') written.push(args[0].id)
      return Reflect.apply(put, this, args)
    }
    try {
      await Promise.all(['a', 'b'].map(id => studio.hideGalleryOutputs([{ task: studio.creation.tasks.find(task => task.id === id)!, index: 0 }])))
      return { written, saved: (await store.readTaskSnapshot('17'))!.map(task => ({ id: task.id, hidden: task.galleryHiddenIndices || [] })) }
    } finally { IDBObjectStore.prototype.put = put }
  })
  expect(result.written).toEqual(expect.arrayContaining(['a', 'b']))
  expect(result.written).not.toContain('untouched')
  expect(result.saved).toEqual(expect.arrayContaining([{ id: 'a', hidden: [0] }, { id: 'b', hidden: [0] }, { id: 'untouched', hidden: [] }]))
})

test('optional display encoding failure preserves original bytes without another download', async ({ page }) => {
  const { image } = await fixture(page)
  let reads = 0
  await page.route('**/api/creation/media**', route => { reads++; return route.fulfill({ contentType: 'image/jpeg', body: image }) })
  await lobby(page)
  const bytes = await page.evaluate(async () => {
    const studio = await import('/src/native-studio.ts'), toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = callback => callback(null)
    try {
      const blob = await studio.readCreationImage('https://media.example/preview-failure.jpg', undefined, 'display')
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    } finally { HTMLCanvasElement.prototype.toBlob = toBlob }
  })
  expect(Buffer.from(bytes)).toEqual(image)
  expect(reads).toBe(1)
})

test('cancelling during PNG header reading never starts image decoding', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const { imageThumbnail } = await import('/src/studio-media-previews.ts')
    const controller = new AbortController(), NativeImage = window.Image
    let created = 0, name = ''
    window.Image = class extends NativeImage { constructor() { super(); created++ } }
    const blob = new Blob([new Uint8Array(16)], { type: 'image/png' })
    blob.slice = () => ({ arrayBuffer: async () => {
      controller.abort()
      const header = new Uint8Array(16); header.set([73, 68, 65, 84], 12)
      return header.buffer
    } }) as Blob
    try { await imageThumbnail(blob, controller.signal, 960) }
    catch (cause) { name = (cause as Error).name }
    finally { window.Image = NativeImage }
    return { created, name }
  })
  expect(result).toEqual({ created: 0, name: 'AbortError' })
})
