import { expect, test, type Page } from '@playwright/test'
import type { CreationTask } from '../src/native-studio'

const owner = 'isolated-media-owner'
const makeTask = (id: string, urls = ['https://media.example/temporary.jpg']): CreationTask => ({
  id, owner, kind: 'image', createdAt: 1, phase: 'complete', model: 'model', prompt: 'original prompt',
  urls, text: '', protocol: 'sync', references: [],
  request: { size: '1024x1024', aspect_ratio: '1:1', n: urls.length, duration: 8 },
})

async function otherTab(page: Page) {
  await page.context().route('**/__task-concurrency-check', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Isolated task concurrency check</title>',
  }))
  await page.context().route('**/api/**', route => route.abort())
  const other = await page.context().newPage()
  await page.goto('/__task-concurrency-check')
  await other.goto('/__task-concurrency-check')
  return other
}

test('metadata writes from a stale tab retain cached originals and explicit media edits retain unrelated metadata', async ({ page }) => {
  const other = await otherTab(page), task = makeTask('cached-original')
  await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(task.owner, [task])
  }, task)
  const stale = await other.evaluate(async owner => {
    const store = await import('/src/studio-task-store.ts')
    return (await store.readTaskSnapshot(owner))![0]!
  }, owner)
  const local = await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    const source = await store.saveTaskOriginal(task.owner, task.id, 0, task.urls[0]!, new Blob(['original bytes'], { type: 'image/jpeg' }))
    task.urls[0] = source!
    await store.saveTaskSnapshot(task.owner, [task])
    await store.saveTaskPreview(task.owner, task.id, JSON.stringify(['image', source]), new Blob(['thumbnail'], { type: 'image/webp' }))
    return task
  }, task)
  stale.galleryHiddenIndices = [0]
  stale.prompt = 'metadata changed in the other tab'
  const retained = await other.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(task.owner, [task])
    const saved = (await store.getTaskPage(task.owner)).tasks[0]!
    const preview = await store.readTaskPreview(task.owner, task.id, JSON.stringify(['image', saved.urls[0]]))
    return { task: saved, original: await (await store.readTaskAsset(task.owner, saved.urls[0]!))?.text(), preview: await preview?.blob.text() }
  }, stale)
  expect(retained.task.urls).toEqual(['studio-asset:cached-original:0'])
  expect(retained.task.galleryHiddenIndices).toEqual([0])
  expect(retained.original).toBe('original bytes')
  expect(retained.preview).toBe('thumbnail')

  local.urls = ['https://media.example/explicitly-replaced.jpg']
  const changed = await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(task.owner, [task])
    return { task: (await store.getTaskPage(task.owner)).tasks[0]!,
      preview: !!await store.readTaskPreview(task.owner, task.id, JSON.stringify(['image', store.taskAssetUrl(task.id, 0)])) }
  }, local)
  expect(changed.task.urls).toEqual(local.urls)
  expect(changed.task.prompt).toBe(stale.prompt)
  expect(changed.task.galleryHiddenIndices).toEqual([0])
  expect(changed.preview).toBe(false)
})

