/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { CommunityWork } from '../../src/pages/community/types.js';
import { useWorkSocial } from '../../src/pages/community/use-work-social.js';

const mock = vi.hoisted(() => ({ api: vi.fn(), actor: { id: 'viewer' } as { id: string } | null }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mock.api }));
vi.mock('@/i.js', () => ({ get $i() { return mock.actor; } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { defaultFollowWithReplies: false, alwaysConfirmFollow: false } } }));

describe('Community author follow and saved works', () => {
	let dispose: (() => void) | undefined;
	let saved = false;
	let followed = false;
	let pending = false;
	let locked = false;
	const work = (id = 'work', authorId = 'creator') => ({ id, author: { id: authorId, username: authorId, name: authorId }, approvedNoteId: 'note-' + id } as CommunityWork);
	beforeEach(() => {
		mock.actor = { id: 'viewer' }; saved = false; followed = false; pending = false; locked = false;
		mock.api.mockReset();
		mock.api.mockImplementation(async (endpoint, params) => {
			if (endpoint === 'users/show') return { id: params.userId, username: params.userId, host: null, isFollowing: followed, hasPendingFollowRequestFromYou: pending, isLocked: locked };
			if (endpoint === 'notes/state') return { isFavorited: saved };
			if (endpoint === 'notes/favorites/create') saved = true;
			if (endpoint === 'notes/favorites/delete') saved = false;
			if (endpoint === 'following/create') { followed = !locked; pending = locked; }
			if (endpoint === 'following/delete') followed = false;
			if (endpoint === 'following/requests/cancel') pending = false;
			return undefined;
		});
	});
	afterEach(() => { dispose?.(); dispose = undefined; });

	async function mount(initial = work(), enabled = true) {
		const current = ref(initial), visible = ref(enabled);
		let social!: ReturnType<typeof useWorkSocial>;
		const app = createApp(defineComponent({ setup() { social = useWorkSocial(() => current.value, () => visible.value); return () => h('div'); } }));
		const host = document.createElement('div'); document.body.append(host); app.mount(host);
		dispose = () => { app.unmount(); host.remove(); };
		await nextTick();
		await vi.waitFor(() => { expect(social.followBusy.value).toBe(false); expect(social.favoriteBusy.value).toBe(false); });
		return { social, current, visible };
	}

	it('persists save and unsave through existing favorites endpoints', async () => {
		const { social } = await mount();
		expect(social.favorite.value).toBe(false);
		await social.toggleFavorite();
		expect(saved).toBe(true); expect(social.favorite.value).toBe(true);
		await social.toggleFavorite();
		expect(saved).toBe(false); expect(social.favorite.value).toBe(false);
		expect(mock.api.mock.calls.filter(([endpoint]) => endpoint.startsWith('notes/favorites/')).map(([endpoint]) => endpoint)).toEqual(['notes/favorites/create', 'notes/favorites/delete']);
	});

	it('reconciles a save made in another tab without deleting it on first click', async () => {
		const { social } = await mount();
		saved = true;
		await social.toggleFavorite();
		expect(social.favorite.value).toBe(true);
		expect(mock.api.mock.calls.some(([endpoint]) => endpoint.startsWith('notes/favorites/'))).toBe(false);
	});

	it('checks an uncertain write before allowing another favorite mutation', async () => {
		const { social } = await mount();
		const original = mock.api.getMockImplementation()!;
		mock.api.mockImplementation(async (endpoint, ...args) => { if (endpoint === 'notes/favorites/create') { saved = true; throw new Error('Connection lost after commit'); } return original(endpoint, ...args); });
		await social.toggleFavorite();
		expect(social.favoriteFailed.value).toBe(true); expect(social.favorite.value).toBeNull();
		await social.toggleFavorite();
		expect(social.favorite.value).toBe(true); expect(social.favoriteFailed.value).toBe(false);
		expect(mock.api.mock.calls.filter(([endpoint]) => endpoint === 'notes/favorites/create')).toHaveLength(1);
	});

	it('follows, confirms unfollow, and respects canceled confirmation', async () => {
		const { social } = await mount();
		await social.toggleFollow(async () => true);
		expect(social.following.value).toBe(true);
		await social.toggleFollow(async () => false);
		expect(social.following.value).toBe(true);
		await social.toggleFollow(async () => true);
		expect(social.following.value).toBe(false);
		expect(mock.api.mock.calls.filter(([endpoint]) => endpoint === 'following/delete')).toHaveLength(1);
	});

	it('preserves locked-account request state and can cancel the request', async () => {
		locked = true;
		const { social } = await mount();
		await social.toggleFollow(async () => true);
		expect(social.followPending.value).toBe(true); expect(social.following.value).toBe(false);
		await social.toggleFollow(async () => true);
		expect(social.followPending.value).toBe(false);
		expect(mock.api.mock.calls.some(([endpoint]) => endpoint === 'following/requests/cancel')).toBe(true);
	});

	it('allows an intentional follow when the author opts out of recommendations', async () => {
		const original = mock.api.getMockImplementation()!;
		mock.api.mockImplementation(async (endpoint, ...args) => {
			const value = await original(endpoint, ...args);
			return endpoint === 'users/show' ? { ...value, isExplorable: false } : value;
		});
		const { social } = await mount();
		await social.toggleFollow(async () => true);
		expect(social.following.value).toBe(true);
	});

	it('does not write for guests or follow the current account', async () => {
		mock.actor = null;
		const guest = await mount();
		await guest.social.toggleFollow(async () => true); await guest.social.toggleFavorite();
		expect(mock.api.mock.calls.map(([endpoint]) => endpoint)).toEqual(['users/show']);
		dispose?.();
		mock.actor = { id: 'creator' }; mock.api.mockClear();
		const own = await mount();
		expect(own.social.ownWork.value).toBe(true);
		await own.social.toggleFollow(async () => true);
		expect(mock.api.mock.calls.some(([endpoint]) => endpoint.startsWith('following/'))).toBe(false);
	});

	it('makes no extra account requests for ordinary feed cards', async () => {
		await mount(work(), false);
		expect(mock.api).not.toHaveBeenCalled();
	});

	it('ignores the previous work response after route changes', async () => {
		const { social, current } = await mount();
		const original = mock.api.getMockImplementation()!;
		let finish: (value: { id: string; username: string }) => void = () => {};
		mock.api.mockImplementation((endpoint, params, ...args) => endpoint === 'users/show' && params.userId === 'slow' ? new Promise(resolve => { finish = resolve; }) : original(endpoint, params, ...args));
		current.value = work('slow-work', 'slow'); await nextTick();
		current.value = work('current-work', 'current'); await nextTick();
		await vi.waitFor(() => expect(social.author.value?.id).toBe('current'));
		finish({ id: 'slow', username: 'slow' }); await nextTick(); await nextTick();
		expect(social.author.value?.id).toBe('current');
	});
});
