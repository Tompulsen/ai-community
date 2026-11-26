import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createImageSubmissionQueue } from './image-submissions.ts'

const rejected = error => error.statusCode === 429 && error.retryAfter === 5 && error.notAccepted === true

test('two blocked submissions bound POST concurrency and prepared requests enter FIFO', async () => {
  const queue = createImageSubmissionQueue({ capacity: 6 }), calls = [], releases = []
  const tickets = ['one', 'two', 'three', 'four'].map(account => queue.reserve(account))
  const work = tickets.map((ticket, index) => (async () => {
    await ticket.enter()
    calls.push(index)
    await new Promise(resolve => { releases[index] = resolve })
    ticket.release()
  })())
  await delay(0)
  assert.deepEqual(calls, [0, 1])
  assert.equal(tickets[0].waited, false)
  assert.equal(tickets[1].waited, false)
  assert.equal(tickets[2].waited, true)
  assert.equal(tickets[3].waited, true)
  releases[1]()
  await delay(0)
  assert.deepEqual(calls, [0, 1, 2])
  releases[0]()
  await delay(0)
  assert.deepEqual(calls, [0, 1, 2, 3])
  releases[2](); releases[3]()
  await Promise.all(work)
})

test('preparing reservations count toward capacity without occupying actual POST slots', async () => {
  const queue = createImageSubmissionQueue({ concurrency: 1, capacity: 3 })
  const preparing = queue.reserve('preparing'), ready = queue.reserve('ready')
  assert.equal(preparing.waited, false)
  await ready.enter()
  assert.equal(ready.waited, false)
  let entered = false
  const waiting = preparing.enter().then(() => { entered = true })
  await delay(0)
  assert.equal(entered, false)
  assert.equal(preparing.waited, true)
  ready.release()
  await waiting
  preparing.release()
})

test('per-account and global backpressure reject before any upstream work', async () => {
  const queue = createImageSubmissionQueue({ capacity: 3, perAccount: 2 })
  const first = queue.reserve('same'), second = queue.reserve('same')
  assert.equal(queue.available('same'), false)
  assert.throws(() => queue.reserve('same'), rejected)
  assert.equal(queue.available('other'), true)
  const other = queue.reserve('other')
  assert.equal(queue.available('third'), false)
  assert.throws(() => queue.reserve('third'), rejected)
  second.release()
  assert.equal(queue.available('same'), true)
  assert.equal(queue.available('third'), true)
  first.release(); other.release()
})

test('a wait timeout settles its promise and releases both capacity and account quota', async () => {
  const queue = createImageSubmissionQueue({ concurrency: 1, capacity: 2, perAccount: 1, waitMs: 15 })
  const active = queue.reserve('active'), waiting = queue.reserve('waiting')
  await active.enter()
  const timedOut = assert.rejects(waiting.enter(), error => rejected(error) && /超时/.test(error.message))
  await Promise.all([timedOut, delay(30)])
  assert.equal(queue.available('waiting'), true)
  waiting.release(); waiting.release()
  const replacement = queue.reserve('waiting'), pending = replacement.enter()
  active.release()
  await pending
  replacement.release()
})

test('releasing an unentered preparation or queued ticket settles cancellation safely', async () => {
  const queue = createImageSubmissionQueue({ concurrency: 1, capacity: 3, perAccount: 1 })
  const preparing = queue.reserve('preparing')
  preparing.release(); preparing.release()
  assert.equal(queue.available('preparing'), true)
  await assert.rejects(preparing.enter(), rejected)
  const active = queue.reserve('active'), cancelled = queue.reserve('cancelled'), next = queue.reserve('next')
  await active.enter()
  const removed = assert.rejects(cancelled.enter(), rejected)
  let entered = false
  const pending = next.enter().then(() => { entered = true })
  cancelled.release(); cancelled.release()
  await removed
  assert.equal(entered, false)
  active.release()
  await pending
  next.release()
})

test('repeated enter returns the same promise and repeated release never frees another slot', async () => {
  const queue = createImageSubmissionQueue({ concurrency: 1, capacity: 3 })
  const first = queue.reserve('one'), second = queue.reserve('two'), third = queue.reserve('three')
  const original = first.enter()
  assert.strictEqual(first.enter(), original)
  await original
  const calls = []
  const pendingSecond = second.enter().then(() => { calls.push('two') })
  const pendingThird = third.enter().then(() => { calls.push('three') })
  first.release(); first.release()
  await pendingSecond
  await delay(0)
  assert.deepEqual(calls, ['two'])
  second.release()
  await pendingThird
  assert.deepEqual(calls, ['two', 'three'])
  third.release()
})

test('queue configuration rejects invalid or unbounded limits', () => {
  for (const options of [{ concurrency: 0 }, { capacity: -1 }, { perAccount: 1.5 }, { waitMs: Infinity }])
    assert.throws(() => createImageSubmissionQueue(options), /Invalid/)
})
