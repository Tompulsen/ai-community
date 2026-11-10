/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Carry the first referral through authentication; the server accepts it only on account creation. */
export function rememberLotteryInvite(): string | undefined {
	try {
		const key = 'community-lottery-invite';
		const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
		if (saved && typeof saved.id === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(saved.id) && saved.expires > Date.now()) return saved.id;
		const id = new URLSearchParams(window.location.search).get('invite');
		if (!id || !/^[a-zA-Z0-9]{1,32}$/.test(id)) return undefined;
		sessionStorage.setItem(key, JSON.stringify({ id, expires: Date.now() + 7 * 86400000 }));
		return id;
	} catch { return undefined; }
}
