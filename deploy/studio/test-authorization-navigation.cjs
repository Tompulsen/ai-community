/* SPDX-License-Identifier: AGPL-3.0-only */
// PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE_PATH may select an existing test installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const sourcePath = path.resolve(__dirname, '../../packages/sw/src/sw.ts');
const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.ESNext, true);
// Execute the real navigation/lifecycle handlers; notification and locale loading are unrelated.
const handlers = source.statements.filter(statement => {
	if (ts.isFunctionDeclaration(statement)) return ['respondToNavigation', 'offlineContentHTML'].includes(statement.name?.text);
	return ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
		statement.expression.expression.getText(source) === 'globalThis.addEventListener' &&
		['install', 'activate', 'fetch'].includes(statement.expression.arguments[0]?.text);
});
assert.equal(handlers.length, 5, 'Expected the actual navigation functions and lifecycle handlers');
const worker = ts.transpileModule(`
const FETCH_TIMEOUT_MS = 1000, _DEV_ = false, _VERSION_ = 'navigation-regression';
const swLang = { cacheName: 'navigation-regression', i18n: { ts: { _offlineScreen: {} } } };
${handlers.map(statement => statement.getFullText(source)).join('\n')}
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const legacyWorker = `
self.addEventListener('activate', event => event.waitUntil(clients.claim()));
self.addEventListener('fetch', event => {
	if (event.request.mode === 'navigate') event.respondWith(fetch(event.request, { signal: new AbortController().signal }));
});
`;

(async () => {
	let updated = false;
	const received = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url, 'http://fixture');
		if (url.pathname === '/sw.js') {
			response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
			response.end(updated ? worker : legacyWorker);
			return;
		}
		received.push({ path: url.pathname, query: url.search, destination: request.headers['sec-fetch-dest'], mode: request.headers['sec-fetch-mode'] });
		if (url.pathname.startsWith('/studio/api/new-api/community/') && request.headers['sec-fetch-dest'] !== 'document') {
			response.writeHead(303, { Location: '/community?studio=authorization-failed', 'Cache-Control': 'no-store' });
			response.end();
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
		response.end('<!doctype html><title>Authorization navigation fixture</title><p>Network page</p>');
	});
	let browser;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const origin = `http://127.0.0.1:${server.address().port}`;
		browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(origin + '/community');
		await page.evaluate(async () => {
			await navigator.serviceWorker.register('/sw.js');
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
		});
		const ticket = 'A'.repeat(43);
		const authorizePath = '/studio/api/new-api/community/embedded/authorize';
		await Promise.all([
			page.waitForURL(origin + '/community?studio=authorization-failed'),
			page.evaluate(target => window.location.assign(target), `${authorizePath}?ticket=${ticket}`),
		]);
		await page.waitForLoadState('load');
		assert.deepEqual(received.find(request => request.path === authorizePath), {
			path: authorizePath, query: `?ticket=${ticket}`, destination: 'empty', mode: 'same-origin',
		}, 'The former worker reproduces the rejected OAuth navigation');

		updated = true;
		await page.evaluate(async () => {
			const previous = navigator.serviceWorker.controller;
			const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
			await (await navigator.serviceWorker.getRegistration()).update();
			await changed;
			if (!navigator.serviceWorker.controller || navigator.serviceWorker.controller === previous) throw new Error('New worker did not claim the existing page');
		});
		const paths = [
			`${authorizePath}?ticket=${ticket}`,
			`/studio/api/new-api/community/start?code=${ticket}`,
			`/studio/api/new-api/community/callback?code=${ticket}&state=${ticket}`,
			`/api/new-api/community/callback?code=${ticket}&state=${ticket}`,
			`/api/newapi/callback?code=${ticket}&state=${ticket}`,
		];
		for (const target of paths) {
			await Promise.all([page.waitForURL(origin + target), page.evaluate(url => window.location.assign(url), target)]);
			await page.waitForLoadState('load');
			const expected = new URL(target, origin);
			assert.deepEqual(received.at(-1), { path: expected.pathname, query: expected.search, destination: 'document', mode: 'navigate' });
			assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
		}
		await context.setOffline(true);
		await page.goto(origin + '/community', { waitUntil: 'load' });
		assert.match(await page.locator('body').innerText(), /Offline - Could not connect to server|Could not connect to server/);
		console.log('PASS: old worker failure reproduced; live worker update preserves OAuth document/navigate and all query parameters; normal navigation retains offline fallback');
	} finally {
		if (browser) await browser.close();
		await new Promise(resolve => server.close(resolve));
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
