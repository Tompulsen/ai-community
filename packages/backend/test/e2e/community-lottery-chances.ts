/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, test } from 'vitest';
import { MiUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { genAidx } from '@/misc/id/aidx.js';
import { generateNativeUserToken } from '@/misc/token.js';
import { api, castAsError, initTestDb } from '../utils.js';

describe('Administrator draw chances', () => {
	let admin: { id: string; token: string };
	let user: { id: string; token: string };
	beforeAll(async () => {
		const db = await initTestDb(true);
		try {
			// Seed identities directly: these tests exercise draw permissions, not registration.
			const createAccount = async (username: string) => {
				const account = { id: genAidx(Date.now()), token: generateNativeUserToken() };
				await db.getRepository(MiUser).insert({ ...account, username, usernameLower: username, host: null });
				await db.getRepository(MiUserProfile).insert({ userId: account.id });
				return account;
			};
			admin = await createAccount('root');
			user = await createAccount('lotteryrecipient');
			const roleId = genAidx(Date.now());
			await db.getRepository(MiRole).insert({ id: roleId, updatedAt: new Date(), lastUsedAt: new Date(), name: 'Lottery administrator', description: '', isAdministrator: true });
			await db.getRepository(MiRoleAssignment).insert({ id: genAidx(Date.now()), roleId, userId: admin.id });
		} finally { await db.destroy(); }
	}, 120000);

	const adjustment = (amount: number, expectedBalance: number, mode: 'add' | 'set' = 'add') => ({ userId: user.id, mode, amount, expectedBalance, requestId: randomUUID(), reason: 'Campaign reward' });

	test('guests and ordinary users cannot read or change another account', async () => {
		for (const actor of [undefined, user]) {
			const expected = actor ? 403 : 400;
			const responses = [
				await api('admin/community/lottery/account', { userId: user.id }, actor),
				await api('admin/community/lottery/adjust-chances', adjustment(1, 0), actor),
			];
			for (const response of responses) {
				assert.equal(response.status, expected);
				assert.equal(castAsError(response.body).error.code, actor ? 'ROLE_PERMISSION_DENIED' : 'ACCESS_DENIED');
			}
		}
	});

	test('adds, sets and clears chances while paused; logs before/after and replays once', async () => {
		assert.equal((await api('admin/community/lottery/account', { userId: user.id }, admin)).body.balance, 0);
		const input = adjustment(5, 0);
		const added = await api('admin/community/lottery/adjust-chances', input, admin);
		assert.equal(added.status, 200);
		assert.equal(added.body.balance, 5);
		assert.equal((await api('admin/community/lottery/adjust-chances', input, admin)).body.balance, 5);
		assert.equal((await api('admin/community/lottery/adjust-chances', { ...input, amount: 6 }, admin)).status, 409);
		const logs = await api('admin/show-moderation-logs', { type: 'adjustLotteryChances', search: input.requestId }, admin);
		assert.equal(logs.body.length, 1);
		assert.equal(logs.body[0].userId, admin.id);
		const { expectedBalance: _, ...loggedInput } = input;
		assert.deepEqual(logs.body[0].info, { ...loggedInput, before: 0, after: 5 });
		assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(2, 5, 'set'), admin)).body.balance, 2);
		assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(0, 2, 'set'), admin)).body.balance, 0);
		assert.equal((await api('community/lottery/status', {}, user)).body.balance, 0);
	});

	test('concurrent edits cannot overwrite each other; the same request remains safe after balance returns to its old value', async () => {
		const input = adjustment(1, 0);
		const competing = adjustment(1, 0);
		const outcomes = await Promise.all([
			api('admin/community/lottery/adjust-chances', input, admin),
			api('admin/community/lottery/adjust-chances', competing, admin),
		]);
		assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
		const successful = outcomes[0].status === 200 ? input : competing;
		assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(0, 1, 'set'), admin)).status, 200);
		assert.equal((await api('admin/community/lottery/adjust-chances', successful, admin)).body.balance, 0);
		const replay = adjustment(3, 0);
		const duplicates = await Promise.all([api('admin/community/lottery/adjust-chances', replay, admin), api('admin/community/lottery/adjust-chances', replay, admin)]);
		assert.ok(duplicates.every(r => r.status === 200 && r.body.balance === 3));
	});

	test('rejects invalid counts, overflow and suspended recipients without changing the account', async () => {
		for (const amount of [-1, .5, 2147483648, 0]) assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(amount, 3), admin)).status, 400);
		assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(2147483647, 3), admin)).status, 400);
		assert.equal((await api('admin/community/lottery/account', { userId: user.id }, admin)).body.balance, 3);
		await api('admin/suspend-user', { userId: user.id }, admin);
		assert.equal((await api('admin/community/lottery/adjust-chances', adjustment(4, 3), admin)).status, 403);
		assert.equal((await api('admin/community/lottery/account', { userId: user.id }, admin)).status, 403);
	});
});
