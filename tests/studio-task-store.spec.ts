import { expect, test, type Page } from '@playwright/test'

test('multi-output gallery metadata preserves original indexes, cached bytes and neighboring task previews', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'three',
      urls: ['https://media.example/0.jpg', 'https://media.example/1.jpg', 'https://media.example/2.jpg'], galleryHiddenIndices: [] as number[] }
    const neighbor = { ...task, id: 'one-other', createdAt: 2, urls: ['https://media.example/other.jpg'], galleryHidden: true }
    await store.saveTaskSnapshot('17', [task, neighbor])
    for (const index of [0, 1, 2]) await store.saveTaskPreview('17', task.id, JSON.stringify(['image', task.urls[index]]), new Blob(['thumbnail'], { type: 'image/webp' }), undefined, index)
    await store.saveTaskPreview('17', neighbor.id, JSON.stringify(['image', neighbor.urls[0]]), new Blob(['neighbor'], { type: 'image/webp' }))
    task.galleryHiddenIndices = [1]
    await store.saveTaskSnapshot('17', [task, neighbor])
    const page = await store.getTaskPage('17', { gallery: true })
    const indexes = store.galleryOutputIndexes(page.tasks[0])
    const retained = await store.readTaskPreview('17', task.id, JSON.stringify(['image', task.urls[1]]), 1)
    const bytes = await store.getTaskStorageSize('17'), foreignBytes = await store.getTaskStorageSize('18')
    task.urls[1] = 'https://media.example/changed.jpg'
    await store.saveTaskSnapshot('17', [task, neighbor])
    const old = await store.readTaskPreview('17', task.id, JSON.stringify(['image', task.urls[2]]), 2)
    const neighborPreview = await store.readTaskPreview('17', neighbor.id, JSON.stringify(['image', neighbor.urls[0]]))
    return { total: page.total, mediaCount: page.mediaCount, indexes, retained: await retained?.blob.text(),
      bytes, foreignBytes, cleared: old === undefined, neighbor: await neighborPreview?.blob.text() }
  })
  expect(result).toEqual({ total: 1, mediaCount: 2, indexes: [0, 2], retained: 'thumbnail', bytes: 35, foreignBytes: 0, cleared: true, neighbor: 'neighbor' })
})

async function fixture(page: Page) {
  await page.route('**/__task-store-check', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><title>Storage fixture</title></head><body></body></html>',
  }))
  await page.goto('/__task-store-check')
}

test('originals commit with task pointers and survive concurrent per-output snapshots and deleted tasks', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'atomic', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model',
      prompt: 'original', urls: ['https://media.example/0.png', 'https://media.example/1.png'] }
    await store.saveTaskSnapshot('17', [task])
    const original = new Blob(['original bytes'], { type: 'image/png' })
    await store.saveTaskOriginal('17', task.id, 0, task.urls[0], original)
    const committed = (await store.getTaskPage('17')).tasks[0]
    await store.saveTaskOriginal('17', task.id, 1, task.urls[1], original)
    task.urls[0] = store.taskAssetUrl(task.id, 0)
    task.prompt = 'metadata changed while saving'
    await store.saveTaskSnapshot('17', [task])
    const merged = (await store.getTaskPage('17')).tasks[0]
    const bytes = await store.readTaskAsset('17', merged.urls[1])
    const foreign = await store.readTaskAsset('18', merged.urls[1])
    await store.deleteTaskRecords('17', [task.id])
    const late = await store.saveTaskOriginal('17', task.id, 1, task.urls[1], original)
    await store.saveTaskSnapshot('17', [task])
    return { committed: committed.urls[0], merged: merged.urls, prompt: merged.prompt, bytes: await bytes?.text(),
      foreign: foreign === undefined, late: late === undefined, count: (await store.getTaskPage('17')).total }
  })
  expect(result).toEqual({ committed: 'studio-asset:atomic:0', merged: ['studio-asset:atomic:0', 'studio-asset:atomic:1'],
    prompt: 'metadata changed while saving', bytes: 'original bytes', foreign: true, late: true, count: 0 })
})

