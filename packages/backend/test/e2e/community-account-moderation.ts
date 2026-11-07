/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { api, castAsError, initTestDb, signup } from '../utils.js';
import type * as Misskey from 'misskey-js';

describe('Community account moderation', () => {
	let admin: Misskey.entities.SignupResponse;
	let previous: Misskey.entities.AdminUpdateMetaRequest['clientOptions'];
	beforeAll(async () => {
		await initTestDb(true);
		admin = await signup({ username: 'root' });
		const settings = (await api('admin/meta', {}, admin)).body.clientOptions;
		previous = { communityPublicationMode: settings.communityPublicationMode ?? 'before', communityAutoBanEnabled: settings.communityAutoBanEnabled !== false, communityViolationThreshold: settings.communityViolationThreshold ?? 3 };
		await api('admin/update-meta', { clientOptions: { communityPublicationMode: 'before' } }, admin);
	}, 120000);
	afterAll(async () => { if (admin && previous) await api('admin/update-meta', { clientOptions: previous }, admin); });

	async function draft(user: Misskey.entities.SignupResponse) {
		const result = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Moderation test', text: 'Content evidence' }, user);
		assert.strictEqual(result.status, 200);
		return result.body.id;
	}

	async function info(user: Misskey.entities.SignupResponse) {
		const result = await api('admin/show-user', { userId: user.id }, admin);
		assert.strictEqual(result.status, 200);
		return result.body;
	}

	test('concurrent distinct decisions suspend atomically; retries do not count again; unban resets the active baseline', async () => {
		const user = await signup({ username: 'moderated' });
		assert.strictEqual((await api('admin/update-meta', { clientOptions: { communityViolationThreshold: 2, communityAutoBanEnabled: true } }, admin)).status, 204);
		const first = await draft(user), second = await draft(user);
		const review = (submissionId: string) => api('admin/community/review', { submissionId, version: 0, decision: 'reject', reason: 'Confirmed violation', recordViolation: true }, admin);
		const outcomes = await Promise.all([review(first), review(second)]);
		assert.ok(outcomes.every(result => result.status === 200));
		assert.strictEqual((await info(user)).communityViolationCount, 2);
		assert.strictEqual((await info(user)).isSuspended, true);
		assert.strictEqual((await review(first)).status, 409);
		assert.strictEqual((await info(user)).communityViolationCount, 2);
		const denied = await api('notes/create', { text: 'Blocked comment' }, user);
		assert.strictEqual(castAsError(denied.body).error.code, 'YOUR_ACCOUNT_SUSPENDED');
		const deniedWork = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title: 'Blocked', text: 'Blocked work' }, user);
		assert.strictEqual(castAsError(deniedWork.body).error.code, 'YOUR_ACCOUNT_SUSPENDED');
		assert.strictEqual((await api('admin/unsuspend-user', { userId: user.id }, admin)).status, 204);
		assert.strictEqual((await info(user)).communityViolationBaseline, 2);
		const third = await draft(user);
		assert.strictEqual((await review(third)).status, 200);
		assert.strictEqual((await info(user)).communityViolationCount, 3);
		assert.strictEqual((await info(user)).isSuspended, false);
	});

	test('reports and work reviews deduplicate; evidence survives deletion; ordinary rejection does not count', async () => {
		await api('admin/update-meta', { clientOptions: { communityViolationThreshold: 3 } }, admin);
		const author = await signup({ username: 'reportauthor' });
		const reporter = await signup({ username: 'reporter' });
		const other = await signup({ username: 'otherreporter' });
		const id = await draft(author);
		const approved = await api('admin/community/review', { submissionId: id, version: 0, decision: 'approve' }, admin);
		assert.strictEqual(approved.status, 200);
		const input = { submissionId: id, reason: 'Confirmed spam' };
		assert.strictEqual((await api('community/report', input)).status, 401);
		assert.strictEqual((await api('community/report', input, author)).status, 403);
		assert.strictEqual((await api('community/report', input, reporter)).status, 204);
		assert.strictEqual((await api('community/report', input, other)).status, 204);
		assert.strictEqual((await info(author)).communityViolationCount, 0);
		const listed = await api('admin/abuse-user-reports', { state: 'unresolved', limit: 100 }, admin);
		const reports = listed.body.filter(report => report.contentKey === `work:${id}`);
		assert.strictEqual(reports.length, 2);
		assert.ok(reports.every(report => report.contentSnapshot?.includes('Content evidence')));
		assert.strictEqual((await api('admin/resolve-abuse-user-report', { reportId: reports[0].id, resolvedAs: 'accept' }, reporter)).status, 403);
		const outcomes = await Promise.all([
			...reports.map(report => api('admin/resolve-abuse-user-report', { reportId: report.id, resolvedAs: 'accept' }, admin)),
			api('admin/community/review', { submissionId: id, version: approved.body.version, decision: 'remove', reason: 'Spam' }, admin),
		]);
		assert.ok(outcomes.every(result => result.status === 200 || result.status === 204));
		assert.strictEqual((await info(author)).communityViolationCount, 1);
		await api('admin/resolve-abuse-user-report', { reportId: reports[0].id, resolvedAs: 'accept' }, admin);
		assert.strictEqual((await info(author)).communityViolationCount, 1);
		const rejected = await draft(author);
		await api('admin/community/review', { submissionId: rejected, version: 0, decision: 'reject', reason: 'Improve formatting' }, admin);
		assert.strictEqual((await info(author)).communityViolationCount, 1);
	});

	test('comment target must belong to the work; report visibility matches native note detail', async () => {
		const author = await signup({ username: 'commentowner' });
		const commenter = await signup({ username: 'commenter' });
		const id = await draft(author);
		const work = await api('admin/community/review', { submissionId: id, version: 0, decision: 'approve' }, admin);
		const reply = await api('notes/create', { text: 'Comment evidence', replyId: work.body.approvedNoteId!, visibility: 'followers' }, commenter);
		assert.strictEqual(reply.status, 200);
		assert.strictEqual((await api('community/report', { submissionId: id, noteId: reply.body.createdNote.id, reason: 'Comment violation' }, author)).status, 204);
		const unrelated = await api('notes/create', { text: 'Unrelated note' }, commenter);
		assert.strictEqual((await api('community/report', { submissionId: id, noteId: unrelated.body.createdNote.id, reason: 'Forged target' }, author)).status, 404);
		const reports = await api('admin/abuse-user-reports', { state: 'unresolved', limit: 100 }, admin);
		const report = reports.body.find(item => item.contentKey === `note:${reply.body.createdNote.id}`)!;
		assert.strictEqual(report.targetUserId, commenter.id);
		await api('notes/delete', { noteId: reply.body.createdNote.id }, commenter);
		await api('admin/resolve-abuse-user-report', { reportId: report.id, resolvedAs: 'accept' }, admin);
		assert.strictEqual((await info(commenter)).communityViolationCount, 1);
	});

	test('threshold is admin-only, bounded and integer; disabled automatic suspension retains counts', async () => {
		const user = await signup({ username: 'ruleuser' });
		assert.strictEqual((await api('admin/update-meta', { clientOptions: { communityViolationThreshold: 1 } }, user)).status, 403);
		for (const threshold of [0, -1, 1.5, 1001]) {
			assert.strictEqual((await api('admin/update-meta', { clientOptions: { communityViolationThreshold: threshold } }, admin)).status, 400);
		}
		await api('admin/update-meta', { clientOptions: { communityViolationThreshold: 1, communityAutoBanEnabled: false } }, admin);
		const id = await draft(user);
		await api('admin/community/review', { submissionId: id, version: 0, decision: 'reject', reason: 'Violation', recordViolation: true }, admin);
		assert.strictEqual((await info(user)).communityViolationCount, 1);
		assert.strictEqual((await info(user)).isSuspended, false);
	});
});
