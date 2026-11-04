/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, test } from 'vitest';
import { MiNote } from '@/models/Note.js';
import { MiUser } from '@/models/User.js';
import { api, initTestDb, signup } from '../utils.js';
import type { Repository } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Community homepage selection', () => {
	let root: misskey.entities.SignupResponse;
	let author: misskey.entities.SignupResponse;
	let notes: Repository<MiNote>;
	let users: Repository<MiUser>;
	beforeAll(async () => {
		const db = await initTestDb(true);
		notes = db.getRepository(MiNote);
		users = db.getRepository(MiUser);
		root = await signup({ username: 'root' });
		author = await signup({ username: 'featured_author' });
	}, 120000);

	test('ranks interaction totals and keeps the visitor view for administrators', async () => {
		const approve = async (title: string) => {
			const submission = await api('community/submissions/create', { idempotencyKey: randomUUID(), category: 'resource', title, text: 'Public example' }, author);
			assert.strictEqual(submission.status, 200);
			const review = await api('admin/community/review', { submissionId: submission.body.id, version: 0, decision: 'approve' }, root);
			assert.strictEqual(review.status, 200);
			assert.ok(review.body.approvedNoteId);
			return review.body;
		};
		const older = await approve('Older popular work');
		const newer = await approve('Newer work');
		await notes.update(older.approvedNoteId!, { repliesCount: 30000, renoteCount: 30000, reactions: { '👍': 2, '✨': 3 } });
		await notes.update(newer.approvedNoteId!, { repliesCount: 2 });
		const popular = await api('community/featured', {});
		assert.strictEqual(popular.status, 200);
		assert.strictEqual(popular.body.items[0].id, older.id);
		assert.strictEqual(popular.body.nextCursor, null);
		await notes.update(newer.approvedNoteId!, { repliesCount: 30000, renoteCount: 30000, reactions: { '👍': 5 } });
		assert.strictEqual((await api('community/featured', {})).body.items[0].id, newer.id);
		await notes.update(newer.approvedNoteId!, { visibility: 'followers' });
		assert.strictEqual((await api('community/featured', {})).body.items[0].id, older.id);
		await users.update(author.id, { requireSigninToViewContents: true });
		assert.deepStrictEqual((await api('community/featured', {}, root)).body.items, []);
		assert.deepStrictEqual((await api('community/featured', {}, author)).body.items, []);
	});
});
