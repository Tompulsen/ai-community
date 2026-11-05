/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Only one community preview can play, including cards retained by KeepAlive.
let current: (() => void) | undefined;

export function claimVideoPlayback(stop: () => void) {
	if (current !== stop) current?.();
	current = stop;
}

export function releaseVideoPlayback(stop: () => void) {
	if (current === stop) current = undefined;
}