test('an aborted original transaction rolls back both bytes and the task pointer', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'rollback', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'rollback', urls: ['https://media.example/original.png'] }
    await store.saveTaskSnapshot('17', [task])
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(put, this, args)
      if (this.name === 'tasks') request.addEventListener('success', () => this.transaction.abort())
      return request
    }
    let rejected = false
    try { await store.saveTaskOriginal('17', task.id, 0, task.urls[0], new Blob(['original'], { type: 'image/png' })) }
    catch { rejected = true }
    finally { IDBObjectStore.prototype.put = put }
    return { rejected, urls: (await store.getTaskPage('17')).tasks[0].urls,
      missing: !await store.readTaskAsset('17', store.taskAssetUrl(task.id, 0)), bytes: await store.getTaskStorageSize('17') }
  })
  expect(result).toEqual({ rejected: true, urls: ['https://media.example/original.png'], missing: true, bytes: 0 })
})

test('identical original bytes share storage within an account while preserving MIME, references and repair', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'first', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'same', urls: ['https://media.example/first.png'] }
    const second = { ...task, id: 'second', createdAt: 2, urls: ['https://media.example/second.webp'] }
    await store.saveTaskSnapshot('17', [task, second])
    const blob = new Blob(['same bytes'], { type: 'image/png' })
    const firstUrl = await store.saveTaskOriginal('17', task.id, 0, task.urls[0], blob)
    const secondUrl = await store.saveTaskOriginal('17', second.id, 0, second.urls[0], blob.slice(0, blob.size, 'image/webp'))
    const first = await store.readTaskAsset('17', firstUrl), other = await store.readTaskAsset('17', secondUrl)
    const uniqueBytes = await store.getTaskStorageSize('17')
    await store.saveTaskSnapshot('18', [{ ...task, owner: '18' }])
    await store.saveTaskOriginal('18', task.id, 0, task.urls[0], blob)
    const foreign = await store.readTaskAsset('19', firstUrl)
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('community-studio-media'); r.onsuccess = () => resolve(r.result) })
    const contentCount = await new Promise<number>(resolve => { const r = db.transaction('contents').objectStore('contents').count(); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>(resolve => {
      const tx = db.transaction('contents', 'readwrite'), request = tx.objectStore('contents').openCursor()
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.owner === '17') cursor.delete(); cursor.continue() } }
      tx.oncomplete = () => resolve()
    })
    const missing = !await store.readTaskAsset('17', secondUrl)
    await store.saveTaskOriginal('17', second.id, 0, secondUrl, blob.slice(0, blob.size, 'image/webp'))
    await store.deleteTaskRecords('17', [task.id])
    const repaired = await store.readTaskAsset('17', secondUrl), retained = await store.readTaskAsset('17', firstUrl)
    db.close()
    return { urls: [firstUrl, secondUrl], types: [first?.type, other?.type], texts: [await first?.text(), await other?.text()],
      uniqueBytes, otherBytes: await store.getTaskStorageSize('18'), foreign: !foreign, contentCount, missing, repaired: await repaired?.text(), retained: await retained?.text() }
  })
  expect(result).toEqual({ urls: ['studio-asset:first:0', 'studio-asset:second:0'], types: ['image/png', 'image/webp'], texts: ['same bytes', 'same bytes'],
    uniqueBytes: 10, otherBytes: 10, foreign: true, contentCount: 2, missing: true, repaired: 'same bytes', retained: 'same bytes' })
})

test('concurrent tabs save identical originals as one content blob', async ({ page, context }) => {
  await fixture(page)
  const other = await context.newPage()
  await fixture(other)
  const save = (page: Page, id: string) => page.evaluate(async id => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id, owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: id, urls: ['https://media.example/shared.png'] }
    await store.saveTaskSnapshot('17', [task])
    return store.saveTaskOriginal('17', id, 0, task.urls[0], new Blob(['shared'], { type: 'image/png' }))
  }, id)
  expect(await Promise.all([save(page, 'tab-one'), save(other, 'tab-two')])).toEqual(['studio-asset:tab-one:0', 'studio-asset:tab-two:0'])
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    return { bytes: await store.getTaskStorageSize('17'), total: (await store.getTaskPage('17')).total,
      originals: await Promise.all(['tab-one', 'tab-two'].map(async id => (await store.readTaskAsset('17', store.taskAssetUrl(id, 0)))?.text())) }
  })
  expect(result).toEqual({ bytes: 6, total: 2, originals: ['shared', 'shared'] })
})

