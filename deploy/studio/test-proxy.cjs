/* SPDX-License-Identifier: AGPL-3.0-only */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createServer } = require('node:http');
const root = path.resolve(__dirname, '../..');
const backendRequire = Module.createRequire(path.join(root, 'packages/backend/package.json'));
const esbuild = require('esbuild');
const file = path.join(root, 'packages/backend/src/server/community-studio.ts');
const compiled = new Module(file, module);
compiled.filename = file;
compiled.paths = Module._nodeModulePaths(path.dirname(file));
compiled._compile(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file);
const { registerCommunityStudio } = compiled.exports;

(async () => {
  const received = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === '/studio/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: last\n\n'), 150);
    } else if (req.url === '/studio/media') {
      res.writeHead(206, { 'Content-Range': 'bytes 2-4/6', 'Content-Type': 'video/mp4' });
      res.end('cde');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['__Host-studio=test; Path=/; Secure; HttpOnly', '__Host-flow=flow; Path=/; Secure; HttpOnly'] });
      res.end(JSON.stringify(received.at(-1)));
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = backendRequire('fastify')();
  registerCommunityStudio(app, `http://127.0.0.1:${upstream.address().port}`, 'https://community.example.test');
  app.get('/api/meta', () => ({ community: true }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const response = await fetch(base + '/studio/api/new-api/embedded?x=1', { method: 'POST', headers: { origin: 'https://community.example.test', 'content-type': 'application/json', 'x-forwarded-host': 'attacker.invalid', 'x-community-embed': 'context', cookie: '__Host-studio=session' }, body: JSON.stringify({ selected: 17 }) });
    const sent = await response.json();
    assert.equal(sent.url, '/studio/api/new-api/embedded?x=1');
    assert.equal(sent.headers.host, 'community.example.test');
    assert.equal(sent.headers['x-forwarded-host'], 'community.example.test');
    assert.equal(sent.headers.origin, 'https://community.example.test');
    assert.equal(sent.headers['x-community-embed'], 'context');
    assert.equal(sent.headers.cookie, '__Host-studio=session');
    assert.deepEqual(JSON.parse(sent.body), { selected: 17 });
    assert.equal(response.headers.getSetCookie().length, 2);
    const callback = await (await fetch(base + '/api/new-api/community/callback?code=opaque&state=state')).json();
    assert.equal(callback.url, '/studio/api/new-api/community/callback?code=opaque&state=state');
    assert.equal((await fetch(base + '/api/new-api/community/callback/unexpected')).status, 404);
    assert.deepEqual(await (await fetch(base + '/api/meta')).json(), { community: true });
    const range = await fetch(base + '/studio/media', { headers: { Range: 'bytes=2-4' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 2-4/6');
    assert.equal(await range.text(), 'cde');
    assert.equal(received.at(-1).headers.range, 'bytes=2-4');
    const stream = await fetch(base + '/studio/stream');
    const reader = stream.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: last\n\n');
    await reader.cancel();
    console.log('PASS: studio path, fixed callback, public Host, cookies, JSON, Range and unbuffered SSE');
  } finally {
    await app.close();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
