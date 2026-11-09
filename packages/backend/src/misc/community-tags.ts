/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { ApiError } from '@/server/api/error.js';
import { communityErrors } from '@/server/api/community-schema.js';
import type { CommunityRevision } from '@/models/CommunitySubmission.js';

export function normalizeCommunityTagIds(tagIds: readonly string[] = []): string[] {
	if (!Array.isArray(tagIds) || tagIds.length > 3 || new Set(tagIds).size !== tagIds.length || tagIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(id))) throw new ApiError(communityErrors.invalidTags);
	return [...tagIds].sort();
}

export function normalizeCommunityTagName(value: string): string {
	const name = value.normalize('NFC').trim();
	if (!name || Array.from(name).length > 24 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) throw new ApiError(communityErrors.invalidTags);
	return name;
}

/** Preserve pre-tag hashes for retries from both old and new clients. */
export function communityPayloadHash(content: CommunityRevision): string {
	const { tagIds, ...legacy } = content;
	const ids = normalizeCommunityTagIds(tagIds);
	return createHash('sha256').update(JSON.stringify(ids.length ? { ...legacy, tagIds: ids } : legacy)).digest('hex');
}
