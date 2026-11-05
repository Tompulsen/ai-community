/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import { parseCommunityPage } from './api.js';
import { misskeyApi } from '@/utility/misskey-api.js';

async function boundedRequest<T>(signal: AbortSignal, request: (requestSignal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal.aborted) controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	const timeout = window.setTimeout(abort, 15000);
	try {
		return await request(controller.signal);
	} finally {
		window.clearTimeout(timeout);
		signal.removeEventListener('abort', abort);
	}
}

export function loadDiscoveryAnnouncements(signal: AbortSignal): Promise<entities.Announcement[]> {
	// This is a public community notice board. Never include targeted account notices
	// or mark an announcement as read merely because its summary appeared here.
	return boundedRequest(signal, requestSignal => misskeyApi('announcements', { limit: 3, isActive: true }, null, requestSignal));
}

export function isDiscoverableCreator(user: entities.UserDetailed, viewerId?: string): boolean {
	return user.id !== viewerId && !user.host && !user.isSuspended && !user.movedTo
		&& !('isDeleted' in user && user.isDeleted) && !('isExplorable' in user && user.isExplorable === false)
		&& !user.isBlocking && !user.isBlocked && !user.isMuted;
}

export async function loadDiscoveryCreators(viewerId: string | undefined, signal: AbortSignal): Promise<entities.UserDetailed[]> {
	return boundedRequest(signal, async requestSignal => {
		const page = parseCommunityPage(await misskeyApi('community/works', { limit: 50 }, undefined, requestSignal));
		const scores = new Map<string, number>();
		for (const work of page.items) {
			if (!['approved', 'published'].includes(work.status) || !work.approvedNoteId) continue;
			if (work.author.id === viewerId) continue;
			const engagement = (work.likesCount ?? 0) + work.repliesCount + (work.renotesCount ?? 0);
			scores.set(work.author.id, (scores.get(work.author.id) ?? 0) + engagement);
		}
		// Map insertion order preserves recency when engagement scores are tied.
		const ids = [...scores].sort((left, right) => right[1] - left[1]).map(([id]) => id);
		if (!ids.length) return [];
		const users = await misskeyApi('users/show', { userIds: ids }, undefined, requestSignal);
		return users.filter(user => isDiscoverableCreator(user, viewerId)).slice(0, 4);
	});
}

export function readCreatorFollow(userId: string, signal: AbortSignal): Promise<entities.UserDetailed> {
	return boundedRequest(signal, requestSignal => misskeyApi('users/show', { userId }, undefined, requestSignal));
}

export function requestCreatorFollow(userId: string, withReplies: boolean, signal: AbortSignal) {
	return boundedRequest(signal, requestSignal => misskeyApi('following/create', { userId, withReplies }, undefined, requestSignal));
}
