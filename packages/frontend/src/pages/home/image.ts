/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const homeImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng'];
export const maxHomeImageSize = 20 * 1024 * 1024;

export function normalizeHomeImageUrl(value: string | null | undefined, siteUrl: string): string | null {
	const trimmed = value?.trim();
	// The public meta API supplies this built-in mascot when no custom image is saved.
	if (!trimmed || trimmed === '/assets/ai.png' || trimmed.length > 2048) return null;
	if (!/^(https?:\/\/|\/(?!\/))/i.test(trimmed) || /[\s\\]/u.test(trimmed)) return null;
	try {
		const target = new URL(trimmed, siteUrl);
		if (target.username || target.password || !target.hostname) return null;
		if (target.protocol !== 'https:' && !(target.protocol === 'http:' && target.origin === new URL(siteUrl).origin)) return null;
		return target.href;
	} catch {
		return null;
	}
}
