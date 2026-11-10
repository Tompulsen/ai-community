/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { loadConfig } from '@/config.js';
import { api, initTestDb } from '../utils.js';
import type { DataSource } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Community feed refresh', () => {
	let db: DataSource | undefined;
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	beforeAll(async () => {
		db = await initTestDb(true);
		const account = async (username: string, administrator = false) => {
			const result = await api('admin/accounts/create', {
				username, password: 'feed-refresh-test-only',
				...(administrator ? { setupPassword: loadConfig().setupPassword } : {}),
			}, administrator ? undefined : root);
			assert.strictEqual(result.status, 200);
			assert.ok(result.body.token);
			return result.body;
		};
		root = await account('root', true);
		alice = await account('refresh_reader');
	}, 120000);

	afterAll(async () => { await db?.destroy(); });

	const draft = (overrides: Partial<misskey.entities.CommunitySubmissionsCreateRequest> = {}) => ({
		idempotencyKey: randomUUID(), category: 'resource' as const,
		title: 'Community refresh regression', text: 'A useful Skill', ...overrides,
	});

	test('refresh sessions keep paging stable and admin controls apply to the next refresh', async () => {
		const old = await api('admin/meta', {}, root);
		const query = `refresh-${randomUUID()}`;
		const settings = { communityFeedMode: 'shuffle' as const, communityFeedPoolSize: 20, communityPullToRefresh: true, communityPublicationMode: 'after' as const };
		assert.strictEqual((await api('admin/update-meta', { clientOptions: settings }, alice)).status, 403);
		assert.strictEqual((await api('admin/update-meta', { clientOptions: { communityFeedPoolSize: 19 } }, root)).status, 400);
		assert.strictEqual((await api('admin/update-meta', { clientOptions: settings }, root)).status, 204);
		const ids: string[] = [];
		const session = { query, limit: 5, feedSeed: randomUUID() };
		type FeedPage = misskey.entities.CommunityWorksResponse;

		async function collect(first?: FeedPage) {
			const result: string[] = [];
			let page = first ?? (await api('community/works', session)).body;
			for (let count = 0; count < 20; count++) {
				result.push(...page.items.map(item => item.id));
				if (!page.nextCursor) return result;
				page = (await api('community/works', { ...session, untilId: page.nextCursor, feedBoundary: page.feedBoundary, feedAnchor: page.feedAnchor })).body;
			}
			throw new Error('Feed pagination did not terminate');
		}

		try {
			for (let index = 0; index < 27; index++) {
				const created = await api('community/submissions/create', draft({ title: `${query} ${index}` }), root);
				assert.strictEqual(created.status, 200);
				ids.push(created.body.id);
			}
			const first = await api('community/works', { ...session, feedAnchor: 1 });
			assert.ok(typeof first.body.feedAnchor === 'number' && first.body.feedAnchor > Date.now() - 10000);
			const shuffled = await collect(first.body);
			assert.deepStrictEqual([...shuffled].sort(), [...ids].sort());
			assert.strictEqual(new Set(shuffled).size, ids.length);
			assert.deepStrictEqual(shuffled.slice(20), [...ids].sort().reverse().slice(20));
			assert.deepStrictEqual(await collect(), shuffled);
			const different = await api('community/works', { ...session, feedSeed: randomUUID() });
			assert.notDeepStrictEqual(different.body.items.map(item => item.id), first.body.items.map(item => item.id));
			await api('admin/update-meta', { clientOptions: { communityFeedMode: 'latest' } }, root);
			assert.deepStrictEqual(await collect(first.body), shuffled);
			const latest = (await api('community/works', session)).body;
			assert.strictEqual(latest.feedBoundary, undefined);
			await api('admin/update-meta', { clientOptions: { communityFeedMode: 'shuffle' } }, root);
			assert.deepStrictEqual(await collect(latest), [...ids].sort().reverse());
			const author = await api('community/works', { ...session, authorId: root.id });
			assert.strictEqual(author.body.feedBoundary, undefined);
			assert.deepStrictEqual(author.body.items.map(item => item.id), [...ids].sort().reverse().slice(0, 5));
		} finally {
			await api('admin/update-meta', { clientOptions: {
				communityPublicationMode: old.body.clientOptions.communityPublicationMode ?? 'before',
				communityFeedMode: old.body.clientOptions.communityFeedMode ?? 'shuffle',
				communityFeedPoolSize: old.body.clientOptions.communityFeedPoolSize ?? 200,
				communityPullToRefresh: old.body.clientOptions.communityPullToRefresh ?? true,
			} }, root);
		}
	}, 120000);
});
