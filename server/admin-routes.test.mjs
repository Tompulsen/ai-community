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
    ['GET', '/api/admin/models'],
    ['PATCH', '/api/admin/models', { items: [], version: 'old' }],
    ['GET', '/api/creation/models?management=1'],
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/roles'],
    ['GET', '/api/admin/users/42'],
    ['GET', '/api/admin/users/42/logins'],
    ['GET', '/api/admin/creation/image-concurrency'],
    ['GET', '/api/admin/users/42/image-concurrency'],
    ['PATCH', '/api/admin/creation/image-concurrency', { defaultLimit: 2, globalLimit: 2, version: 'old' }],
    ['PATCH', '/api/admin/users/42/image-concurrency', { overrideLimit: 1, version: 'old' }],
    ['PATCH', '/api/admin/users/42/note', { moderationNote: 'note', version: 'old' }],
    ['PATCH', '/api/admin/users/42/media', { clear: 'avatar', version: 'old' }],
    ['PATCH', '/api/admin/announcements/news1', { title: 'Title', text: 'Body', isActive: true, version: 'old' }],
    ['PATCH', '/api/admin/users/42/roles', { roleIds: [], version: 'old' }],
  ]) {
    const response = await app.inject({
      method, url, ...(payload ? { headers: { origin, 'content-type': 'application/json' }, payload } : {}),
    })
    assert.equal(response.statusCode, 401, `${method} ${url}`)
  }
})
