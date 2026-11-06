/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { parseCommunityPage } from '@/pages/community/api.js';
import type { CommunityWork } from '@/pages/community/types.js';

export type HomeShowcaseMode = 'custom' | 'popular';
export type FeaturedState = 'custom' | 'loading' | 'ready' | 'empty' | 'error';

/** Fetch the visitor-visible selection without borrowing an administrator's permissions. */
export async function loadFeaturedWork(signal: AbortSignal, category?: CommunityWork['category']): Promise<CommunityWork | null> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal.aborted) abort();
	signal.addEventListener('abort', abort, { once: true });
	const timeout = window.setTimeout(abort, 12000);
	try {
		const response = await window.fetch(`${apiUrl}/community/featured`, {
			method: 'POST', credentials: 'omit', cache: 'no-store',
			headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(category ? { category } : {}), signal: controller.signal,
		});
		if (!response.ok) throw new Error('featured-unavailable');
		const page = parseCommunityPage(await response.json());
		if (page.items.length > 1 || page.nextCursor !== null || page.items.some(work => !['approved', 'published'].includes(work.status) || !work.approvedNoteId)) throw new Error('featured-invalid');
		if (category && page.items.some(work => work.category !== category)) throw new Error('featured-category-mismatch');
		return page.items[0] ?? null;
	} finally {
		window.clearTimeout(timeout);
		signal.removeEventListener('abort', abort);
	}
}
