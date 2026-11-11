/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { chooseLotteryPrize, defaultLotterySettings, emptyLotteryProgress, lotteryCreditReceipt, lotteryCredits, normalizeLotterySettings } from '../../src/misc/community-lottery.js';
import { lotterySettingsParam, lotteryAdjustmentParam } from '../../src/server/api/lottery-schema.js';
import Ajv from 'ajv';

describe('community lottery', () => {
	test('credits require a matching persisted quota snapshot with exact decimal rounding', () => {
		const response = { credited: true, reference: 'community_lottery_fixture_0', user_id: 3, amount_cents: 1, receipt: { id: 7, quota_added: 5000, quota_per_usd: '500000' } };
		expect(lotteryCreditReceipt(response, response.reference, 3, 1)).toEqual({ id: 7, quotaAdded: 5000, quotaPerUsd: '500000' });
		for (const [rate, quota] of [['50', 1], ['500000.25', 5000], ['900000000000000000', 9000000000000000]] as const) {
			expect(lotteryCreditReceipt({ ...response, receipt: { id: 7, quota_added: quota, quota_per_usd: rate } }, response.reference, 3, 1).quotaAdded).toBe(quota);
		}
		for (const patch of [{ credited: false }, { user_id: 4 }, { amount_cents: 2 }, { reference: 'other' }, { receipt: null }, { receipt: { ...response.receipt, id: 0 } }, { receipt: { ...response.receipt, quota_added: 4999 } }, { receipt: { ...response.receipt, quota_added: 5000.5 } }, { receipt: { ...response.receipt, quota_per_usd: '1e6' } }, { receipt: { ...response.receipt, quota_per_usd: '0' } }]) {
			expect(() => lotteryCreditReceipt({ ...response, ...patch }, response.reference, 3, 1)).toThrow('LOTTERY_CREDIT_RESPONSE');
		}
	});

	test('manual adjustments require a target, expected balance and bounded whole numbers', () => {
		const ajv = new Ajv({ useDefaults: true });
		ajv.addFormat('misskey:id', /^[a-zA-Z0-9]+$/);
		const validate = ajv.compile(lotteryAdjustmentParam);
		const input = { userId: 'localuser', mode: 'set', amount: 0, expectedBalance: 5, requestId: 'adjust_request_0001' };
		expect(validate({ ...input })).toBe(true);
		expect(validate({ ...input, mode: 'add', amount: 2147483647 })).toBe(true);
		for (const invalid of [{ amount: -1 }, { amount: .5 }, { amount: 2147483648 }, { expectedBalance: -1 }, { expectedBalance: .5 }, { expectedBalance: 2147483648 }, { mode: 'subtract' }, { requestId: 'short' }, { reason: 'a'.repeat(301) }, { userId: 'invalid id' }]) {
			expect(validate({ ...input, ...invalid })).toBe(false);
		}
		for (const key of ['userId', 'mode', 'amount', 'expectedBalance', 'requestId']) {
			const missing: Record<string, unknown> = { ...input };
			delete missing[key];
			expect(validate(missing)).toBe(false);
		}
	});

	test('old settings receive a separate default wheel without altering rewards', () => {
		const { wheel: _, ...old } = defaultLotterySettings();
		const first = normalizeLotterySettings(old);
		expect(first.wheel.theme).toBe('teal');
		expect(first.prizes).toEqual(old.prizes);
		first.wheel.title = 'Changed';
		expect(normalizeLotterySettings(old).wheel.title).toBe('');
	});

	test('appearance accepts bounded text and known themes, and remains optional for old clients', () => {
		const validate = new Ajv().compile(lotterySettingsParam);
		const settings = defaultLotterySettings();
		expect(validate(settings)).toBe(true);
		const { wheel: _, ...old } = settings;
		expect(validate(old)).toBe(true);
		for (const wheel of [{ ...settings.wheel, theme: 'url(example)' }, { ...settings.wheel, title: 'a'.repeat(33) }, { ...settings.wheel, buttonText: '' }, { ...settings.wheel, rulesText: 'a'.repeat(2001) }, { ...settings.wheel, html: '<script>' }]) {
			expect(validate({ ...settings, wheel })).toBe(false);
		}
	});

	test('each work earns separately and milestones cannot be reclaimed after counts fall', () => {
		const settings = { ...defaultLotterySettings(), enabled: true };
		const counts = { invites: 1, followers: 100, works: [{ id: 'a', likes: 99 }, { id: 'b', likes: 1 }] };
		const first = lotteryCredits(emptyLotteryProgress(), counts, settings);
		expect(first.added).toBe(2);
		counts.works = [{ id: 'a', likes: 100 }, { id: 'b', likes: 100 }];
		const second = lotteryCredits(first.progress, counts, settings);
		expect(second.added).toBe(2);
		const fallen = lotteryCredits(second.progress, { ...counts, followers: 99, works: [] }, settings);
		expect(fallen.added).toBe(0);
		expect(lotteryCredits(fallen.progress, counts, settings).added).toBe(0);
		settings.likes.threshold = 50;
		expect(lotteryCredits(second.progress, counts, settings).added).toBe(2);
		settings.enabled = false;
		expect(lotteryCredits(second.progress, counts, settings).added).toBe(0);
	});

	test('only enabled prizes with stock participate in the exact weighted range', () => {
		const prize = { id: 'a', name: 'Balance', description: '', kind: 'balance' as const, amountCents: 50, weight: 1, stock: -1, enabled: true };
		expect(chooseLotteryPrize([{ ...prize, stock: 0 }])).toBeNull();
		const prizes = [prize, { ...prize, id: 'b', weight: 3 }, { ...prize, id: 'disabled', enabled: false }];
		expect(chooseLotteryPrize(prizes, () => 0)?.id).toBe('a');
		expect(chooseLotteryPrize(prizes, () => 1)?.id).toBe('b');
		expect(chooseLotteryPrize(prizes, () => 3)?.id).toBe('b');
	});
});
