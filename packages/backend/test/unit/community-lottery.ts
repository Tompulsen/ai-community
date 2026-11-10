/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { chooseLotteryPrize, defaultLotterySettings, emptyLotteryProgress, lotteryCredits } from '../../src/misc/community-lottery.js';

describe('community lottery', () => {
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
