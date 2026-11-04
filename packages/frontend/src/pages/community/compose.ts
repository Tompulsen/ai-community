/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const communityComposeEvent = 'misskey:community-compose';

/** Open over the current community; other pages use the existing compose route. */
export function requestCommunityComposer(fallback: () => void): void {
	if (window.dispatchEvent(new Event(communityComposeEvent, { cancelable: true }))) fallback();
}
