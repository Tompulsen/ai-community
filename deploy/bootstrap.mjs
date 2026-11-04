/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { readFile } from 'node:fs/promises';

const credentials = JSON.parse(await readFile(process.argv[2], 'utf8'));
const base = 'http://127.0.0.1:3000';
async function api(endpoint, body) {
	const response = await fetch(`${base}/api/${endpoint}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
	});
	if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
	return response.status === 204 ? null : response.json();
}
const meta = await api('meta', { detail: true });
let token;
if (meta.requireSetup) {
	const admin = await api('admin/accounts/create', credentials);
	token = admin.token;
} else {
	const login = await api('signin-flow', { username: credentials.username, password: credentials.password });
	if (!login.finished) throw new Error('Administrator requires an additional authentication step.');
	token = login.i;
}
const me = await api('i', { i: token });
if (!me.isAdmin) throw new Error('Configured account is not an administrator.');
await api('admin/update-meta', {
	i: token, name: 'AI 创作社区', disableRegistration: false,
	emailRequiredForSignup: false, enableEmail: false, federation: 'none',
	languages: ['zh-CN'], repositoryUrl: 'https://zaiduyu.top/source/ai-community.tar.gz',
});
console.log('Administrator initialized and verified; email/password registration enabled.');