test('v1 upgrade preserves legacy originals, previews and tasks alongside deduplicated new writes', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio-media', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('tasks', { keyPath: ['owner', 'id'] }).createIndex('ownerCreatedAtId', ['owner', 'createdAt', 'id'])
        db.createObjectStore('originals', { keyPath: ['owner', 'key'] }).createIndex('ownerTask', ['owner', 'taskId'])
        db.createObjectStore('previews', { keyPath: ['owner', 'id'] })
        db.createObjectStore('meta', { keyPath: 'owner' })
      }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const task = { id: 'legacy', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'old', urls: ['studio-asset:legacy:0'] }
    await new Promise<void>(resolve => {
      const tx = db.transaction(['tasks', 'originals', 'previews', 'meta'], 'readwrite')
      tx.objectStore('tasks').put({ owner: '17', id: task.id, createdAt: 1, value: task, mediaIdentity: '' })
      tx.objectStore('originals').put({ owner: '17', key: 'legacy:0', taskId: task.id, identity: 'legacy-hash', blob: new Blob(['legacy'], { type: 'image/png' }) })
      tx.objectStore('previews').put({ owner: '17', id: task.id, identity: JSON.stringify(['image', task.urls[0]]), blob: new Blob(['thumb'], { type: 'image/webp' }) })
      tx.objectStore('meta').put({ owner: '17', initialized: true })
      tx.oncomplete = () => resolve()
    })
    db.close()
    const store = await import('/src/studio-task-store.ts'), old = await store.readTaskSnapshot('17')
    const inline = `data:image/png;base64,${btoa('new')}`
    await store.saveTaskSnapshot('17', [...old, { ...task, id: 'new', createdAt: 2, urls: [inline, inline] }])
    return { ids: (await store.readTaskSnapshot('17')).map(task => task.id), original: await (await store.readTaskAsset('17', task.urls[0]))?.text(),
      preview: await (await store.readTaskAsset('17', task.urls[0], true))?.text(), fresh: await (await store.readTaskAsset('17', 'studio-asset:new:1'))?.text(),
      bytes: await store.getTaskStorageSize('17') }
  })
  expect(result).toEqual({ ids: ['new', 'legacy'], original: 'legacy', preview: 'thumb', fresh: 'new', bytes: 14 })
})

test('loading a foreign-tab task cannot expand an already captured snapshot deletion scope', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'known', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'known', urls: ['https://media.example/known.png'] }
    await store.saveTaskSnapshot('17', [task])
    const captured = store.captureTaskSnapshot('17', [task])
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('community-studio-media'); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>(resolve => {
      const tx = db.transaction('tasks', 'readwrite')
      tx.objectStore('tasks').put({ owner: '17', id: 'foreign', createdAt: 2, mediaIdentity: '', value: { ...task, id: 'foreign', createdAt: 2 } })
      tx.oncomplete = () => resolve()
    })
    const loaded = await store.readTaskForUpdate('17', 'foreign')
    await store.saveCapturedTaskSnapshot('17', captured)
    const retained = (await store.getTaskPage('17')).tasks.map(task => task.id)
    await new Promise<void>(resolve => {
      const tx = db.transaction('tasks', 'readwrite'); tx.objectStore('tasks').delete(['17', 'foreign']); tx.oncomplete = () => resolve()
    })
    await store.saveTaskSnapshot('17', [task, loaded])
    db.close()
    return { retained, remaining: (await store.getTaskPage('17')).tasks.map(task => task.id) }
  })
  expect(result).toEqual({ retained: ['foreign', 'known'], remaining: ['known'] })
})

test('media snapshot migration preserves unknown metadata, original bytes and owner isolation without mutating input', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const image = `data:${'image/png'};base64,${btoa('original bytes')}`
    const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'image-model',
      prompt: 'original prompt', urls: [image], preview: image, request: { seed: '42' }, references: [{ name: 'reference', url: image }],
      publications: { community: { work: { id: 'work', original: image } } }, opaqueFutureField: { keep: [1, 2, 3] } }
    const missing = await store.readTaskSnapshot('17')
    await store.saveTaskSnapshot('17', [task])
    const saved = await store.readTaskSnapshot('17')
    const original = await store.readTaskAsset('17', saved[0].urls[0])
    const preview = await store.readTaskAsset('17', saved[0].preview)
    const foreign = await store.readTaskAsset('18', saved[0].urls[0])
    const other = await store.readTaskSnapshot('18')
    return { missing: missing === undefined, saved, original: await original?.text(), preview: await preview?.text(),
      foreign: foreign === undefined, other: other === undefined, unchanged: task.urls[0] === image && task.preview === image }
  })
  expect(result.missing).toBe(true)
  expect(result.saved[0]).toMatchObject({ prompt: 'original prompt', urls: ['studio-asset:one:0'], preview: 'studio-asset:one:preview',
    request: { seed: '42' }, opaqueFutureField: { keep: [1, 2, 3] } })
  expect(result.saved[0].references[0].url.startsWith('data:')).toBe(true)
  expect(result.saved[0].publications.community.work.original.startsWith('data:')).toBe(true)
  expect(result.original).toBe('original bytes')
  expect(result.preview).toBe('original bytes')
  expect(result.foreign && result.other && result.unchanged).toBe(true)
})

