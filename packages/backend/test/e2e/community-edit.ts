/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { MiNote } from '@/models/Note.js';
import { api, castAsError, initTestDb, signup, uploadFile } from '../utils.js';
import type { Repository } from 'typeorm';
import type * as misskey from 'misskey-js';

describe.sequential('Community work editing', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let notes: Repository<MiNote>;
	beforeAll(async () => {
		const connection = await initTestDb(true);
		notes = connection.getRepository(MiNote);
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 120000);
	afterAll(async () => {
		await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, root);
	});
	const create = async () => {
		const result = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: `Editing ${randomUUID()}`, text: 'Original content' }, alice);
		assert.strictEqual(result.status, 200);
		return (await api('community/submissions/show', { submissionId: result.body.id }, alice)).body;
	};
	const input = (work: misskey.entities.CommunitySubmissionsShowResponse, title = 'Updated title') => ({
		submissionId: work.id, version: work.version, category: 'resource' as const, title, text: 'Updated content',
	});
	const approve = async (work: misskey.entities.CommunitySubmissionsShowResponse) => {
		const result = await api('admin/community/review', { submissionId: work.id, version: work.version, decision: 'approve' }, root);
		assert.strictEqual(result.status, 200);
		return result.body;
	};

	test('only an authenticated owner can fetch or modify a draft, including attachment ownership', async () => {
		const work = await create();
		assert.strictEqual((await api('community/submissions/show', { submissionId: work.id })).status, 401);
		assert.strictEqual((await api('community/submissions/update', input(work))).status, 401);
		assert.strictEqual((await api('community/submissions/show', { submissionId: work.id }, bob)).status, 403);
		assert.strictEqual((await api('community/submissions/update', input(work), bob)).status, 403);
		const file = await uploadFile(bob);
		const result = await api('community/submissions/update', { ...input(work), fileIds: [file.body!.id] }, alice);
		assert.strictEqual(castAsError(result.body).error.code, 'COMMUNITY_INVALID_FILES');
		assert.strictEqual((await api('community/submissions/show', { submissionId: work.id }, alice)).body.version, work.version);
	});

	test('simultaneous saves use versions and stale moderation cannot approve the old content', async () => {
		const work = await create();
		const results = await Promise.all([
			api('community/submissions/update', input(work, 'Version A'), alice),
			api('community/submissions/update', input(work, 'Version B'), alice),
		]);
		assert.deepStrictEqual(results.map(result => result.status).sort(), [200, 409]);
		const staleReview = await api('admin/community/review', { submissionId: work.id, version: work.version, decision: 'approve' }, root);
		assert.strictEqual(staleReview.status, 409);
	});

	test('pre-review edits remain private until approved and keep the same Note and interactions', async () => {
		const work = await approve(await create());
		const noteId = work.approvedNoteId!;
		await notes.update({ id: noteId }, { repliesCount: 4, renoteCount: 3, reactions: { '❤': 7 } });
		const saved = await api('community/submissions/update', input(work, 'Private unapproved edit'), alice);
		assert.strictEqual(saved.status, 200);
		assert.strictEqual(saved.body.revisionPending, true);
		assert.strictEqual((await api('community/works/show', { submissionId: work.id })).body.title, work.title);
		assert.strictEqual((await api('community/submissions/show', { submissionId: work.id }, alice)).body.title, 'Private unapproved edit');
		assert.ok((await api('admin/community/submissions', { status: 'unreviewed' }, root)).body.items.some(item => item.id === work.id && item.revisionPending));
		const updated = await approve(saved.body);
		assert.strictEqual(updated.approvedNoteId, noteId);
		assert.strictEqual(updated.revisionPending, false);
		const note = await notes.findOneByOrFail({ id: noteId });
		assert.strictEqual(note.text, 'Private unapproved edit\n\nUpdated content');
		assert.strictEqual(note.repliesCount, 4);
		assert.strictEqual(note.renoteCount, 3);
		assert.deepStrictEqual(note.reactions, { '❤': 7 });
	});

	test('rejecting an edit preserves the original publication and keeps feedback private', async () => {
		const work = await approve(await create());
		const saved = await api('community/submissions/update', input(work), alice);
		const rejected = await api('admin/community/review', { submissionId: work.id, version: saved.body.version, decision: 'reject', reason: 'Please correct the edit' }, root);
		assert.strictEqual(rejected.status, 200);
		assert.strictEqual(rejected.body.status, 'approved');
		assert.strictEqual(rejected.body.title, work.title);
		assert.strictEqual(rejected.body.revisionPending, false);
		assert.strictEqual(rejected.body.rejectionReason, 'Please correct the edit');
		assert.strictEqual((await api('community/works/show', { submissionId: work.id })).body.rejectionReason, null);
	});

	test('post-review editing updates immediately but removed work must be reviewed again', async () => {
		await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'after' } }, root);
		try {
			const work = await create();
			const saved = await api('community/submissions/update', input(work), alice);
			assert.strictEqual(saved.status, 200);
			assert.strictEqual(saved.body.status, 'published');
			assert.strictEqual(saved.body.approvedNoteId, work.approvedNoteId);
			assert.strictEqual(saved.body.revisionPending, false);
			const removed = await api('admin/community/review', { submissionId: work.id, version: saved.body.version, decision: 'remove', reason: 'Rule violation' }, root);
			const corrected = await api('community/submissions/update', input(removed.body, 'Corrected work'), alice);
			assert.strictEqual(corrected.status, 200);
			assert.strictEqual(corrected.body.status, 'pending');
			assert.strictEqual(corrected.body.approvedNoteId, null);
			assert.strictEqual((await api('community/works/show', { submissionId: work.id })).status, 404);
		} finally {
			await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, root);
		}
	});

	test('authors can delete published work without deleting the shared drive attachment', async () => {
		const draft = await create();
		const uploaded = await uploadFile(alice);
		const saved = await api('community/submissions/update', { ...input(draft), category: 'image', fileIds: [uploaded.body!.id] }, alice);
		const work = await approve(saved.body);
		const request = { submissionId: work.id, version: work.version };
		assert.strictEqual((await api('community/submissions/delete', request)).status, 401);
		assert.strictEqual((await api('community/submissions/delete', request, bob)).status, 403);
		assert.strictEqual((await api('community/submissions/delete', { ...request, version: work.version - 1 }, alice)).status, 409);
		assert.strictEqual((await api('community/submissions/delete', request, alice)).status, 204);
		assert.strictEqual(await notes.existsBy({ id: work.approvedNoteId! }), false);
		assert.strictEqual((await api('community/works/show', { submissionId: work.id })).status, 404);
		assert.strictEqual((await api('community/submissions/show', { submissionId: work.id }, alice)).status, 404);
		assert.strictEqual((await api('community/submissions/delete', request, alice)).status, 404);
		assert.strictEqual((await api('drive/files/show', { fileId: uploaded.body!.id }, alice)).status, 200);
	});

	test('concurrent save and delete cannot destroy a newly saved version', async () => {
		const work = await create();
		const [saved, deleted] = await Promise.all([
			api('community/submissions/update', input(work), alice),
			api('community/submissions/delete', { submissionId: work.id, version: work.version }, alice),
		]);
		assert.strictEqual(Number(saved.status === 200) + Number(deleted.status === 204), 1);
		if (saved.status === 200) {
			assert.strictEqual(deleted.status, 409);
			assert.strictEqual((await api('community/submissions/show', { submissionId: work.id }, alice)).body.version, saved.body.version);
		} else {
			assert.strictEqual(saved.status, 404);
			assert.strictEqual((await api('admin/community/review', { submissionId: work.id, version: work.version, decision: 'approve' }, root)).status, 404);
		}
	});
});
