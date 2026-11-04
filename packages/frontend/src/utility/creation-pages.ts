/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';
import { homeLanguage } from '@/pages/home/copy.js';

export const creationText = homeLanguage === 'en-US' ? {
	community: 'Community', text: 'Text studio', image: 'Image studio', video: 'Video studio',
	settings: 'Creation links', description: 'Set a destination for each creation tool. Save to enable its entry. Leave a URL empty to show an unconfigured state.',
	url: 'Creation page URL', urlHint: 'Use a complete external HTTPS URL. Leave it empty to disable the destination. Links are public; do not include passwords or private tokens.',
	mode: 'Open mode', embed: 'Open in the workspace', newTab: 'Open in a new window',
	modeHint: 'Use a new window for sites that need their own login or do not allow embedding.',
	invalidUrl: 'Enter an external HTTPS URL of up to 2,048 characters, without credentials or a link back to this site.',
	notConfigured: 'This studio is not set up yet', emptyHint: 'An administrator needs to configure its destination before you can use it.',
	configure: 'Configure creation links', open: 'Open in a new window',
	externalHint: 'This creation tool opens in a separate window.', embedHint: 'If the page does not display correctly, open it in a new window.',
	loadError: 'Creation settings could not load. Please try again.', saveError: 'Changes could not be saved. Your edits are still here. Please try again.',
	saved: 'Creation links saved', adminOnly: 'Only administrators can change creation links.', preview: 'Open the saved creation page',
} : i18n.ts._creationLinks;

export const creationPages = [
	{ key: 'text', title: creationText.text, icon: 'ti ti-file-text', urlKey: 'creationTextUrl', modeKey: 'creationTextMode' },
	{ key: 'image', title: creationText.image, icon: 'ti ti-photo', urlKey: 'creationImageUrl', modeKey: 'creationImageMode' },
	{ key: 'video', title: creationText.video, icon: 'ti ti-video', urlKey: 'creationVideoUrl', modeKey: 'creationVideoMode' },
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
