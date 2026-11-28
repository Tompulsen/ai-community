import assert from 'node:assert/strict'
import test from 'node:test'
import { acquireOriginalTransfer } from './original-transfer-slots.ts'

const signal = new AbortController().signal

test('200 accounts start immediately and each released slot admits exactly one transfer', { timeout: 5000 }, async () => {
  const active = await Promise.all(Array.from({ length: 200 }, (_, i) => acquireOriginalTransfer(String(i), signal)))
  let started = 0
  const extra = ['a', 'b'].map(id => acquireOriginalTransfer(id, signal).then(release => { started++; return release }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, 0)
  active[0]()
  active[0]()
  const first = await extra[0]
  assert.equal(started, 1)
  first()
  const second = await extra[1]
  second()
  for (const release of active) release()
})

test('a bulk account borrows idle slots; queued first images take priority and cancelled requests free their place', { timeout: 5000 }, async () => {
  const active = await Promise.all(Array.from({ length: 200 }, () => acquireOriginalTransfer('bulk', signal)))
  const order = []
  const wait = (id, name, abort = signal) => acquireOriginalTransfer(id, abort).then(release => { order.push(name); return release })
  const overflow = Array.from({ length: 14 }, (_, i) => wait('bulk', 'bulk-' + i))
  await assert.rejects(acquireOriginalTransfer('bulk', signal), { statusCode: 503 })
  const controller = new AbortController()
  const cancelled = wait('new-A', 'cancelled', controller.signal)
  const first = wait('new-A', 'A1')
  const next = wait('new-A', 'A2')
  const other = wait('new-B', 'B1')
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  active[0]()
  const a1 = await first
  active[1]()
  const b1 = await other
  active[2]()
  const a2 = await next
  assert.deepEqual(order, ['A1', 'B1', 'A2'])
  for (const release of [a1, b1, a2, ...active]) release()
  for (const release of await Promise.all(overflow)) release()
  assert.deepEqual(order.slice(3), Array.from({ length: 14 }, (_, i) => 'bulk-' + i))
})
