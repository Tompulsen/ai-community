/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { loadConfig } from '@/config.js';
import { MiNote } from '@/models/Note.js';
import { api, initTestDb } from '../utils.js';
import type { DataSource } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Community profile collection lookup', () => {
	let db: DataSource;
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let reader: misskey.entities.SignupResponse;
	beforeAll(async () => {
		db = await initTestDb(true);
		const account = async (username: string, administrator = false) => {
			const result = await api('admin/accounts/create', {
				username, password: 'profile-test-only',
				...(administrator ? { setupPassword: loadConfig().setupPassword } : {}),
			}, administrator ? undefined : root);
			assert.strictEqual(result.status, 200);
			assert.ok(result.body.token);
			return result.body;
		};
		root = await account('root', true);
		author = await account('profile_author');
		reader = await account('profile_reader');
		assert.strictEqual((await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, root)).status, 204);
	}, 120000);

	afterAll(async () => { await db?.destroy(); });

	test('maps only visible published works and intersects the existing author and category filters', async () => {
		const tag = await api('admin/community/tags/create', { category: 'resource', name: 'Profile test' }, root);
		assert.strictEqual(tag.status, 200);
		const create = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', tagIds: [tag.body.id], title: 'Profile collection lookup', text: 'A useful workflow' }, author);
		assert.strictEqual(create.status, 200);
		const review = await api('admin/community/review', { submissionId: create.body.id, version: 0, decision: 'approve' }, root);
		assert.strictEqual(review.status, 200);
		const noteId = review.body.approvedNoteId!;
		const ordinary = await api('notes/create', { text: 'Not a community work' }, author);
		assert.strictEqual(ordinary.status, 200);
		const ids = [noteId, ordinary.body.createdNote.id];
		const found = await api('community/works', { noteIds: ids, limit: 50 });
		assert.strictEqual(found.status, 200);
		assert.deepStrictEqual(found.body.items.map(item => item.id), [create.body.id]);
		assert.deepStrictEqual((await api('community/works', { noteIds: ids, authorId: reader.id })).body.items, []);
		assert.deepStrictEqual((await api('community/works', { noteIds: ids, category: 'video' })).body.items, []);
		assert.strictEqual((await api('blocking/create', { userId: author.id }, reader)).status, 200);
		assert.deepStrictEqual((await api('community/works', { noteIds: ids }, reader)).body.items, []);
		await db.getRepository(MiNote).update(noteId, { visibility: 'specified', visibleUserIds: [author.id] });
		assert.deepStrictEqual((await api('community/works', { noteIds: [noteId] })).body.items, []);
		await db.getRepository(MiNote).update(noteId, { visibility: 'public' });
		assert.strictEqual((await api('notes/delete', { noteId }, author)).status, 204);
		assert.deepStrictEqual((await api('community/works', { noteIds: [noteId] })).body.items, []);
	});

	test('rejects empty, duplicate, oversized and invalid IDs', async () => {
		for (const noteIds of [[], ['id1', 'id1'], Array.from({ length: 51 }, (_, i) => `note${i}`), ['not/an/id']]) {
			assert.strictEqual((await api('community/works', { noteIds })).status, 400);
		}
	});
});