test('database cursor pages tie timestamps exactly and apply gallery, model, query and date filters', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const tasks = Array.from({ length: 135 }, (_, index) => ({
      id: `task-${String(index).padStart(3, '0')}`, owner: '17', kind: index === 0 ? 'text' : 'image',
      createdAt: 100 + Math.floor(index / 3), phase: index === 1 ? 'error' : 'complete',
      model: index % 2 ? 'model-a' : 'model-b', prompt: index % 3 ? '猫' : '狗',
      urls: [`https://media.example/${index}.png`],
    }))
    await store.saveTaskSnapshot('17', tasks)
    const first = await store.getTaskPage('17', { gallery: true, limit: 60 })
    const ranges = [], openCursor = IDBIndex.prototype.openCursor
    IDBIndex.prototype.openCursor = function (query, direction) {
      if (this.name === 'ownerCreatedAtId' && query instanceof IDBKeyRange) ranges.push({ upper: query.upper, upperOpen: query.upperOpen })
      return Reflect.apply(openCursor, this, [query, direction])
    }
    let second
    try { second = await store.getTaskPage('17', { gallery: true, after: first.after, limit: 60 }) }
    finally { IDBIndex.prototype.openCursor = openCursor }
    const third = await store.getTaskPage('17', { gallery: true, after: second.after, limit: 60 })
    const filtered = await store.getTaskPage('17', { gallery: true, model: 'model-a', query: '猫', since: 130, limit: 200 })
    const unfiltered = await store.getTaskPage('17', { phase: 'error' })
    const foreign = await store.getTaskPage('18')
    return { lengths: [first.tasks.length, second.tasks.length, third.tasks.length], total: first.total,
      ids: [...first.tasks, ...second.tasks, ...third.tasks].map(task => task.id), last: third.after,
      filtered: filtered.tasks.every(task => task.model === 'model-a' && task.createdAt >= 130 && task.prompt === '猫'),
      filteredTotal: filtered.total, models: filtered.models, errors: unfiltered.tasks.map(task => task.id), foreign: foreign.total,
      after: first.after, ranges }
  })
  expect(result.lengths).toEqual([60, 60, 13])
  expect(result.total).toBe(133)
  expect(new Set(result.ids).size).toBe(133)
  expect(result.ids[0]).toBe('task-134')
  expect(result.ids.at(-1)).toBe('task-002')
  expect(result.last).toBeUndefined()
  expect(result.filtered).toBe(true)
  expect(result.filteredTotal).toBeGreaterThan(0)
  expect(result.models).toEqual(['model-a', 'model-b'])
  expect(result.errors).toEqual(['task-001'])
  expect(result.foreign).toBe(0)
  expect(result.ranges).toContainEqual({ upper: ['17', result.after.createdAt, result.after.id], upperOpen: true })
})

