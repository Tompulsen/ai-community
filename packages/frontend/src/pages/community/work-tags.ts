/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CommunityTag } from './types.js';

export function parseTagQuery(value?: string): string[] {
	return [...new Set((value ?? '').split(',').filter(id => /^[a-zA-Z0-9]{1,32}$/.test(id)))].slice(0, 3);
}

export function tagSearchPath(tag: CommunityTag): string {
	return `/community/${tag.category === 'resource' ? 'knowledge' : tag.category}?${new URLSearchParams({ tags: tag.id })}`;
}
