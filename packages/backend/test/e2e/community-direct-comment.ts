/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiNote } from '@/models/Note.js';
import type { DataSource } from 'typeorm';
import { api, initTestDb, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

describe.sequential('Direct remix comments', () => {
	let db: DataSource;
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let remixer: misskey.entities.SignupResponse;
	let source: misskey.entities.CommunitySubmissionsShowResponse;
	const mode = (value: 'before' | 'after') => api('admin/update-meta', { clientOptions: { communityPublicationMode: value } }, root);
	beforeAll(async () => {
		db = await initTestDb(true);
		root = await signup({ username: 'root' });
		author = await signup({ username: 'directsource' });
		remixer = await signup({ username: 'directremixer' });
		await mode('after');
		const original = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Source', text: 'Original' }, author);
		source = (await api('community/submissions/show', { submissionId: original.body.id }, author)).body;
	}, 120000);
	afterAll(async () => { await mode('before'); await db.destroy(); });
	const input = () => ({ idempotencyKey: randomUUID(), destination: 'source-comment' as const, resultId: randomUUID(), category: 'resource' as const, title: 'Remix', text: 'Generated result', generation: { prompt: '', model: 'test-model', referenceFileIds: [], sourceWorkId: source.id } });

	test('concurrent retries create only a reply, exclude it from the work feed and preserve deletion', async () => {
		const request = input();
		const results = await Promise.all([api('community/submissions/create', request, remixer), api('community/submissions/create', { ...request, idempotencyKey: randomUUID() }, remixer)]);
		assert.strictEqual(results[0].status, 200);
		assert.strictEqual(results[1].body.id, results[0].body.id);
		const work = (await api('community/submissions/show', { submissionId: results[0].body.id }, remixer)).body;
		assert.strictEqual(work.destination, 'source-comment');
		const reply = (await api('notes/show', { noteId: work.approvedNoteId! }, author)).body;
		assert.strictEqual(reply.replyId, source.approvedNoteId);
		assert.ok(!reply.renoteId);
		const feed = (await api('community/works', {}, remixer)).body;
		assert.ok(!feed.items.some(item => item.id === work.id));
		assert.strictEqual((await api('community/works/show', { submissionId: work.id }, remixer)).status, 404);
		await api('community/submissions/delete', { submissionId: work.id, version: work.version }, remixer);
		const retry = await api('community/submissions/create', request, remixer);
		assert.strictEqual(retry.body.id, work.id);
		assert.strictEqual(retry.body.status, 'removed');
	});

	test('requires a saved source and rechecks it during approval', async () => {
		const request = input();
		assert.strictEqual((await api('community/submissions/create', { ...request, generation: { ...request.generation, sourceWorkId: undefined } }, remixer)).status, 400);
		await mode('before');
		try {
			const pending = await api('community/submissions/create', request, remixer);
			assert.strictEqual(pending.body.status, 'pending');
			assert.strictEqual(pending.body.sourceCommentStatus, 'pending');
			await api('blocking/create', { userId: remixer.id }, author);
			try {
				const blocked = await api('admin/community/review', { submissionId: pending.body.id, version: 0, decision: 'approve' }, root);
				assert.strictEqual(blocked.status, 400);
			} finally { await api('blocking/delete', { userId: remixer.id }, author); }
			const approved = await api('admin/community/review', { submissionId: pending.body.id, version: 0, decision: 'approve' }, root);
			assert.strictEqual(approved.body.sourceCommentStatus, 'shared');
		} finally { await mode('after'); }
	});

	test('video works publish normally but cannot become direct, synchronized or ordinary comments', async () => {
		const uploaded = await uploadFile(remixer);
		assert.ok(uploaded.body);
		const fileId = uploaded.body.id;
		// The submission boundary uses server-owned MIME metadata, never a client category.
		await db.getRepository(MiDriveFile).update({ id: fileId }, { type: 'video/mp4' });
		const video = { ...input(), category: 'video' as const, fileIds: [fileId] };
		for (const category of ['video', 'resource'] as const) {
			const direct = await api('community/submissions/create', { ...video, category }, remixer);
			assert.strictEqual(direct.status, 400);
			const synced = await api('community/submissions/create', { ...video, category, destination: 'community', generation: { ...video.generation, shareToSource: true } }, remixer);
			assert.strictEqual(synced.status, 400);
		}
		const published = await api('community/submissions/create', { ...video, destination: 'community' }, remixer);
		assert.strictEqual(published.status, 200);
		assert.strictEqual(published.body.sourceCommentStatus, 'none');
		const work = (await api('community/submissions/show', { submissionId: published.body.id }, remixer)).body;
		for (const attachment of [{ fileIds: [fileId] }, { renoteId: work.approvedNoteId! }]) {
			assert.strictEqual((await api('notes/create', { replyId: source.approvedNoteId!, text: 'Video comment', ...attachment }, remixer)).status, 400);
		}
		assert.strictEqual((await api('notes/create', { replyId: source.approvedNoteId!, text: 'Text comment' }, remixer)).status, 200);
	});

	test('concurrent quote comments and video edits cannot both succeed', async () => {
		const uploaded = await uploadFile(remixer);
		assert.ok(uploaded.body);
		await db.getRepository(MiDriveFile).update({ id: uploaded.body.id }, { type: 'video/mp4' });
		const published = await api('community/submissions/create', { ...input(), destination: 'community' }, remixer);
		const work = (await api('community/submissions/show', { submissionId: published.body.id }, remixer)).body;
		const [comment, edit] = await Promise.all([
			api('notes/create', { replyId: source.approvedNoteId!, renoteId: work.approvedNoteId!, text: 'My work' }, remixer),
			api('community/submissions/update', { submissionId: work.id, version: work.version, category: 'video', title: work.title, text: work.text, fileIds: [uploaded.body.id] }, remixer),
		]);
		assert.ok(comment.status === 200 || edit.status === 200);
		assert.ok(comment.status !== 200 || edit.status !== 200);
		const current = await db.getRepository(MiNote).findOneByOrFail({ id: work.approvedNoteId! });
		if (current.attachedFileTypes.includes('video/mp4')) assert.strictEqual(await db.getRepository(MiNote).countBy({ renoteId: current.id, replyId: source.approvedNoteId! }), 0);
	});
});
