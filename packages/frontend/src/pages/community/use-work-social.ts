/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { entities } from 'misskey-js';
import type { CommunityWork } from './types.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';

export function useWorkSocial(getWork: () => CommunityWork, enabled: () => boolean) {
	const author = ref<entities.UserDetailed | null>(null);
	const favorite = ref<boolean | null>(null);
	const followBusy = ref(false);
	const favoriteBusy = ref(false);
	const followFailed = ref(false);
	const favoriteFailed = ref(false);
	const following = computed(() => !!author.value?.isFollowing);
	const followPending = computed(() => !!author.value?.hasPendingFollowRequestFromYou);
	const ownWork = computed(() => getWork().author.id === $i?.id);
	const controllers = new Set<AbortController>();
	let active = true;
	let generation = 0;

	function context() {
		const work = getWork(), actor = $i?.id, version = generation;
		return { work, valid: () => active && enabled() && version === generation && work.id === getWork().id && actor === $i?.id };
	}

	async function request<T>(perform: (signal: AbortSignal) => Promise<T>) {
		const controller = new AbortController();
		controllers.add(controller);
		const timer = window.setTimeout(() => controller.abort(), 15000);
		try { return await perform(controller.signal); } finally { window.clearTimeout(timer); controllers.delete(controller); }
	}

	async function readAuthor() {
		const current = context();
		if (!current.valid() || followBusy.value) return;
		followBusy.value = true; followFailed.value = false;
		try {
			const result = await request(signal => misskeyApi('users/show', { userId: current.work.author.id }, undefined, signal));
			if (current.valid()) author.value = result;
		} catch { if (current.valid()) followFailed.value = true; } finally { if (current.valid()) followBusy.value = false; }
	}

	async function readFavorite() {
		const current = context();
		if (!current.valid() || !$i || !current.work.approvedNoteId || favoriteBusy.value) return;
		favoriteBusy.value = true; favoriteFailed.value = false;
		try {
			const result = await request(signal => misskeyApi('notes/state', { noteId: current.work.approvedNoteId! }, undefined, signal));
			if (current.valid()) favorite.value = result.isFavorited;
		} catch { if (current.valid()) favoriteFailed.value = true; } finally { if (current.valid()) favoriteBusy.value = false; }
	}

	async function toggleFavorite() {
		if (!$i || favoriteBusy.value || !active || !enabled()) return;
		if (favorite.value === null || favoriteFailed.value) { await readFavorite(); return; }
		const current = context(), target = !favorite.value, noteId = current.work.approvedNoteId;
		if (!noteId) return;
		favoriteBusy.value = true; favoriteFailed.value = false;
		try {
			const fresh = await request(signal => misskeyApi('notes/state', { noteId }, undefined, signal));
			if (!current.valid()) return;
			favorite.value = fresh.isFavorited;
			if (fresh.isFavorited !== target) {
				await request(signal => misskeyApi(target ? 'notes/favorites/create' : 'notes/favorites/delete', { noteId }, undefined, signal));
				if (current.valid()) favorite.value = target;
			}
		} catch { if (current.valid()) { favorite.value = null; favoriteFailed.value = true; } } finally { if (current.valid()) favoriteBusy.value = false; }
	}

	async function toggleFollow(confirm: () => Promise<boolean>) {
		if (!$i || ownWork.value || followBusy.value || !active || !enabled()) return;
		if (!author.value || followFailed.value) { await readAuthor(); return; }
		const current = context(), target = !(following.value || followPending.value);
		followBusy.value = true; followFailed.value = false;
		try {
			const fresh = await request(signal => misskeyApi('users/show', { userId: current.work.author.id }, undefined, signal));
			if (!current.valid()) return;
			author.value = fresh;
			if ((!!fresh.isFollowing || !!fresh.hasPendingFollowRequestFromYou) === target) return;
			if (target && (fresh.isBlocking || fresh.isBlocked || fresh.isSuspended || fresh.movedTo || ('isDeleted' in fresh && fresh.isDeleted))) { followFailed.value = true; return; }
			if ((!target || prefer.s.alwaysConfirmFollow) && !await confirm()) return;
			if (!current.valid()) return;
			await request(async signal => {
				if (target) await misskeyApi('following/create', { userId: fresh.id, withReplies: prefer.s.defaultFollowWithReplies }, undefined, signal);
				else await misskeyApi(fresh.isFollowing ? 'following/delete' : 'following/requests/cancel', { userId: fresh.id }, undefined, signal);
			});
			const verified = await request(signal => misskeyApi('users/show', { userId: fresh.id }, undefined, signal));
			if (current.valid()) {
				author.value = verified;
				followFailed.value = (!!verified.isFollowing || !!verified.hasPendingFollowRequestFromYou) !== target;
			}
		} catch { if (current.valid()) followFailed.value = true; } finally { if (current.valid()) followBusy.value = false; }
	}

	function clear() {
		generation++;
		for (const controller of controllers) controller.abort();
		controllers.clear();
		author.value = null; favorite.value = null;
		followBusy.value = false; favoriteBusy.value = false;
		followFailed.value = false; favoriteFailed.value = false;
	}

	function load() { if (active && enabled()) { void readAuthor(); void readFavorite(); } }

	watch([() => getWork().id, () => getWork().approvedNoteId, () => getWork().author.id, () => $i?.id, enabled], () => { clear(); load(); }, { immediate: true });
	onActivated(() => { if (!active) { active = true; load(); } });
	onDeactivated(() => { active = false; clear(); });
	onBeforeUnmount(() => { active = false; clear(); });
	return { author, favorite, following, followPending, ownWork, followBusy, favoriteBusy, followFailed, favoriteFailed, toggleFavorite, toggleFollow, readAuthor, readFavorite };
}
