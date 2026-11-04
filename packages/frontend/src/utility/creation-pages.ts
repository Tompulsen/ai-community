/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

export const creationPages = [
	{ key: 'text', title: i18n.ts._creationLinks.text, icon: 'ti ti-file-text', urlKey: 'creationTextUrl', modeKey: 'creationTextMode' },
	{ key: 'image', title: i18n.ts._creationLinks.image, icon: 'ti ti-photo', urlKey: 'creationImageUrl', modeKey: 'creationImageMode' },
	{ key: 'video', title: i18n.ts._creationLinks.video, icon: 'ti ti-video', urlKey: 'creationVideoUrl', modeKey: 'creationVideoMode' },
] as const;

export type CreationMode = 'embed' | 'newTab';

// Keep the browser check consistent with backend/misc/creation-url.ts.
export function normalizeCreationUrl(value: string, siteUrl: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length > 2048 || !/^https:\/\/[^/]/i.test(trimmed) || /[\s\\]/u.test(trimmed)) return null;
	try {
		const target = new URL(trimmed);
		if (!target.hostname || target.username || target.password || target.origin === new URL(siteUrl).origin) return null;
		return target.href.length <= 2048 ? target.href : null;
	} catch {
		return null;
	}
}
