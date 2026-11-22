/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomInt } from 'node:crypto';

export type LotteryRule = { enabled: boolean; threshold: number; tickets: number };
export type LotteryWheel = { theme: 'teal' | 'violet' | 'sunset'; title: string; subtitle: string; buttonText: string; rulesText: string };
export type LotteryPrize = { id: string; name: string; description: string; weight: number; stock: number; enabled: boolean; amountCents: number; kind: 'balance' | 'empty' };
export type LotterySettings = {
	enabled: boolean;
	minSupportCnyFen: number;
	rewardValidityHours: number;
	dailyLimit?: number;
	invites: LotteryRule;
	likes: LotteryRule;
	followers: LotteryRule;
	likesMode: 'work' | 'total';
	prizes: LotteryPrize[];
	wheel: LotteryWheel;
};
export type LotterySettingsInput = Omit<LotterySettings, 'wheel' | 'minSupportCnyFen' | 'rewardValidityHours'> & { wheel?: LotteryWheel; minSupportCnyFen?: number; rewardValidityHours?: number };
export type LotteryCreditReceipt = { id: number; quotaAdded: number; quotaPerUsd: string; rewardKind?: 'charity'; validityHours?: number; expiresAt?: number; points?: string; lotId?: number; creditedAt?: number; quotaPerPoint?: number };
export type LotteryAward = { amountCents: number; prizeId: string; name: string; description: string; status: 'pending' | 'fulfilled' | 'empty'; fulfilledAt: string | null; fulfilledBy: string | null; note: string; rewardKind?: 'charity'; validityHours?: number; creditReceipt?: LotteryCreditReceipt; creditBlocked?: boolean };
export type LotteryProgress = { invites: number; likes: number; followers: number; works: Record<string, number> };

