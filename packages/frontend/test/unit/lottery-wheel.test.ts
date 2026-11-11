/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { lotteryPercentages, wheelPrizesForReceipt, wheelSlots } from '../../src/pages/community/lottery-wheel.js';
import type { WheelPrize } from '../../src/pages/community/lottery-wheel.js';

const prize: WheelPrize = { id: 'a', name: 'Old name', description: '', amountCents: 50, kind: 'balance', enabled: true, weight: 10, stock: 5 };
const winner = { prizeId: 'a', name: 'Confirmed prize', description: 'Updated by admin', amountCents: 200, status: 'fulfilled' as const, fulfilledAt: null, note: '' };

describe('lottery wheel receipts', () => {
	test('percentage drafts add to 100 even with thirds and retain original weights', () => {
		const prizes = ['a', 'b', 'c'].map(id => ({ ...prize, id, weight: 1 }));
		const draft = lotteryPercentages(prizes);
		expect(Object.values(draft).reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(10000);
		expect(prizes.map(p => p.weight)).toEqual([1, 1, 1]);
		expect(lotteryPercentages([])).toEqual({});
	});
	test('a renamed or repriced prize uses the receipt without mutating the status pool', () => {
		const slots = wheelPrizesForReceipt([prize], winner);
		expect(slots[0]).toMatchObject({ id: 'a', name: winner.name, amountCents: 200 });
		expect(prize.amountCents).toBe(50);
		expect(wheelSlots(slots).every(slot => slot.id === 'a')).toBe(true);
	});
	test('a new or historical prize is retained even when missing from the current pool', () => {
		const slots = wheelSlots(wheelPrizesForReceipt([prize], { ...winner, prizeId: 'new' }));
		expect(slots.findIndex(slot => slot.id === 'new')).toBeGreaterThanOrEqual(0);
		expect(slots.find(slot => slot.id === 'new')?.amountCents).toBe(200);
		expect(wheelSlots([])).toEqual([]);
	});
});
