import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

async function shutdownFixture(t, mode) {
  const directory = await mkdtemp(path.join(tmpdir(), 'community-shutdown-'))
  const sockets = new Set(), commands = []
  const pendingRead = Promise.withResolvers()
  let connectionId = 0, releaseRead
  // Real ioredis sockets keep the child alive if either client's cleanup is omitted.
  const server = net.createServer(socket => {
    const id = ++connectionId
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let pending = Buffer.alloc(0)
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length) {
        const first = pending.indexOf('\r\n')
        if (first < 0) return
        assert.equal(pending[0], 42)
        const count = Number(pending.subarray(1, first)), args = []
        let offset = first + 2
        for (let index = 0; index < count; index++) {
          const end = pending.indexOf('\r\n', offset)
          if (end < 0) return
          const length = Number(pending.subarray(offset + 1, end))
          if (pending.length < end + length + 4) return
          args.push(pending.subarray(end + 2, end + length + 2).toString())
          offset = end + length + 4
        }
        pending = pending.subarray(offset)
        const name = args[0].toLowerCase()
        commands.push({ id, name })
        if (name === 'info') socket.write('$11\r\nloading:0\r\n\r\n')
        else if (name === 'zrangebyscore') socket.write('*0\r\n')
        else if (name === 'get' && mode === 'drain') {
          releaseRead = () => socket.write('$-1\r\n')
          pendingRead.resolve()
        } else if (name === 'get') socket.write('$-1\r\n')
        else if (name === 'ping' && mode === 'startup-ping-quit-error') socket.write('-ERR fixture ping failure\r\n')
        else if (name === 'ping') socket.write('+PONG\r\n')
        else if (name === 'quit' && (id === 2 && mode === 'quit-error' || mode === 'startup-ping-quit-error')) socket.write('-ERR fixture quit failure\r\n')
        else if (name === 'quit') socket.end('+OK\r\n')
        else socket.write('+OK\r\n')
      }
    })
  })
  let child, exited
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const config = path.join(directory, 'config.json'), fixture = path.join(directory, 'child.mjs')
  await writeFile(config, JSON.stringify({ url: 'http://localhost', db: { host: '127.0.0.1', db: 'fixture' }, redis: { host: '127.0.0.1', port } }))
  await writeFile(fixture, `
import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(new URL('../package.json', import.meta.url).href)})
require('pg').Pool = class {
  on() {}
  async query(sql) {
    if (${JSON.stringify(mode)} === 'startup-table' && sql.includes('community_creation_request')) throw new Error('fixture table missing')
    return sql.includes('community_creation_request') ? { rows: [], rowCount: 0 } : { rows: [{ ok: 1 }] }
  }
  async end() { console.log('PG_ENDED') }
}
const { start } = await import(${JSON.stringify(new URL('./runtime.ts', import.meta.url).href)})
const { getNewApiRedis } = await import(${JSON.stringify(new URL('./native-account/session.ts', import.meta.url).href)})
const mode = ${JSON.stringify(mode)}
process.on('beforeExit', () => console.log('NATURAL_BEFORE_EXIT'))
let app
try { app = await start() }
catch (error) {
  if (!mode.startsWith('startup-')) throw error
  console.log('EXPECTED_STARTUP_FAILURE')
  process.send({ ready: true })
  process.disconnect()
}
if (app) {
if (mode.startsWith('startup-')) throw new Error('Expected startup to fail')
const headers = { cookie: 'octopus_new_api_session=' + 'a'.repeat(43) }
if (mode === 'lazy') getNewApiRedis()
else if (mode === 'drain') {
  void fetch('http://127.0.0.1:' + app.server.address().port + '/api/new-api/session', { headers: { ...headers, Connection: 'close' } })
    .then(async response => { if (response.status !== 200) throw new Error('Request failed'); await response.text(); console.log('REQUEST_DRAINED') })
} else if (mode !== 'unused') await app.inject({ method: 'GET', url: '/api/new-api/session', headers })
process.once('message', () => {
  process.disconnect()
  // Windows cannot deliver POSIX signals; exercise the same registered handler there.
  if (process.platform === 'win32') process.emit('SIGTERM')
  else process.kill(process.pid, 'SIGTERM')
})
process.send({ ready: true })
}
`)
  child = fork(fixture, [], { cwd: projectRoot, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
    ...process.env, CONFIG_PATH: config, FILES_ROOT: directory, PORT: mode === 'startup-listen' ? '-1' : '0', HOST: '127.0.0.1',
    COMMUNITY_REQUEST_STORE: mode === 'startup-table' ? '1' : '0', COMMUNITY_REQUEST_V2: '0', COMMUNITY_REQUEST_V2_ACCOUNTS: '',
    DISABLE_LOTTERY_WORKER: '1', DISABLE_MEDIA_WORKER: '1', COMMUNITY_WALLET_ENABLED: 'false',
    NEW_API_BASE_URL: 'http://127.0.0.1:1', NEW_API_PUBLIC_URL: 'http://127.0.0.1:1',
    NEW_API_SESSION_SECRET: 'isolated-shutdown-secret-32-characters', NEW_API_REDIS_URL: `redis://127.0.0.1:${port}`,
  } })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  exited = once(child, 'exit')
  await Promise.race([
    once(child, 'message'),
    exited.then(() => { throw new Error('Child exited before ready: ' + stderr) }),
    delay(10000, undefined, { ref: false }).then(() => { throw new Error('Child startup timed out: ' + stderr) }),
  ])
  if (mode === 'drain') await pendingRead.promise
  return {
    child, commands, sockets,
    releaseRead: () => releaseRead(),
    async result() {
      const [code, signal] = await Promise.race([
        exited,
        delay(5000, undefined, { ref: false }).then(() => { throw new Error('Child did not exit naturally: ' + stdout + stderr) }),
      ])
      await Promise.all([...sockets].map(socket => once(socket, 'close')))
      return { code, signal, stdout, stderr }
    },
  }
}