export const defaultLotteryWheel = (): LotteryWheel => ({ theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' });

export function normalizeLotterySettings(settings: LotterySettingsInput & { minConsumptionCnyFen?: number }): LotterySettings {
	const { minConsumptionCnyFen, ...current } = settings;
	const rewardValidityHours = current.rewardValidityHours === undefined ? 168 : current.rewardValidityHours;
	if (!Number.isInteger(rewardValidityHours) || rewardValidityHours < 1 || rewardValidityHours > 8760) throw new Error('LOTTERY_INVALID');
	return { ...current, rewardValidityHours, minSupportCnyFen: current.minSupportCnyFen ?? minConsumptionCnyFen ?? 0, wheel: { ...defaultLotteryWheel(), ...current.wheel } };
}

export function defaultLotterySettings(): LotterySettings {
	return {
		enabled: false,
		minSupportCnyFen: 0,
		rewardValidityHours: 168,
		invites: { enabled: true, threshold: 1, tickets: 1 },
		likes: { enabled: true, threshold: 100, tickets: 1 },
		followers: { enabled: true, threshold: 100, tickets: 1 },
		likesMode: 'work', prizes: [],
		wheel: defaultLotteryWheel(),
	};
}

export const emptyLotteryProgress = (): LotteryProgress => ({ invites: 0, likes: 0, followers: 0, works: {} });

export function lotteryEntitlement(count: number, rule: LotteryRule): number {
	return rule.enabled ? Math.floor(count / rule.threshold) * rule.tickets : 0;
}

/** Retain previous entitlements: unliking/refollowing and rule changes cannot reissue them. */
export function lotteryCredits(previous: LotteryProgress, counts: { invites: number; followers: number; works: { id: string; likes: number }[] }, settings: LotterySettings) {
	const next = structuredClone(previous);
	if (!settings.enabled) return { progress: next, added: 0 };
	next.invites = Math.max(previous.invites, lotteryEntitlement(counts.invites, settings.invites));
	next.followers = Math.max(previous.followers, lotteryEntitlement(counts.followers, settings.followers));
	if (settings.likes.enabled) {
		for (const work of counts.works) next.works[work.id] = Math.max(next.works[work.id] ?? 0, lotteryEntitlement(work.likes, settings.likes));
		const likes = settings.likesMode === 'work' ? Object.values(next.works).reduce((a, b) => a + b, 0) : lotteryEntitlement(counts.works.reduce((a, b) => a + b.likes, 0), settings.likes);
		next.likes = Math.max(previous.likes, likes);
	}
	const added = next.invites + next.likes + next.followers - previous.invites - previous.likes - previous.followers;
	if (!Number.isSafeInteger(added) || added < 0 || added > 2147483647) throw new Error('LOTTERY_CREDIT_OVERFLOW');
	return { progress: next, added };
}

export function availableLotteryPrizes(prizes: LotteryPrize[]) {
	return prizes.filter(p => p.enabled && p.weight > 0 && p.stock !== 0);
}

export function chooseLotteryPrize(prizes: LotteryPrize[], random = randomInt): LotteryPrize | null {
	const available = availableLotteryPrizes(prizes);
	const total = available.reduce((sum, prize) => sum + prize.weight, 0);
	if (!total) return null;
	let ticket = random(total);
	for (const prize of available) {
		ticket -= prize.weight;
		if (ticket < 0) return prize;
	}
	throw new Error('LOTTERY_RANDOM_RANGE');
}

export function lotteryInviter(value: unknown): string | undefined {
	return typeof value === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(value) ? value : undefined;
}

export function lotteryCreditReceipt(response: Record<string, unknown>, reference: string, userId: number, amountCents: number,
	expected?: Pick<LotteryAward, 'rewardKind' | 'validityHours'> & { quotaPerPoint?: number }): LotteryCreditReceipt {
	const receipt = response.receipt as Record<string, unknown> | null | undefined;
	if (response.credited !== true || response.reference !== reference || response.user_id !== userId || response.amount_cents !== amountCents
		|| !receipt || !Number.isSafeInteger(receipt.id) || Number(receipt.id) <= 0 || !Number.isSafeInteger(receipt.quota_added) || Number(receipt.quota_added) <= 0
		|| typeof receipt.quota_per_usd !== 'string' || !/^(?:0|[1-9]\d{0,30})(?:\.\d{1,30})?$/.test(receipt.quota_per_usd)) throw new Error('LOTTERY_CREDIT_RESPONSE');
	const [whole, fraction = ''] = receipt.quota_per_usd.split('.');
	const denominator = 100n * 10n ** BigInt(fraction.length);
	// Match New API's positive decimal rounding without losing precision to JavaScript floats.
	const quota = (BigInt(amountCents) * BigInt(whole + fraction) + denominator / 2n) / denominator;
	if (quota !== BigInt(Number(receipt.quota_added))) throw new Error('LOTTERY_CREDIT_RESPONSE');
	const base = { id: Number(receipt.id), quotaAdded: Number(receipt.quota_added), quotaPerUsd: receipt.quota_per_usd };
	if (expected?.rewardKind === 'charity') {
		if (!Number.isInteger(expected.validityHours) || expected.validityHours! < 1 || expected.validityHours! > 8760
			|| receipt.reward_kind !== 'charity' || receipt.validity_hours !== expected.validityHours
			|| !Number.isSafeInteger(receipt.expires_at) || Number(receipt.expires_at) <= 0 || Number(receipt.expires_at) > 8640000000000
			|| !Number.isSafeInteger(receipt.credited_at) || Number(receipt.credited_at) <= 0 || Number(receipt.credited_at) > 8640000000000
			|| Number(receipt.expires_at) - Number(receipt.credited_at) !== expected.validityHours! * 3600
			|| !Number.isSafeInteger(receipt.lot_id) || Number(receipt.lot_id) <= 0
			|| !Number.isSafeInteger(receipt.quota_per_point) || Number(receipt.quota_per_point) <= 0
			|| (expected.quotaPerPoint !== undefined && receipt.quota_per_point !== expected.quotaPerPoint)
			|| typeof receipt.points !== 'string' || !/^[1-9]\d{0,15}$/.test(receipt.points)
			|| BigInt(receipt.points) * BigInt(Number(receipt.quota_per_point)) !== quota) throw new Error('LOTTERY_CREDIT_RESPONSE');
		return { ...base, rewardKind: 'charity', validityHours: expected.validityHours, expiresAt: Number(receipt.expires_at),
			points: receipt.points, lotId: Number(receipt.lot_id), creditedAt: Number(receipt.credited_at), quotaPerPoint: Number(receipt.quota_per_point) };
	}
	if (receipt.reward_kind !== undefined && receipt.reward_kind !== 'balance') throw new Error('LOTTERY_CREDIT_RESPONSE');
	return base;
}
