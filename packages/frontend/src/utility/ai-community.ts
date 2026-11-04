/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

export const communityModules = [
	{ key: 'video', icon: 'ti ti-movie', get title() { return i18n.ts._aiCommunity.video; }, get description() { return i18n.ts._aiCommunity.videoDescription; } },
	{ key: 'image', icon: 'ti ti-photo', get title() { return i18n.ts._aiCommunity.image; }, get description() { return i18n.ts._aiCommunity.imageDescription; } },
	{ key: 'knowledge', icon: 'ti ti-code', get title() { return i18n.ts._aiCommunity.knowledge; }, get description() { return i18n.ts._aiCommunity.knowledgeDescription; } },
] as const;

export type CommunityModule = typeof communityModules[number]['key'];
export type CommunityChannels = Record<CommunityModule, string | null>;

export async function fetchCommunityChannels(signal?: AbortSignal): Promise<CommunityChannels> {
	const response = await window.fetch('/ai-community.json', { cache: 'no-store', signal });
	if (!response.ok) throw new Error('Community configuration unavailable');
	const value: unknown = await response.json();
	if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid community configuration');
	const source = value as Record<string, unknown>;
	const channels: CommunityChannels = { video: null, image: null, knowledge: null };
	const ids = new Set<string>();
	for (const { key } of communityModules) {
		const id = source[key];
		if (id == null) continue;
		if (typeof id !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(id) || ids.has(id)) throw new Error('Invalid community channel');
		channels[key] = id;
		ids.add(id);
	}
	return channels;
}