for (const mode of ['unused', 'lazy', 'connected']) {
  test(`SIGTERM naturally exits after closing ${mode} account Redis`, { timeout: 15000 }, async t => {
    const fixture = await shutdownFixture(t, mode)
    assert.equal(fixture.sockets.size, mode === 'connected' ? 2 : 1)
    fixture.child.send('shutdown')
    const result = await fixture.result()
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.match(result.stdout, /PG_ENDED/)
    assert.match(result.stdout, /NATURAL_BEFORE_EXIT/)
    assert.equal(fixture.commands.filter(item => item.name === 'quit').length, mode === 'connected' ? 2 : 1)
    assert.equal(fixture.sockets.size, 0)
  })
}

test('shutdown drains an accepted session read before closing either Redis connection', { timeout: 15000 }, async t => {
  const fixture = await shutdownFixture(t, 'drain')
  fixture.child.send('shutdown')
  await delay(100)
  assert.equal(fixture.child.exitCode, null)
  assert.equal(fixture.commands.filter(item => item.name === 'quit').length, 0)
  fixture.releaseRead()
  const result = await fixture.result()
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.signal, null)
  assert.match(result.stdout, /REQUEST_DRAINED/)
  assert.match(result.stdout, /NATURAL_BEFORE_EXIT/)
  assert.equal(fixture.commands.filter(item => item.name === 'quit').length, 2)
})

test('account Redis quit failure closes its socket and reports a nonzero natural exit', { timeout: 15000 }, async t => {
  const fixture = await shutdownFixture(t, 'quit-error')
  fixture.child.send('shutdown')
  const result = await fixture.result()
  assert.equal(result.code, 1)
  assert.equal(result.signal, null)
  assert.match(result.stdout, /NATURAL_BEFORE_EXIT/)
  assert.equal(fixture.sockets.size, 0)
})

for (const mode of ['startup-table', 'startup-ping-quit-error', 'startup-listen']) {
  test(`${mode} releases connections and workers before naturally exiting`, { timeout: 15000 }, async t => {
    const fixture = await shutdownFixture(t, mode)
    const result = await fixture.result()
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.match(result.stdout, /EXPECTED_STARTUP_FAILURE/)
    assert.match(result.stdout, /PG_ENDED/)
    assert.match(result.stdout, /NATURAL_BEFORE_EXIT/)
    assert.equal(fixture.sockets.size, 0)
  })
}
