import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { applicationRequest } from './web-request.ts'

test('account adapter replaces forged IP headers with the address from the trusted proxy chain', async t => {
  const app = Fastify({ trustProxy: ['loopback', '172.18.0.1'] })
  t.after(() => app.close())
  app.get('/account', (request, reply) => {
    const adapted = applicationRequest(request, reply, 'https://community.example')
    return { real: adapted.headers.get('x-real-ip'), forwarded: adapted.headers.get('x-forwarded-for') }
  })
  for (const [remoteAddress, forwarded, expected] of [
    ['198.51.100.20', '203.0.113.2', '198.51.100.20'],
    ['172.18.0.1', '203.0.113.99, 198.51.100.12', '198.51.100.12'],
    ['127.0.0.1', '198.51.100.11', '198.51.100.11'],
  ]) {
    const response = await app.inject({ method: 'GET', url: '/account', remoteAddress,
      headers: { 'x-real-ip': '203.0.113.123', 'x-forwarded-for': forwarded } })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { real: expected, forwarded: expected })
  }
})
