import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.route('**/__gallery-performance', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Gallery performance fixture</title>',
  }))
  await page.goto('/__gallery-performance')
}

test('repeated cursor pages reuse task summaries and cached storage sizes', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const tasks = Array.from({ length: 360 }, (_, index) => ({
      id: `record-${String(index).padStart(3, '0')}`, owner: '17', kind: 'image', createdAt: index,
      phase: 'complete', model: index % 2 ? 'model-a' : 'model-b', prompt: `record ${index}`,
      urls: [`https://media.example/${index}.png`],
    }))
    await store.saveTaskSnapshot('17', tasks)
    for (const task of tasks.slice(0, 12)) {
      await store.saveTaskOriginal('17', task.id, 0, task.urls[0], new Blob(['original'], { type: 'image/png' }))
      await store.saveTaskPreview('17', task.id, JSON.stringify(['image', store.taskAssetUrl(task.id, 0)]), new Blob(['preview'], { type: 'image/webp' }))
    }
    const visits = { tasks: 0, assets: 0 }, indexOpen = IDBIndex.prototype.openCursor, storeOpen = IDBObjectStore.prototype.openCursor
    IDBIndex.prototype.openCursor = function (...args) {
      const request = Reflect.apply(indexOpen, this, args)
      if (this.name === 'ownerCreatedAtId') request.addEventListener('success', () => { if (request.result) visits.tasks++ })
      return request
    }
    IDBObjectStore.prototype.openCursor = function (...args) {
      const request = Reflect.apply(storeOpen, this, args)
      if (['originals', 'previews'].includes(this.name)) request.addEventListener('success', () => { if (request.result) visits.assets++ })
      return request
    }
    try {
      const first = await store.getTaskPage('17', { gallery: true, limit: 60 })
      const firstBytes = await store.getTaskStorageSize('17')
      const second = await store.getTaskPage('17', { gallery: true, limit: 60, after: first.after })
      const secondBytes = await store.getTaskStorageSize('17')
      return { visits, totals: [first.total, second.total], lengths: [first.tasks.length, second.tasks.length], firstBytes, secondBytes }
    } finally {
      IDBIndex.prototype.openCursor = indexOpen
      IDBObjectStore.prototype.openCursor = storeOpen
    }
  })
  expect(result.totals).toEqual([360, 360])
  expect(result.lengths).toEqual([60, 60])
  expect(result.firstBytes).toBe(180)
  expect(result.secondBytes).toBe(result.firstBytes)
  expect(result.visits).toEqual({ tasks: 482, assets: 24 })
})

test('page-only reads stay bounded and full cursor traversal preserves filtered outputs and complete model choices', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const tasks = Array.from({ length: 365 }, (_, index) => ({
      id: `record-${String(index).padStart(3, '0')}`, owner: '17', kind: 'image', createdAt: Math.floor(index / 3),
      phase: 'complete', model: index % 2 ? 'model-a' : 'model-b', prompt: index % 3 ? 'cat' : 'dog',
      urls: [`https://media.example/${index}.png`, `https://media.example/${index}-2.png`],
      galleryHiddenIndices: index % 5 ? [] : [1],
    }))
    await store.saveTaskSnapshot('17', tasks)
    let visits = 0, assetScans = 0
    const indexOpen = IDBIndex.prototype.openCursor, storeOpen = IDBObjectStore.prototype.openCursor
    IDBIndex.prototype.openCursor = function (...args) {
      const request = Reflect.apply(indexOpen, this, args)
      if (this.name === 'ownerCreatedAtId') request.addEventListener('success', () => { if (request.result) visits++ })
      return request
    }
    IDBObjectStore.prototype.openCursor = function (...args) {
      if (['originals', 'previews'].includes(this.name)) assetScans++
      return Reflect.apply(storeOpen, this, args)
    }
    let first, second, bounded
    try {
      first = await store.getTaskPage('17', { gallery: true, limit: 60, summary: false })
      second = await store.getTaskPage('17', { gallery: true, limit: 60, after: first.after, summary: false })
      bounded = { visits, assetScans }
    } finally { IDBIndex.prototype.openCursor = indexOpen; IDBObjectStore.prototype.openCursor = storeOpen }
    const options = { gallery: true, model: 'model-a', query: 'cat', since: 10 }
    const summary = await store.getTaskSummary('17', options)
    const all = [], indexes = []
    let cursor
    do {
      const page = await store.getTaskPage('17', { ...options, limit: 17, after: cursor, summary: false })
      all.push(...page.tasks)
      indexes.push(...page.tasks.flatMap(task => store.galleryOutputIndexes(task).map(index => `${task.id}:${index}`)))
      cursor = page.after
    } while (cursor)
    return { bounded, first: first.tasks.length, second: second.tasks.length, summary,
      ids: all.map(task => task.id), outputs: indexes.length, expected: tasks.filter(task => task.model === 'model-a' && task.prompt === 'cat' && task.createdAt >= 10).length }
  })
  expect(result.bounded).toEqual({ visits: 122, assetScans: 0 })
  expect([result.first, result.second]).toEqual([60, 60])
  expect(result.ids).toHaveLength(result.expected)
  expect(new Set(result.ids).size).toBe(result.expected)
  expect(result.summary).toMatchObject({ total: result.expected, mediaCount: result.outputs, models: ['model-a', 'model-b'] })
})

