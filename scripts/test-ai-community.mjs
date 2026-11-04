/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseAiCommunityConfig, loadAiCommunityConfig } from '../packages/backend/src/misc/ai-community-config.ts';

test('public configuration only exposes validated distinct channel IDs', () => {
	assert.deepEqual(parseAiCommunityConfig({ video: 'video123', image: 'image123', knowledge: 'code123', token: 'secret' }), { video: 'video123', image: 'image123', knowledge: 'code123' });
	assert.deepEqual(parseAiCommunityConfig({}), { video: null, image: null, knowledge: null });
	for (const value of [null, [], 'bad', { video: '../private' }, { video: 123 }, { video: 'same', image: 'same' }]) {
		assert.throws(() => parseAiCommunityConfig(value));
	}
});

test('configuration loader distinguishes unconfigured and malformed state', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'ai-community-config-'));
	try {
		assert.equal((await loadAiCommunityConfig(dir)).video, null);
		await mkdir(join(dir, '.config'));
		await writeFile(join(dir, '.config/ai-community.json'), '{bad');
		await assert.rejects(loadAiCommunityConfig(dir));
		await writeFile(join(dir, '.config/ai-community.json'), JSON.stringify({ video: 'v1' }));
		assert.equal((await loadAiCommunityConfig(dir)).video, 'v1');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('setup resumes, rejects non-admins and concurrent runs, and never saves tokens', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'ai-community-setup-'));
	try {
		await mkdir(join(dir, 'scripts'));
		await mkdir(join(dir, '.config'));
		const script = join(dir, 'scripts/setup-ai-community.mjs');
		await copyFile(new URL('./setup-ai-community.mjs', import.meta.url), script);
		const mock = join(dir, 'mock.mjs');
		await writeFile(mock, `
import { appendFileSync } from 'node:fs';
let count = 0;
globalThis.fetch = async (url, options) => {
 const endpoint = new URL(url).pathname;
 const body = JSON.parse(options.body);
 if (body.i !== 'test-token') throw new Error('missing credential');
 appendFileSync(process.env.TEST_CALLS, endpoint + '\\n');
 if (endpoint === '/api/i') return Response.json({ isAdmin: process.env.TEST_ADMIN !== 'no' });
 if (endpoint === '/api/channels/show') return Response.json({ id: body.channelId });
 count++;
 if (process.env.TEST_FAIL === 'yes' && count === 2) return new Response('', { status: 503 });
 return Response.json({ id: 'channel' + count + process.env.TEST_RUN });
};`);
		const calls = join(dir, 'calls.txt');
		const run = (extra = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, script, '--url', 'http://localhost:3000'], {
			env: { ...process.env, MISSKEY_ADMIN_TOKEN: 'test-token', TEST_CALLS: calls, TEST_RUN: 'a', ...extra }, encoding: 'utf8',
		});
		assert.notEqual(run({ TEST_ADMIN: 'no' }).status, 0);
		assert.notEqual(run({ TEST_FAIL: 'yes' }).status, 0);
		const partial = JSON.parse(await readFile(join(dir, '.config/ai-community.json'), 'utf8'));
		assert.ok(partial.video);
		assert.equal(partial.image, null);
		const resumed = run({ TEST_RUN: 'b' });
		assert.equal(resumed.status, 0, resumed.stderr);
		const text = await readFile(join(dir, '.config/ai-community.json'), 'utf8');
		const complete = JSON.parse(text);
		assert.equal(complete.video, partial.video);
		assert.ok(complete.image && complete.knowledge);
		assert.ok(!text.includes('test-token'));
		const before = await readFile(calls, 'utf8');
		assert.equal(run().status, 0);
		const after = await readFile(calls, 'utf8');
		assert.ok(!after.slice(before.length).includes('/api/channels/create'));
		await writeFile(join(dir, '.config/ai-community.json.lock'), '');
		assert.notEqual(run().status, 0);
		assert.equal(await readFile(calls, 'utf8'), after);
	} finally {
		// dir is an absolute OS-created temporary directory, never a user-supplied path.
		assert.ok(resolve(dir).startsWith(resolve(tmpdir())));
		await rm(dir, { recursive: true, force: true });
	}
});
