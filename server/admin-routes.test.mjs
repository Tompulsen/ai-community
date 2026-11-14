import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createApplication } from './runtime.ts'

test('new admin routes are registered and deny anonymous access before database reads', async t => {
  const origin = 'https://community.example'
  const app = createApplication({
    db: { query() { assert.fail('Admin access must be denied before a query') } }, redis: {},
    config: { url: origin }, filesRoot: path.resolve('files'),
  })
  t.after(() => app.close())
  for (const [method, url, payload] of [
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/roles'],
    ['PATCH', '/api/admin/announcements/news1', { title: 'Title', text: 'Body', isActive: true, version: 'old' }],
    ['PATCH', '/api/admin/users/42/roles', { roleIds: [], version: 'old' }],
  ]) {
    const response = await app.inject({
      method, url, ...(payload ? { headers: { origin, 'content-type': 'application/json' }, payload } : {}),
    })
    assert.equal(response.statusCode, 401, `${method} ${url}`)
  }
})
