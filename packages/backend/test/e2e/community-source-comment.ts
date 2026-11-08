/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { MiNote } from '@/models/Note.js';
import { api, initTestDb, signup } from '../utils.js';
import type { Repository } from 'typeorm';
import type * as misskey from 'misskey-js';

describe.sequential('Community remix comment sharing', () => {
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let remixer: misskey.entities.SignupResponse;
	let notes: Repository<MiNote>;
	let source: misskey.entities.CommunitySubmissionsShowResponse;
	beforeAll(async () => {
		const db = await initTestDb(true);
		notes = db.getRepository(MiNote);
		root = await signup({ username: 'root' });
		author = await signup({ username: 'sourceauthor' });
		remixer = await signup({ username: 'remixer' });
		await mode('after');
		const result = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Source', text: 'Original prompt' }, author);
		assert.strictEqual(result.status, 200);
		source = (await api('community/submissions/show', { submissionId: result.body.id }, author)).body;
	}, 120000);

	afterAll(async () => { await mode('before'); });
	const mode = (value: 'before' | 'after') => api('admin/update-meta', { clientOptions: { communityPublicationMode: value } }, root);
	const input = (shareToSource?: boolean) => ({
		idempotencyKey: randomUUID(), category: 'resource' as const, title: 'My remix', text: 'Generated text',
		generation: { prompt: 'Original prompt', model: 'test-model', referenceFileIds: [], sourceWorkId: source.id, ...(shareToSource === undefined ? {} : { shareToSource }) },
	});
	const replies = () => notes.findBy({ replyId: source.approvedNoteId! });

	test('default opt-out and explicit false are idempotently equivalent', async () => {
		const before = (await replies()).length;
		const request = input();
		const result = await api('community/submissions/create', request, remixer);
		assert.strictEqual(result.status, 200);
		assert.strictEqual(result.body.sourceCommentStatus, 'none');
		const retry = await api('community/submissions/create', { ...request, generation: { ...request.generation, shareToSource: false } }, remixer);
		assert.strictEqual(retry.body.id, result.body.id);
		assert.strictEqual((await replies()).length, before);
	});

	test('publication shares a native reply and quote once across concurrent retries and review', async () => {
		const request = input(true);
		const results = await Promise.all([api('community/submissions/create', request, remixer), api('community/submissions/create', request, remixer)]);
		for (const result of results) assert.strictEqual(result.status, 200);
		assert.strictEqual(results[0].body.id, results[1].body.id);
		assert.strictEqual(results[0].body.sourceCommentStatus, 'shared');
		const work = (await api('community/submissions/show', { submissionId: results[0].body.id }, remixer)).body;
		const matching = (await replies()).filter(note => note.renoteId === work.approvedNoteId);
		assert.strictEqual(matching.length, 1);
		assert.strictEqual(matching[0].userId, remixer.id);
		assert.deepStrictEqual(matching[0].fileIds, []);
		assert.ok(matching[0].text?.endsWith(`/community/work/${work.id}`));
		assert.strictEqual((await api('admin/community/review', { submissionId: work.id, version: work.version, decision: 'approve' }, root)).status, 200);
		assert.strictEqual((await replies()).filter(note => note.renoteId === work.approvedNoteId).length, 1);
	});

	test('pre-review works remain private and synchronize only on approval', async () => {
		await mode('before');
		try {
			const before = (await replies()).length;
			const pending = await api('community/submissions/create', input(true), remixer);
			assert.strictEqual(pending.body.sourceCommentStatus, 'pending');
			assert.strictEqual((await replies()).length, before);
			const approved = await api('admin/community/review', { submissionId: pending.body.id, version: 0, decision: 'approve' }, root);
			assert.strictEqual(approved.status, 200);
			assert.strictEqual(approved.body.sourceCommentStatus, 'shared');
			assert.strictEqual((await replies()).length, before + 1);
		} finally { await mode('after'); }
	});

	test('blocking or an unavailable source skips the comment without losing the work', async () => {
		const before = (await replies()).length;
		await api('blocking/create', { userId: remixer.id }, author);
		try {
			const result = await api('community/submissions/create', input(true), remixer);
			assert.strictEqual(result.status, 200);
			assert.strictEqual(result.body.status, 'published');
			assert.strictEqual(result.body.sourceCommentStatus, 'unavailable');
			assert.strictEqual((await replies()).length, before);
		} finally { await api('blocking/delete', { userId: remixer.id }, author); }
		const request = input(true);
		request.generation.sourceWorkId = 'missing';
		const result = await api('community/submissions/create', request, remixer);
		assert.strictEqual(result.body.sourceCommentStatus, 'unavailable');
	});
});
