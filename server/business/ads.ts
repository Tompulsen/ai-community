/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const communityAdKeys = ['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4'] as const;

export type CommunityAd = { enabled: boolean; title: string; imageUrl: string; linkUrl: string };

export const communityAdParam = {
	type: 'object', nullable: true, additionalProperties: false,
	properties: {
		enabled: { type: 'boolean' },
		title: { type: 'string', maxLength: 80 },
		imageUrl: { type: 'string', maxLength: 2048 },
		linkUrl: { type: 'string', maxLength: 2048 },
	},
	required: ['enabled', 'title', 'imageUrl', 'linkUrl'],
} as const;

function normalizeUrl(value: string, siteUrl: string, image: boolean): string | null {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(trimmed) || !/^https?:\/\//i.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		if (!url.hostname || url.username || url.password) return null;
		if (image && url.protocol === 'http:' && url.origin !== new URL(siteUrl).origin) return null;
		return url.href;
	} catch { return null; }
}

export function normalizeCommunityAd(value: CommunityAd, siteUrl: string): CommunityAd | null {
	if (!value || typeof value.enabled !== 'boolean' || typeof value.title !== 'string' || typeof value.imageUrl !== 'string' || typeof value.linkUrl !== 'string') return null;
	const title = value.title.trim();
	const imageUrl = normalizeUrl(value.imageUrl, siteUrl, true);
	const linkUrl = normalizeUrl(value.linkUrl, siteUrl, false);
	if (title.length > 80 || imageUrl == null || linkUrl == null) return null;
	if (value.enabled && (!title || !imageUrl || !linkUrl)) return null;
	return { enabled: value.enabled, title, imageUrl, linkUrl };
}

export function publicCommunityClientOptions<T extends Partial<Record<typeof communityAdKeys[number], CommunityAd | null>>>(options: T, siteUrl: string): T {
	const result = { ...options };
	for (const key of communityAdKeys) {
		const ad = options[key] && normalizeCommunityAd(options[key], siteUrl);
		if (ad?.enabled) result[key] = ad;
		else delete result[key];
	}
	return result;
}
