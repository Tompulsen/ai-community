/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Validate locally; never fetch an administrator-supplied destination. */
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