test('explicit task deletion reaches unseen records, clears previews and rejects active records atomically', async ({ page }) => {
  const other = await otherTab(page)
  await page.evaluate(async owner => {
    const store = await import('/src/studio-task-store.ts')
    await store.readTaskSnapshot(owner)
  }, owner)
  const removable = makeTask('from-another-tab', [`data:${'image/png'};base64,${Buffer.from('original').toString('base64')}`])
  const neighbor = makeTask('keep-neighbor')
  const stale = await other.evaluate(async tasks => {
    const store = await import('/src/studio-task-store.ts'), owner = tasks[0]!.owner
    await store.saveTaskSnapshot(owner, tasks)
    const saved = (await store.readTaskSnapshot(owner))!
    const task = saved.find(task => task.id === 'from-another-tab')!
    await store.saveTaskPreview(owner, task.id, JSON.stringify(['image', task.urls[0]]), new Blob(['thumbnail'], { type: 'image/webp' }))
    await store.saveTaskSnapshot('another-owner', [{ ...task, owner: 'another-owner', urls: ['https://media.example/foreign.jpg'] }])
    return saved
  }, [removable, neighbor])
  const removed = await page.evaluate(async ({ owner, id }) => {
    const store = await import('/src/studio-task-store.ts')
    const before = (await store.getTaskPage(owner)).tasks.map(task => task.id)
    await store.deleteTaskRecords(owner, [id])
    const preview = await store.readTaskPreview(owner, id, JSON.stringify(['image', store.taskAssetUrl(id, 0)]))
    return { before, after: (await store.getTaskPage(owner)).tasks.map(task => task.id),
      original: await (await store.readTaskAsset(owner, store.taskAssetUrl(id, 0)))?.text(),
      preview: !!preview, foreign: (await store.getTaskPage('another-owner')).tasks.map(task => task.id) }
  }, { owner, id: removable.id })
  expect(removed.before).toEqual(expect.arrayContaining([removable.id, neighbor.id]))
  expect(removed.after).toEqual([neighbor.id])
  expect(removed.original).toBe('original')
  expect(removed.preview).toBe(false)
  expect(removed.foreign).toEqual([removable.id])

  stale.find(task => task.id === removable.id)!.prompt = 'late metadata from the stale tab'
  const afterLateWrite = await other.evaluate(async tasks => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(tasks[0]!.owner, tasks)
    return (await store.getTaskPage(tasks[0]!.owner)).tasks.map(task => task.id)
  }, stale)
  expect(afterLateWrite).toEqual([neighbor.id])
  stale.find(task => task.id === removable.id)!.urls = ['https://media.example/late-media-change.jpg']
  const afterLateMedia = await other.evaluate(async tasks => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(tasks[0]!.owner, tasks)
    return (await store.getTaskPage(tasks[0]!.owner)).tasks.map(task => task.id)
  }, stale)
  expect(afterLateMedia).toEqual([neighbor.id])

  for (const phase of ['submitting', 'running', 'paused', 'attention'] as const) {
    const active = { ...makeTask('active-in-another-tab'), phase }
    await other.evaluate(async tasks => {
      const store = await import('/src/studio-task-store.ts')
      await store.saveTaskSnapshot(tasks[0]!.owner, tasks)
    }, [neighbor, active])
    const protectedBatch = await page.evaluate(async ({ owner, ids }) => {
      const store = await import('/src/studio-task-store.ts')
      let message = ''
      try { await store.deleteTaskRecords(owner, ids) } catch (error) { message = (error as Error).message }
      return { message, ids: (await store.getTaskPage(owner)).tasks.map(task => task.id) }
    }, { owner, ids: [neighbor.id, active.id] })
    expect(protectedBatch.message).toContain('进行中或需要核对')
    expect(protectedBatch.ids).toEqual(expect.arrayContaining([neighbor.id, active.id]))
  }
})

test('a snapshot captured before deletion cannot restore the task when it runs later in the same tab', async ({ page }) => {
  await otherTab(page)
  const result = await page.evaluate(async task => {
    const store = await import('/src/studio-task-store.ts')
    await store.saveTaskSnapshot(task.owner, [task])
    task.prompt = 'captured before deletion completed'
    const captured = store.captureTaskSnapshot(task.owner, [task])
    await Promise.all([
      store.deleteTaskRecords(task.owner, [task.id]),
      store.saveCapturedTaskSnapshot(task.owner, captured),
    ])
    const afterQueuedWrite = (await store.getTaskPage(task.owner)).tasks.map(task => task.id)
    await store.readTaskSnapshot(task.owner)
    await store.saveCapturedTaskSnapshot(task.owner, captured)
    return { afterQueuedWrite, afterReread: (await store.getTaskPage(task.owner)).tasks.map(task => task.id) }
  }, makeTask('queued-before-delete'))
  expect(result).toEqual({ afterQueuedWrite: [], afterReread: [] })
})
