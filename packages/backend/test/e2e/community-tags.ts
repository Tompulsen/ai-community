/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { loadConfig } from '@/config.js';
import { MiCommunitySubmission } from '@/models/CommunitySubmission.js';
import { MiCommunityTag } from '@/models/CommunityTag.js';
import { api, castAsError, initTestDb, sendEnvResetRequest } from '../utils.js';
import type { DataSource, Repository } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Community work tags', () => {
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let db: DataSource | undefined;
	let submissions: Repository<MiCommunitySubmission>;
	let tags: Repository<MiCommunityTag>;
	let publicationModeConfigured = false;
	const assertStatus = (result: { status: number; body: unknown }, expected: number, operation: string) => {
		const body = result.body as { error?: { code?: string; message?: string } | string; code?: string; message?: string } | null;
		const error = typeof body?.error === 'object' ? body.error : body;
		assert.strictEqual(result.status, expected, `${operation}: HTTP ${result.status}; ${JSON.stringify({ code: error?.code, message: error?.message })}`);
	};
	const createAccount = async (username: string, administrator: boolean) => {
		// Use the existing setup/admin endpoint, which provisions real accounts through SignupService.
		const result = await api('admin/accounts/create', {
			username,
			password: 'community-tags-test-only',
			...(administrator ? { setupPassword: loadConfig().setupPassword } : {}),
		}, administrator ? undefined : root);
		assertStatus(result, 200, `create account ${username}`);
		assert.ok(result.body && typeof result.body.id === 'string' && result.body.id.length > 0, `create account ${username}: missing user id`);
		assert.ok(typeof result.body.token === 'string' && result.body.token.length > 0, `create account ${username}: missing token`);
		const me = await api('i', {}, result.body);
		assertStatus(me, 200, `authenticate ${username}`);
		assert.strictEqual(me.body.id, result.body.id);
		assert.strictEqual(me.body.isAdmin, administrator, `administrator status for ${username}`);
		return result.body;
	};
	const mode = async (value: 'before' | 'after') => {
		const result = await api('admin/update-meta', { clientOptions: { communityPublicationMode: value } }, root);
		assertStatus(result, 204, `set publication mode to ${value}`);
	};
	const createTag = async (name: string, category: 'image' | 'video' | 'resource' = 'resource') => {
		const result = await api('admin/community/tags/create', { category, name }, root);
		assertStatus(result, 200, `create ${category} tag`);
		return result.body;
	};
	const input = (tagIds?: string[]) => ({ idempotencyKey: randomUUID(), category: 'resource' as const, title: 'Tagged work', text: 'A useful workflow', ...(tagIds ? { tagIds } : {}) });
	const show = async (id: string) => (await api('community/submissions/show', { submissionId: id }, author)).body;
	const search = async (query: string, tagIds: string[] = []) => (await api('community/works', { category: 'resource', query, tagIds })).body.items;
	beforeAll(async () => {
		db = await initTestDb(true);
		submissions = db.getRepository(MiCommunitySubmission);
		tags = db.getRepository(MiCommunityTag);
		// The test server caches metadata; reload it after initializing this isolated database.
		await sendEnvResetRequest();
		root = await createAccount('root', true);
		author = await createAccount('tagauthor', false);
		await mode('after');
		publicationModeConfigured = true;
	}, 120000);
	afterAll(async () => {
		try {
			if (publicationModeConfigured) await mode('before');
		} finally {
			await db?.destroy();
		}
	});

	test('lists tags anonymously and restricts mutations to administrators', async () => {
		assert.strictEqual((await api('community/tags', {})).status, 200);
		assert.strictEqual((await api('admin/community/tags/create', { category: 'image', name: 'Forbidden' }, author)).status, 403);
		const tag = await createTag('Only image', 'image');
		assert.ok((await api('community/tags', { category: 'image' })).body.some(item => item.id === tag.id));
		assert.ok(!(await api('community/tags', { category: 'video' })).body.some(item => item.id === tag.id));
		assert.strictEqual((await api('admin/community/tags/update', { tagId: tag.id, name: 'Forbidden' }, author)).status, 403);
		assert.strictEqual((await api('admin/community/tags/delete', { tagId: tag.id }, author)).status, 403);
	});

	test('concurrent duplicate creation is unique per category and deletion cannot be undone by rename', async () => {
		const results = await Promise.all([api('admin/community/tags/create', { category: 'resource', name: 'Concurrent' }, root), api('admin/community/tags/create', { category: 'resource', name: 'Concurrent' }, root)]);
		assert.deepStrictEqual(results.map(result => result.status).sort(), [200, 409]);
		await createTag('Concurrent', 'image');
		const tag = results.find(result => result.status === 200)!.body;
		assert.strictEqual((await api('admin/community/tags/delete', { tagId: tag.id }, root)).status, 204);
		assert.strictEqual((await api('admin/community/tags/update', { tagId: tag.id, name: 'Resurrected' }, root)).status, 404);
		assert.ok(!(await api('community/tags', {})).body.some(item => item.id === tag.id));
		await createTag('Concurrent');
	});

	test('rejects unavailable, cross-category, duplicate and excess selections', async () => {
		const image = await createTag('Wrong category', 'image');
		const removed = await createTag('Deleted selection');
		await api('admin/community/tags/delete', { tagId: removed.id }, root);
		for (const ids of [[image.id], [removed.id], ['missing'], [image.id, image.id], ['a', 'b', 'c', 'd']]) {
			assert.strictEqual((await api('community/submissions/create', input(ids), author)).status, 400);
		}
	});

	test('concurrent renames keep category uniqueness and a competing delete cannot revive a tag', async () => {
		const first = await createTag('Rename one');
		const second = await createTag('Rename two');
		const renamed = await Promise.all([first, second].map(tag => api('admin/community/tags/update', { tagId: tag.id, name: 'Only one final name' }, root)));
		assert.deepStrictEqual(renamed.map(result => result.status).sort(), [200, 409]);
		const race = await Promise.all([
			api('admin/community/tags/update', { tagId: first.id, name: 'Rename during deletion' }, root),
			api('admin/community/tags/delete', { tagId: first.id }, root),
		]);
		assert.ok([200, 404].includes(race[0].status));
		assert.strictEqual(race[1].status, 204);
		assert.strictEqual((await tags.findOneByOrFail({ id: first.id })).isDeleted, true);
		assert.ok(!(await api('community/tags', {})).body.some(tag => tag.id === first.id));
	});

	test('deleting a selected label concurrently with posting never exposes the deleted label', async () => {
		const tag = await createTag('Post delete race');
		const request = input([tag.id]);
		const [created, deleted] = await Promise.all([
			api('community/submissions/create', request, author),
			api('admin/community/tags/delete', { tagId: tag.id }, root),
		]);
		assert.strictEqual(deleted.status, 204);
		assert.ok([200, 400].includes(created.status));
		if (created.status === 200) {
			assert.deepStrictEqual((await show(created.body.id)).tagIds, []);
			assert.ok(await submissions.existsBy({ id: created.body.id }));
		} else {
			assert.strictEqual(castAsError(created.body).error.code, 'COMMUNITY_INVALID_TAGS');
			assert.ok(!await submissions.existsBy({ authorId: author.id, idempotencyKey: request.idempotencyKey }));
		}
		assert.deepStrictEqual(await search('', [tag.id]), []);
	});

	test('matches tags with OR and intersects them with keyword search, and follows renames/deletions', async () => {
		const first = await createTag('Unique workflow tag');
		const second = await createTag('Alternate tag');
		const empty = await createTag('Unselected tag');
		const request = input([first.id, second.id]);
		const result = await api('community/submissions/create', request, author);
		assert.strictEqual(result.status, 200);
		assert.strictEqual((await api('community/submissions/create', { ...request, tagIds: [second.id, first.id] }, author)).body.id, result.body.id);
		assert.ok((await search('workflow', [first.id, empty.id])).some(work => work.id === result.body.id));
		assert.ok(!(await search('no matching keyword', [first.id])).some(work => work.id === result.body.id));
		assert.ok((await search(first.name)).some(work => work.id === result.body.id));
		await api('admin/community/tags/update', { tagId: first.id, name: 'Renamed specialty' }, root);
		assert.ok(!(await search(first.name)).some(work => work.id === result.body.id));
		assert.ok((await search('Renamed specialty')).some(work => work.id === result.body.id));
		await api('admin/community/tags/delete', { tagId: first.id }, root);
		assert.ok(!(await search('', [first.id])).some(work => work.id === result.body.id));
		const saved = await show(result.body.id);
		assert.deepStrictEqual(saved.tagIds, [second.id]);
		assert.strictEqual(saved.tags[0].name, second.name);
		assert.ok(await submissions.existsBy({ id: result.body.id }));
	});

	test('keeps new labels private until approval and tolerates a deleted pending label', async () => {
		const original = await createTag('Published classification');
		const pending = await createTag('Private classification');
		const result = await api('community/submissions/create', input([original.id]), author);
		const work = await show(result.body.id);
		await mode('before');
		try {
			const edit = await api('community/submissions/update', { submissionId: work.id, version: work.version, category: 'resource', title: work.title, text: work.text, tagIds: [pending.id] }, author);
			assert.strictEqual(edit.status, 200);
			assert.deepStrictEqual(edit.body.tagIds, [pending.id]);
			assert.deepStrictEqual((await api('community/works/show', { submissionId: work.id })).body.tagIds, [original.id]);
			assert.ok(!(await search(pending.name)).some(item => item.id === work.id));
			assert.ok(!(await search('', [pending.id])).some(item => item.id === work.id));
			await api('admin/community/tags/delete', { tagId: pending.id }, root);
			const approved = await api('admin/community/review', { submissionId: work.id, version: edit.body.version, decision: 'approve' }, root);
			assert.strictEqual(approved.status, 200);
			assert.deepStrictEqual(approved.body.tagIds, []);
		} finally { await mode('after'); }
	});

	test('searches the complete published prompt while keeping changed or cleared pending prompts private', async () => {
		const publishedTerm = 'PublishedPromptTail';
		const privateTerm = 'PrivatePromptTail';
		const generation = { prompt: `${'A long prompt. '.repeat(250)}${publishedTerm}`, model: 'test-model', referenceFileIds: [] };
		const created = await api('community/submissions/create', { ...input(), generation }, author);
		assert.strictEqual(created.status, 200);
		const work = await show(created.body.id);
		assert.ok(!work.text.includes(publishedTerm));
		assert.ok((await search(publishedTerm)).some(item => item.id === work.id));
		await mode('before');
		try {
			const editInput = { submissionId: work.id, version: work.version, category: 'resource' as const, title: work.title, text: work.text };
			const edited = await api('community/submissions/update', { ...editInput, generation: { ...generation, prompt: privateTerm } }, author);
			assert.strictEqual(edited.status, 200);
			assert.ok((await search(publishedTerm)).some(item => item.id === work.id));
			assert.ok(!(await search(privateTerm)).some(item => item.id === work.id));
			assert.ok((await api('community/submissions/mine', { query: privateTerm }, author)).body.items.some(item => item.id === work.id));
			assert.ok((await api('admin/community/submissions', { query: privateTerm }, root)).body.items.some(item => item.id === work.id));
			assert.ok(!(await api('community/submissions/mine', { query: publishedTerm }, author)).body.items.some(item => item.id === work.id));
			const cleared = await api('community/submissions/update', { ...editInput, version: edited.body.version, generation: null }, author);
			assert.strictEqual(cleared.status, 200);
			assert.ok(!(await api('community/submissions/mine', { query: publishedTerm }, author)).body.items.some(item => item.id === work.id));
			assert.ok(!(await api('admin/community/submissions', { query: privateTerm }, root)).body.items.some(item => item.id === work.id));
			assert.ok((await search(publishedTerm)).some(item => item.id === work.id));
			const restored = await api('community/submissions/update', { ...editInput, version: cleared.body.version, generation: { ...generation, prompt: privateTerm } }, author);
			const approved = await api('admin/community/review', { submissionId: work.id, version: restored.body.version, decision: 'approve' }, root);
			assert.strictEqual(approved.status, 200);
			assert.ok((await search(privateTerm)).some(item => item.id === work.id));
			assert.ok(!(await search(publishedTerm)).some(item => item.id === work.id));
		} finally { await mode('after'); }
	});

	test('preserves old retry hashes and keeps tags on legacy edits while allowing an explicit clear', async () => {
		const request = input();
		const created = await api('community/submissions/create', request, author);
		const old = { category: 'resource', title: request.title, text: request.text, model: '', sourceUrl: '', license: '', fileIds: [] };
		assert.strictEqual((await submissions.findOneByOrFail({ id: created.body.id })).payloadHash, createHash('sha256').update(JSON.stringify(old)).digest('hex'));
		assert.strictEqual((await api('community/submissions/create', { ...request, tagIds: [] }, author)).body.id, created.body.id);
		const tag = await createTag('Preserved tag');
		const tagged = await api('community/submissions/create', input([tag.id]), author);
		const work = await show(tagged.body.id);
		const unchanged = await api('community/submissions/update', { submissionId: work.id, version: work.version, category: 'resource', title: work.title, text: work.text }, author);
		assert.deepStrictEqual(unchanged.body.tagIds, [tag.id]);
		const cleared = await api('community/submissions/update', { submissionId: work.id, version: unchanged.body.version, category: 'resource', title: work.title, text: work.text, tagIds: [] }, author);
		assert.deepStrictEqual(cleared.body.tagIds, []);
		const invalid = await api('community/submissions/update', { submissionId: work.id, version: cleared.body.version, category: 'resource', title: work.title, text: work.text, tagIds: ['missing'] }, author);
		assert.strictEqual(castAsError(invalid.body).error.code, 'COMMUNITY_INVALID_TAGS');
	});
});