test('incremental snapshots preserve another tab additions, clear only known deletions and retain referenced original assets', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const first = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model',
      prompt: 'one', urls: [`data:${'image/png'};base64,${btoa('original')}`] }
    await store.saveTaskSnapshot('17', [first])
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('community-studio-media')
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('tasks', 'readwrite')
      transaction.objectStore('tasks').put({ owner: '17', id: 'another-tab', createdAt: 2, value: {
        ...first, id: 'another-tab', createdAt: 2, prompt: 'another tab', urls: ['https://media.example/new.png'],
      }, mediaIdentity: 'foreign-write' })
      transaction.objectStore('tasks').put({ owner: '17', id: 'one', createdAt: 1, value: {
        ...first, prompt: 'updated by another tab', urls: [store.taskAssetUrl('one', 0)],
      }, mediaIdentity: 'other-tab-update' })
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    await store.saveTaskSnapshot('17', [first])
    const updated = (await store.getTaskPage('17')).tasks.find(task => task.id === 'one')?.prompt
    await store.saveTaskSnapshot('17', [])
    const snapshot = await store.readTaskSnapshot('17')
    const original = await store.readTaskAsset('17', store.taskAssetUrl('one', 0))
    await store.saveTaskSnapshot('17', [])
    const empty = await store.readTaskSnapshot('17')
    let rejected = false
    try { await store.saveTaskSnapshot('17', [{ ...first, owner: '18' }]) } catch { rejected = true }
    const stillEmpty = await store.readTaskSnapshot('17')
    return { ids: snapshot?.map(task => task.id), original: await original?.text(), empty, rejected, stillEmpty, updated }
  })
  expect(result.ids).toEqual(['another-tab'])
  expect(result.original).toBe('original')
  expect(result.updated).toBe('updated by another tab')
  expect(result.empty).toEqual([])
  expect(result.rejected).toBe(true)
  expect(result.stillEmpty).toEqual([])
})

test('thumbnail identity survives inline original archival but rejects stale writers and clears on changed media', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model',
      prompt: 'one', urls: [`data:${'image/png'};base64,${btoa('original')}`] }
    await store.saveTaskSnapshot('17', [task])
    const mediaIdentity = JSON.stringify(['image', store.taskAssetUrl('one', 0)])
    const thumb = new Blob(['thumbnail'], { type: 'image/webp' })
    await store.saveTaskPreview('17', 'one', mediaIdentity, thumb, 3.5)
    const cached = await store.readTaskPreview('17', 'one', mediaIdentity)
    const preview = await store.readTaskAsset('17', store.taskAssetUrl('one', 0), true)
    task.prompt = 'metadata only'
    await store.saveTaskSnapshot('17', [task])
    const retained = await store.readTaskPreview('17', 'one', mediaIdentity)
    task.urls = ['https://media.example/changed.png']
    await store.saveTaskSnapshot('17', [task])
    const cleared = await store.readTaskPreview('17', 'one', mediaIdentity)
    await store.saveTaskPreview('17', 'one', mediaIdentity, thumb)
    const stale = await store.readTaskPreview('17', 'one', mediaIdentity)
    const foreign = await store.readTaskPreview('18', 'one', mediaIdentity)
    return { cached: await cached?.blob.text(), duration: cached?.duration, preview: await preview?.text(),
      retained: !!retained, cleared: !cleared, stale: !stale, foreign: !foreign }
  })
  expect(result).toEqual({ cached: 'thumbnail', duration: 3.5, preview: 'thumbnail', retained: true, cleared: true, stale: true, foreign: true })
})

test('captured metadata updates preserve their call-time snapshot without decoding, hashing or reading and rewriting large original blobs', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const original = 'x'.repeat(2 * 1024 ** 2)
    const task = { id: 'large', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model',
      prompt: 'before', urls: [`data:${'image/png'};base64,${btoa(original)}`] }
    await store.saveTaskSnapshot('17', [task])
    task.prompt = 'captured prompt'
    const captured = store.captureTaskSnapshot('17', [task])
    task.prompt = 'changed after capture'
    const calls = { decode: 0, digest: 0, originalRead: 0, originalWrite: 0 }
    const decode = window.atob, digest = crypto.subtle.digest, get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put
    window.atob = function (...args) { calls.decode++; return Reflect.apply(decode, this, args) }
    crypto.subtle.digest = function (...args) { calls.digest++; return Reflect.apply(digest, this, args) }
    IDBObjectStore.prototype.get = function (...args) { if (this.name === 'originals') calls.originalRead++; return Reflect.apply(get, this, args) }
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'originals') calls.originalWrite++; return Reflect.apply(put, this, args) }
    try { await store.saveCapturedTaskSnapshot('17', captured) }
    finally {
      window.atob = decode; crypto.subtle.digest = digest
      IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.put = put
    }
    const saved = await store.readTaskSnapshot('17')
    const blob = await store.readTaskAsset('17', store.taskAssetUrl('large', 0))
    return { calls, prompt: saved[0].prompt, size: blob?.size }
  })
  expect(result.calls).toEqual({ decode: 0, digest: 0, originalRead: 0, originalWrite: 0 })
  expect(result.prompt).toBe('captured prompt')
  expect(result.size).toBe(2 * 1024 ** 2)
})
