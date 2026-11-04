/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile, mkdir, copyFile, open, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Uses the existing authenticated API. The token never enters the public config.
const rawUrl = process.argv[process.argv.indexOf('--url') + 1];
if (!process.argv.includes('--url') || !rawUrl || !process.env.MISSKEY_ADMIN_TOKEN) {
	console.error('Usage: set MISSKEY_ADMIN_TOKEN, then node scripts/setup-ai-community.mjs --url http://localhost:3000');
	process.exit(1);
}
const baseUrl = new URL(rawUrl);
if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('Invalid server URL');
if (baseUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) throw new Error('Use HTTPS for a remote server');
const configFile = fileURLToPath(new URL('../.config/ai-community.json', import.meta.url));
const modules = [
	['video', '视频社区', '分享 AI 视频、短片与创作过程，交流提示词和制作经验。'],
	['image', '图片社区', '分享 AI 图片、视觉设计与提示词，讨论创作方法。'],
	['knowledge', '文本代码与 Skill 社区', '分享文章、代码、开源项目与 Skill。请注明来源、许可证和使用方法。'],
];
async function api(endpoint, body = {}) {
	const response = await fetch(new URL(`/api/${endpoint}`, baseUrl), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...body, i: process.env.MISSKEY_ADMIN_TOKEN }),
		signal: AbortSignal.timeout(30000),
		redirect: 'error',
	});
	if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
	return response.json();
}

await mkdir(fileURLToPath(new URL('../.config/', import.meta.url)), { recursive: true });
const lockFile = `${configFile}.lock`;
const lock = await open(lockFile, 'wx').catch(error => {
	if (error.code === 'EEXIST') throw new Error('Community setup is already running. If a previous process crashed, verify it has stopped before removing the .lock file.');
	throw error;
});
const temporaryFile = `${configFile}.${process.pid}.tmp`;
try {
	const me = await api('i');
	if (!me.isAdmin) throw new Error('An administrator account is required');
	let config = { video: null, image: null, knowledge: null };
	try {
		const existing = JSON.parse(await readFile(configFile, 'utf8'));
		for (const [key] of modules) {
			if (existing[key] != null && (typeof existing[key] !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(existing[key]))) throw new Error(`Invalid channel ID: ${key}`);
			config[key] = existing[key] ?? null;
		}
		if (new Set(Object.values(config).filter(Boolean)).size !== Object.values(config).filter(Boolean).length) throw new Error('Channel IDs must be unique');
		await copyFile(configFile, `${configFile}.bak-${Date.now()}`);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	await mkdir(fileURLToPath(new URL('../.config/', import.meta.url)), { recursive: true });
	for (const [key, name, description] of modules) {
		if (config[key]) {
			await api('channels/show', { channelId: config[key] });
			console.log(`${name}: existing channel verified`);
			continue;
		}
		const channel = await api('channels/create', { name, description, allowRenoteToExternal: false });
		if (typeof channel.id !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(channel.id)) throw new Error('Invalid channel response');
		config[key] = channel.id;
		// Persist after every creation so a partial failure can resume without duplicates.
		await writeFile(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
		await rename(temporaryFile, configFile);
		console.log(`${name}: created`);
	}
	console.log(`Community channels configured: ${configFile}`);
} finally {
	await lock.close();
	await unlink(lockFile);
	await unlink(temporaryFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
