/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { api, initTestDb, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

describe.sequential('Community comment deletion', () => {
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let commenter: misskey.entities.SignupResponse;
	let stranger: misskey.entities.SignupResponse;
	let work: misskey.entities.CommunitySubmissionsShowResponse;
	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		author = await signup({ username: 'workowner' });
		commenter = await signup({ username: 'commenter' });
		stranger = await signup({ username: 'stranger' });
		await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'after' } }, root);
		const created = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Original', text: 'Original work' }, author);
		work = (await api('community/submissions/show', { submissionId: created.body.id }, author)).body;
	}, 120000);
	afterAll(async () => { await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, root); });
	const comment = async () => (await api('notes/create', { text: 'Comment', replyId: work.approvedNoteId!, visibility: 'public' }, commenter)).body.createdNote;
	const remove = (noteId: string, actor: typeof author) => api('community/comments/delete', { submissionId: work.id, noteId }, actor);

	test('only the comment author or owning work author may delete the reply', async () => {
		const first = await comment();
		assert.strictEqual((await remove(first.id, stranger)).status, 403);
		assert.strictEqual((await remove(first.id, commenter)).status, 204);
		const second = await comment();
		assert.strictEqual((await remove(second.id, author)).status, 204);
		assert.strictEqual((await api('notes/show', { noteId: work.approvedNoteId! }, author)).status, 200);
	});

	test('rejects unrelated originals and null parent matches', async () => {
		const unrelated = (await api('notes/create', { text: 'Unrelated original' }, commenter)).body.createdNote;
		assert.strictEqual((await remove(unrelated.id, author)).status, 404);
		await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, root);
		try {
			const pending = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Pending', text: 'Pending' }, author);
			assert.strictEqual((await api('community/comments/delete', { submissionId: pending.body.id, noteId: unrelated.id }, author)).status, 404);
		} finally { await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'after' } }, root); }
		assert.strictEqual((await api('notes/show', { noteId: unrelated.id }, commenter)).status, 200);
	});

	test('concurrent owner/author deletions decrement the count once', async () => {
		const reply = await comment();
		const before = (await api('notes/show', { noteId: work.approvedNoteId! }, author)).body.repliesCount;
		const results = await Promise.all([remove(reply.id, author), remove(reply.id, commenter)]);
		assert.ok(results.some(result => result.status === 204));
		assert.ok(results.every(result => [204, 404].includes(result.status)));
		assert.strictEqual((await api('notes/show', { noteId: work.approvedNoteId! }, author)).body.repliesCount, before - 1);
	});
});
