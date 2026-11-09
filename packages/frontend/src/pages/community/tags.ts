/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readonly, shallowRef } from 'vue';
import type { CommunityCategory, CommunityTag } from './types.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export const communityTagCategories: CommunityCategory[] = ['image', 'video', 'resource'];
export const communityTagNameLimit = 24;
const cache = new Map<CommunityCategory | 'all', CommunityTag[]>();
const updateVersion = shallowRef(0);
export const communityTagUpdates = readonly(updateVersion);
export const communityTagsVersion = communityTagUpdates;
const requestVersions = new Map<CommunityCategory | 'all', number>();

export const normalizeCommunityTagName = (name: string) => name.normalize('NFC').trim();
export function validCommunityTagName(name: string): boolean {
	const normalized = normalizeCommunityTagName(name);
	return [...normalized].length >= 1 && [...normalized].length <= communityTagNameLimit && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized);
}

export function clearCommunityTagsCache(): void {
	cache.clear();
	updateVersion.value++;
}

/** Snapshot for labels outside the picker. Loading always revalidates with the server. */
export function getCachedCommunityTags(category?: CommunityCategory): CommunityTag[] {
	const tags = cache.get('all') ?? [...cache.values()].flat();
	return [...new Map(tags.filter(tag => !category || tag.category === category).map(tag => [tag.id, tag])).values()].map(tag => ({ ...tag }));
}

export async function loadCommunityTags(category?: CommunityCategory, signal?: AbortSignal): Promise<CommunityTag[]> {
	const key = category ?? 'all';
	const version = updateVersion.value;
	const requestVersion = (requestVersions.get(key) ?? 0) + 1;
	requestVersions.set(key, requestVersion);
	const result = await misskeyApi<CommunityTag[]>('community/tags', category ? { category } : {}, undefined, signal);
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	if (!Array.isArray(result) || result.some(tag => !tag || typeof tag.id !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(tag.id) || !communityTagCategories.includes(tag.category) || typeof tag.name !== 'string' || !validCommunityTagName(tag.name) || (category && tag.category !== category)) || new Set(result.map(tag => tag.id)).size !== result.length) throw new Error('Invalid community tag response');
	const tags = result.map(({ id, category: tagCategory, name }) => ({ id, category: tagCategory, name }));
	if (version === updateVersion.value && requestVersions.get(key) === requestVersion) {
		if (category) {
			cache.set(category, tags);
			const all = cache.get('all');
			if (all) cache.set('all', [...all.filter(tag => tag.category !== category), ...tags]);
		} else {
			cache.clear();
			cache.set('all', tags);
		}
	}
	return tags.map(tag => ({ ...tag }));
}
