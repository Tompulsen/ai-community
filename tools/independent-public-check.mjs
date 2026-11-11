import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

const cases = [
  { path: '/healthz', status: 200, json: 'object' },
  { path: '/api/session', status: 200, json: 'guest' },
  ...['works', 'tags', 'creators', 'announcements'].map(name => ({
    path: `/api/${name}`, status: 200, json: 'items',
  })),
  ...['notifications', 'library', 'admin/submissions'].map(name => ({
    path: `/api/${name}`, status: 401,
  })),
  { path: '/community?tab=announcements', status: 200, html: true },
]

async function checkPublicOrigin(input) {
  const origin = new URL(input)
  assert(['http:', 'https:'].includes(origin.protocol), 'Use an HTTP or HTTPS origin.')
  assert(!origin.username && !origin.password, 'Do not put credentials in the URL.')
  assert(origin.pathname === '/' && !origin.search && !origin.hash, 'Use an origin without a path, query or fragment.')
  const results = []
  for (const item of cases) {
    try {
      const response = await fetch(new URL(item.path, origin), {
        method: 'GET', credentials: 'omit', redirect: 'manual',
        headers: { Accept: item.html ? 'text/html' : 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      const text = await response.text()
      assert.equal(response.status, item.status, `Expected HTTP ${item.status}, received ${response.status}.`)
      if (item.json) {
        const body = JSON.parse(text)
        assert(body && typeof body === 'object' && !Array.isArray(body), 'Expected a JSON object.')
        if (item.json === 'guest') assert.equal(body.user, null, 'Expected an anonymous session.')
        if (item.json === 'items') assert(Array.isArray(body.items), 'Expected an items array.')
      } else if (item.html) {
        assert(response.headers.get('content-type')?.includes('text/html'), 'Expected HTML.')
        assert.match(text, /id=["']app["']/, 'Expected the application root.')
      }
      results.push({ path: item.path, passed: true })
    } catch (error) {
      results.push({ path: item.path, passed: false, error: error.message })
    }
  }
  return results
}

async function selfTest() {
  const requests = []
  let broken = false
  let redirect = false
  const server = createServer((request, response) => {
    requests.push(request.method)
    const item = cases.find(candidate => candidate.path === request.url)
    assert(item, `Unexpected path: ${request.url}`)
    const status = redirect && item.html ? 302 : item.status
    response.writeHead(status, {
      'Content-Type': item.html ? 'text/html' : 'application/json',
      ...(status === 302 ? { Location: '/redirect-must-not-be-followed' } : {}),
    })
    const body = item.json === 'guest' ? { user: null }
      : item.json === 'items' ? { items: broken && request.url === '/api/works' ? null : [] }
      : {}
    response.end(item.html ? '<!doctype html><div id="app"></div>' : JSON.stringify(body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const healthy = await checkPublicOrigin(origin)
    assert(healthy.every(item => item.passed), JSON.stringify(healthy.filter(item => !item.passed)))
    broken = true
    assert.deepEqual((await checkPublicOrigin(origin)).filter(item => !item.passed).map(item => item.path), ['/api/works'])
    broken = false
    redirect = true
    assert.deepEqual((await checkPublicOrigin(origin)).filter(item => !item.passed).map(item => item.path), ['/community?tab=announcements'])
    assert.equal(requests.length, cases.length * 3)
    assert(requests.every(method => method === 'GET'))
    await assert.rejects(checkPublicOrigin('https://user:secret@example.invalid'))
    console.log('Self-test passed: healthy responses, invalid data, redirects, GET-only requests and credential rejection.')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

try {
  if (process.argv[2] === '--self-test') await selfTest()
  else {
    assert(process.argv.length === 3, 'Usage: node tools/independent-public-check.mjs <origin> | --self-test')
    const results = await checkPublicOrigin(process.argv[2])
    for (const item of results) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.path}${item.error ? `: ${item.error}` : ''}`)
    console.log(`${results.filter(item => item.passed).length}/${results.length} passed; anonymous GET requests only.`)
    if (results.some(item => !item.passed)) process.exitCode = 1
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
