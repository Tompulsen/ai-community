/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, test } from 'vitest';
import { Blob } from 'node-fetch';
import { MiNote } from '@/models/Note.js';
import { api, castAsError, initTestDb, signup, uploadFile } from '../utils.js';
import type { Repository } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Community submissions', () => {
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

	const draft = (overrides: Partial<misskey.entities.CommunitySubmissionsCreateRequest> = {}) => ({
		idempotencyKey: randomUUID(), category: 'resource' as const,
		title: 'Community regression', text: 'A useful Skill 😄', ...overrides,
	});

	test('requires sign-in for owner history and moderator authorization for review', async () => {
		assert.strictEqual((await api('community/submissions/mine', {})).status, 401);
		const anonymousList = await api('admin/community/submissions', {});
		assert.strictEqual(anonymousList.status, 400);
		assert.strictEqual(castAsError(anonymousList.body).error.code, 'ACCESS_DENIED');
		assert.strictEqual((await api('admin/community/submissions', {}, alice)).status, 403);
		const created = await api('community/submissions/create', draft(), alice);
		assert.strictEqual(created.status, 200);
		const review = { submissionId: created.body.id, version: 0, decision: 'approve' as const };
		const anonymousReview = await api('admin/community/review', review);
		assert.strictEqual(anonymousReview.status, 400);
		assert.strictEqual(castAsError(anonymousReview.body).error.code, 'ACCESS_DENIED');
		assert.strictEqual((await api('admin/community/review', review, bob)).status, 403);
		const own = await api('community/submissions/mine', {}, alice);
		const other = await api('community/submissions/mine', {}, bob);
		const published = await api('community/works', {});
		assert.ok(own.body.items.some(item => item.id === created.body.id));
		assert.ok(!other.body.items.some(item => item.id === created.body.id));
		assert.ok(!published.body.items.some(item => item.id === created.body.id));
	});

	test('retries are idempotent and reject attachment ids owned by another user', async () => {
		const uploaded = await uploadFile(alice, { name: 'SKILL.md', blob: new Blob(['# Example Skill\nInstructions'], { type: 'text/markdown' }) });
		assert.strictEqual(uploaded.status, 200);
		assert.ok(uploaded.body);
		const input = draft({ fileIds: [uploaded.body.id] });
		const first = await api('community/submissions/create', input, alice);
		const retry = await api('community/submissions/create', input, alice);
		assert.strictEqual(first.status, 200);
		assert.deepStrictEqual(retry.body, first.body);
		const conflict = await api('community/submissions/create', { ...input, title: 'Changed payload' }, alice);
		assert.strictEqual(conflict.status, 409);
		const foreign = await api('community/submissions/create', draft({ fileIds: [uploaded.body.id] }), bob);
		assert.strictEqual(castAsError(foreign.body).error.code, 'COMMUNITY_INVALID_FILES');
	});

	test('concurrent approvals produce exactly one public Note', async () => {
		const input = draft({ title: `Concurrent ${randomUUID()}` });
		const created = await api('community/submissions/create', input, alice);
		assert.strictEqual(created.status, 200);
		const review = { submissionId: created.body.id, version: 0, decision: 'approve' as const };
		const results = await Promise.all([
			api('admin/community/review', review, root),
			api('admin/community/review', review, root),
		]);
		assert.deepStrictEqual(results.map(result => result.status).sort(), [200, 409]);
		const approved = results.find(result => result.status === 200)!;
		assert.ok(approved.body.approvedNoteId);
		assert.strictEqual(await notes.countBy({ userId: alice.id, text: `${input.title}\n\n${input.text}` }), 1);
		const published = await api('community/works', { query: input.title });
		assert.strictEqual(published.body.items.length, 1);
		assert.strictEqual(published.body.items[0].approvedNoteId, approved.body.approvedNoteId);
	});

	test('an attachment removed before approval leaves the submission pending without a Note', async () => {
		const uploaded = await uploadFile(alice);
		assert.strictEqual(uploaded.status, 200);
		assert.ok(uploaded.body);
		const input = draft({ category: 'image', fileIds: [uploaded.body.id], title: `Removed ${randomUUID()}` });
		const created = await api('community/submissions/create', input, alice);
		assert.strictEqual(created.status, 200);
		assert.strictEqual((await api('drive/files/delete', { fileId: uploaded.body.id }, alice)).status, 204);
		const reviewed = await api('admin/community/review', { submissionId: created.body.id, version: 0, decision: 'approve' }, root);
		assert.strictEqual(castAsError(reviewed.body).error.code, 'COMMUNITY_INVALID_FILES');
		const own = await api('community/submissions/mine', { query: input.title }, alice);
		assert.strictEqual(own.body.items[0].status, 'pending');
		assert.strictEqual(own.body.items[0].version, 0);
		assert.strictEqual(own.body.items[0].approvedNoteId, null);
		assert.strictEqual(await notes.countBy({ userId: alice.id, text: `${input.title}\n\n${input.text}` }), 0);
	});

	test('ordinary Note and poll creation still use the native publication path', async () => {
		const ordinary = await api('notes/create', { text: 'Ordinary note' }, alice);
		assert.strictEqual(ordinary.status, 200);
		assert.strictEqual(ordinary.body.createdNote.text, 'Ordinary note');
		const poll = await api('notes/create', { text: 'Choose', poll: { choices: ['A', 'B'], multiple: false } }, alice);
		assert.strictEqual(poll.status, 200);
		assert.deepStrictEqual(poll.body.createdNote.poll?.choices.map(choice => choice.text), ['A', 'B']);
	});
});
