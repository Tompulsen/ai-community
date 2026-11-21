/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { chooseLotteryPrize, defaultLotterySettings, emptyLotteryProgress, lotteryCreditReceipt, lotteryCredits, normalizeLotterySettings } from './lottery.js';

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

	test('charity receipts require frozen points, matching duration and the original expiry', () => {
		const expected = { rewardKind: 'charity' as const, validityHours: 48 };
		const creditedAt = 1795000000;
		const receipt = { id: 7, quota_added: 250000, quota_per_usd: '500000', reward_kind: 'charity',
			validity_hours: 48, credited_at: creditedAt, expires_at: creditedAt + 48 * 3600, points: '2500', quota_per_point: 100, lot_id: 19 };
		const response = { credited: true, reference: 'community_lottery_fixture_0', user_id: 3, amount_cents: 50, receipt };
		expect(lotteryCreditReceipt(response, response.reference, 3, 50, expected)).toEqual({
			id: 7, quotaAdded: 250000, quotaPerUsd: '500000', rewardKind: 'charity', validityHours: 48,
			creditedAt, expiresAt: receipt.expires_at, points: '2500', quotaPerPoint: 100, lotId: 19,
		});
		for (const patch of [{ reward_kind: 'balance' }, { reward_kind: undefined }, { validity_hours: 168 },
			{ expires_at: receipt.expires_at + 1 }, { expires_at: 0 }, { expires_at: Number.MAX_SAFE_INTEGER + 1 }, { expires_at: 8640000000001 },
			{ credited_at: undefined }, { credited_at: String(creditedAt) }, { credited_at: 0 },
			{ points: '2499' }, { points: '02500' }, { points: '2500.0' }, { points: 2500 }, { points: '0' },
			{ lot_id: 0 }, { lot_id: '19' }, { lot_id: Number.MAX_SAFE_INTEGER + 1 },
			{ quota_per_point: undefined }, { quota_per_point: 100.5 }, { quota_per_point: 0 }, { quota_per_point: 101 }]) {
			expect(() => lotteryCreditReceipt({ ...response, receipt: { ...receipt, ...patch } }, response.reference, 3, 50, expected)).toThrow('LOTTERY_CREDIT_RESPONSE');
		}
		for (const validityHours of [undefined, 0, -1, 1.5, 8761, Number.MAX_SAFE_INTEGER]) {
			expect(() => lotteryCreditReceipt(response, response.reference, 3, 50, { ...expected, validityHours })).toThrow('LOTTERY_CREDIT_RESPONSE');
		}
		expect(() => lotteryCreditReceipt(response, response.reference, 3, 50)).toThrow('LOTTERY_CREDIT_RESPONSE');
	});

	test('old settings retain their numeric threshold under consumption and a separate wheel without altering rewards', () => {
		const { wheel: _, minConsumptionCnyFen: _consumption, rewardValidityHours: _validity, ...old } = defaultLotterySettings();
		const first = normalizeLotterySettings(old);
		expect(first.minConsumptionCnyFen).toBe(0);
		expect(first.rewardValidityHours).toBe(168);
		const legacy = { ...old, minSupportCnyFen: 129 };
		const migrated = normalizeLotterySettings(legacy);
		expect(migrated.minConsumptionCnyFen).toBe(129);
		expect(migrated).not.toHaveProperty('minSupportCnyFen');
		expect(legacy.minSupportCnyFen).toBe(129);
		expect(normalizeLotterySettings({ ...legacy, minConsumptionCnyFen: 0 }).minConsumptionCnyFen).toBe(0);
		expect(first.wheel.theme).toBe('teal');
		expect(first.prizes).toEqual(old.prizes);
		first.wheel.title = 'Changed';
		expect(normalizeLotterySettings(old).wheel.title).toBe('');
	});

	test('reward durations accept whole hours within one year and reject zero or invalid stored values', () => {
		for (const rewardValidityHours of [1, 168, 8760]) {
			expect(normalizeLotterySettings({ ...defaultLotterySettings(), rewardValidityHours }).rewardValidityHours).toBe(rewardValidityHours);
		}
		for (const rewardValidityHours of [0, -1, 1.5, 8761, Number.MAX_SAFE_INTEGER, NaN]) {
			expect(() => normalizeLotterySettings({ ...defaultLotterySettings(), rewardValidityHours })).toThrow('LOTTERY_INVALID');
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
