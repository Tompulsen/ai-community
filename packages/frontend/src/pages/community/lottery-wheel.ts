/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Endpoints } from 'misskey-js';

export type WheelSettings = Endpoints['community/lottery/status']['res']['settings']['wheel'];
export type WheelPrize = Endpoints['community/lottery/status']['res']['settings']['prizes'][number];

export const wheelThemes = {
	teal: { accent: '#116b61', ink: '#174b44', light: '#e4f3ec', alternate: '#fff1d4', rim: '#b7dfcd', paper: '#fffdf5' },
	violet: { accent: '#633db0', ink: '#442b72', light: '#eee5ff', alternate: '#fff0d7', rim: '#d2baf4', paper: '#fffaf4' },
	sunset: { accent: '#a4432b', ink: '#663521', light: '#ffe5d7', alternate: '#fff2d4', rim: '#f0bd9f', paper: '#fffaf2' },
} as const;

export const defaultWheelSettings = (): WheelSettings => ({ theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' });

export function lotteryPercentages(prizes: WheelPrize[]): Record<string, number> {
	const enabled = prizes.filter(prize => prize.enabled);
	const total = enabled.reduce((sum, prize) => sum + prize.weight, 0);
	const entries = enabled.map(prize => ({ id: prize.id, exact: total ? prize.weight / total * 10000 : 0 }));
	const basisPoints = Object.fromEntries(prizes.map(prize => [prize.id, 0]));
	for (const entry of entries) basisPoints[entry.id] = Math.floor(entry.exact);
	let remaining = total ? 10000 - Object.values(basisPoints).reduce((sum, value) => sum + value, 0) : 0;
	for (const entry of entries.sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
		if (remaining-- > 0) basisPoints[entry.id]++;
	}
	return Object.fromEntries(Object.entries(basisPoints).map(([id, value]) => [id, value / 100]));
}

export function wheelSlots(prizes: WheelPrize[]): WheelPrize[] {
	if (prizes.length === 0 || prizes.length >= 4) return prizes;
	return Array.from({ length: prizes.length * Math.ceil(4 / prizes.length) }, (_, i) => prizes[i % prizes.length]);
}

export function wheelPrizesForReceipt(prizes: WheelPrize[], winner: Endpoints['community/lottery/draw']['res']['prizes'][number]): WheelPrize[] {
	const existing = prizes.find(prize => prize.id === winner.prizeId);
	const confirmed: WheelPrize = {
		...existing, id: winner.prizeId, name: winner.name, description: winner.description,
		amountCents: winner.amountCents, kind: winner.status === 'empty' ? 'empty' : 'balance',
		enabled: true, weight: existing?.weight ?? 0, stock: existing?.stock ?? -1,
	};
	return existing ? prizes.map(prize => prize.id === winner.prizeId ? confirmed : prize) : [...prizes, confirmed];
}