test('snapshot edits, hidden outputs, original caches, preview replacement and deletion invalidate cached values', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const one = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model-a', prompt: 'cat',
      urls: ['https://media.example/one.png', 'https://media.example/two.png'], galleryHiddenIndices: [] as number[] }
    const two = { ...one, id: 'two', createdAt: 2, model: 'model-b', urls: ['https://media.example/three.png'] }
    await store.saveTaskSnapshot('17', [one])
    const counts = [(await store.getTaskSummary('17', { gallery: true })).mediaCount]
    const sizes = [await store.getTaskStorageSize('17')]
    await store.saveTaskSnapshot('17', [one, two])
    counts.push((await store.getTaskSummary('17', { gallery: true })).mediaCount)
    await store.saveTaskPreview('17', 'one', JSON.stringify(['image', one.urls[0]]), new Blob(['abc'], { type: 'image/webp' }))
    sizes.push(await store.getTaskStorageSize('17'))
    await store.saveTaskPreview('17', 'one', JSON.stringify(['image', one.urls[0]]), new Blob(['abcde'], { type: 'image/webp' }))
    sizes.push(await store.getTaskStorageSize('17'))
    await store.saveTaskOriginal('17', 'one', 0, one.urls[0], new Blob(['0123456789'], { type: 'image/png' }))
    sizes.push(await store.getTaskStorageSize('17'))
    one.galleryHiddenIndices = [1]
    two.phase = 'error'
    await store.saveTaskSnapshot('17', [one, two])
    const hidden = await store.getTaskSummary('17', { gallery: true })
    counts.push(hidden.mediaCount)
    await store.deleteTaskRecords('17', ['one'])
    sizes.push(await store.getTaskStorageSize('17'))
    counts.push((await store.getTaskSummary('17', { gallery: true })).mediaCount)
    return { counts, sizes, hidden, tasks: (await store.getTaskSummary('17')).total }
  })
  expect(result.counts).toEqual([2, 3, 1, 0])
  expect(result.sizes).toEqual([0, 3, 5, 15, 10])
  expect(result.hidden).toEqual({ total: 1, mediaCount: 1, models: ['model-a'] })
  expect(result.tasks).toBe(1)
})

test('cached statistics stay owner-scoped and observe committed writes from another tab', async ({ page }) => {
  await fixture(page)
  const other = await page.context().newPage()
  await fixture(other)
  const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model-a', prompt: 'cat', urls: ['https://media.example/one.png'] }
  await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot('17', [task])
    await Promise.all([store.getTaskSummary('17'), store.getTaskSummary('18'), store.getTaskStorageSize('17'), store.getTaskStorageSize('18')])
  }, task)
  await other.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot('17', [task, { ...task, id: 'two', model: 'model-b', createdAt: 2 }])
    await store.saveTaskPreview('17', task.id, JSON.stringify(['image', task.urls[0]]), new Blob(['thumbnail'], { type: 'image/webp' }))
    await store.saveTaskSnapshot('18', [{ ...task, owner: '18', model: 'foreign-model' }])
  }, task)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    return { own: await store.getTaskSummary('17'), foreign: await store.getTaskSummary('18'),
      ownBytes: await store.getTaskStorageSize('17'), foreignBytes: await store.getTaskStorageSize('18') }
  })
  expect(result).toEqual({ own: { total: 2, mediaCount: 2, models: ['model-a', 'model-b'] },
    foreign: { total: 1, mediaCount: 1, models: ['foreign-model'] }, ownBytes: 9, foreignBytes: 0 })
})

test('another tab adding a preview only refreshes storage bytes and reuses the task summary', async ({ page }) => {
  await fixture(page)
  const other = await page.context().newPage()
  await fixture(other)
  const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model-a', prompt: 'cat', urls: ['https://media.example/one.png'] }
  await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot('17', [task])
    await Promise.all([store.getTaskSummary('17', { gallery: true }), store.getTaskStorageSize('17')])
    ;(window as any).summaryCursorReads = 0
    const open = IDBIndex.prototype.openCursor
    IDBIndex.prototype.openCursor = function (...args) {
      if (this.name === 'ownerCreatedAtId') (window as any).summaryCursorReads++
      return Reflect.apply(open, this, args)
    }
  }, task)
  await other.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskPreview('17', task.id, JSON.stringify(['image', task.urls[0]]), new Blob(['new-thumbnail'], { type: 'image/webp' }))
  }, task)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    return { summary: await store.getTaskSummary('17', { gallery: true }), bytes: await store.getTaskStorageSize('17'),
      taskCursors: (window as any).summaryCursorReads }
  })
  expect(result).toEqual({ summary: { total: 1, mediaCount: 1, models: ['model-a'] }, bytes: 13, taskCursors: 0 })
})

test('older tabs without revision markers cannot leave subsequent summaries cached', async ({ page }) => {
  await fixture(page)
  const totals = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model-a', prompt: 'cat', urls: ['https://media.example/one.png'] }
    await store.saveTaskSnapshot('17', [task])
    const totals = [(await store.getTaskSummary('17')).total]
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio-media', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      for (const id of ['two', 'three']) {
        const transaction = db.transaction(['tasks', 'meta'], 'readwrite')
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onabort = transaction.onerror = () => reject(transaction.error)
        })
        transaction.objectStore('tasks').put({ owner: '17', id, createdAt: 2,
          value: { ...task, id, createdAt: 2 }, mediaIdentity: JSON.stringify(['image', task.urls]) })
        transaction.objectStore('meta').put({ owner: '17', initialized: true })
        await done
        totals.push((await store.getTaskSummary('17')).total)
      }
      return totals
    } finally { db.close() }
  })
  expect(totals).toEqual([1, 2, 3])
})

test('a late summary or storage read cannot refill caches with an older committed revision', async ({ page }) => {
  await fixture(page)
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = { id: 'one', owner: '17', kind: 'image', createdAt: 1, phase: 'complete', model: 'model-a', prompt: 'cat', urls: ['https://media.example/one.png'] }
    await store.saveTaskSnapshot('17', [task])
    const transaction = IDBDatabase.prototype.transaction, releases: (() => void)[] = []
    let summaryGated = false, sizeGated = false, entered = () => {}
    const waiting = new Promise<void>(resolve => { entered = resolve })
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = Reflect.apply(transaction, this, args)
      const names = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0] as string[])
      if (args[1] !== 'readwrite' && (names.length === 1 && names[0] === 'tasks' && !summaryGated || names.includes('originals') && !sizeGated)) {
        if (names.includes('originals')) sizeGated = true
        else summaryGated = true
        let handler: ((this: IDBTransaction, event: Event) => unknown) | null = null
        Object.defineProperty(tx, 'oncomplete', { get: () => handler, set: value => { handler = value } })
        tx.addEventListener('complete', event => {
          releases.push(() => handler?.call(tx, event))
          if (releases.length === 2) entered()
        })
      }
      return tx
    }
    try {
      const oldSummary = store.getTaskSummary('17'), oldSize = store.getTaskStorageSize('17')
      await waiting
      await store.saveTaskSnapshot('17', [task, { ...task, id: 'two', createdAt: 2, model: 'model-b' }])
      await store.saveTaskPreview('17', task.id, JSON.stringify(['image', task.urls[0]]), new Blob(['new-preview'], { type: 'image/webp' }))
      const fresh = await store.getTaskSummary('17'), bytes = await store.getTaskStorageSize('17')
      for (const release of releases) release()
      const late = await oldSummary, lateBytes = await oldSize
      return { fresh, bytes, late, lateBytes, final: await store.getTaskSummary('17'), finalBytes: await store.getTaskStorageSize('17') }
    } finally {
      IDBDatabase.prototype.transaction = transaction
      for (const release of releases) release()
    }
  })
  expect(result.fresh).toEqual({ total: 2, mediaCount: 2, models: ['model-a', 'model-b'] })
  expect(result.late).toEqual(result.fresh)
  expect(result.final).toEqual(result.fresh)
  expect([result.bytes, result.lateBytes, result.finalBytes]).toEqual([11, 11, 11])
})
